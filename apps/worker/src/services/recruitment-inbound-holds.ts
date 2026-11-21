import { sha256 } from '../lib/security.js';
import { beginActivity, endActivity } from '../lib/activity.js';

export class InvalidRecruitmentInbound extends Error {}
export class RecruitmentInboundBusy extends Error {}
export const recruitmentSubjectHash = (accountId: string, igsid: string) => sha256(JSON.stringify([accountId,igsid]));

/** Only the signature/account/App-verified webhook calls this opt-in path.
 * Even while paused, persist holds before acknowledging. Never clear a hold
 * from a later inbound or from an echo; ambiguous input goes to human review.
 */
export async function ingestRecruitmentInboundHolds(db:D1Database, account:{id:string;ig_user_id:string},
  events:Array<{kind:string;value:Record<string,any>}>, nowMs=Date.now()):Promise<void> {
  const identity=await db.prepare('SELECT id FROM ig_accounts WHERE id=? AND ig_user_id=? AND is_active=1').bind(account.id,account.ig_user_id).first();
  if(!identity)throw new InvalidRecruitmentInbound('Account identity unavailable');
  const rows=[];
  for(const {kind,value:v} of events) {
    if(!['messaging','standby'].includes(kind) || v.message?.is_echo===true || (!v.message&&!v.postback))continue;
    const mid=v.message?.mid??v.postback?.mid;
    if(typeof v.sender?.id!=='string'||!v.sender.id.trim()||v.sender.id===account.ig_user_id
      ||v.sender.id!==v.sender.id.trim()||v.recipient?.id!==account.ig_user_id||!Number.isSafeInteger(v.timestamp)||v.timestamp<0||v.timestamp>nowMs
      ||(mid!==undefined&&(typeof mid!=='string'||!mid.trim()||mid!==mid.trim()||mid.length>512)))throw new InvalidRecruitmentInbound('Invalid incoming identity');
    const eventKey=await sha256(mid?JSON.stringify(['mid',mid]):JSON.stringify(['event',v]));
    const text=typeof v.message?.text==='string'?v.message.text.normalize('NFKC').trim().toLowerCase():'';
    const payload=v.postback?.payload;
    const state=['停止','配信停止','stop','unsubscribe'].includes(text)||payload==='recruitment:stop'?'stopped'
      :['辞退','応募辞退'].includes(text)?'declined':text||payload==='recruitment:consult'?'consulting':'hold';
    rows.push({eventKey,subject:await recruitmentSubjectHash(account.id,v.sender.id),state,at:v.timestamp});
  }
  if(!rows.length)return;
  const activity=await beginActivity(db);if(!activity)throw new RecruitmentInboundBusy('Deletion in progress');
  try {
    for(let i=0;i<rows.length;i+=25) {
      await db.batch(rows.slice(i,i+25).map(r=>db.prepare(`INSERT INTO recruitment_inbound_holds
        (account_id,event_key,subject_hash,state,occurred_at_ms,recorded_at_ms)
        SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ig_accounts WHERE id=? AND ig_user_id=? AND is_active=1)
        ON CONFLICT(account_id,event_key) DO NOTHING`).bind(account.id,r.eventKey,r.subject,r.state,r.at,nowMs,account.id,account.ig_user_id)));
    }
  } finally {await endActivity(db,activity);}
}

export async function assertNoRecruitmentInboundHold(db:D1Database,accountId:string,igsid:string):Promise<void> {
  const row=await db.prepare('SELECT 1 FROM recruitment_inbound_holds WHERE account_id=? AND subject_hash=? LIMIT 1')
    .bind(accountId,await recruitmentSubjectHash(accountId,igsid)).first();
  if(row)throw new Error('Recruitment inbound requires human review');
}
