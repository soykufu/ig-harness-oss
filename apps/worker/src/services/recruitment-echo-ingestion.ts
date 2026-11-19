import { beginActivity, endActivity } from '../lib/activity.js';
import { prepareRecruitmentEchoObservation } from './recruitment-outbound-ledger.js';

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
      const observation = prepareRecruitmentEchoObservation(db, {
        accountId: account.id, senderIgUserId: value.sender.id, messageId: value.message.mid,
        isEcho: true, sentAtMs: value.timestamp, receivedAtMs,
      });
      // Keep signed-webhook provenance atomic with the quota observation.
      // API acknowledgements and legacy mixed observations never write here.
      const receipt = db.prepare(`INSERT INTO recruitment_echo_receipts
          (account_id,message_id,sent_at_ms,first_received_at_ms,last_received_at_ms)
        SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ig_accounts WHERE id=? AND ig_user_id=?)
        ON CONFLICT(account_id,message_id) DO UPDATE SET
          sent_at_ms=MIN(sent_at_ms,excluded.sent_at_ms),
          first_received_at_ms=MIN(first_received_at_ms,excluded.first_received_at_ms),
          last_received_at_ms=MAX(last_received_at_ms,excluded.last_received_at_ms)`)
        .bind(account.id,value.message.mid,value.timestamp,receivedAtMs,receivedAtMs,account.id,account.ig_user_id);
      const saved = await db.batch([observation, receipt]);
      if (!saved[0]?.results.length) throw new InvalidRecruitmentEcho('Echo account identity mismatch');
    }
  } finally { await endActivity(db, activity); }
  return echoes.length;
}
