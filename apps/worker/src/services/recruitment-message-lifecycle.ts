import {assertGatePostbackReady,assertGatePostbackPayload,type GatePostbackProof} from './recruitment-gate-postback.js';
import {assertGateFollowupReady,assertGateFollowupPayload,type GateFollowupProof} from './recruitment-gate-followup.js';
import {assertRecruitmentRichTestReady,assertRecruitmentRichTestPayload,type RecruitmentRichTest} from './recruitment-rich-test.js';
import {assertHumanReplyContract,type HumanReplyInput} from './recruitment-human-reply.js';
import {assertRecruitmentBroadcastReady} from './recruitment-broadcast-admission.js';
import { assertRecruitmentStepReady } from './recruitment-step-admission.js';
import { assertRecruitmentBusinessState } from './recruitment-business-state.js';
export { assertRecruitmentBusinessState } from './recruitment-business-state.js';
import { assertRecruitmentPrivateReplyReady } from './recruitment-private-admission.js';
import type { MessageLifecycle } from '@ig-harness/ig-sdk';
import { reserveRecruitmentOutbound, acknowledgeRecruitmentOutbound, markRecruitmentOutboundUncertain, assertRecruitmentReservationReady } from './recruitment-outbound-ledger.js';
import { assertNoRecruitmentInboundHold } from './recruitment-inbound-holds.js';
import { messagingEligibility } from './messaging-window.js';

/** Each client belongs to ONE durable operation. Rich blocks get distinct
 * slots; a recreated client starts at slot 0, which cannot be replayed.
 * Do not generate a new operation key to retry a failed/unknown delivery.
 */
export function recruitmentMessageLifecycle(db: D1Database, accountId: string,
  operation: { key: string; ownerEpoch: string; definitionVersion?: string; subjectVersion?: string; humanReply?: HumanReplyInput; richTest?: RecruitmentRichTest; gateFollowup?:GateFollowupProof;gatePostback?:GatePostbackProof } | undefined,
  guard: () => Promise<void>, now = Date.now): MessageLifecycle {
  let slot = 0;
  let failed = false;
  let inFlight = false;
  let expectedRecipient: string | undefined;
  let expectedCommentId: string | undefined;
  return {
    async before(payload) {
      if (failed || inFlight || !operation?.key || !operation.ownerEpoch) throw new Error('Recruitment operation is unavailable');
      inFlight = true;
      try {
        await guard();
        if(operation.key.startsWith('gate-followup:')&&!operation.gateFollowup)throw Error('Gate follow-up purpose required');
        if((operation.key.startsWith('gate-reward:')||operation.key.startsWith('gate-reminder:'))&&!operation.gatePostback)throw Error('Gate postback purpose required');
        const nowMs = now();
        if(operation.humanReply){
          const reply=operation.humanReply;const message=payload.message as Record<string,unknown>|undefined;
          if(slot!==0||reply.accountId!==accountId||!payload.recipient?.id||payload.recipient.comment_id||!message||Object.keys(message).length!==1||message.text!==reply.text)throw Error('Human reply payload does not match review');
          const target=await db.prepare('SELECT igsid FROM followers WHERE id=? AND account_id=?').bind(reply.followerId,accountId).first<{igsid:string}>();
          if(target?.igsid!==payload.recipient.id)throw Error('Human reply recipient changed');
          await assertHumanReplyContract(db,reply,operation.key,true,nowMs);
        }
        if(operation.richTest){
          await assertRecruitmentRichTestPayload(db,accountId,operation.richTest,slot,payload);
          await assertRecruitmentRichTestReady(db,accountId,operation,operation.richTest,nowMs);
        }
        if(operation.gatePostback)await assertGatePostbackPayload(db,accountId,operation,operation.gatePostback,slot,payload,nowMs);
        if(operation.gateFollowup)await assertGateFollowupPayload(db,accountId,operation,operation.gateFollowup,slot,payload,nowMs);
        const hour = new Date(nowMs + 9 * 3_600_000).getUTCHours();
        if (hour < 8 || hour >= 21) throw new Error('Outside recruitment delivery window');
        const key = `${operation.key}:${slot++}`;
        if (!await reserveRecruitmentOutbound(db, { accountId, operationKey: key, ownerEpoch: operation.ownerEpoch, nowMs, preparationLocked: false })) {
          throw new Error('Recruitment reservation denied');
        }
        expectedRecipient = payload.recipient?.id;
        expectedCommentId = payload.recipient?.comment_id;
        return key;
      } catch (error) { failed = true; inFlight = false; throw error; }
    },
    async beforeFetch(ticket) {
      await guard();
      const nowMs = now();
      const hour = new Date(nowMs + 9 * 3_600_000).getUTCHours();
      if (hour < 8 || hour >= 21) throw new Error('Outside recruitment delivery window');
      if (!inFlight || failed || !operation) throw new Error('Recruitment operation is unavailable');
      await assertRecruitmentReservationReady(db, {accountId,operationKey:ticket,ownerEpoch:operation.ownerEpoch,nowMs});
      // Ordinary DMs cannot gain a 24h window from an outgoing/manual echo.
      // Private replies use comment IDs and keep their separate policy path.
      if (expectedRecipient) {
        const follower = await db.prepare('SELECT id,metadata FROM followers WHERE account_id=? AND igsid=?').bind(accountId,expectedRecipient).first<{id:number;metadata:string}>();
        if (!follower || await messagingEligibility(db,follower.id,accountId,nowMs)!=='eligible') throw new Error('Recruitment recipient is not eligible');
        if(operation.richTest){if(operation.richTest.followerId!==follower.id)throw Error('Rich test recipient changed');await assertRecruitmentRichTestReady(db,accountId,operation,operation.richTest,nowMs);}
        if(operation.gatePostback){if(operation.gatePostback.followerId!==follower.id)throw Error('Gate postback recipient changed');await assertGatePostbackReady(db,accountId,operation,operation.gatePostback,nowMs);}
        if(operation.gateFollowup){if(operation.gateFollowup.followerId!==follower.id)throw Error('Gate follow-up recipient changed');await assertGateFollowupReady(db,accountId,operation,operation.gateFollowup,nowMs);}
        if (operation.key.startsWith('step:')) await assertRecruitmentStepReady(db, accountId, follower.id, operation.key, operation.definitionVersion, operation.subjectVersion);
        if (operation.key.startsWith('broadcast:')) await assertRecruitmentBroadcastReady(db,accountId,follower.id,operation.key,operation.definitionVersion,nowMs);
        if(operation.humanReply){
          if(operation.humanReply.followerId!==follower.id)throw Error('Human reply recipient changed');
          await assertHumanReplyContract(db,operation.humanReply,operation.key,true,nowMs);
        }else{
          assertRecruitmentBusinessState(follower.metadata, operation.ownerEpoch, nowMs);
          await assertNoRecruitmentInboundHold(db,accountId,expectedRecipient);
        }
      } else if(expectedCommentId) {
        expectedRecipient=await assertRecruitmentPrivateReplyReady(db,accountId,expectedCommentId,operation,nowMs);
      } else { throw new Error('Recruitment recipient identity missing'); }
    },
    async acknowledged(ticket, response) {
      const result = response as { message_id?: unknown; recipient_id?: unknown } | null;
      if (typeof result?.message_id !== 'string' || !result.message_id
        || typeof result.recipient_id !== 'string' || !result.recipient_id
        || (expectedRecipient && result.recipient_id !== expectedRecipient)) throw new Error('Unverified message acknowledgement');
      await acknowledgeRecruitmentOutbound(db, { accountId, operationKey: ticket, messageId: result.message_id, acknowledgedAtMs: now() });
      inFlight = false;
    },
    async uncertain(ticket) {
      failed = true; inFlight = false;
      await markRecruitmentOutboundUncertain(db, accountId, ticket);
    },
  };
}

