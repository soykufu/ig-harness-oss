import {pathToFileURL} from 'node:url';
const APP_ID='2224712165014101';
export const PAIR_SCOPES=Object.freeze(['business_management','instagram_basic','instagram_manage_messages','pages_read_engagement','pages_show_list']);
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
  if(!response.ok||!response.body)return{ok:false,state:'pair_read_failed'};
  const reader=response.body.getReader(),chunks=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return{ok:false,state:'pair_response_too_large'};}chunks.push(value);}
  const payload=JSON.parse(Buffer.concat(chunks).toString('utf8')),data=payload?.data;
  if(payload?.error||!data||typeof data!=='object'||data.error)return{ok:false,state:'pair_response_unverified'};
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
   targetAssetRechecked:false,credentialsInstalled:false,registrationAttempted:false,subscriptionAttempted:false,messagesSent:0};
 }catch{return{ok:false,state:'pair_read_failed'};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let result;try{result=await inspectMetaPair(process.env);}catch{result={ok:false,state:'pair_read_failed'};}
 console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
