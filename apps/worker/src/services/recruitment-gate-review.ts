import {sha256} from '../lib/security.js';
async function reviewSlots(db:D1Database,accountId:string,keys:string[]){
 if(!keys.length)return{byKey:new Map<string,any[]>(),truncated:false};
 const rows=await db.prepare(`SELECT p.value AS parent_key,o.operation_key,o.state,o.message_id,o.owner_epoch,
 EXISTS(SELECT 1 FROM recruitment_outbound_observations e WHERE e.account_id=o.account_id AND e.message_id=o.message_id) AS recorded,
 EXISTS(SELECT 1 FROM recruitment_echo_receipts e WHERE e.account_id=o.account_id AND e.message_id=o.message_id) AS signed_echo
 FROM json_each(?) p JOIN recruitment_outbound_operations o ON o.account_id=?
 AND o.operation_key>=p.value||':' AND o.operation_key<p.value||';'
 AND substr(o.operation_key,1,length(p.value)+1)=p.value||':'
 ORDER BY o.operation_key LIMIT 1001`).bind(JSON.stringify(keys),accountId).all<any>();
 const byKey=new Map<string,any[]>();for(const row of rows.results.slice(0,1000)){const list=byKey.get(row.parent_key)??[];list.push(row);byKey.set(row.parent_key,list);}
 return{byKey,truncated:rows.results.length>1000};
}
export type GateReviewItem={id:string;phase:string;state:string;recordedAt:string|null;expectedMessages:number|null;recordedMessages:number;apiAcknowledged:number;recordedSuccess:boolean;needsReview:boolean;mayRetry:false;recipientReceipt:'unknown';echoEvidence:'signed_webhook_recorded'|'unknown';deliveryState:string;endReason:string|null};
/** Read historical evidence without issuing Meta calls, advancing a phase or
 * releasing a stop. Missing records and missing schema do not prove non-send. */
export async function readGateReview(db:D1Database,accountId:string,gateId:string){
 if(!await db.prepare('SELECT 1 FROM engagement_gates WHERE id=? AND account_id=?').bind(gateId,accountId).first())return null;
 const records=await db.prepare(`SELECT * FROM (SELECT o.operation_key,o.phase,o.state,o.claimed_at_ms,o.expected_messages,o.owner_epoch,o.definition_version,o.payload_version,NULL AS source_version,d.status AS delivery_state,d.end_reason
 FROM recruitment_gate_operations o JOIN gate_deliveries d ON d.id=o.delivery_id JOIN engagement_gates g ON g.id=d.gate_id AND g.account_id=o.account_id
 WHERE o.account_id=? AND g.id=?
 UNION ALL
 SELECT o.operation_key,'cta' AS phase,o.state,o.claimed_at_ms,o.expected_messages,o.owner_epoch,o.definition_version,o.payload_version,o.source_hash AS source_version,d.status AS delivery_state,d.end_reason
 FROM recruitment_gate_cta_operations o JOIN gate_deliveries d ON d.id=o.delivery_id JOIN engagement_gates g ON g.id=d.gate_id AND g.account_id=o.account_id
 WHERE o.account_id=? AND g.id=? ) ORDER BY CASE WHEN state='sent' OR state='skipped' THEN 1 ELSE 0 END,claimed_at_ms DESC,operation_key LIMIT 101`).bind(accountId,gateId,accountId,gateId).all<any>();
 const recordSlots=await reviewSlots(db,accountId,records.results.slice(0,100).map(r=>r.operation_key));
 const items:GateReviewItem[]=[];
 for(const row of records.results.slice(0,100)){
  const slots={results:recordSlots.byKey.get(row.operation_key)??[]};
  const count=Number.isSafeInteger(row.expected_messages)&&row.expected_messages>0&&row.expected_messages<=10?row.expected_messages:null;
  const acknowledged=slots.results.filter(s=>s.state==='sent'&&typeof s.message_id==='string'&&s.message_id.length>0&&s.owner_epoch===row.owner_epoch&&s.recorded===1);
  const complete=count!==null&&slots.results.length===count&&Array.from({length:count},(_,index)=>row.operation_key+':'+index).every(key=>acknowledged.some(s=>s.operation_key===key));
  const pinned=/^[a-f0-9]{64}$/.test(row.definition_version??'')&&/^[a-f0-9]{64}$/.test(row.payload_version??'')&&typeof row.owner_epoch==='string'&&!!row.owner_epoch.trim();
  const sourcePinned=row.phase!=='cta'||/^[a-f0-9]{64}$/.test(row.source_version??'');
  const success=!recordSlots.truncated&&row.state==='sent'&&pinned&&sourcePinned&&complete;const skipped=!recordSlots.truncated&&row.state==='skipped'&&row.expected_messages===0&&slots.results.length===0;
  items.push({id:row.operation_key,phase:row.phase,state:row.state,recordedAt:Number.isSafeInteger(row.claimed_at_ms)&&row.claimed_at_ms>=0&&row.claimed_at_ms<=8640000000000000?new Date(row.claimed_at_ms).toISOString():null,expectedMessages:count,recordedMessages:slots.results.length,apiAcknowledged:acknowledged.length,recordedSuccess:success,needsReview:!success&&!skipped||row.end_reason==='outcome_unknown',mayRetry:false,recipientReceipt:'unknown',echoEvidence:complete&&acknowledged.every(s=>s.signed_echo===1)?'signed_webhook_recorded':'unknown',deliveryState:row.delivery_state,endReason:row.end_reason});
 }
 const pending=await db.prepare(`SELECT d.id,d.status,d.end_reason,d.triggered_at,
 CASE WHEN json_valid(d.metadata) AND json_type(d.metadata,'$.recruitment_followup')='object' THEN 'followup' ELSE 'gate' END AS phase
 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id
 WHERE g.id=? AND g.account_id=? AND d.end_reason IN ('delivery_in_progress','outcome_unknown')
 AND NOT EXISTS(SELECT 1 FROM recruitment_gate_operations o WHERE o.account_id=g.account_id AND o.delivery_id=d.id)
 AND NOT EXISTS(SELECT 1 FROM recruitment_gate_cta_operations o WHERE o.account_id=g.account_id AND o.delivery_id=d.id)
 AND COALESCE(CASE WHEN json_valid(d.metadata) THEN json_type(d.metadata,'$.recruitment_followup') END,'')!='object'
 ORDER BY d.triggered_at DESC,d.id LIMIT 51`).bind(gateId,accountId).all<any>();
 for(const d of pending.results.slice(0,50))items.unshift({id:'hold:'+d.id,phase:d.phase,state:d.end_reason==='outcome_unknown'?'uncertain':'claimed',recordedAt:Number.isFinite(Date.parse(d.triggered_at))?new Date(d.triggered_at).toISOString():null,expectedMessages:null,recordedMessages:0,apiAcknowledged:0,recordedSuccess:false,needsReview:true,mayRetry:false,recipientReceipt:'unknown',echoEvidence:'unknown',deliveryState:d.status,endReason:d.end_reason});
 // Follow-up metadata retains only the latest claim. Older steps without an
 // immutable receipt cannot be reconstructed as successful history.
 const followups=await db.prepare(`SELECT d.id,d.status AS delivery_state,d.end_reason,d.followup_step_sent,
 json_extract(d.metadata,'$.recruitment_followup.step') AS step,
 json_extract(d.metadata,'$.recruitment_followup.version') AS definition_version,
 json_extract(d.metadata,'$.recruitment_followup.payload') AS payload_version,
 json_extract(d.metadata,'$.recruitment_followup.expected_messages') AS expected_messages,
 json_extract(d.metadata,'$.recruitment_followup.owner_epoch') AS owner_epoch,
 json_extract(d.metadata,'$.recruitment_followup.claimed_at_ms') AS claimed_at_ms
 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id
 WHERE g.id=? AND g.account_id=? AND json_valid(d.metadata) AND json_type(d.metadata,'$.recruitment_followup')='object'
 ORDER BY CASE WHEN d.end_reason IS NOT NULL THEN 0 ELSE 1 END,d.triggered_at DESC,d.id LIMIT 51`).bind(gateId,accountId).all<any>();
 const followupSlots=await reviewSlots(db,accountId,followups.results.slice(0,50).filter(r=>Number.isSafeInteger(r.step)&&r.step>=0).map(r=>'gate-followup:'+encodeURIComponent(r.id)+':'+r.step));
 for(const row of followups.results.slice(0,50)){
  const validStep=Number.isSafeInteger(row.step)&&row.step>=0;
  const key=validStep?'gate-followup:'+encodeURIComponent(row.id)+':'+row.step:'unverified-followup:'+await sha256(JSON.stringify([accountId,row.id]));
  const slots={results:followupSlots.byKey.get(key)??[]};
  const count=Number.isSafeInteger(row.expected_messages)&&row.expected_messages>0&&row.expected_messages<=2?row.expected_messages:null;
  const acknowledged=slots.results.filter(s=>s.state==='sent'&&typeof s.message_id==='string'&&!!s.message_id&&s.recorded===1);
  const complete=count!==null&&slots.results.length===count&&Array.from({length:count},(_,index)=>key+':'+index).every(k=>acknowledged.some(s=>s.operation_key===k));
  // Historical metadata has no pinned owner. A current owner or a matching
  // slot must never fill that missing historical evidence.
  const ownerPinned=typeof row.owner_epoch==='string'&&!!row.owner_epoch.trim()&&acknowledged.every(s=>s.owner_epoch===row.owner_epoch);
  const pinned=/^[a-f0-9]{64}$/.test(row.definition_version??'')&&/^[a-f0-9]{64}$/.test(row.payload_version??'');
  const success=!followupSlots.truncated&&validStep&&row.followup_step_sent===row.step+1&&row.end_reason===null&&ownerPinned&&pinned&&complete;
  const at=Number.isSafeInteger(row.claimed_at_ms)&&row.claimed_at_ms>=0&&row.claimed_at_ms<=8640000000000000?new Date(row.claimed_at_ms).toISOString():null;
  items.push({id:key,phase:'followup',state:row.end_reason==='outcome_unknown'?'uncertain':success?'sent':'unverified',recordedAt:at,expectedMessages:count,recordedMessages:slots.results.length,apiAcknowledged:acknowledged.length,recordedSuccess:success,needsReview:!success,mayRetry:false,recipientReceipt:'unknown',echoEvidence:complete&&acknowledged.every(s=>s.signed_echo===1)?'signed_webhook_recorded':'unknown',deliveryState:row.delivery_state,endReason:row.end_reason});
 }
 const publicRows=await db.prepare(`SELECT j.id,j.public_reply_status,j.public_reply_id,j.public_reply_plan_hash,j.public_reply_owner_epoch,j.public_reply_claimed_at,d.status AS delivery_state,d.end_reason,
 EXISTS(SELECT 1 FROM recruitment_outbound_operations o JOIN private_reply_attempts p ON p.account_id=o.account_id AND p.comment_id=j.comment_id AND p.follower_id=j.follower_id AND p.status='sent' AND p.message_id=o.message_id
 JOIN recruitment_outbound_observations e ON e.account_id=o.account_id AND e.message_id=o.message_id
 WHERE o.account_id=j.account_id AND o.operation_key='comment:'||j.id||':0' AND o.state='sent' AND o.owner_epoch=j.public_reply_owner_epoch AND length(o.message_id)>0) AS private_ack
 FROM comment_rule_jobs j JOIN gate_deliveries d ON d.id=j.gate_delivery_id AND d.follower_id=j.follower_id JOIN engagement_gates g ON g.id=d.gate_id AND g.account_id=j.account_id
 WHERE g.id=? AND j.account_id=? AND j.public_reply_status IS NOT NULL
 ORDER BY CASE WHEN j.public_reply_status='sent' THEN 1 ELSE 0 END,j.public_reply_claimed_at DESC,j.id LIMIT 51`).bind(gateId,accountId).all<any>();
 for(const row of publicRows.results.slice(0,50)){
  const at=Date.parse(row.public_reply_claimed_at??'');
  const pinned=/^[a-f0-9]{64}$/.test(row.public_reply_plan_hash??'')&&typeof row.public_reply_owner_epoch==='string'&&!!row.public_reply_owner_epoch.trim()&&Number.isFinite(at);
  const acknowledged=row.public_reply_status==='sent'&&typeof row.public_reply_id==='string'&&!!row.public_reply_id.trim();
  const success=pinned&&acknowledged&&row.private_ack===1;
  items.push({id:'public:'+await sha256(JSON.stringify([accountId,row.id])),phase:'public_reply',state:row.public_reply_status,recordedAt:Number.isFinite(at)?new Date(at).toISOString():null,expectedMessages:1,recordedMessages:acknowledged?1:0,apiAcknowledged:acknowledged?1:0,recordedSuccess:success,needsReview:!success||row.end_reason==='outcome_unknown',mayRetry:false,recipientReceipt:'unknown',echoEvidence:'unknown',deliveryState:row.delivery_state,endReason:row.end_reason});
 }
 items.sort((a,b)=>Number(b.needsReview)-Number(a.needsReview)||(b.recordedAt??'').localeCompare(a.recordedAt??'')||a.id.localeCompare(b.id));
 return{followupHistoryScope:'latest_claim_only' as const,items:items.slice(0,50),moreMayExist:recordSlots.truncated||followupSlots.truncated||followups.results.length>50||records.results.length>100||publicRows.results.length>50||pending.results.length>50||items.length>50,mayRetry:false as const,recipientReceipt:'unknown' as const};
}
