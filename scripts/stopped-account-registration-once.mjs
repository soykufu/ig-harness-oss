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
export async function main(){return{ok:false,state:'account_registration_retired',reason:'operation_retired',consumedRunId:45323225017,exchangeAttempted:false,registrationAttempted:false,messagesSent:0};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){console.log(JSON.stringify(await main()));process.exitCode=1;}
