import {pathToFileURL} from 'node:url';
export const APP_ID='2224712165014101';
const CALLBACK='https://soykufu-ig-harness-20261119.soykufu.workers.dev/webhook';
const KNOWN_FIELDS=new Set(['messages','messaging_postbacks','messaging_referral','comments','mentions','live_comments','message_reactions','messaging_seen','standby']);

// App credentials stay in the official runner. No exchange, persistence,
// subscription repair or callback validation request is implemented here.
export async function inspectAppWebhook(env,fetchImpl=fetch){
 if(env.GITHUB_REPOSITORY!=='soykufu/ig-harness-oss'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch')return{ok:false,state:'official_runtime_required'};
 const secret=env.IG_META_APP_SECRET;
 if(typeof secret!=='string'||!secret)return{ok:false,state:'app_secret_not_saved'};
 if(!/^[a-f0-9]{32}$/i.test(secret))return{ok:false,state:'app_secret_format_unverified'};
 const get=async endpoint=>{
  const response=await fetchImpl(`https://graph.facebook.com/v25.0/${endpoint}`,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${APP_ID}|${secret}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('http');
  if(!response.body)throw Error('body');
  const reader=response.body.getReader(),chunks=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw Error('size');}chunks.push(value);}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!data||typeof data!=='object'||data.error)throw Error('data');return data;
 };
 try{
  const app=await get(`${APP_ID}?fields=id`);
  if(app.id!==APP_ID)return{ok:false,state:'app_identity_mismatch'};
  const subscriptions=await get(`${APP_ID}/subscriptions`);
  if(!Array.isArray(subscriptions.data))return{ok:false,state:'subscription_response_unverified'};
  const unrelated=subscriptions.data.filter(row=>row?.object!=='instagram'&&row?.object!=='page');
  const unrelatedFieldShapeUnverified=unrelated.some(row=>!Array.isArray(row?.fields)||row.fields.some(f=>{const n=typeof f==='string'?f:f?.name;return typeof n!=='string'||!/^[a-z_]{1,64}$/.test(n);}));
  const relevant=subscriptions.data.filter(row=>row?.object==='instagram'||row?.object==='page');
  const objects=relevant.map(row=>{
   const fields=Array.isArray(row.fields)?row.fields.map(field=>typeof field==='string'?field:field?.name):[];
   return{object:row.object,callbackMatches:row.callback_url===CALLBACK,active:typeof row.active==='boolean'?row.active:null,
    fields:[...new Set(fields.filter(field=>KNOWN_FIELDS.has(field)))].sort(),
    fieldsVerified:Array.isArray(row.fields)&&fields.every(field=>typeof field==='string'),
    unknownFieldsPresent:fields.some(field=>!KNOWN_FIELDS.has(field))};
  });
  // Observation only; never combine fields from different callbacks/objects
  // into an asserted complete receiving subscription.
  return{ok:true,state:'app_webhook_observed',appIdentityVerified:true,
   listingIncomplete:Boolean(subscriptions.paging?.next),objects,appObjectCount:subscriptions.data.length,unrelatedObjectCount:unrelated.length,unrelatedFieldShapeUnverified,
   receivingVerified:false,subscriptionAttempted:false,callbackRequestAttempted:false,
   credentialsInstalled:false,messagesSent:0};
 }catch{return{ok:false,state:'app_read_failed',subscriptionAttempted:false,messagesSent:0};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let result;try{result=await inspectAppWebhook(process.env);}catch{result={ok:false,state:'app_read_failed'};}
 console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
