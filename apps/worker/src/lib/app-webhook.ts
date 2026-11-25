// App-side Instagram webhook observation. Configuration of the instagram
// object belongs to the Meta App Dashboard, not POST /app/subscriptions.
// Official reference: https://developers.facebook.com/docs/graph-api/reference/app/subscriptions/
import type { CredentialEnv } from './credential-crypto.js';
import { readAppSecret } from './credential-crypto.js';
import { loadTokenDebug } from './token-debug.js';
export const APP_SUBSCRIPTION_FIELDS = ['messages','messaging_postbacks','messaging_referral','comments','mentions','live_comments'] as const;
const GRAPH_VERSION='v25.0';
async function resolveAppSecret(account:{id:string;ig_user_id:string;app_secret:string|null},env:CredentialEnv&{IG_APP_SECRET?:string}):Promise<string|undefined>{
  try{return(await readAppSecret(account,env))??env.IG_APP_SECRET??undefined;}catch{return env.IG_APP_SECRET??undefined;}
}
export interface AppSubscriptionObject {object:string;callbackUrl:string|null;fields:string[];active:boolean|null}
export interface AppWebhookReport {
  checkedAt:string;status:'ok'|'fail'|'unknown';appId:string|null;callbackUrl:string|null;
  objects:AppSubscriptionObject[];missingFields:string[];callbackMatches:boolean|null;
  listingIncomplete?:boolean;message?:string|null;
  readFailure?:'transport'|'http_auth'|'http_rate_limit'|'http_other'|'body_read'|'response_too_large'|'invalid_json'|'invalid_response'|'invalid_fields'|'invalid_app_id';
}
class SubscriptionReadError extends Error {
  constructor(readonly code:NonNullable<AppWebhookReport['readFailure']>){super('subscription_read_failed');}
}
export async function resolveAppId(env:CredentialEnv&{IG_APP_ID?:string;IG_APP_SECRET?:string},db:D1Database,accountId:string):Promise<string|null>{
  if(env.IG_APP_ID)return env.IG_APP_ID;
  const debug=await loadTokenDebug(db,accountId);return debug?.status==='ok'?debug.appId??null:null;
}
function normalizeFields(value:unknown):string[]{
  if(!Array.isArray(value))throw new SubscriptionReadError('invalid_fields');
  const fields=value.map((f:unknown)=>typeof f==='string'?f:f&&typeof f==='object'&&'name'in f?(f as {name:unknown}).name:null);
  if(fields.some(f=>typeof f!=='string'||!/^[a-z_]{1,64}$/.test(f))||new Set(fields).size!==fields.length)throw new SubscriptionReadError('invalid_fields');
  return fields as string[];
}
function callback(value:unknown):string|null{
  if(typeof value!=='string')return null;
  try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)return null;return u.href;}catch{return null;}
}
async function fetchSubscriptions(appId:string,secret:string):Promise<{objects:AppSubscriptionObject[];incomplete:boolean}>{
  if(!/^\d{1,64}$/.test(appId))throw new SubscriptionReadError('invalid_app_id');
  let res:Response;
  try{res=await fetch('https://graph.facebook.com/'+GRAPH_VERSION+'/'+appId+'/subscriptions',{
    method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+appId+'|'+secret},signal:AbortSignal.timeout(10000),
  });}catch{throw new SubscriptionReadError('transport');}
  if(!res.ok)throw new SubscriptionReadError(res.status===401||res.status===403?'http_auth':res.status===429?'http_rate_limit':'http_other');
  if(!res.body)throw new SubscriptionReadError('body_read');
  const reader=res.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw new SubscriptionReadError('response_too_large');parts.push(value);}}catch(error){throw error instanceof SubscriptionReadError?error:new SubscriptionReadError('body_read');}finally{try{await reader.cancel();}catch{/* cleanup must not hide the read outcome */}}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  let payload:{data?:unknown;error?:unknown;paging?:{next?:unknown}};
  try{payload=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new SubscriptionReadError('invalid_json');}
  if(!payload||payload.error||!Array.isArray(payload.data))throw new SubscriptionReadError('invalid_response');
  const objects=payload.data.map((item:unknown)=>{
    if(!item||typeof item!=='object')throw new SubscriptionReadError('invalid_response');
    const r=item as {object?:unknown;callback_url?:unknown;fields?:unknown;active?:unknown};
    if(typeof r.object!=='string'||!r.object)throw new SubscriptionReadError('invalid_response');
    return {object:r.object,callbackUrl:callback(r.callback_url),fields:normalizeFields(r.fields),active:typeof r.active==='boolean'?r.active:null};
  });
  return{objects,incomplete:payload.paging?.next!==undefined&&payload.paging.next!==null&&payload.paging.next!==''};
}
export async function checkAppWebhook(
  env:CredentialEnv&{IG_APP_ID?:string;IG_APP_SECRET?:string;WORKER_URL:string},db:D1Database,
  account:{id:string;ig_user_id:string;app_secret:string|null},
):Promise<AppWebhookReport>{
  const checkedAt=new Date().toISOString(),appId=await resolveAppId(env,db,account.id),secret=await resolveAppSecret(account,env);
  const base={checkedAt,appId,callbackUrl:null,objects:[],missingFields:[],callbackMatches:null};
  if(!appId||!secret)return{...base,status:'unknown',message:'アプリ情報が未設定のため、Webhook設定を確認できません。'};
  const expected=callback(env.WORKER_URL.replace(/\/$/,'')+'/webhook');
  if(!expected)return{...base,status:'unknown',message:'Webhookの受信先URLを確認してください。'};
  try{
    const {objects,incomplete}=await fetchSubscriptions(appId,secret);
    const relevant=objects.filter(o=>o.object==='instagram'||o.object==='page'),instagram=relevant.filter(o=>o.object==='instagram');
    const duplicates=['instagram','page'].some(type=>relevant.filter(o=>o.object===type).length>1);
    const fields=instagram.length===1?instagram[0]!.fields:[];
    const missingFields=APP_SUBSCRIPTION_FIELDS.filter(f=>!fields.includes(f));
    const callbackMatches=relevant.length>0&&relevant.every(o=>o.callbackUrl===expected);
    const unknown=incomplete||duplicates||relevant.some(o=>o.active===null);
    const status=unknown?'unknown':instagram.length!==1||!callbackMatches||relevant.some(o=>o.active!==true)||missingFields.length?'fail':'ok';
    return{checkedAt,status,appId,callbackUrl:instagram[0]?.callbackUrl??relevant[0]?.callbackUrl??null,objects,missingFields,callbackMatches,listingIncomplete:incomplete,
      message:status==='ok'?null:unknown?'購読情報が不完全なため、Metaのアプリ管理画面で確認してください。':'Metaのアプリ管理画面でInstagramのWebhook購読・受信先・有効状態を確認してください。'};
  }catch(error){return{...base,status:'unknown',...(error instanceof SubscriptionReadError?{readFailure:error.code}:{}),message:'アプリ側の購読情報を確認できませんでした。'};}
}
export interface FixAppWebhookResult {
  fixed:boolean;refused?:boolean;foreignUrl?:string;verifyTokenGenerated?:boolean;manualSetupRequired?:boolean;report:AppWebhookReport;
}
/** Observe first. Never rotate a verify token or issue an unsupported API write. */
export async function fixAppWebhook(
  env:CredentialEnv&{IG_APP_ID?:string;IG_APP_SECRET?:string;WORKER_URL:string},db:D1Database,
  account:{id:string;ig_user_id:string;app_secret:string|null},
  _opts:{updateAccountVerifyToken:(verifyToken:string)=>Promise<void>},
):Promise<FixAppWebhookResult>{
  const report=await checkAppWebhook(env,db,account),expected=callback(env.WORKER_URL.replace(/\/$/,'')+'/webhook');
  if(report.status==='unknown')return{fixed:false,verifyTokenGenerated:false,manualSetupRequired:true,report};
  const foreign=report.objects.find(o=>(o.object==='instagram'||o.object==='page')&&o.callbackUrl&&o.callbackUrl!==expected);
  if(foreign)return{fixed:false,refused:true,foreignUrl:foreign.callbackUrl!,verifyTokenGenerated:false,manualSetupRequired:true,report};
  if(report.status==='ok')return{fixed:true,verifyTokenGenerated:false,report};
  return{fixed:false,refused:true,verifyTokenGenerated:false,manualSetupRequired:true,report};
}

