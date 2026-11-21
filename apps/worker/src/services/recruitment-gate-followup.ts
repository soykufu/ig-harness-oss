import {sha256} from '../lib/security.js';
import type {EngagementGate,GateDelivery} from '@ig-harness/db';

export type GateFollowupProof={deliveryId:string;stepIndex:number;followerId:number;igsid:string;definitionVersion:string;messages:unknown[];payloadVersion:string};
const FIELDS=['id','account_id','status','followup_dm_sequence','reward_url','line_connection_id','line_pool_slug','line_tracked_link_short'] as const;
export function gateFollowupKey(deliveryId:string,stepIndex:number){return `gate-followup:${encodeURIComponent(deliveryId)}:${stepIndex}`;}
export function gateFollowupVersion(gate:Pick<EngagementGate,typeof FIELDS[number]>,delivery:Pick<GateDelivery,'id'|'gate_id'|'follower_id'|'igsid'|'followup_step_sent'>){
 return sha256(JSON.stringify([FIELDS.map(k=>gate[k]??null),delivery.id,delivery.gate_id,delivery.follower_id,delivery.igsid,delivery.followup_step_sent]));
}
export function gateFollowupPayloadVersion(messages:unknown[]){return sha256(JSON.stringify(messages));}
/** A claimed follow-up retains its operation ID across edits and failures.
 * It grants no exception to the ordinary pause, window, ownership or hold rules. */
export async function assertGateFollowupReady(db:D1Database,accountId:string,operation:{key:string;definitionVersion?:string;ownerEpoch:string},proof:GateFollowupProof,now=Date.now()){
 if(operation.key!==gateFollowupKey(proof.deliveryId,proof.stepIndex)||!Number.isSafeInteger(proof.stepIndex)||proof.stepIndex<0||!Number.isSafeInteger(proof.followerId)||proof.followerId<1||operation.definitionVersion!==proof.definitionVersion||!/^[a-f0-9]{64}$/.test(proof.definitionVersion)||proof.messages.length<1||proof.messages.length>2||await gateFollowupPayloadVersion(proof.messages)!==proof.payloadVersion)throw Error('Invalid gate follow-up evidence');
 const row=await db.prepare(`SELECT g.*,d.id AS delivery_id,d.gate_id,d.follower_id,d.igsid,d.followup_step_sent,d.metadata AS delivery_metadata,d.delivered_at
 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id AND g.account_id=? AND g.status='active'
 JOIN recruitment_gate_followup_operations r ON r.delivery_id=d.id AND r.account_id=g.account_id AND r.follower_id=d.follower_id AND r.step_index=d.followup_step_sent AND r.operation_key=? AND r.state='claimed' AND r.owner_epoch=? AND r.definition_version=? AND r.payload_version=? AND r.expected_messages=? AND r.claimed_at_ms BETWEEN ? AND ?
 JOIN followers f ON f.id=d.follower_id AND f.account_id=g.account_id AND f.igsid=d.igsid
 WHERE d.id=? AND d.follower_id=? AND d.igsid=? AND d.status='delivered' AND d.end_reason='delivery_in_progress'
 AND d.next_followup_at IS NULL AND d.followup_step_sent=?`).bind(accountId,operation.key,operation.ownerEpoch,proof.definitionVersion,proof.payloadVersion,proof.messages.length,now-60000,now,proof.deliveryId,proof.followerId,proof.igsid,proof.stepIndex).first<EngagementGate & {delivery_id:string;gate_id:string;follower_id:number;igsid:string;followup_step_sent:number;delivery_metadata:string;delivered_at:string|null}>();
 if(!row)throw Error('Gate follow-up requires reconciliation');
 const claim=JSON.parse(row.delivery_metadata).recruitment_followup;
 if(!claim||claim.owner_epoch!==operation.ownerEpoch||claim.step!==proof.stepIndex||claim.version!==proof.definitionVersion||claim.payload!==proof.payloadVersion||claim.expected_messages!==proof.messages.length||!Number.isSafeInteger(claim.claimed_at_ms)||claim.claimed_at_ms>now||claim.claimed_at_ms<now-60000||!row.delivered_at||!Number.isFinite(Date.parse(row.delivered_at))||Date.parse(row.delivered_at)>now||await gateFollowupVersion(row,{...row,id:row.delivery_id})!==proof.definitionVersion)throw Error('Gate follow-up definition or claim changed');
}
export async function assertGateFollowupPayload(db:D1Database,accountId:string,operation:{key:string;definitionVersion?:string;ownerEpoch:string},proof:GateFollowupProof,slot:number,payload:{recipient?:{id?:string;comment_id?:string};message?:unknown},now=Date.now()){
 await assertGateFollowupReady(db,accountId,operation,proof,now);
 if(payload.recipient?.id!==proof.igsid||payload.recipient.comment_id||slot>=proof.messages.length||JSON.stringify(payload.message)!==JSON.stringify(proof.messages[slot]))throw Error('Gate follow-up payload or recipient changed');
}
