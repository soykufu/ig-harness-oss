import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {assessMetaTokenLifecycle,assessMetaTokenReplacement} from './soykufu-meta-pair-readonly.mjs';
import {verifyMeta} from './soykufu-meta-readonly.mjs';
import {businessSnapshot} from './stopped-migration-apply.mjs';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
import {readStoppedInstallationSnapshot} from './stopped-installation-snapshot.mjs';
import {summarizeWorkerBundle} from './stopped-backup-preflight.mjs';
import {backendEntry} from './stopped-account-preparation-apply.mjs';
import {readFile} from 'node:fs/promises';
const A='e76a3f504309ca9289d8dfa3ee504502',D='e55c3b84-ea9a-48fd-a7a3-08253089d295',NAME='soykufu-ig-harness-20261119';
const W='/accounts/'+A+'/workers/scripts/'+NAME,ORIGIN='https://'+NAME+'.soykufu.workers.dev',APP='2224712165014101',PAGE='1632563283635095',IG='17841402028638204';
const INDEX_HASH='638363e607c2e642da2c5a35c342fab0ff355078e46a86855da6128b34bf4cd4';
const hash=x=>createHash('sha256').update(x).digest('hex');
const format=t=>typeof t==='string'&&t.length>0&&t.length<=8192&&t===t.trim()&&!/[\r\n]/.test(t);
const reasons=['official_runtime_required','baseline_changed','token_precheck_failed','replacement_unverified','page_unverified','registration_unknown','registration_rejected','postcheck_failed'];
export async function registerStoppedOnce({official,snapshot,inspect,exchange,recheck,readPage,register,audit}){
 const r={ok:false,state:'stopped_registration_held',phase:'preflight',exchangeAttempted:false,registrationAttempted:false,registrationAccepted:false,subscriptionAttempted:false,messagesSent:0};
 try{
  if(!official)throw Error('official_runtime_required');
  const before=await snapshot();r.phase='token_precheck';
  const original=await inspect();if(assessMetaTokenLifecycle(original,Math.floor(Date.now()/1000)).exchangeReviewReady!==true)throw Error('token_precheck_failed');
  r.phase='exchange_request';r.exchangeAttempted=true;const candidate=await exchange();
  r.phase='replacement_recheck';const metadata=await recheck(candidate);
  if(!assessMetaTokenReplacement(original,metadata,Math.floor(Date.now()/1000)).replacementVerified)throw Error('replacement_unverified');
  const page=await readPage(candidate);if(page?.verified!==true||!format(page.token))throw Error('page_unverified');
  r.phase='registration_precheck';if(JSON.stringify(before)!==JSON.stringify(await snapshot()))throw Error('baseline_changed');
  r.phase='registration_request';r.registrationAttempted=true;const result=await register(page.token);
  if(result?.accepted!==true)throw Error(result?.rejected===true?'registration_rejected':'registration_unknown');
  r.registrationAccepted=true;r.phase='postcheck';const checks=await audit(before,result);
  if(checks?.ok!==true)throw Error('postcheck_failed');
  return{...r,ok:true,state:'stopped_account_registered',verification:checks};
 }catch(e){return{...r,reason:reasons.includes(e?.message)?e.message:'operation_failed'};}
}
async function json(response,limit=65536){
 if(!response.ok||!response.body)throw Error('provider_response_failed');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('provider_response_failed');parts.push(value);}}finally{await reader.cancel();}
 const body=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!body||typeof body!=='object'||body.error)throw Error('provider_response_failed');return body;
}
export async function main(e=process.env){
 const official=e.GITHUB_REPOSITORY==='soykufu/ig-harness-oss'&&e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_EVENT_NAME==='workflow_dispatch'&&e.GITHUB_RUN_NUMBER==='67'&&e.GITHUB_RUN_ATTEMPT==='1'&&e.APPROVED_CONNECTION_PHASE==='registration'
  &&format(e.IG_META_USER_ACCESS_TOKEN)&&/^[a-f0-9]{32}$/i.test(e.IG_META_APP_SECRET??'')&&!!e.CLOUDFLARE_API_TOKEN&&!!e.IG_HARNESS_API_KEY;
 const request=(url,options={})=>fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});
 const api=async(path,sql)=>{
  if(sql===undefined){if(!isStoppedRuntimeReadPath(path)&&![W+'/settings',W+'/content/v2'].includes(path))throw Error('read_only');}
  else if(path!=='/accounts/'+A+'/d1/database/'+D+'/query'||!/^\s*(SELECT|PRAGMA)\b/i.test(sql)||sql.includes(';'))throw Error('read_only');
  const response=await request('https://api.cloudflare.com/client/v4'+path,{method:sql===undefined?'GET':'POST',headers:{Authorization:`Bearer ${e.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},...(sql===undefined?{}:{body:JSON.stringify({sql})})});
  if(path.endsWith('/content/v2')){if(!response.ok)throw Error('content_failed');return summarizeWorkerBundle(Buffer.from(await response.arrayBuffer()),response.headers.get('content-type'),response.headers.get('cf-entrypoint'));}
  const body=await json(response,20*1024*1024);if(body.success!==true)throw Error('provider_response_failed');return body.result;
 };
 const query=async sql=>(await api('/accounts/'+A+'/d1/database/'+D+'/query',sql))[0].results;
 const worker=async(path,options={})=>request(ORIGIN+path,{...options,headers:{Authorization:`Bearer ${e.IG_HARNESS_API_KEY}`,'Content-Type':'application/json'}});
 const graph=async(path,token)=>json(await request('https://graph.facebook.com/v25.0/'+path,{headers:{Authorization:`Bearer ${token}`}}));
 const inspect=async token=>{
  const url=new URL('https://graph.facebook.com/v25.0/debug_token');url.searchParams.set('input_token',token);
  const b=await json(await request(url.href,{headers:{Authorization:`Bearer ${APP}|${e.IG_META_APP_SECRET}`}}));return b.data;
 };
 const snapshot=async()=>{
  const runtime=await readStoppedRuntimeSnapshot({read:path=>api(path)}),installation=await readStoppedInstallationSnapshot({repoDir:process.cwd(),query});
  if(!runtime.deploymentStable||!runtime.deployedBindingsVerified||!runtime.preparationLockVerified||!runtime.extraFlagsVerified||!runtime.r2DirectPublicAccessDisabled||!runtime.connectionCredentialMetadata?.tokenEncryptionKeyPresent||!runtime.connectionCredentialMetadata?.environmentAccountAbsent||!installation.stopped||!installation.schemaReady||installation.appliedMigrationCount!==41)throw Error('baseline_changed');
  const bundle=await api(W+'/content/v2'),guard=await readFile(new URL('./recovery-bucket-guard.mjs',import.meta.url));
  const expected=[['index.js',INDEX_HASH],['backend-entry.js',hash(backendEntry)],['recovery-bucket-guard.mjs',hash(guard)]].map(([name,sha256])=>({name,sha256})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  if(bundle.entrypoint!=='backend-entry.js'||JSON.stringify(bundle.modules.map(({name,sha256})=>({name,sha256})))!==JSON.stringify(expected))throw Error('baseline_changed');
  const settings=await api(W+'/settings'),business=await businessSnapshot(query),subscriptions=await graph(APP+'/subscriptions',APP+'|'+e.IG_META_APP_SECRET);
  if(!Array.isArray(subscriptions.data)||subscriptions.paging?.next)throw Error('baseline_changed');
  return{fingerprint:runtime.deploymentFingerprint,settingsHash:hash(JSON.stringify(settings)),business,subscriptionsHash:hash(JSON.stringify(subscriptions.data))};
 };
 return registerStoppedOnce({official,snapshot,inspect:()=>inspect(e.IG_META_USER_ACCESS_TOKEN),exchange:async()=>{
  const url=new URL('https://graph.facebook.com/v25.0/oauth/access_token');url.searchParams.set('grant_type','fb_exchange_token');url.searchParams.set('client_id',APP);url.searchParams.set('client_secret',e.IG_META_APP_SECRET);url.searchParams.set('fb_exchange_token',e.IG_META_USER_ACCESS_TOKEN);
  const body=await json(await request(url.href));if(!format(body.access_token)||body.token_type?.toLowerCase()!=='bearer'||!Number.isSafeInteger(body.expires_in)||body.expires_in<=604800||body.expires_in>61*86400)throw Error('replacement_unverified');return body.access_token;
 },recheck:inspect,readPage:async token=>{
  const v=await verifyMeta({...e,IG_META_USER_ACCESS_TOKEN:token},request);if(!v.ok)throw Error('page_unverified');
  const p=await graph(PAGE+'?fields=id,access_token,instagram_business_account{id,username}',token);
  if(p.id!==PAGE||p.instagram_business_account?.id!==IG||p.instagram_business_account?.username!=='soykufu'||!format(p.access_token))throw Error('page_unverified');
  const d=await inspect(p.access_token);if(d?.is_valid!==true||d.app_id!==APP||d.type!=='PAGE')throw Error('page_unverified');
  const me=await graph('me?fields=id',p.access_token);if(me.id!==PAGE)throw Error('page_unverified');return{verified:true,token:p.access_token};
 },register:async token=>{
  const response=await worker('/api/accounts',{method:'POST',body:JSON.stringify({igUserId:IG,username:'soykufu',connectionType:'facebook_login',accessToken:token,subscribeWebhooks:false})});
  if(response.status!==201){await response.body?.cancel();return{accepted:false,rejected:response.status>=400&&response.status<500};}
  const body=await json(response);const a=body.data;
  return{accepted:body.success===true&&a?.igUserId===IG&&a.username==='soykufu'&&a.pageId===PAGE&&a.connectionType==='facebook_login'&&a.isActive===true&&a.isDefault===false&&a.connection?.profile?.state==='ok'&&a.connection?.webhook?.subscribedNow===false,id:a?.id};
 },audit:async(before,result)=>{
  const id=result.id;if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))throw Error('postcheck_failed');
  const quote="'"+id+"'",keys=['token_valid','connection','graph_usage','graph_backoff_until'].map(k=>"'health:"+k+":"+id+"'").join(',');
  const filtered=sql=>{
   for(const [table,condition]of [['ig_accounts','id <> '+quote],['integration_settings','key NOT IN ('+keys+')'],['delivery_failures',"NOT (account_id="+quote+" AND source='account_setup' AND stage='check')"]])sql=sql.replace(' FROM '+JSON.stringify(table)+' LIMIT 10001',' FROM '+JSON.stringify(table)+' WHERE '+condition+' LIMIT 10001');
   return query(sql);
  };
  const business=await businessSnapshot(filtered),runtime=await readStoppedRuntimeSnapshot({read:path=>api(path)}),settings=await api(W+'/settings');
  const rows=await query("SELECT id,ig_user_id,username,page_id,connection_type,is_active,is_default,access_token LIKE 'enc:v1:%' AS encrypted,app_secret IS NULL AS no_secret,verify_token IS NULL AS no_verify FROM ig_accounts");
  const count=await query("SELECT (SELECT value FROM integration_settings WHERE key='outbound_paused') AS paused,(SELECT COUNT(*) FROM followers) AS followers");
  const integrity=await query('PRAGMA quick_check'),fk=await query('PRAGMA foreign_key_check'),subscriptions=await graph(APP+'/subscriptions',APP+'|'+e.IG_META_APP_SECRET);
  const row=rows[0];const checks={businessUnchanged:JSON.stringify(business)===JSON.stringify(before.business),singleEncryptedAccount:rows.length===1&&row.id===id&&row.ig_user_id===IG&&row.username==='soykufu'&&row.page_id===PAGE&&row.connection_type==='facebook_login'&&row.is_active===1&&row.is_default===0&&row.encrypted===1&&row.no_secret===1&&row.no_verify===1,
   stopped:count[0]?.paused==='1'&&count[0]?.followers===0&&runtime.preparationLockVerified===true&&runtime.extraFlagsVerified===true,configurationUnchanged:hash(JSON.stringify(settings))===before.settingsHash&&runtime.deploymentFingerprint===before.fingerprint,
   subscriptionsUnchanged:Array.isArray(subscriptions.data)&&!subscriptions.paging?.next&&hash(JSON.stringify(subscriptions.data))===before.subscriptionsHash,integrity:integrity.length===1&&Object.values(integrity[0])[0]==='ok'&&fk.length===0};
  return{ok:Object.values(checks).every(x=>x===true),...checks};
 }});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let r;try{r=await main();}catch{r={ok:false,state:'stopped_registration_held',reason:'preparation_failed',exchangeAttempted:false,registrationAttempted:false,messagesSent:0};}console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}
