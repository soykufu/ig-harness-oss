import {renderRichActions,richActionMessage,type RichMessageBlock} from '@ig-harness/ig-sdk';
import {sha256} from '../lib/security.js';
import {recruitmentManualBodyHash} from './recruitment-manual-intent.js';
export type RecruitmentRichTest={richId:string;followerId:number;actorId:string;rewardUrl:string|null;followerUsername:string|null;definitionVersion:string};
export function recruitmentRichTestContent(rich:{id:string;kind:string;blocks:unknown},proof:Pick<RecruitmentRichTest,'actorId'|'rewardUrl'|'followerUsername'>){
 return JSON.stringify([rich.id,rich.kind,rich.blocks,proof.rewardUrl,proof.followerUsername,proof.actorId]);
}
/** Purpose/actor/template are rechecked against the same durable manual key.
 * This grants no exception to pause, business state, inbound hold or 24h rules. */
export async function assertRecruitmentRichTestReady(db:D1Database,accountId:string,operation:{key:string;ownerEpoch:string},proof:RecruitmentRichTest,now:number){
 if(!/^manual:[a-f0-9]{64}$/.test(operation.key)||!Number.isSafeInteger(proof.followerId)||proof.followerId<1||!/^[a-f0-9]{64}$/.test(proof.definitionVersion))throw Error('Invalid rich test proof');
 const rich=await db.prepare('SELECT id,kind,blocks FROM rich_messages WHERE id=? AND account_id=?').bind(proof.richId,accountId).first<{id:string;kind:string;blocks:string}>();
 if(!rich)throw Error('Rich message ownership changed');const blocks=JSON.parse(rich.blocks);
 const content=recruitmentRichTestContent({...rich,blocks},proof);
 if(!Array.isArray(blocks)||!blocks.length||await sha256(content)!==proof.definitionVersion)throw Error('Rich message definition changed');
 const hash=await recruitmentManualBodyHash({followerId:proof.followerId,messageType:'rich-test',content});
 const row=await db.prepare(`SELECT f.igsid FROM recruitment_manual_intents i
 JOIN followers f ON f.id=i.follower_id AND f.account_id=i.account_id
 JOIN rich_messages r ON r.id=? AND r.account_id=i.account_id AND r.kind=? AND r.blocks=?
 WHERE i.account_id=? AND i.operation_key=? AND i.follower_id=? AND i.body_hash=? AND i.owner_epoch=? AND i.status='claimed'
 AND i.created_at_ms BETWEEN ? AND ?
 AND EXISTS(SELECT 1 FROM staff_members WHERE id=? AND is_active=1 AND role IN ('owner','admin'))
 AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=i.account_id)`)
 .bind(proof.richId,rich.kind,rich.blocks,accountId,operation.key,proof.followerId,hash,operation.ownerEpoch,now-60000,now,proof.actorId).first<{igsid:string}>();
 if(!row)throw Error('Rich test requires reconciliation');
 // Validate all expanded blocks before reserving the first transport slot.
 renderRichActions(row.igsid,blocks as RichMessageBlock[],{gateId:'preview-gate',deliveryId:'preview-delivery',rewardUrl:proof.rewardUrl,followerUsername:proof.followerUsername},{preserveCopy:true});
}

export async function assertRecruitmentRichTestPayload(db:D1Database,accountId:string,proof:RecruitmentRichTest,slot:number,payload:{recipient?:{id?:string;comment_id?:string};message?:unknown}){
 const target=await db.prepare('SELECT igsid FROM followers WHERE id=? AND account_id=?').bind(proof.followerId,accountId).first<{igsid:string}>();
 const rich=await db.prepare('SELECT blocks FROM rich_messages WHERE id=? AND account_id=?').bind(proof.richId,accountId).first<{blocks:string}>();
 if(!target||!rich||payload.recipient?.id!==target.igsid||payload.recipient?.comment_id)throw Error('Rich test recipient changed');
 const actions=renderRichActions(target.igsid,JSON.parse(rich.blocks) as RichMessageBlock[],{gateId:'preview-gate',deliveryId:'preview-delivery',rewardUrl:proof.rewardUrl,followerUsername:proof.followerUsername},{preserveCopy:true});
 if(!actions[slot]||JSON.stringify(payload.message)!==JSON.stringify(richActionMessage(actions[slot])))throw Error('Rich test payload changed');
}
