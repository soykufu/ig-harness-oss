import {pathToFileURL} from 'node:url';
import {inspectAppWebhook} from './soykufu-app-webhook-readonly.mjs';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
const ORIGIN='https://soykufu-ig-harness-20261119.soykufu.workers.dev';
const FP='9c96599e2e5abdd130ee0be1caa37d2c44bb9b155a6bdde98db36bec14e5937f';
const safeState=v=>['ok','missing','error','skipped'].includes(v)?v:'unknown';
export async function inspectReceivingPreflight({env,readRuntime,readAccounts,readApp}){
 const held=reason=>({ok:false,state:'receiving_preflight_held',reason,credentialWritesAttempted:false,subscriptionAttempted:false,messagesSent:0});
 if(env.GITHUB_REPOSITORY!=='soykufu/ig-harness-oss'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch')return held('official_runtime_required');
 try{
  const before=await readRuntime();
  const runtimeOk=r=>r?.deploymentStable===true&&r.deployedBindingsVerified===true&&r.preparationLockVerified===true&&r.extraFlagsVerified===true&&r.deploymentFingerprint===FP;
  if(!runtimeOk(before))return held('runtime_requires_reconciliation');
  const rows=await readAccounts();if(!Array.isArray(rows)||rows.length!==1)return held('account_requires_reconciliation');
  const a=rows[0];if(a?.igUserId!=='17841402028638204'||a.username!=='soykufu'||a.pageId!=='1632563283635095'||a.connectionType!=='facebook_login'||a.isActive!==true||a.isDefault!==false)return held('account_requires_reconciliation');
  const app=await readApp();if(app?.ok!==true||app.appIdentityVerified!==true)return held('app_observation_unverified');
  const c=before.connectionCredentialMetadata,objects=app.objects;
  if(c?.verified!==true||!Array.isArray(objects))return held('observation_unverified');
  const ig=objects.filter(o=>o?.object==='instagram');
  const configured=ig.length===1&&app.listingIncomplete===false&&ig[0].active===true&&ig[0].callbackMatches===true&&ig[0].fieldsVerified===true;
  const fields=configured&&Array.isArray(ig[0].fields)?ig[0].fields:[];
  const secretAvailable=c.appSecretPresent===true||a.hasAppSecret===true,verifyAvailable=c.verifyTokenPresent===true||a.hasVerifyToken===true;
  const appIdAvailable=c.appIdConfigured===true||(a.tokenDebug?.status==='ok'&&a.tokenDebug.appId==='2224712165014101');
  // Native D1 bookmarks may advance during authenticated GET rate counting.
  // Reconcile deployment/configuration, not a changing recovery timestamp.
  const stable=r=>[r.deploymentFingerprint,r.deployedBindingsVerified,r.preparationLockVerified,r.extraFlagsVerified,r.r2DirectPublicAccessDisabled,r.connectionCredentialMetadata];
  const after=await readRuntime();if(!runtimeOk(after)||JSON.stringify(stable(before))!==JSON.stringify(stable(after)))return held('runtime_changed');
  return{ok:true,state:'receiving_preflight_observed',appSecretAvailable:secretAvailable,verifyTokenAvailable:verifyAvailable,appIdAvailable,
   appListingComplete:app.listingIncomplete===false,instagramSubscriptionObserved:ig.length>0,
   dmFieldsConfigured:configured&&['messages','messaging_postbacks','messaging_referral'].every(f=>fields.includes(f)),
   cachedProfileProbe:safeState(a.connection?.profile?.state),cachedMessagingProbe:safeState(a.connection?.permissions?.messages?.state),cachedCommentProbe:safeState(a.connection?.permissions?.comments?.state),
   permissionGrantStatus:'not_verified_by_five_scope_check',instagramSetupVia:'meta_app_dashboard',
   receivingVerified:false,credentialWritesAttempted:false,subscriptionAttempted:false,messagesSent:0};
 }catch{return held('read_failed');}
}
async function boundedJson(response){
 if(!response.ok||!response.body)throw Error('read_failed');const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144)throw Error('read_failed');parts.push(value);}}finally{await reader.cancel();}
 const data=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!data||data.error)throw Error('read_failed');return data;
}
async function main(){const e=process.env;return inspectReceivingPreflight({env:e,
 readRuntime:()=>readStoppedRuntimeSnapshot({read:async path=>{
  if(!e.CLOUDFLARE_API_TOKEN||!isStoppedRuntimeReadPath(path))throw Error('read_path');const body=await boundedJson(await fetch('https://api.cloudflare.com/client/v4'+path,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+e.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(20000)}));if(body.success!==true)throw Error('read_failed');return body.result;
 }}),readAccounts:async()=>{
  if(!e.IG_HARNESS_API_KEY)throw Error('credential_missing');const body=await boundedJson(await fetch(ORIGIN+'/api/accounts',{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+e.IG_HARNESS_API_KEY},signal:AbortSignal.timeout(20000)}));if(body.success!==true)throw Error('read_failed');return body.data;
 },readApp:()=>inspectAppWebhook(e)});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let r;try{r=await main();}catch{r={ok:false,state:'receiving_preflight_held',reason:'read_failed'};}console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}
