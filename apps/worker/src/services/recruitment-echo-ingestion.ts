import { beginActivity, endActivity } from '../lib/activity.js';
import { observeRecruitmentOutboundEcho } from './recruitment-outbound-ledger.js';

export class InvalidRecruitmentEcho extends Error {}
export class RecruitmentEchoBusy extends Error {}

/** Called ONLY after webhook HMAC + exact entry/account/App routing checks.
 * This is a durable metadata ingestion path, never an inbound-message queue.
 * It must not attest reconciliation freshness: echo receipt cannot prove that
 * Meta has delivered all prior manual/native messages.
 */
export async function ingestRecruitmentEchoes(db: D1Database, account: { id: string; ig_user_id: string },
  events: Array<{ kind: string; value: Record<string, any> }>, receivedAtMs = Date.now()): Promise<number> {
  const echoes = events.filter(e => (e.kind === 'messaging' || e.kind === 'standby') && e.value.message?.is_echo === true);
  // Validate the entire batch before any writes. No body, attachment or
  // recipient identifier is persisted in this ledger.
  for (const { value } of echoes) {
    if (value.sender?.id !== account.ig_user_id
      || typeof value.recipient?.id !== 'string' || !value.recipient.id.trim() || value.recipient.id === account.ig_user_id
      || typeof value.message.mid !== 'string' || !value.message.mid.trim() || value.message.mid.length > 512
      || value.message.mid !== value.message.mid.trim()
      || !Number.isSafeInteger(value.timestamp) || value.timestamp < 0 || value.timestamp > receivedAtMs) {
      throw new InvalidRecruitmentEcho('Invalid outgoing message metadata');
    }
  }
  if (!echoes.length) return 0;
  const activity = await beginActivity(db);
  if (!activity) throw new RecruitmentEchoBusy('Data deletion is in progress');
  try {
    for (const { value } of echoes) {
      await observeRecruitmentOutboundEcho(db, {
        accountId: account.id, senderIgUserId: value.sender.id, messageId: value.message.mid,
        isEcho: true, sentAtMs: value.timestamp, receivedAtMs,
      });
    }
  } finally { await endActivity(db, activity); }
  return echoes.length;
}
