import {sha256} from '../lib/security.js';
import {recruitmentSubjectHash} from './recruitment-inbound-holds.js';
import {messagingEligibility} from './messaging-window.js';
export type HumanReplyInput={accountId:string;followerId:number;actorId:string;nonce:string;text:string};
// The full ordered set is compared in the same write statement, not just a
// timestamp/count: a new or altered event invalidates the reviewed contract.
const SNAPSHOT=`SELECT json_group_array(json_object('key',event_key,'state',state,'at',occurred_at_ms,'seen',recorded_at_ms)) AS snapshot FROM
 (SELECT event_key,state,occurred_at_ms,recorded_at_ms FROM recruitment_inbound_holds WHERE account_id=? AND subject_hash=? ORDER BY event_key)`;
async function evidence(db:D1Database,input:HumanReplyInput,now:number){
 if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(input.followerId)||input.followerId<1||!/^[A-Za-z0-9_-]{16,100}$/.test(input.nonce)||typeof input.text!=='string'||!input.text.trim()||input.text.length>2000)throw Error('Invalid human reply');
 const row=await db.prepare(`SELECT f.igsid,c.owner_epoch FROM followers f JOIN ig_accounts a ON a.id=f.account_id AND a.is_active=1
 JOIN recruitment_outbound_control c ON c.account_id=a.id AND c.owner='harness'
 WHERE f.account_id=? AND f.id=? AND c.reconciled_at_ms BETWEEN ? AND ?
 AND EXISTS(SELECT 1 FROM staff_members WHERE id=? AND is_active=1 AND role IN ('owner','admin'))
 AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=a.id)`)
 .bind(input.accountId,input.followerId,now-60000,now,input.actorId).first<{igsid:string;owner_epoch:string}>();
 if(!row||await messagingEligibility(db,input.followerId,input.accountId,now)!=='eligible')throw Error('Human reply requires reconciliation');
 const subject=await recruitmentSubjectHash(input.accountId,row.igsid);
 const snapshot=(await db.prepare(SNAPSHOT).bind(input.accountId,subject).first<{snapshot:string}>())?.snapshot;
 const events=JSON.parse(snapshot??'[]') as {key:string;state:string;at:number;seen:number}[];
 const latest=Math.max(...events.map(e=>e.at));
 if(!events.length||latest>now||latest<=now-86400000||events.some(e=>e.seen>now||e.at>now||e.at<0||e.seen<e.at)||events.filter(e=>e.at===latest).some(e=>e.state!=='consulting'))throw Error('Latest inbound is not a reviewed consultation');
 return{key:'human:'+await sha256(JSON.stringify([input.accountId,input.nonce])),subject,snapshot:snapshot!,inboundHash:await sha256(snapshot!),bodyHash:await sha256(input.text),epoch:row.owner_epoch};
}
/** Preparation only. No route, UI, lifecycle exemption or active state update
 * is installed by this module; enabled defaults false. Pause is never lifted. */
export async function prepareHumanReplyContract(db:D1Database,input:HumanReplyInput,enabled=false,now=Date.now()):Promise<string>{
 if(!enabled)throw Error('Human reply contract is not enabled');
 const e=await evidence(db,input,now);
 const row=await db.prepare(`INSERT INTO recruitment_human_reply_contracts(account_id,operation_key,follower_id,actor_id,body_hash,inbound_hash,owner_epoch,status,created_at_ms,expires_at_ms)
 SELECT ?,?,?,?,?,?,?,'prepared',?,? WHERE (${SNAPSHOT})=?
 AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=?)
 AND EXISTS(SELECT 1 FROM staff_members WHERE id=? AND is_active=1 AND role IN ('owner','admin'))
 ON CONFLICT(account_id,operation_key) DO NOTHING RETURNING operation_key`)
 .bind(input.accountId,e.key,input.followerId,input.actorId,e.bodyHash,e.inboundHash,e.epoch,now,now+60000,input.accountId,e.subject,e.snapshot,input.accountId,input.actorId).first();
 if(!row)throw Error('Human reply already prepared or changed');return e.key;
}
/** Consumes one contract, not delivery permission. SDK pause, quota, owner,
 * normal window, recipient and acknowledgement guards must remain mandatory. */
export async function claimHumanReplyContract(db:D1Database,input:HumanReplyInput,enabled=false,now=Date.now()):Promise<string>{
 if(!enabled)throw Error('Human reply contract is not enabled');const e=await evidence(db,input,now);
 const row=await db.prepare(`UPDATE recruitment_human_reply_contracts SET status='claimed'
 WHERE account_id=? AND operation_key=? AND follower_id=? AND actor_id=? AND body_hash=? AND inbound_hash=? AND owner_epoch=? AND status='prepared'
 AND created_at_ms<=? AND expires_at_ms>? AND expires_at_ms<=created_at_ms+60000
 AND (${SNAPSHOT})=? AND EXISTS(SELECT 1 FROM integration_settings WHERE key='outbound_paused' AND value='0')
 AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=?)
 AND EXISTS(SELECT 1 FROM staff_members WHERE id=? AND is_active=1 AND role IN ('owner','admin'))
 AND EXISTS(SELECT 1 FROM recruitment_outbound_control WHERE account_id=? AND owner='harness' AND owner_epoch=? AND reconciled_at_ms BETWEEN ? AND ?) RETURNING operation_key`)
 .bind(input.accountId,e.key,input.followerId,input.actorId,e.bodyHash,e.inboundHash,e.epoch,now,now,input.accountId,e.subject,e.snapshot,input.accountId,input.actorId,input.accountId,e.epoch,now-60000,now).first();
 if(!row)throw Error('Human reply contract cannot be claimed');return e.key;
}

export async function assertHumanReplyContract(db:D1Database,input:HumanReplyInput,key:string,enabled=false,now=Date.now()):Promise<void>{
 if(!enabled)throw Error('Human reply contract is not enabled');const e=await evidence(db,input,now);
 const row=key===e.key?await db.prepare(`SELECT 1 FROM recruitment_human_reply_contracts WHERE account_id=? AND operation_key=? AND follower_id=? AND actor_id=? AND body_hash=? AND inbound_hash=? AND owner_epoch=? AND status='claimed' AND created_at_ms<=? AND expires_at_ms>? AND expires_at_ms<=created_at_ms+60000
 AND (${SNAPSHOT})=?
 AND EXISTS(SELECT 1 FROM integration_settings WHERE key='outbound_paused' AND value='0')
 AND EXISTS(SELECT 1 FROM staff_members WHERE id=? AND is_active=1 AND role IN ('owner','admin'))
 AND EXISTS(SELECT 1 FROM recruitment_outbound_control WHERE account_id=? AND owner='harness' AND owner_epoch=? AND reconciled_at_ms BETWEEN ? AND ?)
 AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=?)`)
 .bind(input.accountId,key,input.followerId,input.actorId,e.bodyHash,e.inboundHash,e.epoch,now,now,input.accountId,e.subject,e.snapshot,input.actorId,input.accountId,e.epoch,now-60000,now,input.accountId).first():null;
 if(!row)throw Error('Human reply contract no longer matches');
}
