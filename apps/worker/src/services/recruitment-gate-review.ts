export type GateReviewItem={id:string;phase:string;state:string;recordedAt:string|null;expectedMessages:number|null;recordedMessages:number;apiAcknowledged:number;recordedSuccess:boolean;needsReview:boolean;mayRetry:false;recipientReceipt:'unknown';echoEvidence:'signed_webhook_recorded'|'unknown';deliveryState:string;endReason:string|null};
/** Read historical evidence without issuing Meta calls, advancing a phase or
 * releasing a stop. Missing records and missing schema do not prove non-send. */
export async function readGateReview(db:D1Database,accountId:string,gateId:string){
 if(!await db.prepare('SELECT 1 FROM engagement_gates WHERE id=? AND account_id=?').bind(gateId,accountId).first())return null;
 const records=await db.prepare(`SELECT o.operation_key,o.phase,o.state,o.claimed_at_ms,o.expected_messages,o.owner_epoch,o.definition_version,o.payload_version,d.status AS delivery_state,d.end_reason
 FROM recruitment_gate_operations o JOIN gate_deliveries d ON d.id=o.delivery_id JOIN engagement_gates g ON g.id=d.gate_id AND g.account_id=o.account_id
 WHERE o.account_id=? AND g.id=? ORDER BY o.claimed_at_ms DESC,o.operation_key LIMIT 51`).bind(accountId,gateId).all<any>();
 const items:GateReviewItem[]=[];
 for(const row of records.results.slice(0,50)){
  const slots=await db.prepare(`SELECT o.operation_key,o.state,o.message_id,o.owner_epoch,
   EXISTS(SELECT 1 FROM recruitment_outbound_observations e WHERE e.account_id=o.account_id AND e.message_id=o.message_id) AS recorded,
   EXISTS(SELECT 1 FROM recruitment_echo_receipts e WHERE e.account_id=o.account_id AND e.message_id=o.message_id) AS signed_echo
   FROM recruitment_outbound_operations o WHERE o.account_id=? AND substr(o.operation_key,1,length(?)+1)=?||':' ORDER BY o.operation_key`).bind(accountId,row.operation_key,row.operation_key).all<any>();
  const count=Number.isSafeInteger(row.expected_messages)&&row.expected_messages>0&&row.expected_messages<=10?row.expected_messages:null;
  const acknowledged=slots.results.filter(s=>s.state==='sent'&&typeof s.message_id==='string'&&s.message_id.length>0&&s.owner_epoch===row.owner_epoch&&s.recorded===1);
  const complete=count!==null&&slots.results.length===count&&Array.from({length:count},(_,index)=>row.operation_key+':'+index).every(key=>acknowledged.some(s=>s.operation_key===key));
  const pinned=/^[a-f0-9]{64}$/.test(row.definition_version??'')&&/^[a-f0-9]{64}$/.test(row.payload_version??'')&&typeof row.owner_epoch==='string'&&!!row.owner_epoch.trim();
  const success=row.state==='sent'&&pinned&&complete;const skipped=row.state==='skipped'&&row.expected_messages===0&&slots.results.length===0;
  items.push({id:row.operation_key,phase:row.phase,state:row.state,recordedAt:Number.isSafeInteger(row.claimed_at_ms)&&row.claimed_at_ms>=0&&row.claimed_at_ms<=8640000000000000?new Date(row.claimed_at_ms).toISOString():null,expectedMessages:count,recordedMessages:slots.results.length,apiAcknowledged:acknowledged.length,recordedSuccess:success,needsReview:!success&&!skipped||row.end_reason==='outcome_unknown',mayRetry:false,recipientReceipt:'unknown',echoEvidence:complete&&acknowledged.every(s=>s.signed_echo===1)?'signed_webhook_recorded':'unknown',deliveryState:row.delivery_state,endReason:row.end_reason});
 }
 const pending=await db.prepare(`SELECT d.id,d.status,d.end_reason,d.triggered_at,
 CASE WHEN json_valid(d.metadata) AND json_type(d.metadata,'$.recruitment_followup')='object' THEN 'followup' ELSE 'gate' END AS phase
 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id
 WHERE g.id=? AND g.account_id=? AND d.end_reason IN ('delivery_in_progress','outcome_unknown')
 AND NOT EXISTS(SELECT 1 FROM recruitment_gate_operations o WHERE o.account_id=g.account_id AND o.delivery_id=d.id)
 ORDER BY d.triggered_at DESC,d.id LIMIT 51`).bind(gateId,accountId).all<any>();
 for(const d of pending.results.slice(0,50))items.unshift({id:'hold:'+d.id,phase:d.phase,state:d.end_reason==='outcome_unknown'?'uncertain':'claimed',recordedAt:Number.isFinite(Date.parse(d.triggered_at))?new Date(d.triggered_at).toISOString():null,expectedMessages:null,recordedMessages:0,apiAcknowledged:0,recordedSuccess:false,needsReview:true,mayRetry:false,recipientReceipt:'unknown',echoEvidence:'unknown',deliveryState:d.status,endReason:d.end_reason});
 items.sort((a,b)=>Number(b.needsReview)-Number(a.needsReview)||(b.recordedAt??'').localeCompare(a.recordedAt??'')||a.id.localeCompare(b.id));
 return{items:items.slice(0,50),moreMayExist:records.results.length>50||pending.results.length>50||items.length>50,mayRetry:false as const,recipientReceipt:'unknown' as const};
}
