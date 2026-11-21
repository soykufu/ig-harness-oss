import type {EngagementGate,GateDelivery,RecruitmentEnrollmentGuard} from '@ig-harness/db';
import {gateFollowupKey} from './recruitment-gate-followup.js';
import {isRecruitmentDeliveryWindow,recruitmentAdmissionPredicate} from './recruitment-automation-admission.js';
const GATE_FIELDS=['followup_dm_sequence','reward_url','line_connection_id','line_pool_slug','line_tracked_link_short'] as const;
const gateMatch=GATE_FIELDS.map(k=>`g.${k} IS ?`).join(' AND ');
const gateValues=(g:EngagementGate)=>GATE_FIELDS.map(k=>g[k]);
const changed=(r:D1Result)=>r.results?.length===1;
// Forces the whole D1 batch to roll back rather than retaining half a journal.
const requireLastChange=(db:D1Database)=>db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json('transaction guard failed') END");
export async function claimGateFollowupReceipt(db:D1Database,accountId:string,gate:EngagementGate,d:GateDelivery,version:string,snapshot:RecruitmentEnrollmentGuard){
 const now=Date.now();if(!isRecruitmentDeliveryWindow(now))return false;
 const admission=recruitmentAdmissionPredicate(accountId,d.follower_id,snapshot,now),key=gateFollowupKey(d.id,d.followup_step_sent);
 const metadata=JSON.stringify({step:d.followup_step_sent,version,claimed_at_ms:now,owner_epoch:snapshot.ownerEpoch});
 try{
  const result=await db.batch([
   db.prepare(`UPDATE gate_deliveries AS d SET next_followup_at=NULL,end_reason='delivery_in_progress',metadata=json_set(metadata,'$.recruitment_followup',json(?))
    WHERE d.id=? AND d.gate_id=? AND d.follower_id=? AND d.igsid=? AND d.status='delivered' AND d.end_reason IS NULL AND d.metadata IS ? AND d.followup_step_sent=? AND d.next_followup_at IS ?
    AND EXISTS(SELECT 1 FROM engagement_gates g WHERE g.id=d.gate_id AND g.account_id=? AND g.status='active' AND ${gateMatch})
    AND NOT EXISTS(SELECT 1 FROM recruitment_gate_followup_operations WHERE account_id=? AND operation_key=?) AND ${admission.sql} RETURNING id`)
    .bind(metadata,d.id,gate.id,d.follower_id,d.igsid,d.metadata,d.followup_step_sent,d.next_followup_at,accountId,...gateValues(gate),accountId,key,...admission.bindings),
   db.prepare(`INSERT INTO recruitment_gate_followup_operations(account_id,operation_key,delivery_id,follower_id,step_index,definition_version,owner_epoch,claimed_at_ms,state)
    SELECT ?,?,id,follower_id,?,?,?,?,'claimed' FROM gate_deliveries WHERE id=? AND changes()=1 RETURNING operation_key`)
    .bind(accountId,key,d.followup_step_sent,version,snapshot.ownerEpoch,now,d.id),
  ]);
  if(!changed(result[0])&&!changed(result[1]))return false;
  if(!changed(result[0])||!changed(result[1]))throw Error('Follow-up claim journal incomplete');
  return true;
 }catch(error){
  // Competing transactions may have won the same immutable identity. This
  // branch never reissues it and never turns an unknown send into a retry.
  if(await db.prepare('SELECT 1 FROM recruitment_gate_followup_operations WHERE account_id=? AND operation_key=?').bind(accountId,key).first())return false;
  throw error;
 }
}
export async function prepareGateFollowupReceipt(db:D1Database,accountId:string,d:GateDelivery,version:string,payload:string,count:number){
 const key=gateFollowupKey(d.id,d.followup_step_sent);
 const result=await db.batch([
  db.prepare(`UPDATE recruitment_gate_followup_operations SET payload_version=?,expected_messages=? WHERE account_id=? AND operation_key=? AND delivery_id=? AND follower_id=? AND step_index=? AND definition_version=? AND state='claimed' AND payload_version IS NULL AND expected_messages IS NULL
   AND EXISTS(SELECT 1 FROM gate_deliveries d WHERE d.id=delivery_id AND d.status='delivered' AND d.end_reason='delivery_in_progress' AND d.followup_step_sent=step_index AND json_extract(d.metadata,'$.recruitment_followup.version')=definition_version AND json_extract(d.metadata,'$.recruitment_followup.owner_epoch')=owner_epoch) RETURNING operation_key`)
   .bind(payload,count,accountId,key,d.id,d.follower_id,d.followup_step_sent,version),
  db.prepare(`UPDATE gate_deliveries SET metadata=json_set(metadata,'$.recruitment_followup.payload',?,'$.recruitment_followup.expected_messages',?) WHERE id=? AND status='delivered' AND end_reason='delivery_in_progress' AND followup_step_sent=? AND json_extract(metadata,'$.recruitment_followup.version')=? AND json_extract(metadata,'$.recruitment_followup.payload') IS NULL AND changes()=1 RETURNING id`)
   .bind(payload,count,d.id,d.followup_step_sent,version),requireLastChange(db),
 ]);
 if(!changed(result[0])||!changed(result[1]))throw Error('Follow-up preparation changed');
}
export async function uncertainGateFollowupReceipt(db:D1Database,accountId:string,d:GateDelivery,version:string){
 await db.batch([
  db.prepare("UPDATE recruitment_gate_followup_operations SET state='uncertain' WHERE account_id=? AND operation_key=? AND state='claimed'").bind(accountId,gateFollowupKey(d.id,d.followup_step_sent)),
  db.prepare("UPDATE gate_deliveries SET end_reason='outcome_unknown' WHERE id=? AND status='delivered' AND followup_step_sent=? AND end_reason='delivery_in_progress' AND json_extract(metadata,'$.recruitment_followup.version')=?").bind(d.id,d.followup_step_sent,version),
 ]);
}
export async function completeGateFollowupReceipt(db:D1Database,accountId:string,gate:EngagementGate,d:GateDelivery,version:string,nextAt:string|null,snapshot:RecruitmentEnrollmentGuard){
 const now=Date.now();if(!isRecruitmentDeliveryWindow(now))throw Error('Follow-up completion requires reconciliation');
 const admission=recruitmentAdmissionPredicate(accountId,d.follower_id,snapshot,now),key=gateFollowupKey(d.id,d.followup_step_sent);
 const result=await db.batch([
  db.prepare(`UPDATE recruitment_gate_followup_operations AS r SET state='sent' WHERE r.account_id=? AND r.operation_key=? AND r.state='claimed' AND r.definition_version=? AND r.owner_epoch=? AND r.claimed_at_ms BETWEEN ? AND ? AND r.payload_version IS NOT NULL AND r.expected_messages BETWEEN 1 AND 2
   AND EXISTS(SELECT 1 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id WHERE d.id=r.delivery_id AND d.follower_id=r.follower_id AND d.status='delivered' AND d.followup_step_sent=r.step_index AND d.end_reason='delivery_in_progress' AND d.next_followup_at IS NULL AND g.id=? AND g.account_id=r.account_id AND g.status='active' AND ${gateMatch} AND json_extract(d.metadata,'$.recruitment_followup.version')=r.definition_version AND json_extract(d.metadata,'$.recruitment_followup.payload')=r.payload_version AND json_extract(d.metadata,'$.recruitment_followup.expected_messages')=r.expected_messages)
   AND (SELECT COUNT(*) FROM recruitment_outbound_operations o WHERE o.account_id=r.account_id AND substr(o.operation_key,1,length(r.operation_key)+1)=r.operation_key||':')=r.expected_messages
   AND NOT EXISTS(SELECT 1 FROM json_each(CASE r.expected_messages WHEN 1 THEN '[0]' ELSE '[0,1]' END) slot WHERE NOT EXISTS(SELECT 1 FROM recruitment_outbound_operations o JOIN recruitment_outbound_observations e ON e.account_id=o.account_id AND e.message_id=o.message_id WHERE o.account_id=r.account_id AND o.operation_key=r.operation_key||':'||slot.value AND o.state='sent' AND length(o.message_id)>0 AND o.owner_epoch=r.owner_epoch))
   AND ${admission.sql} RETURNING operation_key`)
   .bind(accountId,key,version,snapshot.ownerEpoch,now-60000,now,gate.id,...gateValues(gate),...admission.bindings),
  db.prepare(`UPDATE gate_deliveries SET end_reason=NULL,followup_step_sent=?,next_followup_at=? WHERE id=? AND status='delivered' AND followup_step_sent=? AND end_reason='delivery_in_progress' AND changes()=1 RETURNING id`).bind(d.followup_step_sent+1,nextAt,d.id,d.followup_step_sent),requireLastChange(db),
 ]);
 if(!changed(result[0])||!changed(result[1]))throw Error('Follow-up completion journal changed');
}
