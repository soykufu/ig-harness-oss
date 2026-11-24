import {pathToFileURL} from 'node:url';
const APP_ID='2224712165014101';
export const PAIR_SCOPES=Object.freeze(['business_management','instagram_basic','instagram_manage_messages','pages_read_engagement','pages_show_list']);
const DAY=86400;
function normalizedSet(values){
 if(!Array.isArray(values)||values.some(v=>typeof v!=='string'||!v||v!==v.trim())||new Set(values).size!==values.length)return null;
 return [...values].sort();
}
function granularTargets(value){
 if(!Array.isArray(value))return null;
 const names=new Set(),rows=[];
 for(const row of value){
  if(!row||typeof row.scope!=='string'||!row.scope||names.has(row.scope))return null;
  const targets=normalizedSet(row.target_ids);if(!targets)return null;
  names.add(row.scope);rows.push([row.scope,targets]);
 }
 return JSON.stringify(rows.sort((a,b)=>a[0].localeCompare(b[0])));
}
// Pure metadata inspection: never exchange, persist, return an identity or
// authorize installation. A current is_valid result is not a lifetime promise.
export function assessMetaTokenLifecycle(data,nowSeconds){
 const held=reason=>({state:'held',reason,exchangeReviewReady:false,exchangeAuthorized:false,storageAuthorized:false});
 if(!Number.isSafeInteger(nowSeconds)||nowSeconds<=0)return held('clock_unverified');
 if(data?.error||data?.is_valid!==true||data?.app_id!==APP_ID||data?.type!=='USER')return held('user_token_identity_unverified');
 const scopes=normalizedSet(data.scopes);
 if(!scopes||PAIR_SCOPES.some(scope=>!scopes.includes(scope)))return held('scopes_unverified');
 for(const field of ['expires_at','data_access_expires_at']){
  if(!Number.isSafeInteger(data[field])||data[field]<=0)return held('lifetime_unknown');
  if(data[field]<=nowSeconds)return held('credential_expired');
 }
 if(data.data_access_expires_at-nowSeconds<=900)return held('data_access_renewal_required');
 const remaining=data.expires_at-nowSeconds;
 if(remaining<=900)return held('insufficient_exchange_window');
 return{state:remaining<=7*DAY?'exchange_review_ready':'validity_monitoring',reason:null,
  remainingBand:remaining<=3600?'within_1_hour':remaining<=DAY?'within_24_hours':remaining<=7*DAY?'within_7_days':'beyond_7_days',
  exchangeReviewReady:remaining<=7*DAY,exchangeAuthorized:false,storageAuthorized:false};
}
// Validate a prospective server-side exchange before any storage. The caller
// must separately authorize duration/storage and freshly recheck Page/IG.
// No network, credential inputs, mutation transport or CLI entry exists here.
export function assessMetaTokenReplacement(before,after,nowSeconds){
 const held=reason=>({state:'held',reason,replacementVerified:false,storageAuthorized:false,registrationAuthorized:false});
 const initial=assessMetaTokenLifecycle(before,nowSeconds),candidate=assessMetaTokenLifecycle(after,nowSeconds);
 if(initial.state==='held'||candidate.state==='held')return held('token_metadata_unverified');
 if(initial.exchangeReviewReady!==true)return held('exchange_not_needed');
 if(typeof before.user_id!=='string'||!before.user_id||before.user_id!==after.user_id)return held('subject_changed_or_unknown');
 const oldScopes=normalizedSet(before.scopes),newScopes=normalizedSet(after.scopes);
 if(JSON.stringify(oldScopes)!==JSON.stringify(newScopes))return held('permission_set_changed');
 const oldTargets=granularTargets(before.granular_scopes),newTargets=granularTargets(after.granular_scopes);
 if(oldTargets===null||newTargets===null||oldTargets!==newTargets)return held('asset_scope_changed_or_unknown');
 if(after.expires_at<=before.expires_at||after.expires_at-nowSeconds<=7*DAY||after.expires_at-nowSeconds>61*DAY)return held('replacement_lifetime_unverified');
 if(after.data_access_expires_at!==before.data_access_expires_at)return held('data_access_lifetime_changed');
 if(after.data_access_expires_at-nowSeconds<=7*DAY)return held('data_access_renewal_required');
 return{state:'replacement_metadata_verified',reason:null,replacementVerified:true,
  storageAuthorized:false,registrationAuthorized:false};
}
function safeDiagnostic(error,data,now){
 const numeric=value=>Number.isSafeInteger(value)&&value>=0&&value<=2147483647?value:null;
 const seconds=Math.floor(now()/1000);
 return{graphCode:numeric(error?.code),graphSubcode:numeric(error?.error_subcode??error?.subcode),
  appMatches:typeof data?.app_id==='string'&&/^\d+$/.test(data.app_id)?data.app_id===APP_ID:null,
  tokenValid:typeof data?.is_valid==='boolean'?data.is_valid:null,
  expiryElapsed:Number.isSafeInteger(data?.expires_at)&&data.expires_at>0&&Number.isFinite(seconds)?data.expires_at<=seconds:null};
}
// The documented input_token query stays exclusively inside the official
// runner -> Meta request. Never return its URL, either key, user id or errors.
export async function inspectMetaPair(env,fetchImpl=fetch,now=Date.now){
 if(env.GITHUB_REPOSITORY!=='soykufu/ig-harness-oss'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch')return{ok:false,state:'official_runtime_required'};
 const secret=env.IG_META_APP_SECRET,token=env.IG_META_USER_ACCESS_TOKEN;
 if(typeof secret!=='string'||!secret||typeof token!=='string'||!token)return{ok:false,state:'pair_credentials_missing'};
 if(!/^[a-f0-9]{32}$/i.test(secret)||token!==token.trim()||/[\r\n]/.test(token)||token.length>8192)return{ok:false,state:'pair_credentials_format_unverified'};
 try{
  const url=new URL('https://graph.facebook.com/v25.0/debug_token');url.searchParams.set('input_token',token);
  const response=await fetchImpl(url.href,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${APP_ID}|${secret}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok||!response.body)return{ok:false,state:'pair_read_failed',httpStatus:response.status};
  const reader=response.body.getReader(),chunks=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return{ok:false,state:'pair_response_too_large'};}chunks.push(value);}
  const payload=JSON.parse(Buffer.concat(chunks).toString('utf8')),data=payload?.data;
  if(payload?.error)return{ok:false,state:'pair_response_unverified',...safeDiagnostic(payload.error,null,now)};
  if(!data||typeof data!=='object')return{ok:false,state:'pair_response_unverified'};
  if(data.error)return{ok:false,state:data.is_valid===false?'token_not_valid':'pair_response_unverified',...safeDiagnostic(data.error,data,now)};
  if(data.app_id!==APP_ID)return{ok:false,state:'token_app_mismatch'};
  if(data.is_valid!==true)return{ok:false,state:'token_not_valid'};
  const seconds=Math.floor(now()/1000);if(!Number.isFinite(seconds))return{ok:false,state:'inspection_time_invalid'};
  for(const field of ['expires_at','data_access_expires_at']){
   if(data[field]!==undefined&&(!Number.isSafeInteger(data[field])||data[field]<0))return{ok:false,state:'token_expiry_unverified'};
   if(data[field]>0&&data[field]<=seconds)return{ok:false,state:'token_expired'};
  }
  if(!Array.isArray(data.scopes))return{ok:false,state:'token_scopes_unverified'};
  const missing=PAIR_SCOPES.filter(scope=>data.scopes.filter(value=>value===scope).length!==1);
  if(missing.length)return{ok:false,state:'token_scopes_missing',missing};
  return{ok:true,state:'token_app_pair_verified',appMatches:true,tokenValid:true,requiredScopesVerified:true,
   tokenExpiryWithin7Days:data.expires_at>0?data.expires_at-seconds<=604800:null,
   dataAccessExpiryWithin7Days:data.data_access_expires_at>0?data.data_access_expires_at-seconds<=604800:null,
   lifecycle:assessMetaTokenLifecycle(data,seconds),
   targetAssetRechecked:false,credentialsInstalled:false,registrationAttempted:false,subscriptionAttempted:false,messagesSent:0};
 }catch{return{ok:false,state:'pair_read_failed'};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let result;try{result=await inspectMetaPair(process.env);}catch{result={ok:false,state:'pair_read_failed'};}
 console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
