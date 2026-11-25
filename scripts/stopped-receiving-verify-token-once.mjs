import {pathToFileURL} from 'node:url';
import {businessSnapshot} from './stopped-migration-apply.mjs';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
import {readStoppedInstallationSnapshot} from './stopped-installation-snapshot.mjs';
import {inspectAppWebhook} from './soykufu-app-webhook-readonly.mjs';

const ACCOUNT='e76a3f504309ca9289d8dfa3ee504502',DATABASE='e55c3b84-ea9a-48fd-a7a3-08253089d295';
const ORIGIN='https://soykufu-ig-harness-20261119.soykufu.workers.dev';
const FINGERPRINT='154f4550c1a25a023cbc2e2b01239e07bddd138e0a6095f4dd7a6ceee3e868e6';
const reasons=['official_single_run_required','dedicated_credential_unverified','stopped_state_unverified','account_unverified','app_subscription_requires_reconciliation','baseline_changed','credential_request_unknown','postcheck_failed'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function verifyOfficialRun(e){
 return e.GITHUB_ACTIONS==='true'&&e.GITHUB_REPOSITORY==='soykufu/ig-harness-oss'&&e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_EVENT_NAME==='workflow_dispatch'&&e.GITHUB_RUN_NUMBER==='93'&&e.GITHUB_RUN_ATTEMPT==='1'&&e.APPROVED_RECEIVING_VERIFY_TOKEN==='fixed-account-verification-only';
}
export function dedicatedValue(e){
 const v=e.IG_WEBHOOK_VERIFY_TOKEN;
 return typeof v==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(v)&&v!==e.IG_HARNESS_API_KEY&&v!==e.IG_META_APP_SECRET;
}
export function maskVerifyColumns(rows,columns){
 if(!Array.isArray(rows)||rows.length!==1||!Array.isArray(columns))throw Error('account_unverified');
 const out=structuredClone(rows);
 for(const name of ['verify_token','updated_at']){
  const i=columns.findIndex(c=>c.name===name);if(i<0)throw Error('account_unverified');
  out[0]['t'+i]='allowed_column';out[0]['v'+i]='allowed_column';
 }
 return out;
}
function validSnapshot(s){
 const r=s?.runtime,i=s?.installation,a=s?.account;
 return r?.deploymentStable===true&&r.deployedBindingsVerified===true&&r.preparationLockVerified===true&&r.extraFlagsVerified===true&&r.r2DirectPublicAccessDisabled===true&&r.deploymentFingerprint===FINGERPRINT&&
 i?.stopped===true&&i.connectedAccounts===1&&i.followers===0&&i.registeredAccountVerified===true&&i.schemaReady===true&&i.appliedMigrationCount===41&&
 a?.igUserId==='17841402028638204'&&a.username==='soykufu'&&a.pageId==='1632563283635095'&&a.connectionType==='facebook_login'&&a.isActive===true&&a.isDefault===false&&a.hasAppSecret===true&&/^[a-f0-9-]{36}$/i.test(a.id)&&s.paused===true&&s.integrity===true;
}
function stable(s){return [s.account.id,s.runtime.deploymentFingerprint,s.runtime.deployedBindingsVerified,s.runtime.preparationLockVerified,s.runtime.extraFlagsVerified,s.runtime.r2DirectPublicAccessDisabled,s.runtime.connectionCredentialMetadata,s.installation,s.business];}
function appAbsent(a){return a?.ok===true&&a.appIdentityVerified===true&&a.listingIncomplete===false&&a.appObjectCount===0&&a.unrelatedObjectCount===0&&Array.isArray(a.objects)&&a.objects.length===0;}
export async function installVerifyTokenOnce({official,credentialValid,snapshot,inspectApp,patch}){
 const r={ok:false,state:'receiving_verify_token_held',phase:'preflight',credentialWriteAttempted:false,credentialAccepted:false,subscriptionAttempted:false,webhookRequestAttempted:false,messagesSent:0};
 try{
  if(!official)throw Error('official_single_run_required');
  if(!credentialValid)throw Error('dedicated_credential_unverified');
  const before=await snapshot();if(!validSnapshot(before))throw Error('stopped_state_unverified');
  const app=await inspectApp();if(!appAbsent(app))throw Error('app_subscription_requires_reconciliation');
  const second=await snapshot();if(!validSnapshot(second)||!same(stable(before),stable(second))||before.candidateMatches!==second.candidateMatches)throw Error('baseline_changed');
  if(before.candidateMatches!==true){
   r.phase='credential_request';r.credentialWriteAttempted=true;
   if(await patch(before.account.id)!==true)throw Error('credential_request_unknown');
   r.credentialAccepted=true;
  }
  r.phase='postcheck';
  const after=await snapshot();
  if(!validSnapshot(after)||!same(stable(before),stable(after))||after.candidateMatches!==true)throw Error('postcheck_failed');
  const appAfter=await inspectApp();
  if(!appAbsent(appAfter)||!same(app,appAfter))throw Error('postcheck_failed');
  const final=await snapshot();
  if(!validSnapshot(final)||!same(stable(after),stable(final))||final.candidateMatches!==true)throw Error('postcheck_failed');
  return {...r,ok:true,state:'stopped_receiving_verify_token_verified',dedicatedCandidateMatched:true,alreadyConfigured:!r.credentialWriteAttempted,businessUnchanged:true,existingPageTokenUnchanged:true,existingAppSecretUnchanged:true,configurationUnchanged:true,subscriptionsUnchanged:true,guardrailsPaused:true,preparationLock:true,receivingVerified:false};
 }catch(e){return {...r,reason:reasons.includes(e?.message)?e.message:'validation_failed'};}
}
async function boundedJson(response){
 if(!response.ok||!response.body)throw Error('read_failed');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16777216)throw Error('read_failed');parts.push(value);}}finally{await reader.cancel();}
 const body=JSON.parse(Buffer.concat(parts).toString('utf8'));
 if(!body||body.error||body.success===false)throw Error('read_failed');return body;
}
async function main(){
 const e=process.env;
 if(!verifyOfficialRun(e)||!dedicatedValue(e))return installVerifyTokenOnce({official:verifyOfficialRun(e),credentialValid:dedicatedValue(e)});
 if(!e.CLOUDFLARE_API_TOKEN||!e.IG_HARNESS_API_KEY||!e.IG_META_APP_SECRET)throw Error('read_failed');
 const request=(url,init={})=>fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});
 const query=async(sql,params=[])=>{
  if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)||sql.includes(';'))throw Error('read_only');
  const body=await boundedJson(await request('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/'+DATABASE+'/query',{
   method:'POST',headers:{Authorization:'Bearer '+e.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({sql,params})
  }));
  if(body.success!==true||body.result?.length!==1||!Array.isArray(body.result[0].results))throw Error('read_failed');
  return body.result[0].results;
 };
 const worker=async(path,init={})=>boundedJson(await request(ORIGIN+path,{...init,headers:{Authorization:'Bearer '+e.IG_HARNESS_API_KEY,...(init.headers||{})}}));
 const readRuntime=()=>readStoppedRuntimeSnapshot({read:async path=>{
  if(!isStoppedRuntimeReadPath(path))throw Error('read_path');
  const b=await boundedJson(await request('https://api.cloudflare.com/client/v4'+path,{method:'GET',headers:{Authorization:'Bearer '+e.CLOUDFLARE_API_TOKEN}}));
  if(b.success!==true)throw Error('read_failed');return b.result;
 }});
 return installVerifyTokenOnce({
  official:true,credentialValid:true,inspectApp:()=>inspectAppWebhook(e),
  snapshot:async()=>{
   const runtime=await readRuntime(),installation=await readStoppedInstallationSnapshot({repoDir:process.cwd(),registeredAccount:true,query});
   const rows=(await worker('/api/accounts',{method:'GET'})).data;
   if(!Array.isArray(rows)||rows.length!==1||!/^[a-f0-9-]{36}$/i.test(rows[0]?.id))throw Error('account_unverified');
   const account=rows[0],columns=await query('PRAGMA table_xinfo("ig_accounts")');
   let masked=false;
   const business=await businessSnapshot(async sql=>{
    const result=await query(sql);
    if(/^SELECT .* FROM "ig_accounts" LIMIT 10001$/.test(sql)){if(masked)throw Error('read_failed');masked=true;return maskVerifyColumns(result,columns);}
    return result;
   });
   if(!masked)throw Error('read_failed');
   const match=await query('SELECT COUNT(*) AS matching FROM ig_accounts WHERE id=? AND verify_token=?',[account.id,e.IG_WEBHOOK_VERIFY_TOKEN]);
   const guards=await worker('/api/delivery-guardrails?account_id='+account.id,{method:'GET'});
   const quick=await query('PRAGMA quick_check'),fk=await query('PRAGMA foreign_key_check');
   return {runtime,installation,account,business,candidateMatches:match.length===1&&match[0].matching===1,paused:guards.data?.paused===true,integrity:quick.length===1&&quick[0].quick_check==='ok'&&fk.length===0};
  },
  patch:async id=>{
   if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('account_unverified');
   const body=await worker('/api/accounts/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({verifyToken:e.IG_WEBHOOK_VERIFY_TOKEN})});
   return body.success===true&&body.data?.id===id&&body.data?.hasVerifyToken===true;
  }
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let result;try{result=await main();}catch{result={ok:false,state:'receiving_verify_token_held',phase:'preparation',reason:'read_failed',credentialWriteAttempted:false,subscriptionAttempted:false,webhookRequestAttempted:false,messagesSent:0};}
 console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
