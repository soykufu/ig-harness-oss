import {wrapClickTracking} from './gate-click-tracking.js';
import type {IgAccountRef} from './line-cross-link.js';
import type {GateFollowupProof} from './recruitment-gate-followup.js';
import {sha256} from '../lib/security.js';
import {renderRichActions,richActionMessage,type RichAction,type RichMessageBlock} from '@ig-harness/ig-sdk';
import {getEngagementGate,getGateDelivery,getRichMessage,logMessage,parseFollowupSequence,type EngagementGate,type GateDelivery} from '@ig-harness/db';
import {assertRecruitmentBusinessState} from './recruitment-business-state.js';
import {assertNoRecruitmentInboundHold} from './recruitment-inbound-holds.js';
import {messagingEligibility} from './messaging-window.js';
type Client={getUserProfile(id:string):Promise<{is_user_follow_business?:boolean}>;sendText(id:string,text:string):Promise<unknown>;sendImage(id:string,url:string):Promise<unknown>;sendGenericTemplate(id:string,elements:unknown[]):Promise<unknown>;sendQuickReply(id:string,text:string,items:unknown[]):Promise<unknown>};
export type GatePostbackProof={deliveryId:string;followerId:number;igsid:string;phase:'reward'|'reminder';loopCount:number;eventKey:string;definitionVersion:string;messages:unknown[];payloadVersion:string};
export type GatePostbackClientFactory=(key:string,definitionVersion?:string,subjectVersion?:string,followup?:GateFollowupProof,postback?:GatePostbackProof)=>Promise<Client>;
const FIELDS=['id','account_id','status','require_follow','max_loops','reward_dm_text','reward_url','reward_dm_rich_message_id','follow_reminder_dm_text','follow_reminder_button_label','follow_reminder_dm_rich_message_id','followup_dm_sequence','line_connection_id','line_pool_slug','line_tracked_link_short'] as const;
export function gatePostbackKey(proof:Pick<GatePostbackProof,'deliveryId'|'phase'|'loopCount'>){return `gate-${proof.phase}:${encodeURIComponent(proof.deliveryId)}${proof.phase==='reminder'?':'+proof.loopCount:''}`;}
async function version(db:D1Database,gate:EngagementGate,delivery:GateDelivery){
 const templates=[];
 for(const id of [gate.reward_dm_rich_message_id,gate.follow_reminder_dm_rich_message_id]){
  if(!id){templates.push(null);continue;}
  const r=await db.prepare('SELECT id,kind,blocks FROM rich_messages WHERE id=? AND account_id=?').bind(id,gate.account_id).first();if(!r)throw Error('Gate template ownership missing');templates.push(r);
 }
 return sha256(JSON.stringify([FIELDS.map(k=>gate[k]??null),delivery.id,delivery.gate_id,delivery.follower_id,delivery.igsid,delivery.loop_count,templates]));
}
async function ready(db:D1Database,accountId:string,proof:GatePostbackProof,now:number){
 const delivery=await getGateDelivery(db,proof.deliveryId);const gate=delivery?await getEngagementGate(db,delivery.gate_id):null;
 if(!gate||!delivery||gate.account_id!==accountId||gate.status!=='active'||delivery.follower_id!==proof.followerId||delivery.igsid!==proof.igsid||delivery.loop_count!==proof.loopCount||!['cta_sent','pending_follow'].includes(delivery.status)||await version(db,gate,delivery)!==proof.definitionVersion)throw Error('Gate postback definition changed');
 const row=await db.prepare(`SELECT f.metadata,c.owner_epoch FROM recruitment_gate_operations o
 JOIN followers f ON f.id=o.follower_id AND f.account_id=o.account_id AND f.igsid=? AND f.messaging_owner='primary'
 JOIN ig_accounts a ON a.id=o.account_id AND a.is_active=1
 JOIN recruitment_outbound_control c ON c.account_id=o.account_id AND c.owner='harness' AND c.owner_epoch=o.owner_epoch AND c.reconciled_at_ms BETWEEN ? AND ?
 JOIN gate_deliveries d ON d.id=o.delivery_id AND d.end_reason='delivery_in_progress'
 JOIN webhook_events e ON e.account_id=o.account_id AND e.event_key=o.event_key AND e.kind='messaging' AND e.status='processing' AND e.subject_id=f.igsid
 WHERE o.account_id=? AND o.operation_key=? AND o.delivery_id=? AND o.follower_id=? AND o.event_key=? AND o.phase=? AND o.loop_count=? AND o.definition_version=? AND o.payload_version IS ? AND o.expected_messages IS ? AND o.state='claimed' AND o.claimed_at_ms BETWEEN ? AND ?
 AND EXISTS(SELECT 1 FROM integration_settings WHERE key='outbound_paused' AND value='0')
 AND json_extract(e.payload,'$.sender.id')=f.igsid AND json_extract(e.payload,'$.postback.payload')='CHECK_FOLLOW:'||d.gate_id||':'||d.id
 AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=o.account_id)`).bind(proof.igsid,now-60000,now,accountId,gatePostbackKey(proof),proof.deliveryId,proof.followerId,proof.eventKey,proof.phase,proof.loopCount,proof.definitionVersion,proof.payloadVersion||null,proof.messages.length||null,now-60000,now).first<{metadata:string;owner_epoch:string}>();
 if(!row||await messagingEligibility(db,proof.followerId,accountId,now)!=='eligible')throw Error('Gate postback requires reconciliation');
 assertRecruitmentBusinessState(row.metadata,row.owner_epoch,now);await assertNoRecruitmentInboundHold(db,accountId,proof.igsid);
 return{gate,delivery};
}
export async function assertGatePostbackReady(db:D1Database,accountId:string,operation:{key:string;definitionVersion?:string},proof:GatePostbackProof,now=Date.now()){
 if(operation.key!==gatePostbackKey(proof)||operation.definitionVersion!==proof.definitionVersion||!proof.messages.length||proof.messages.length>10||await sha256(JSON.stringify(proof.messages))!==proof.payloadVersion)throw Error('Gate postback purpose missing');
 await ready(db,accountId,proof,now);
}
export async function assertGatePostbackPayload(db:D1Database,accountId:string,operation:{key:string;definitionVersion?:string},proof:GatePostbackProof,slot:number,payload:{recipient?:{id?:string;comment_id?:string};message?:unknown},now=Date.now()){
 await assertGatePostbackReady(db,accountId,operation,proof,now);
 if(payload.recipient?.id!==proof.igsid||payload.recipient.comment_id||slot>=proof.messages.length||JSON.stringify(payload.message)!==JSON.stringify(proof.messages[slot]))throw Error('Gate postback recipient or payload changed');
}
/** Enforced-only path. Existing live rules remain disabled. No LINE fallback. */
export async function handleRecruitmentGatePostback(db:D1Database,client:Client,input:{gateId:string;deliveryId:string;igsid:string;accountId?:string;eventKey?:string;workerBaseUrl?:string;igAccount?:IgAccountRef},factory:GatePostbackClientFactory){
 const now=Date.now();if(!input.accountId||!input.eventKey||!/^(message|postback):[a-f0-9]{64}$/.test(input.eventKey))throw Error('Verified gate postback event required');
 const [gate,delivery]=await Promise.all([getEngagementGate(db,input.gateId),getGateDelivery(db,input.deliveryId)]);
 if(!gate||!delivery||gate.account_id!==input.accountId||delivery.gate_id!==gate.id||delivery.igsid!==input.igsid||gate.status!=='active'||!['cta_sent','pending_follow'].includes(delivery.status))return;
 const evidence=await db.prepare(`SELECT c.owner_epoch FROM webhook_events e JOIN recruitment_outbound_control c ON c.account_id=e.account_id AND c.owner='harness' AND c.reconciled_at_ms BETWEEN ? AND ?
 WHERE e.account_id=? AND e.event_key=? AND e.kind='messaging' AND e.status='processing' AND e.subject_id=? AND julianday(e.started_at) BETWEEN julianday(?) AND julianday(?)
 AND json_extract(e.payload,'$.sender.id')=? AND json_extract(e.payload,'$.postback.payload')=?`).bind(now-60000,now,input.accountId,input.eventKey,input.igsid,new Date(now-60000).toISOString(),new Date(now).toISOString(),input.igsid,`CHECK_FOLLOW:${gate.id}:${delivery.id}`).first<{owner_epoch:string}>();
 if(!evidence)throw Error('Gate postback receipt missing');
 // Serialize the whole read/check/reply cycle BEFORE the profile GET.
 const definitionVersion=await version(db,gate,delivery);
 const claim=await db.prepare(`UPDATE gate_deliveries SET end_reason='delivery_in_progress' WHERE id=? AND status=? AND loop_count=? AND end_reason IS NULL AND NOT EXISTS(SELECT 1 FROM recruitment_gate_operations WHERE account_id=? AND event_key=?) RETURNING id`).bind(delivery.id,delivery.status,delivery.loop_count,input.accountId,input.eventKey).first();
 if(!claim)return;
 let proof:GatePostbackProof|undefined,key:string|undefined;
 try{
  if(gate.line_connection_id)throw Error('Gate LINE handoff requires verification');
  if(await messagingEligibility(db,delivery.follower_id,input.accountId,now)!=='eligible')throw Error('Gate postback recipient ineligible');
  if(!Number.isSafeInteger(delivery.loop_count)||delivery.loop_count<0||!Number.isSafeInteger(gate.max_loops)||gate.max_loops<0||![0,1].includes(gate.require_follow))throw Error('Gate phase state is invalid');
  const following=gate.require_follow===0?true:(await client.getUserProfile(input.igsid)).is_user_follow_business;
  if(typeof following!=='boolean')throw Error('Follow state could not be verified');
  const follows=following;
  proof={deliveryId:delivery.id,followerId:delivery.follower_id,igsid:delivery.igsid,phase:follows?'reward':'reminder',loopCount:delivery.loop_count,eventKey:input.eventKey,definitionVersion,messages:[],payloadVersion:''};key=gatePostbackKey(proof);
  const inserted=await db.prepare(`INSERT INTO recruitment_gate_operations(account_id,operation_key,event_key,delivery_id,follower_id,phase,loop_count,definition_version,owner_epoch,claimed_at_ms,state) VALUES(?,?,?,?,?,?,?,?,?,?,'claimed') ON CONFLICT DO NOTHING RETURNING operation_key`).bind(input.accountId,key,input.eventKey,delivery.id,delivery.follower_id,proof.phase,delivery.loop_count,definitionVersion,evidence.owner_epoch,now).first();
  if(!inserted)throw Error('Gate phase already claimed');
  await ready(db,input.accountId,proof,Date.now());
  if(!follows&&gate.max_loops>0&&delivery.loop_count+1>gate.max_loops){
   await db.batch([db.prepare("UPDATE recruitment_gate_operations SET state='skipped',expected_messages=0 WHERE account_id=? AND operation_key=? AND state='claimed'").bind(input.accountId,key),db.prepare("UPDATE gate_deliveries SET status='dropped',end_reason=NULL,last_check_at=? WHERE id=? AND end_reason='delivery_in_progress'").bind(new Date().toISOString(),delivery.id)]);return;
  }
  const rewardUrl=input.workerBaseUrl&&gate.reward_url?await wrapClickTracking(input.workerBaseUrl,gate.id,gate.reward_url,delivery.igsid,input.igAccount?.security):gate.reward_url;
  const richId=follows?gate.reward_dm_rich_message_id:gate.follow_reminder_dm_rich_message_id;let actions:RichAction[];
  if(richId){const r=await getRichMessage(db,richId);if(!r)throw Error('Gate template missing');actions=renderRichActions(delivery.igsid,r.blocks as RichMessageBlock[],{gateId:gate.id,deliveryId:delivery.id,rewardUrl});}
  else if(follows){const text=gate.reward_dm_text.replace(/\{\{?\s*IGSID\s*\}?\}/g,()=>delivery.igsid)+(rewardUrl?'\n\n'+rewardUrl:'');actions=[{type:'text',text}];}
  else actions=[{type:'template',elements:[{title:gate.follow_reminder_dm_text.slice(0,80),subtitle:gate.follow_reminder_dm_text.length>80?gate.follow_reminder_dm_text.slice(80,200):undefined,buttons:[{type:'postback',title:gate.follow_reminder_button_label,payload:`CHECK_FOLLOW:${gate.id}:${delivery.id}`}]}]}];
  proof.messages=actions.map(richActionMessage);proof.payloadVersion=await sha256(JSON.stringify(proof.messages));
  await db.prepare("UPDATE recruitment_gate_operations SET payload_version=?,expected_messages=? WHERE account_id=? AND operation_key=? AND state='claimed' AND payload_version IS NULL").bind(proof.payloadVersion,actions.length,input.accountId,key).run();
  const sender=await factory(key,definitionVersion,undefined,undefined,proof);
  for(const a of actions){if(a.type==='text')await sender.sendText(delivery.igsid,a.text);else if(a.type==='image')await sender.sendImage(delivery.igsid,a.url);else if(a.type==='template')await sender.sendGenericTemplate(delivery.igsid,a.elements);else await sender.sendQuickReply(delivery.igsid,a.text,a.replies);}
  await ready(db,input.accountId,proof,Date.now());
  const at=new Date().toISOString();let next:string|null=null;if(follows){const first=parseFollowupSequence(gate.followup_dm_sequence)[0];if(first)next=new Date(Date.now()+first.delay_minutes*60000).toISOString();}
  const result=await db.batch([
   db.prepare("UPDATE recruitment_gate_operations SET state='sent' WHERE account_id=? AND operation_key=? AND state='claimed' AND (SELECT COUNT(*) FROM recruitment_outbound_operations WHERE account_id=? AND operation_key GLOB ? AND state='sent' AND length(message_id)>0)=? RETURNING operation_key").bind(input.accountId,key,input.accountId,key+':*',actions.length),
   db.prepare("UPDATE gate_deliveries SET status=?,loop_count=?,last_check_at=?,delivered_at=?,next_followup_at=?,end_reason=NULL WHERE id=? AND end_reason='delivery_in_progress' AND EXISTS(SELECT 1 FROM recruitment_gate_operations WHERE account_id=? AND operation_key=? AND state='sent') AND status IN ('cta_sent','pending_follow') AND loop_count=? AND EXISTS(SELECT 1 FROM engagement_gates g WHERE g.id=gate_deliveries.gate_id AND g.account_id IS ? AND g.status IS ? AND g.require_follow IS ? AND g.max_loops IS ? AND g.reward_dm_text IS ? AND g.reward_url IS ? AND g.reward_dm_rich_message_id IS ? AND g.follow_reminder_dm_text IS ? AND g.follow_reminder_button_label IS ? AND g.follow_reminder_dm_rich_message_id IS ? AND g.followup_dm_sequence IS ? AND g.line_connection_id IS ? AND g.line_pool_slug IS ? AND g.line_tracked_link_short IS ?)").bind(follows?'delivered':'pending_follow',follows?delivery.loop_count:delivery.loop_count+1,at,follows?at:null,next,delivery.id,input.accountId,key,delivery.loop_count,gate.account_id,gate.status,gate.require_follow,gate.max_loops,gate.reward_dm_text,gate.reward_url,gate.reward_dm_rich_message_id,gate.follow_reminder_dm_text,gate.follow_reminder_button_label,gate.follow_reminder_dm_rich_message_id,gate.followup_dm_sequence,gate.line_connection_id,gate.line_pool_slug,gate.line_tracked_link_short),
  ]);if(result[0].results.length!==1||result[1].meta.changes!==1)throw Error('Gate acknowledgement incomplete');
  await logMessage(db,{followerId:delivery.follower_id,direction:'out',messageType:'template',body:JSON.stringify({kind:'gate',phase:proof.phase}),triggerSource:'gate'});
 }catch(error){
  if(key)await db.prepare("UPDATE recruitment_gate_operations SET state='uncertain' WHERE account_id=? AND operation_key=? AND state='claimed'").bind(input.accountId,key).run();
  await db.prepare("UPDATE gate_deliveries SET end_reason='outcome_unknown' WHERE id=? AND end_reason='delivery_in_progress'").bind(delivery.id).run();throw error;
 }
}
