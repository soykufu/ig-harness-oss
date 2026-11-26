import {pathToFileURL} from 'node:url';
import {inspectMetaPair} from './soykufu-meta-pair-readonly.mjs';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';

const APP='2224712165014101',PAGE='1632563283635095',IG='17841402028638204';
const ORIGIN='https://soykufu-ig-harness-20261119.soykufu.workers.dev';
const FP='02c5cc03682d18786407e22ee1cc9e4440b12197a87680789436c9eb7a59af61';
const DM_FIELDS=Object.freeze(['messages','messaging_postbacks','messaging_referrals']);
const noMutations={credentialWritesAttempted:false,subscriptionAttempted:false,configurationChanged:false,messagesSent:0,receivingVerified:false};
const runtimeOk=r=>r?.deploymentFingerprint===FP&&r.deploymentStable===true&&r.deployedBindingsVerified===true&&r.preparationLockVerified===true&&r.extraFlagsVerified===true;
const projection=r=>JSON.stringify([r.deploymentFingerprint,r.deployedBindingsVerified,r.preparationLockVerified,r.extraFlagsVerified,r.r2DirectPublicAccessDisabled,r.connectionCredentialMetadata]);
const accountOk=a=>a?.igUserId===IG&&a.username==='soykufu'&&a.pageId===PAGE&&a.connectionType==='facebook_login'&&a.isActive===true&&a.isDefault===false;

// Meta/credential-bearing responses are consumed only in the official runner.
// The public result has fixed booleans/fields; no tokens, candidate data or IDs.
export async function inspectStoppedPageSubscription({env,readRuntime,readAccounts,readPair,readPermissions,readPage,readSubscriptions}){
 const held=reason=>({ok:false,state:'stopped_page_subscription_held',reason,...noMutations});
 if(env.GITHUB_REPOSITORY!=='soykufu/ig-harness-oss'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch')return held('official_runtime_required');
 let phase='runtime',metadataObserved=null;
 try{
  const before=await readRuntime();if(!runtimeOk(before))return held('runtime_requires_reconciliation');
  phase='accounts';
  const accounts=await readAccounts();if(!Array.isArray(accounts)||accounts.length!==1||!accountOk(accounts[0]))return held('account_requires_reconciliation');
  phase='credential_pair';
  const pair=await readPair();if(pair?.ok!==true||pair.state!=='token_app_pair_verified'||pair.appMatches!==true||pair.tokenValid!==true)return held('provisioning_user_read_unverified');
  phase='permissions';
  const permissions=await readPermissions();
  if(!permissions||!Array.isArray(permissions.data)||permissions.paging?.next)return held('permissions_listing_unverified');
  const metadata=permissions.data.filter(r=>r?.permission==='pages_manage_metadata');
  if(metadata.length>1||metadata.some(r=>!['granted','declined','expired'].includes(r.status)))return held('permissions_listing_unverified');
  const pagesManageMetadataGranted=metadata.length===1&&metadata[0].status==='granted';
  metadataObserved=pagesManageMetadataGranted;
  phase='page_identity';
  const page=await readPage();if(page?.pageIdentityVerified!==true||page.pageTokenAvailable!==true)return held('fixed_page_unverified');
  phase='page_subscription';
  const response=await readSubscriptions();
  if(!response||!Array.isArray(response.data)||response.paging?.next)return held('page_subscription_listing_unverified');
  if(response.data.some(r=>!r||typeof r.id!=='string'||!/^\d+$/.test(r.id)))return held('page_subscription_listing_unverified');
  const fixed=response.data.filter(r=>r.id===APP);if(fixed.length>1)return held('duplicate_app_subscription');
  const fields=fixed[0]?.subscribed_fields??[];
  if(fixed.length&&(!Array.isArray(fixed[0].subscribed_fields)||fields.some(f=>typeof f!=='string'||!/^[a-z_]{1,80}$/.test(f))||new Set(fields).size!==fields.length))return held('page_fields_unverified');
  phase='final_runtime';
  const after=await readRuntime();if(!runtimeOk(after)||projection(before)!==projection(after))return held('runtime_changed');
  phase='final_accounts';
  const last=await readAccounts();if(!Array.isArray(last)||last.length!==1||!accountOk(last[0])||last[0].id!==accounts[0].id)return held('account_changed');
  return{ok:true,state:'stopped_page_subscription_observed',appIdentityVerified:true,pageIdentityVerified:true,permissionsListingComplete:true,pagesManageMetadataGranted,
   pageSubscriptionListingComplete:true,pageAppSubscribed:fixed.length===1,pageDmFieldsConfigured:fixed.length===1&&DM_FIELDS.every(f=>fields.includes(f)),
   observedPageDmFields:DM_FIELDS.filter(f=>fields.includes(f)),...noMutations};
 }catch{return{...held('read_failed'),readPhase:phase,...(metadataObserved===null?{}:{pagesManageMetadataGranted:metadataObserved})};}
}

async function boundedJson(response){
 if(!response.ok||!response.body)throw Error('read_failed');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144)throw Error('read_failed');chunks.push(value);}}finally{await reader.cancel();}
 const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||body.error)throw Error('read_failed');return body;
}

export async function runOfficialPageRead(env,fetchImpl=fetch){
 const official=env.GITHUB_REPOSITORY==='soykufu/ig-harness-oss'&&env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_EVENT_NAME==='workflow_dispatch';
 if(!official)return inspectStoppedPageSubscription({env});
 const keys=['CLOUDFLARE_API_TOKEN','IG_HARNESS_API_KEY','IG_META_USER_ACCESS_TOKEN','IG_META_APP_SECRET'];
 if(keys.some(k=>typeof env[k]!=='string'||!env[k]||env[k]!==env[k].trim()||/[\r\n]/.test(env[k])))return{ok:false,state:'stopped_page_subscription_held',reason:'diagnostic_credentials_unavailable',...noMutations};
 let pageToken;
 const get=async(url,token)=>boundedJson(await fetchImpl(url,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)}));
 const graph=(path,token)=>get('https://graph.facebook.com/v25.0/'+path,token);
 try{return await inspectStoppedPageSubscription({env,
  readRuntime:()=>readStoppedRuntimeSnapshot({read:async path=>{if(!isStoppedRuntimeReadPath(path))throw Error('read_path');const b=await get('https://api.cloudflare.com/client/v4'+path,env.CLOUDFLARE_API_TOKEN);if(b.success!==true)throw Error('read_failed');return b.result;}}),
  readAccounts:async()=>{const b=await get(ORIGIN+'/api/accounts',env.IG_HARNESS_API_KEY);if(b.success!==true)throw Error('read_failed');return b.data;},
  readPair:()=>inspectMetaPair(env,fetchImpl),
  readPermissions:()=>graph('me/permissions',env.IG_META_USER_ACCESS_TOKEN),
  readPage:async()=>{const p=await graph(PAGE+'?fields=id,instagram_business_account{id,username},access_token',env.IG_META_USER_ACCESS_TOKEN);const verified=p.id===PAGE&&p.instagram_business_account?.id===IG&&p.instagram_business_account.username==='soykufu';if(verified&&typeof p.access_token==='string'&&p.access_token.length>0&&p.access_token===p.access_token.trim()&&!/[\r\n]/.test(p.access_token))pageToken=p.access_token;return{pageIdentityVerified:verified,pageTokenAvailable:!!pageToken};},
  readSubscriptions:async()=>{if(!pageToken)throw Error('page_unverified');return graph(PAGE+'/subscribed_apps',pageToken);}
 });}finally{pageToken=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let r;try{r=await runOfficialPageRead(process.env);}catch{r={ok:false,state:'stopped_page_subscription_held',reason:'read_failed',...noMutations};}console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}
