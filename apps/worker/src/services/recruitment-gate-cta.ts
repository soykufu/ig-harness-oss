import {recruitmentTemplateCopy} from './recruitment-template-copy.js';
import {sha256} from '../lib/security.js';
import {renderRichActions,richActionMessage,type RichAction} from '@ig-harness/ig-sdk';
import {getEngagementGate,getGateDelivery,logMessage,type EngagementGate,type GateDelivery} from '@ig-harness/db';
import {assertRecruitmentBusinessState} from './recruitment-business-state.js';
import {assertNoRecruitmentInboundHold,recruitmentSubjectHash} from './recruitment-inbound-holds.js';
import {messagingEligibility} from './messaging-window.js';
import type {GateFollowupProof} from './recruitment-gate-followup.js';
import type {GatePostbackProof} from './recruitment-gate-postback.js';
type Client={sendText(id:string,text:string):Promise<unknown>;sendImage(id:string,url:string):Promise<unknown>;sendGenericTemplate(id:string,elements:unknown[]):Promise<unknown>;sendQuickReply(id:string,text:string,items:unknown[]):Promise<unknown>};
export type GateCtaMode='keyword'|'story'|'comment_resume';
export type GateCtaProof={deliveryId:string;followerId:number;igsid:string;mode:GateCtaMode;eventKey:string;definitionVersion:string;sourceHash:string;messages:unknown[];payloadVersion:string};
export type GateCtaClientFactory=(key:string,version?:string,subject?:string,followup?:GateFollowupProof,postback?:GatePostbackProof,cta?:GateCtaProof)=>Promise<Client>;
export type GateCtaContext={accountId:string;eventKey:string;clientFactory:GateCtaClientFactory};
const FIELDS=['id','account_id','status','trigger_type','trigger_keyword','allow_repeat','initial_dm_text','initial_dm_button_label','initial_dm_rich_message_id','reward_url','line_connection_id','line_pool_slug','line_tracked_link_short'] as const;
export const gateCtaKey=(deliveryId:string)=>'gate-cta:'+encodeURIComponent(deliveryId);
async function template(db:D1Database,gate:EngagementGate){
 if(!gate.initial_dm_rich_message_id)return null;
 const r=await db.prepare('SELECT id,kind,blocks FROM rich_messages WHERE id=? AND account_id=?').bind(gate.initial_dm_rich_message_id,gate.account_id).first<{id:string;kind:string;blocks:string}>();
 if(!r)throw Error('CTA template ownership missing');return r;
}
async function version(db:D1Database,gate:EngagementGate,delivery:GateDelivery,mode:GateCtaMode,sourceHash:string){
 return sha256(JSON.stringify([FIELDS.map(k=>gate[k]??null),delivery.id,delivery.gate_id,delivery.follower_id,delivery.igsid,mode,sourceHash,await template(db,gate)]));
}
function sourceMatches(gate:EngagementGate,mode:GateCtaMode,payload:string,igsid:string){
 const e=JSON.parse(payload);if(e.sender?.id!==igsid||!e.message||e.message.is_echo||e.postback)throw Error('CTA inbound message missing');
 if(mode==='keyword'){
  const text=e.message.quick_reply?.payload??e.message.text;
  if(gate.trigger_type!=='dm_keyword'||!gate.trigger_keyword||typeof text!=='string'||!text.includes(gate.trigger_keyword))throw Error('CTA keyword source changed');
 }else if(mode==='story'){
  if(gate.trigger_type!=='story_mention'||!e.message.attachments?.some((a:{type?:string})=>a.type==='story_mention'))throw Error('CTA story source missing');
 }else if(mode==='comment_resume'){
  if(gate.trigger_type!=='comment_on_post')throw Error('CTA comment source changed');
 }else throw Error('Unknown CTA source');
 return e;
}
async function evidence(db:D1Database,accountId:string,gate:EngagementGate,delivery:GateDelivery,mode:GateCtaMode,eventKey:string,now:number){
 if(gate.account_id!==accountId||gate.status!=='active'||!Number.isSafeInteger(delivery.follower_id)||! /^(message|postback):[a-f0-9]{64}$/.test(eventKey))throw Error('Invalid CTA source scope');
 const row=await db.prepare(`SELECT f.metadata,c.owner_epoch,e.payload FROM followers f
 JOIN ig_accounts a ON a.id=f.account_id AND a.is_active=1
 JOIN recruitment_outbound_control c ON c.account_id=f.account_id AND c.owner='harness' AND c.reconciled_at_ms BETWEEN ? AND ?
 JOIN webhook_events e ON e.account_id=f.account_id AND e.event_key=? AND e.kind='messaging' AND e.status='processing' AND e.subject_id=f.igsid AND julianday(e.started_at) BETWEEN julianday(?) AND julianday(?)
 WHERE f.id=? AND f.account_id=? AND f.igsid=? AND f.messaging_owner='primary'
 AND EXISTS(SELECT 1 FROM integration_settings WHERE key='outbound_paused' AND value='0')
 AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=f.account_id)`)
 .bind(now-60000,now,eventKey,new Date(now-60000).toISOString(),new Date(now).toISOString(),delivery.follower_id,accountId,delivery.igsid).first<{metadata:string;owner_epoch:string;payload:string}>();
 if(!row||await messagingEligibility(db,delivery.follower_id,accountId,now)!=='eligible')throw Error('CTA inbound requires reconciliation');
 const e=sourceMatches(gate,mode,row.payload,delivery.igsid);
 if(!Number.isSafeInteger(e.timestamp)||e.timestamp>now||e.timestamp<=now-86400000)throw Error('CTA inbound timestamp invalid');
 assertRecruitmentBusinessState(row.metadata,row.owner_epoch,now);await assertNoRecruitmentInboundHold(db,accountId,delivery.igsid);
 if(mode==='comment_resume'){
  const prior=await db.prepare(`SELECT 1 FROM comment_rule_jobs j JOIN private_reply_attempts p ON p.account_id=j.account_id AND p.follower_id=j.follower_id AND p.comment_id=j.comment_id AND p.status='sent'
  JOIN recruitment_outbound_operations o ON o.account_id=j.account_id AND o.operation_key='comment:'||j.id||':0' AND o.state='sent' AND o.owner_epoch=? AND o.message_id=p.message_id AND length(o.message_id)>0
  WHERE j.gate_delivery_id=? AND j.account_id=? AND j.follower_id=? AND j.status='sent' AND j.delivery_mode='private_reply' AND json_extract(?,'$.comment_id')=j.comment_id
  AND julianday(p.attempted_at)<=julianday(?,'unixepoch')`).bind(row.owner_epoch,delivery.id,accountId,delivery.follower_id,delivery.metadata,e.timestamp/1000).first();
  if(!prior)throw Error('CTA private reply acknowledgement missing');
 }
 return row;
}
async function current(db:D1Database,accountId:string,proof:GateCtaProof,now:number){
 const delivery=await getGateDelivery(db,proof.deliveryId),gate=delivery?await getEngagementGate(db,delivery.gate_id):null;
 if(!delivery||!gate||delivery.follower_id!==proof.followerId||delivery.igsid!==proof.igsid)throw Error('CTA recipient changed');
 const source=await evidence(db,accountId,gate,delivery,proof.mode,proof.eventKey,now);
 if(await sha256(source.payload)!==proof.sourceHash||await version(db,gate,delivery,proof.mode,proof.sourceHash)!==proof.definitionVersion)throw Error('CTA definition or source changed');
 return{gate,delivery,source};
}
export async function assertGateCtaReady(db:D1Database,accountId:string,operation:{key:string;definitionVersion?:string;ownerEpoch:string},proof:GateCtaProof,now=Date.now()){
 if(operation.key!==gateCtaKey(proof.deliveryId)||operation.definitionVersion!==proof.definitionVersion||!/^[a-f0-9]{64}$/.test(proof.definitionVersion)||proof.messages.length<1||proof.messages.length>10||await sha256(JSON.stringify(proof.messages))!==proof.payloadVersion)throw Error('CTA purpose missing');
 const state=await current(db,accountId,proof,now);
 const row=await db.prepare(`SELECT 1 FROM recruitment_gate_cta_operations o JOIN gate_deliveries d ON d.id=o.delivery_id
 WHERE o.account_id=? AND o.operation_key=? AND o.delivery_id=? AND o.follower_id=? AND o.event_key=? AND o.mode=? AND o.definition_version=? AND o.source_hash=? AND o.payload_version=? AND o.expected_messages=? AND o.owner_epoch=? AND o.state='claimed' AND o.claimed_at_ms BETWEEN ? AND ?
 AND d.status=? AND d.end_reason='delivery_in_progress' AND json_extract(d.metadata,'$.cta_send_status')='processing'
 AND (?!='comment_resume' OR json_extract(d.metadata,'$.awaiting_reply')=0)`)
 .bind(accountId,operation.key,proof.deliveryId,proof.followerId,proof.eventKey,proof.mode,proof.definitionVersion,proof.sourceHash,proof.payloadVersion,proof.messages.length,operation.ownerEpoch,now-60000,now,proof.mode==='comment_resume'?'cta_sent':'triggered',proof.mode).first();
 if(!row||operation.ownerEpoch!==state.source.owner_epoch)throw Error('CTA claim changed');return state;
}
export async function assertGateCtaPayload(db:D1Database,accountId:string,operation:{key:string;definitionVersion?:string;ownerEpoch:string},proof:GateCtaProof,slot:number,payload:{recipient?:{id?:string;comment_id?:string};message?:unknown},now=Date.now()){
 await assertGateCtaReady(db,accountId,operation,proof,now);
 if(payload.recipient?.id!==proof.igsid||payload.recipient.comment_id||slot>=proof.messages.length||JSON.stringify(payload.message)!==JSON.stringify(proof.messages[slot]))throw Error('CTA payload changed');
}
/** Enforced-only path. No fallback client, no creation of LINE links. */
export async function sendRecruitmentGateCta(db:D1Database,gate:EngagementGate,delivery:GateDelivery,mode:GateCtaMode,context:GateCtaContext){
 const now=Date.now(),key=gateCtaKey(delivery.id);
 const existing=await db.prepare('SELECT 1 FROM recruitment_gate_cta_operations WHERE account_id=? AND (operation_key=? OR event_key=?)').bind(context.accountId,key,context.eventKey).first();if(existing)return;
 const source=await evidence(db,context.accountId,gate,delivery,mode,context.eventKey,now);
 if(gate.line_connection_id)throw Error('CTA LINE handoff requires verification');
 const sourceHash=await sha256(source.payload),definitionVersion=await version(db,gate,delivery,mode,sourceHash),rich=await template(db,gate);
 let actions:RichAction[];
 if(rich)actions=renderRichActions(delivery.igsid,JSON.parse(rich.blocks),{gateId:gate.id,deliveryId:delivery.id,rewardUrl:gate.reward_url});
 else{
  const copy=recruitmentTemplateCopy(gate.initial_dm_text,gate.initial_dm_button_label);
  actions=[{type:'template',elements:[{title:copy.title,subtitle:copy.subtitle,buttons:[{type:'postback',title:copy.buttonTitle,payload:`CHECK_FOLLOW:${gate.id}:${delivery.id}`}]}]}];
 }
 const messages=actions.map(richActionMessage),payloadVersion=await sha256(JSON.stringify(messages));
 const proof:GateCtaProof={deliveryId:delivery.id,followerId:delivery.follower_id,igsid:delivery.igsid,mode,eventKey:context.eventKey,definitionVersion,sourceHash,messages,payloadVersion};
 const expectedStatus=mode==='comment_resume'?'cta_sent':'triggered';
 const sameGate=FIELDS.map(field=>`g.${field} IS ?`).join(' AND '),subject=await recruitmentSubjectHash(context.accountId,delivery.igsid);
 const result=await db.batch([
  db.prepare(`INSERT INTO recruitment_gate_cta_operations(account_id,operation_key,event_key,delivery_id,follower_id,mode,definition_version,source_hash,payload_version,expected_messages,owner_epoch,claimed_at_ms,state)
  SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'claimed' WHERE EXISTS(SELECT 1 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id JOIN followers f ON f.id=d.follower_id AND f.account_id=g.account_id
   JOIN recruitment_outbound_control c ON c.account_id=g.account_id AND c.owner='harness' AND c.owner_epoch=? AND c.reconciled_at_ms BETWEEN ? AND ?
   JOIN webhook_events e ON e.account_id=g.account_id AND e.event_key=? AND e.status='processing' AND e.payload=?
   WHERE d.id=? AND d.status=? AND d.end_reason IS NULL AND d.metadata IS ? AND f.metadata IS ? AND f.igsid=d.igsid AND f.messaging_owner='primary' AND ${sameGate}
   AND (?!='comment_resume' OR json_extract(d.metadata,'$.awaiting_reply')=1) AND json_extract(d.metadata,'$.cta_send_status') IS NULL
   AND EXISTS(SELECT 1 FROM integration_settings WHERE key='outbound_paused' AND value='0') AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=g.account_id)
   AND NOT EXISTS(SELECT 1 FROM recruitment_inbound_holds WHERE account_id=g.account_id AND subject_hash=?))
  ON CONFLICT DO NOTHING RETURNING operation_key`)
  .bind(context.accountId,key,context.eventKey,delivery.id,delivery.follower_id,mode,definitionVersion,sourceHash,payloadVersion,messages.length,source.owner_epoch,now,source.owner_epoch,now-60000,now,context.eventKey,source.payload,delivery.id,expectedStatus,delivery.metadata,source.metadata,...FIELDS.map(field=>gate[field]??null),mode,subject),
  db.prepare(`UPDATE gate_deliveries SET end_reason='delivery_in_progress',metadata=json_set(metadata,'$.cta_send_status','processing','$.awaiting_reply',0)
   WHERE id=? AND status=? AND end_reason IS NULL AND metadata IS ? AND EXISTS(SELECT 1 FROM recruitment_gate_cta_operations WHERE account_id=? AND operation_key=? AND event_key=? AND claimed_at_ms=? AND state='claimed') RETURNING id`)
   .bind(delivery.id,expectedStatus,delivery.metadata,context.accountId,key,context.eventKey,now),
 ]);
 if(result[0].results.length!==1)return;
 try{
  if(result[1].results.length!==1)throw Error('CTA claim could not be recorded');
  const operation={key,definitionVersion,ownerEpoch:source.owner_epoch};await assertGateCtaReady(db,context.accountId,operation,proof);
  const client=await context.clientFactory(key,definitionVersion,undefined,undefined,undefined,proof);
  for(const action of actions){if(action.type==='text')await client.sendText(delivery.igsid,action.text);else if(action.type==='image')await client.sendImage(delivery.igsid,action.url);else if(action.type==='template')await client.sendGenericTemplate(delivery.igsid,action.elements);else await client.sendQuickReply(delivery.igsid,action.text,action.replies);}
  const final=await assertGateCtaReady(db,context.accountId,operation,proof);
  const slots=await db.prepare(`SELECT o.operation_key,o.state,o.message_id,o.owner_epoch,EXISTS(SELECT 1 FROM recruitment_outbound_observations e WHERE e.account_id=o.account_id AND e.message_id=o.message_id) AS recorded FROM recruitment_outbound_operations o WHERE o.account_id=? AND substr(o.operation_key,1,length(?)+1)=?||':'`).bind(context.accountId,key,key).all<{operation_key:string;state:string;message_id:string|null;owner_epoch:string;recorded:number}>();
  if(slots.results.length!==messages.length||messages.some((_m,i)=>!slots.results.some(s=>s.operation_key===key+':'+i&&s.state==='sent'&&!!s.message_id&&s.owner_epoch===source.owner_epoch&&s.recorded===1)))throw Error('CTA acknowledgement incomplete');
  const done=await db.batch([
   db.prepare(`UPDATE gate_deliveries SET status='cta_sent',end_reason=NULL,metadata=json_set(metadata,'$.cta_send_status','sent') WHERE id=? AND status=? AND end_reason='delivery_in_progress' AND metadata IS ? AND EXISTS(SELECT 1 FROM followers WHERE id=? AND account_id=? AND metadata IS ?) AND EXISTS(SELECT 1 FROM engagement_gates g WHERE g.id=gate_deliveries.gate_id AND ${sameGate}) RETURNING id`).bind(delivery.id,expectedStatus,final.delivery.metadata,delivery.follower_id,context.accountId,final.source.metadata,...FIELDS.map(field=>gate[field]??null)),
   db.prepare("UPDATE recruitment_gate_cta_operations SET state='sent' WHERE account_id=? AND operation_key=? AND state='claimed' AND EXISTS(SELECT 1 FROM gate_deliveries WHERE id=? AND status='cta_sent' AND end_reason IS NULL AND json_extract(metadata,'$.cta_send_status')='sent') RETURNING operation_key").bind(context.accountId,key,delivery.id),
  ]);if(done[0].results.length!==1||done[1].results.length!==1)throw Error('CTA completion requires reconciliation');
  await logMessage(db,{followerId:delivery.follower_id,direction:'out',messageType:'template',body:JSON.stringify({kind:'gate',phase:'cta'}),triggerSource:'gate'});
 }catch(error){
  await db.batch([db.prepare("UPDATE recruitment_gate_cta_operations SET state='uncertain' WHERE account_id=? AND operation_key=? AND state='claimed'").bind(context.accountId,key),db.prepare("UPDATE gate_deliveries SET end_reason='outcome_unknown',metadata=json_set(metadata,'$.cta_send_status','uncertain') WHERE id=? AND end_reason='delivery_in_progress' AND json_extract(metadata,'$.cta_send_status')='processing'").bind(delivery.id)]);throw error;
 }
}
