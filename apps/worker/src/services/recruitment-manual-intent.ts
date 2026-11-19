import { sha256 } from '../lib/security.js';
export type ManualIntent = { accountId:string; followerId:number; nonce:string; messageType:string; content:string; altText?:string };
export async function claimRecruitmentManualIntent(db:D1Database,input:ManualIntent,preparationLocked=true,nowMs=Date.now()):Promise<{
  status:'claimed'|'sent'|'uncertain'|'conflict'|'held'; key?:string; ownerEpoch?:string;
}> {
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(input.nonce)) throw new Error('A stable 16–100 character Idempotency-Key is required');
  if (!Number.isSafeInteger(input.followerId)||input.followerId<1) throw new Error('Invalid follower');
  if(preparationLocked)return {status:'held'};
  const key='manual:'+await sha256(JSON.stringify([input.accountId,input.nonce]));
  const hash=await sha256(JSON.stringify([input.followerId,input.messageType,input.content,input.altText??'']));
  const control=await db.prepare(`SELECT owner_epoch FROM recruitment_outbound_control WHERE account_id=? AND owner='harness'
    AND reconciled_at_ms BETWEEN ? AND ?`).bind(input.accountId,nowMs-60_000,nowMs).first<{owner_epoch:string}>();
  if(!control)return {status:'held'};
  const claimed=await db.prepare(`INSERT INTO recruitment_manual_intents(account_id,operation_key,follower_id,body_hash,owner_epoch,status,created_at_ms)
    SELECT ?,?,?,?,?,'claimed',? WHERE EXISTS(SELECT 1 FROM followers WHERE id=? AND account_id=?)
    AND EXISTS(SELECT 1 FROM integration_settings WHERE key='outbound_paused' AND value='0')
    AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=?)
    AND EXISTS(SELECT 1 FROM recruitment_outbound_control WHERE account_id=? AND owner='harness' AND owner_epoch=?)
    ON CONFLICT(account_id,operation_key) DO NOTHING RETURNING operation_key`)
    .bind(input.accountId,key,input.followerId,hash,control.owner_epoch,nowMs,input.followerId,input.accountId,input.accountId,input.accountId,control.owner_epoch).first();
  if(claimed)return {status:'claimed',key,ownerEpoch:control.owner_epoch};
  const existing=await db.prepare('SELECT body_hash,status FROM recruitment_manual_intents WHERE account_id=? AND operation_key=?')
    .bind(input.accountId,key).first<{body_hash:string;status:string}>();
  if(!existing)return {status:'held'};
  if(existing.body_hash!==hash)return {status:'conflict'};
  return {status:existing.status==='sent'?'sent':'uncertain'};
}
export async function finishRecruitmentManualIntent(db:D1Database,accountId:string,key:string,status:'sent'|'uncertain'):Promise<void>{
  const result=await db.prepare("UPDATE recruitment_manual_intents SET status=? WHERE account_id=? AND operation_key=? AND status='claimed'").bind(status,accountId,key).run();
  if(result.meta.changes!==1)throw new Error('Manual delivery outcome was not persisted');
}
