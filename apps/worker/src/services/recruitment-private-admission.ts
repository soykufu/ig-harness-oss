import {assertNoRecruitmentInboundHold} from './recruitment-inbound-holds.js';
import {assertRecruitmentBusinessState} from './recruitment-business-state.js';

/** Final check for one claimed comment job, not an ordinary DM's 24h window.
 * Missing creation time and live-comment proof are held; no Graph lookup or
 * fresh operation ID is generated here. Callers must supply comment:<job-id>.
 */
export async function assertRecruitmentPrivateReplyReady(db:D1Database,accountId:string,commentId:string,
 operation:{key:string;ownerEpoch:string},nowMs:number):Promise<string>{
 if(!operation.key.startsWith('comment:'))throw Error('Private reply operation requires a comment job');
 const row=await db.prepare(`SELECT f.igsid,f.metadata,j.comment_created_at,j.started_at,p.attempted_at
   FROM comment_rule_jobs j JOIN followers f ON f.id=j.follower_id AND f.account_id=j.account_id
   JOIN private_reply_attempts p ON p.account_id=j.account_id AND p.comment_id=j.comment_id AND p.follower_id=j.follower_id
   WHERE j.account_id=? AND j.id=? AND j.comment_id=? AND j.status='processing'
     AND j.delivery_mode='private_reply' AND p.status='processing' AND f.messaging_owner='primary'
     AND COALESCE(j.is_live,0)=0 AND julianday(j.due_at)<=julianday(?) AND julianday(j.expires_at)>julianday(?)
     AND (j.gate_delivery_id IS NULL OR EXISTS(SELECT 1 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id WHERE d.id=j.gate_delivery_id AND g.account_id=j.account_id AND g.status='active' AND d.follower_id=j.follower_id AND d.igsid=f.igsid AND d.status='triggered' AND d.end_reason IS NULL))`)
   .bind(accountId,operation.key.slice(8),commentId,new Date(nowMs).toISOString(),new Date(nowMs).toISOString())
   .first<{igsid:string;metadata:string;comment_created_at:string|null;started_at:string|null;attempted_at:string}>();
 if(!row?.igsid)throw Error('Private reply job requires reconciliation');
 const created=Date.parse(row.comment_created_at??'');
 const claimed=[Date.parse(row.started_at??''),Date.parse(row.attempted_at)];
 if(!Number.isFinite(created)||created>nowMs||created<=nowMs-7*86400000
   ||claimed.some(t=>!Number.isFinite(t)||t>nowMs||t<nowMs-60000))throw Error('Private reply evidence is stale');
 assertRecruitmentBusinessState(row.metadata,operation.ownerEpoch,nowMs);
 await assertNoRecruitmentInboundHold(db,accountId,row.igsid);
 return row.igsid;
}
