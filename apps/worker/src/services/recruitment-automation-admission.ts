import {assertRecruitmentBusinessState} from './recruitment-business-state.js';
import {assertNoRecruitmentInboundHold,recruitmentSubjectHash} from './recruitment-inbound-holds.js';
import {messagingEligibility} from './messaging-window.js';
export function isRecruitmentDeliveryWindow(now=Date.now()){
 const hour=new Date(now+9*3600000).getUTCHours();return hour>=8&&hour<21;
}
/** Before any automatic enrollment/linkage/forwarding, not merely before a
 * message fetch. Reads only: never reconcile ownership or release a hold. */
export async function assertRecruitmentAutomationAdmission(db:D1Database,accountId:string,followerId:number,now=Date.now()){
 if(!isRecruitmentDeliveryWindow(now))throw Error('Outside recruitment delivery window');
 const row=await db.prepare(`SELECT f.igsid,f.metadata,c.owner_epoch FROM followers f
 JOIN ig_accounts a ON a.id=f.account_id AND a.is_active=1
 JOIN recruitment_outbound_control c ON c.account_id=f.account_id AND c.owner='harness' AND c.reconciled_at_ms BETWEEN ? AND ?
 WHERE f.id=? AND f.account_id=? AND f.messaging_owner='primary'
 AND EXISTS(SELECT 1 FROM integration_settings WHERE key='outbound_paused' AND value='0')
 AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=f.account_id)
 AND NOT EXISTS(SELECT 1 FROM recruitment_outbound_operations WHERE account_id=f.account_id AND (state='uncertain' OR reserved_at_ms>? OR (state='reserved' AND reserved_at_ms<=?)))
 AND NOT EXISTS(SELECT 1 FROM comment_rule_jobs WHERE account_id=f.account_id AND public_reply_status IN ('processing','uncertain'))
 AND NOT EXISTS(SELECT 1 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id WHERE g.account_id=f.account_id AND d.end_reason='outcome_unknown')
 AND NOT EXISTS(SELECT 1 FROM recruitment_gate_operations WHERE account_id=f.account_id AND (state='uncertain' OR (state='claimed' AND (claimed_at_ms<=? OR claimed_at_ms>? OR owner_epoch!=c.owner_epoch))))
 AND NOT EXISTS(SELECT 1 FROM recruitment_gate_followup_operations WHERE account_id=f.account_id AND (state='uncertain' OR (state='claimed' AND (claimed_at_ms<=? OR claimed_at_ms>? OR owner_epoch!=c.owner_epoch))))
 AND NOT EXISTS(SELECT 1 FROM recruitment_gate_cta_operations WHERE account_id=f.account_id AND (state='uncertain' OR (state='claimed' AND (claimed_at_ms<=? OR claimed_at_ms>? OR owner_epoch!=c.owner_epoch))))`)
 .bind(now-60000,now,followerId,accountId,now,now-60000,now-60000,now,now-60000,now,now-60000,now).first<{igsid:string;metadata:string;owner_epoch:string}>();
 if(!row||await messagingEligibility(db,followerId,accountId,now)!=='eligible')throw Error('Automatic recruitment action requires reconciliation');
 assertRecruitmentBusinessState(row.metadata,row.owner_epoch,now);await assertNoRecruitmentInboundHold(db,accountId,row.igsid);
 return{accountId,metadata:row.metadata,ownerEpoch:row.owner_epoch,subjectHash:await recruitmentSubjectHash(accountId,row.igsid)};
}

/** Snapshot-bound predicate for each automatic mutation. A preflight alone is
 * insufficient: a stop/hold/owner change may occur while a query is awaited. */
export function recruitmentAdmissionPredicate(accountId:string,followerId:number,snapshot:{accountId:string;metadata:string;ownerEpoch:string;subjectHash:string},now=Date.now()){
 if(snapshot.accountId!==accountId||!isRecruitmentDeliveryWindow(now))return{sql:'0',bindings:[] as (string|number)[]};
 return{sql:`EXISTS(SELECT 1 FROM followers f JOIN ig_accounts a ON a.id=f.account_id AND a.is_active=1
 JOIN recruitment_outbound_control c ON c.account_id=f.account_id AND c.owner='harness' AND c.owner_epoch=? AND c.reconciled_at_ms BETWEEN ? AND ?
 WHERE f.id=? AND f.account_id=? AND f.messaging_owner='primary' AND f.metadata IS ?
 AND julianday(f.last_inbound_at)>julianday(?) AND julianday(f.last_inbound_at)<=julianday(?)
 AND json_extract(f.metadata,'$.recruitment_delivery.state')='active'
 AND json_extract(f.metadata,'$.recruitment_delivery.owner_epoch')=c.owner_epoch
 AND json_extract(f.metadata,'$.recruitment_delivery.observed_at_ms') BETWEEN ? AND ?
 AND json_extract(f.metadata,'$.recruitment_delivery.valid_until_ms')>? AND json_extract(f.metadata,'$.recruitment_delivery.valid_until_ms')<=json_extract(f.metadata,'$.recruitment_delivery.observed_at_ms')+300000
 AND EXISTS(SELECT 1 FROM integration_settings WHERE key='outbound_paused' AND value='0')
 AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=f.account_id)
 AND NOT EXISTS(SELECT 1 FROM recruitment_inbound_holds WHERE account_id=f.account_id AND subject_hash=?)
 AND NOT EXISTS(SELECT 1 FROM recruitment_outbound_operations WHERE account_id=f.account_id AND (state='uncertain' OR reserved_at_ms>? OR (state='reserved' AND reserved_at_ms<=?)))
 AND NOT EXISTS(SELECT 1 FROM recruitment_gate_followup_operations WHERE account_id=f.account_id AND (state='uncertain' OR (state='claimed' AND (claimed_at_ms<=? OR claimed_at_ms>? OR owner_epoch!=c.owner_epoch))))
 AND NOT EXISTS(SELECT 1 FROM recruitment_gate_cta_operations WHERE account_id=f.account_id AND (state='uncertain' OR (state='claimed' AND (claimed_at_ms<=? OR claimed_at_ms>? OR owner_epoch!=c.owner_epoch))))
 AND NOT EXISTS(SELECT 1 FROM recruitment_gate_operations WHERE account_id=f.account_id AND (state='uncertain' OR (state='claimed' AND (claimed_at_ms<=? OR claimed_at_ms>? OR owner_epoch!=c.owner_epoch))))
 AND NOT EXISTS(SELECT 1 FROM comment_rule_jobs WHERE account_id=f.account_id AND public_reply_status IN ('processing','uncertain'))
 AND NOT EXISTS(SELECT 1 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id WHERE g.account_id=f.account_id AND d.end_reason='outcome_unknown'))`,bindings:[snapshot.ownerEpoch,now-60000,now,followerId,accountId,snapshot.metadata,new Date(now-86400000).toISOString(),new Date(now).toISOString(),now-300000,now,now,snapshot.subjectHash,now,now-60000,now-60000,now,now-60000,now,now-60000,now]};
}
