import {pathToFileURL} from 'node:url';

const CF='https://api.cloudflare.com/client/v4';
const DB='/accounts/e76a3f504309ca9289d8dfa3ee504502/d1/database/e55c3b84-ea9a-48fd-a7a3-08253089d295/query';
const FP='02c5cc03682d18786407e22ee1cc9e4440b12197a87680789436c9eb7a59af61';
const SINCE='2026-11-26T02:15:00.000Z';
const fixed="ig_user_id='17841402028638204' AND username='soykufu' AND page_id='1632563283635095' AND connection_type='facebook_login' AND is_active=1 AND is_default=0";
const scope=`account_id IN (SELECT id FROM ig_accounts WHERE ${fixed})`;
export const QUERIES=Object.freeze({
 guard:`SELECT (SELECT value FROM integration_settings WHERE key='outbound_paused') AS paused,(SELECT COUNT(*) FROM ig_accounts) AS accounts,(SELECT COUNT(*) FROM ig_accounts WHERE ${fixed}) AS fixed_accounts`,
 receipt:`SELECT COUNT(*) AS matched,COUNT(DISTINCT json_extract(payload,'$.message.mid')) AS distinct_mids,SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,MIN(received_at) AS first_at,MAX(received_at) AS last_at FROM webhook_events WHERE ${scope} AND kind='messaging' AND received_at>='${SINCE}' AND json_valid(payload) AND json_extract(payload,'$.message.text')='受信テスト1126' AND COALESCE(json_extract(payload,'$.message.is_echo'),0)=0 AND length(json_extract(payload,'$.message.mid'))>0`,
 recent:`SELECT COUNT(*) AS events,SUM(CASE WHEN kind='messaging' THEN 1 ELSE 0 END) AS primary_events,SUM(CASE WHEN kind='standby' THEN 1 ELSE 0 END) AS standby_events,SUM(CASE WHEN json_type(payload,'$.message')='object' AND COALESCE(json_extract(payload,'$.message.is_echo'),0)=0 AND length(json_extract(payload,'$.message.mid'))>0 THEN 1 ELSE 0 END) AS inbound_messages,COUNT(DISTINCT CASE WHEN json_type(payload,'$.message')='object' AND COALESCE(json_extract(payload,'$.message.is_echo'),0)=0 THEN json_extract(payload,'$.message.mid') END) AS distinct_mids,SUM(CASE WHEN json_type(payload,'$.message')='object' AND COALESCE(json_extract(payload,'$.message.is_echo'),0)=0 AND status='pending' THEN 1 ELSE 0 END) AS pending_messages,SUM(CASE WHEN instr(COALESCE(json_extract(payload,'$.message.text'),''),'テスト')>0 THEN 1 ELSE 0 END) AS test_phrase_matches,MIN(received_at) AS first_at,MAX(received_at) AS last_at FROM webhook_events WHERE ${scope} AND kind IN ('messaging','standby') AND received_at>='${SINCE}' AND json_valid(payload)`,
 health:`SELECT (SELECT MAX(value) FROM integration_settings WHERE key IN (SELECT 'health:last_webhook_at:'||id FROM ig_accounts WHERE ${fixed})) AS last_webhook_at,(SELECT MAX(value) FROM integration_settings WHERE key IN (SELECT 'health:sig_ok_last:'||id FROM ig_accounts WHERE ${fixed})) AS last_signature_ok_at,(SELECT MAX(value) FROM integration_settings WHERE key IN (SELECT 'health:sig_fail_last:'||id FROM ig_accounts WHERE ${fixed})) AS last_signature_fail_at,(SELECT COUNT(*) FROM webhook_events WHERE ${scope} AND received_at>='${SINCE}') AS recent_events,(SELECT COUNT(*) FROM messages_log WHERE direction='out' AND julianday(created_at)>=julianday('${SINCE}')) AS outgoing_since_test`,
});
const runtimeOk=r=>r?.deploymentFingerprint===FP&&r.deploymentStable===true&&r.deployedBindingsVerified===true&&r.preparationLockVerified===true&&r.extraFlagsVerified===true;
const official=e=>e.GITHUB_REPOSITORY==='soykufu/ig-harness-oss'&&e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_EVENT_NAME==='workflow_dispatch';
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const timestamp=t=>t===null||(typeof t==='string'&&/^2026-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(t)&&Number.isFinite(Date.parse(t)));
const guard=r=>r?.paused==='1'&&r.accounts===1&&r.fixed_accounts===1;
const held=reason=>({ok:false,state:'stopped_inbound_receipt_held',reason,configurationChanged:false,subscriptionAttempted:false,credentialWritesAttempted:false,messagesSent:0,receivingVerified:false});
export async function inspectInboundReceipt({env,readRuntime,query}){
 if(!official(env))return held('official_runtime_required');
 try{
  if(!runtimeOk(await readRuntime()))return held('runtime_requires_reconciliation');
  if(!guard((await query(QUERIES.guard))[0]))return held('stop_or_identity_unverified');
  const r=(await query(QUERIES.receipt))[0],h=(await query(QUERIES.health))[0],recent=(await query(QUERIES.recent))[0];
  if(!recent||!['events','primary_events','standby_events','inbound_messages','distinct_mids','pending_messages','test_phrase_matches'].every(k=>integer(recent[k]??0))||!timestamp(recent.first_at)||!timestamp(recent.last_at)||(recent.distinct_mids??0)>(recent.inbound_messages??0))return held('recent_receipt_unverified');
  if(!r||!h||!integer(r.matched)||!integer(r.distinct_mids)||r.distinct_mids>r.matched||!integer(r.pending??0)||(r.pending??0)>r.matched||![r.first_at,r.last_at,h.last_webhook_at,h.last_signature_ok_at,h.last_signature_fail_at].every(timestamp)||!integer(h.recent_events)||!integer(h.outgoing_since_test))return held('receipt_unverified');
  if(r.matched>0&&(!r.first_at||!r.last_at||Date.parse(r.first_at)<Date.parse(SINCE)||Date.parse(r.last_at)<Date.parse(r.first_at)))return held('receipt_unverified');
  if(!runtimeOk(await readRuntime())||!guard((await query(QUERIES.guard))[0]))return held('runtime_changed');
  const signatureObserved=h.last_signature_ok_at!==null&&Date.parse(h.last_signature_ok_at)>=Date.parse(SINCE);
  return{ok:true,state:'stopped_inbound_receipt_observed',testWindowStart:SINCE,recentMessagingEvents:recent.events,primaryMessagingEvents:recent.primary_events??0,standbyMessagingEvents:recent.standby_events??0,recentInboundMessages:recent.inbound_messages??0,recentDistinctInboundMessages:recent.distinct_mids??0,recentStoredDuplicates:(recent.inbound_messages??0)-(recent.distinct_mids??0),recentPendingInboundMessages:recent.pending_messages??0,recentTestPhraseMatches:recent.test_phrase_matches??0,firstRecentMessageAt:recent.first_at,lastRecentMessageAt:recent.last_at,matchedTestEvents:r.matched,distinctTestMessages:r.distinct_mids,storedDuplicateMessages:r.matched-r.distinct_mids,pendingTestEvents:r.pending??0,firstReceivedAt:r.first_at,lastReceivedAt:r.last_at,lastWebhookAt:h.last_webhook_at,signatureSuccessObserved:signatureObserved,lastSignatureFailureAt:h.last_signature_fail_at,recentAccountEvents:h.recent_events,outgoingMessagesSinceTest:h.outgoing_since_test,guardrailsPaused:true,preparationLock:true,configurationChanged:false,subscriptionAttempted:false,credentialWritesAttempted:false,messagesSent:0,receivingVerified:r.matched===1&&r.distinct_mids===1&&r.pending===1&&signatureObserved&&h.outgoing_since_test===0};
 }catch{return held('read_failed');}
}
export async function runOfficialInboundRead(env,fetchImpl=fetch,readRuntime){
 if(!official(env))return held('official_runtime_required');
 const token=env.CLOUDFLARE_API_TOKEN;
 if(typeof token!=='string'||!token||token!==token.trim()||/[\r\n]/.test(token))return held('diagnostic_credential_unavailable');
 async function json(url,options){
  const response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok||!response.body)throw Error('read_failed');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144)throw Error('read_failed');chunks.push(value);}}finally{await reader.cancel();}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(data.success!==true)throw Error('read_failed');return data.result;
 }
 const headers={Authorization:'Bearer '+token};
 const query=async sql=>{
  if(!Object.values(QUERIES).includes(sql))throw Error('read_path');
  const rows=await json(CF+DB,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sql})});
  if(!Array.isArray(rows)||rows.length!==1||rows[0]?.success===false||!Array.isArray(rows[0]?.results)||rows[0].results.length!==1)throw Error('read_failed');return rows[0].results;
 };
 if(!readRuntime){
  const runtime=await import('./stopped-runtime-snapshot.mjs');
  readRuntime=()=>runtime.readStoppedRuntimeSnapshot({read:async path=>{if(!runtime.isStoppedRuntimeReadPath(path))throw Error('read_path');return json(CF+path,{method:'GET',headers});}});
 }
 return inspectInboundReceipt({env,readRuntime,query});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let result;try{result=await runOfficialInboundRead(process.env);}catch{result=held('read_failed');}console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;}
