import {pathToFileURL} from 'node:url';
import {installVerifyTokenOnce,dedicatedValue,maskVerifyColumns} from './stopped-receiving-verify-token-once.mjs';
import {businessSnapshot} from './stopped-migration-apply.mjs';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
import {readStoppedInstallationSnapshot} from './stopped-installation-snapshot.mjs';
import {inspectAppWebhook} from './soykufu-app-webhook-readonly.mjs';
const ACCOUNT='e76a3f504309ca9289d8dfa3ee504502',DATABASE='e55c3b84-ea9a-48fd-a7a3-08253089d295';
const ORIGIN='https://soykufu-ig-harness-20261119.soykufu.workers.dev';
export function verifyReplacementRun(e){
 return e.GITHUB_ACTIONS==='true'&&e.GITHUB_REPOSITORY==='soykufu/ig-harness-oss'&&e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_EVENT_NAME==='workflow_dispatch'&&e.GITHUB_RUN_NUMBER==='96'&&e.GITHUB_RUN_ATTEMPT==='1'&&e.APPROVED_VERIFY_TOKEN_REPLACEMENT==='saved-note-replacement-only';
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
 if(!verifyReplacementRun(e)||!dedicatedValue(e))return installVerifyTokenOnce({official:verifyReplacementRun(e),credentialValid:dedicatedValue(e)});
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
 console.log(JSON.stringify({...result,operation:'saved_note_verification_replacement'}));if(!result.ok)process.exitCode=1;
}
