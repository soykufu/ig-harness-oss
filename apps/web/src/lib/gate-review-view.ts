export type GateReviewItem={id:string;phase:string;state:string;recordedAt:string|null;expectedMessages:number|null;recordedMessages:number;apiAcknowledged:number;recordedSuccess:boolean;needsReview:boolean;mayRetry:false;recipientReceipt:'unknown';echoEvidence:'signed_webhook_recorded'|'unknown';deliveryState:string;endReason:string|null}
export type GateReviewView={followupHistoryScope?:'latest_claim_only'|'recorded_steps_and_legacy_latest';items:GateReviewItem[];moreMayExist:boolean;mayRetry:false;recipientReceipt:'unknown'}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max
const count=(v:unknown,max:number):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=max
/** Validate display data, never manufacture a send/retry/receipt permission.
 * Contradictory success is demoted to review; malformed records hold the view. */
export function gateReviewView(value:unknown,now=Date.now()):GateReviewView|null {
 if(!Number.isSafeInteger(now)||now<0||!object(value)||value.mayRetry!==false||value.recipientReceipt!=='unknown'||typeof value.moreMayExist!=='boolean'||!Array.isArray(value.items)||value.items.length>50)return null
 const scope=value.followupHistoryScope
 if(scope!==undefined&&scope!=='latest_claim_only'&&scope!=='recorded_steps_and_legacy_latest')return null
 const items:GateReviewItem[]=[],ids=new Set<string>()
 for(const row of value.items){
  if(!object(row)||!text(row.id,1000)||ids.has(row.id)||!text(row.phase,100)||!text(row.state,100)||!text(row.deliveryState,100)||!(row.endReason===null||text(row.endReason,1000))||row.mayRetry!==false||row.recipientReceipt!=='unknown'||(row.echoEvidence!=='signed_webhook_recorded'&&row.echoEvidence!=='unknown')||typeof row.recordedSuccess!=='boolean'||typeof row.needsReview!=='boolean'||!count(row.recordedMessages,1000)||!count(row.apiAcknowledged,1000)||row.apiAcknowledged>row.recordedMessages||!(row.expectedMessages===null||count(row.expectedMessages,10)))return null
  if(row.recordedAt!==null&&typeof row.recordedAt!=='string')return null
  const at=typeof row.recordedAt==='string'?Date.parse(row.recordedAt):NaN
  const validTime=typeof row.recordedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(row.recordedAt)&&Number.isSafeInteger(at)&&at>=0&&at<=now&&new Date(at).toISOString().replace('.000Z','Z')===row.recordedAt.replace('.000Z','Z')
  const phaseKnown=['gate','cta','public_reply','reward','reminder','followup'].includes(row.phase),stateKnown=['claimed','processing','sent','skipped','uncertain','unverified','failed'].includes(row.state)
  const consistent=phaseKnown&&stateKnown&&validTime&&row.state==='sent'&&row.expectedMessages!==null&&row.expectedMessages>0&&row.expectedMessages===row.recordedMessages&&row.expectedMessages===row.apiAcknowledged
  const recordedSuccess=row.recordedSuccess&&consistent
  const skipped=phaseKnown&&stateKnown&&validTime&&row.state==='skipped'&&row.recordedSuccess===false&&row.recordedMessages===0&&row.apiAcknowledged===0&&(row.expectedMessages===null||row.expectedMessages===0)
  items.push({id:row.id,phase:row.phase,state:row.state,recordedAt:validTime?new Date(at).toISOString():null,expectedMessages:row.expectedMessages,recordedMessages:row.recordedMessages,apiAcknowledged:row.apiAcknowledged,recordedSuccess,needsReview:row.needsReview||!recordedSuccess&&!skipped||row.endReason==='outcome_unknown',mayRetry:false,recipientReceipt:'unknown',echoEvidence:row.echoEvidence as GateReviewItem['echoEvidence'],deliveryState:row.deliveryState,endReason:row.endReason})
  ids.add(row.id)
 }
 return{...(scope?{followupHistoryScope:scope}:{}),items,moreMayExist:value.moreMayExist,mayRetry:false,recipientReceipt:'unknown'}
}
