import type { MessageLifecycle } from '@ig-harness/ig-sdk';
import { reserveRecruitmentOutbound, acknowledgeRecruitmentOutbound, markRecruitmentOutboundUncertain, assertRecruitmentReservationReady } from './recruitment-outbound-ledger.js';
import { messagingEligibility } from './messaging-window.js';

/** Each client belongs to ONE durable operation. Rich blocks get distinct
 * slots; a recreated client starts at slot 0, which cannot be replayed.
 * Do not generate a new operation key to retry a failed/unknown delivery.
 */
export function recruitmentMessageLifecycle(db: D1Database, accountId: string,
  operation: { key: string; ownerEpoch: string } | undefined,
  guard: () => Promise<void>, now = Date.now): MessageLifecycle {
  let slot = 0;
  let failed = false;
  let inFlight = false;
  let expectedRecipient: string | undefined;
  return {
    async before(payload) {
      if (failed || inFlight || !operation?.key || !operation.ownerEpoch) throw new Error('Recruitment operation is unavailable');
      inFlight = true;
      try {
        await guard();
        const nowMs = now();
        const hour = new Date(nowMs + 9 * 3_600_000).getUTCHours();
        if (hour < 8 || hour >= 21) throw new Error('Outside recruitment delivery window');
        const key = `${operation.key}:${slot++}`;
        if (!await reserveRecruitmentOutbound(db, { accountId, operationKey: key, ownerEpoch: operation.ownerEpoch, nowMs, preparationLocked: false })) {
          throw new Error('Recruitment reservation denied');
        }
        expectedRecipient = payload.recipient?.id;
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
        assertRecruitmentBusinessState(follower.metadata, operation.ownerEpoch, nowMs);
      }
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

/** Suppression evidence only; never grants consent, a DM window or quota.
 * Missing/stale/unrecognised state is held. A verified state synchronizer must
 * supply this namespace; importing a follower is not permission to send.
 */
export function assertRecruitmentBusinessState(metadata: string, ownerEpoch: string, nowMs: number): void {
  let state: any;
  try { state = JSON.parse(metadata)?.recruitment_delivery; } catch { /* deny below */ }
  if (!state || state.state !== 'active' || state.owner_epoch !== ownerEpoch
    || !Number.isSafeInteger(state.observed_at_ms) || !Number.isSafeInteger(state.valid_until_ms)
    || state.observed_at_ms > nowMs || state.observed_at_ms < nowMs - 300_000
    || state.valid_until_ms <= nowMs || state.valid_until_ms > state.observed_at_ms + 300_000) {
    throw new Error('Recruitment business state requires reconciliation');
  }
}
