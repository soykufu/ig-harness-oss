import {sha256} from '../lib/security.js';
import {assertRecruitmentBusinessState} from './recruitment-business-state.js';
import {assertNoRecruitmentInboundHold} from './recruitment-inbound-holds.js';

const PREFIX='comment-public:';
const FIELDS=['follower_id','igsid','comment_id','media_id','reply_text','reply_mode','message_type','body','gate_delivery_id'] as const;
type PublicPlan={id:string;follower_id:number;igsid:string;comment_id:string;media_id:string|null;reply_text:string|null;reply_mode:string|null;message_type:string;body:string;gate_delivery_id:string|null};
type Ready=PublicPlan & {metadata:string;owner_epoch:string;public_reply_plan_hash:string|null;public_reply_owner_epoch:string|null;public_reply_claimed_at:string|null};
export function recruitmentPublicReplyVersion(accountId:string,plan:PublicPlan){
 return sha256(JSON.stringify([accountId,plan.id,FIELDS.map(field=>plan[field]??null)]));
}
// Positive private-DM acknowledgement, the same owner epoch, a fresh job and
// current gate/follower state are required. Public replies consume no DM slot.
const READY=`SELECT j.*,f.igsid,f.metadata,c.owner_epoch FROM comment_rule_jobs j
 JOIN followers f ON f.id=j.follower_id AND f.account_id=j.account_id AND f.messaging_owner='primary'
 JOIN ig_accounts a ON a.id=j.account_id AND a.is_active=1
 JOIN recruitment_outbound_control c ON c.account_id=j.account_id AND c.owner='harness'
 JOIN private_reply_attempts p ON p.account_id=j.account_id AND p.comment_id=j.comment_id AND p.follower_id=j.follower_id AND p.status='sent'
 JOIN recruitment_outbound_operations o ON o.account_id=j.account_id AND o.operation_key='comment:'||j.id||':0' AND o.state='sent' AND o.owner_epoch=c.owner_epoch AND o.message_id=p.message_id AND length(o.message_id)>0
 WHERE j.account_id=? AND j.id=? AND j.public_reply_status IS ?
 AND c.reconciled_at_ms BETWEEN ? AND ?
 AND julianday(j.started_at) BETWEEN julianday(?) AND julianday(?)
 AND julianday(j.finished_at) BETWEEN julianday(?) AND julianday(?)
 AND julianday(p.attempted_at) BETWEEN julianday(?) AND julianday(?)
 AND COALESCE(j.is_live,0)=0 AND julianday(j.comment_created_at)<=julianday(?) AND julianday(j.expires_at)>julianday(?)
 AND ((j.status='sent' AND j.delivery_mode='private_reply' AND j.message_type='text') OR (j.status='pending' AND j.delivery_mode='awaiting_inbound' AND j.message_type!='text'))
 AND EXISTS(SELECT 1 FROM integration_settings WHERE key='outbound_paused' AND value='0')
 AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=j.account_id)
 AND NOT EXISTS(SELECT 1 FROM recruitment_outbound_operations WHERE account_id=j.account_id AND state='uncertain')
 AND NOT EXISTS(SELECT 1 FROM comment_rule_jobs x WHERE x.account_id=j.account_id AND x.id!=j.id AND x.public_reply_status IN ('processing','uncertain'))
 AND (j.gate_delivery_id IS NULL OR EXISTS(SELECT 1 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id WHERE d.id=j.gate_delivery_id AND g.account_id=j.account_id AND g.status='active' AND d.follower_id=j.follower_id AND d.igsid=f.igsid AND d.status='cta_sent' AND d.end_reason IS NULL))`;
function bindings(accountId:string,jobId:string,status:string|null,now:number){
 const earlier=new Date(now-60000).toISOString(),at=new Date(now).toISOString();
 return[accountId,jobId,status,now-60000,now,earlier,at,earlier,at,earlier,at,at,at];
}
async function state(db:D1Database,accountId:string,jobId:string,status:string|null,now:number){
 const row=await db.prepare(READY).bind(...bindings(accountId,jobId,status,now)).first<Ready>();
 const hour=new Date(now+9*3600000).getUTCHours();
 if(!row||hour<8||hour>=21||!row.reply_text?.trim()||!['thread','mention'].includes(row.reply_mode??'')||!/^[A-Za-z0-9_-]{1,200}$/.test(row.comment_id)||(row.reply_mode==='mention'&&!/^[A-Za-z0-9_-]{1,200}$/.test(row.media_id??'')))throw Error('Public reply requires reconciliation');
 assertRecruitmentBusinessState(row.metadata,row.owner_epoch,now);
 await assertNoRecruitmentInboundHold(db,accountId,row.igsid);
 return row;
}
/** Claim is one-way. A crash/unknown outcome never creates another phase ID. */
export async function claimRecruitmentPublicReply(db:D1Database,accountId:string,jobId:string,expectedVersion:string,enabled=false,now=Date.now()){
 if(!enabled||!/^[a-f0-9]{64}$/.test(expectedVersion))throw Error('Public reply is not prepared');
 const row=await state(db,accountId,jobId,null,now);
 if(await recruitmentPublicReplyVersion(accountId,row)!==expectedVersion)throw Error('Public reply plan changed');
 const same=FIELDS.map(field=>`ready.${field} IS ?`).join(' AND ');
 const claimed=await db.prepare(`UPDATE comment_rule_jobs SET public_reply_status='processing',public_reply_plan_hash=?,public_reply_owner_epoch=?,public_reply_claimed_at=?
 WHERE id=? AND account_id=? AND public_reply_status IS NULL
 AND EXISTS(SELECT 1 FROM (${READY}) ready WHERE ready.metadata IS ? AND ready.owner_epoch=? AND ${same}) RETURNING id`)
 .bind(expectedVersion,row.owner_epoch,new Date(now).toISOString(),jobId,accountId,...bindings(accountId,jobId,null,now),row.metadata,row.owner_epoch,...FIELDS.map(field=>row[field]??null)).first();
 if(!claimed)throw Error('Public reply already claimed or changed');
 return{key:PREFIX+jobId,ownerEpoch:row.owner_epoch,definitionVersion:expectedVersion};
}
/** The exact public endpoint/query is checked after SDK signing, before fetch. */
export async function assertRecruitmentPublicReplyReady(db:D1Database,accountId:string,operation:{key:string;ownerEpoch:string;definitionVersion?:string},request:{method:string;path:string;body:unknown},now=Date.now()){
 if(!operation.key.startsWith(PREFIX)||!operation.definitionVersion)throw Error('Public reply identity missing');
 const row=await state(db,accountId,operation.key.slice(PREFIX.length),'processing',now);
 if(row.owner_epoch!==operation.ownerEpoch||row.public_reply_owner_epoch!==operation.ownerEpoch||row.public_reply_plan_hash!==operation.definitionVersion||!row.public_reply_claimed_at||!Number.isFinite(Date.parse(row.public_reply_claimed_at))||Date.parse(row.public_reply_claimed_at)>now||Date.parse(row.public_reply_claimed_at)<now-60000||await recruitmentPublicReplyVersion(accountId,row)!==operation.definitionVersion)throw Error('Public reply plan changed');
 const expected=row.reply_mode==='mention'?`/${row.media_id}/comments?message=${encodeURIComponent(row.reply_text!)}`:`/${row.comment_id}/replies?message=${encodeURIComponent(row.reply_text!)}`;
 if(request.method!=='POST'||request.path!==expected||request.body!==undefined)throw Error('Public reply target or text changed');
}
