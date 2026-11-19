/** Preparation module: intentionally NOT wired to outbound messaging yet.
 * Webhook metadata ingestion is separately opt-in and disabled by default.
 * It cannot prove complete native/manual echo coverage. Ownership cutover and
 * that evidence must precede integration. No recipient/text content is stored.
 */
const HOUR_MS = 3_600_000;
const FRESH_MS = 60_000;
const CAP = 10;

function identity(value: string): void {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 512) {
    throw new Error('Invalid ledger identity');
  }
}
function time(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid ledger timestamp');
}

/** One SQLite statement serializes quota check + reservation. A duplicate key
 * never authorizes a retry, including after an hour or an uncertain outcome.
 * Missing pause/ownership/reconciliation evidence fails closed.
 */
export async function reserveRecruitmentOutbound(db: D1Database, request: {
  accountId: string; operationKey: string; ownerEpoch: string; nowMs: number;
  preparationLocked?: boolean;
}): Promise<boolean> {
  const { accountId, operationKey, ownerEpoch, nowMs } = request;
  identity(accountId); identity(operationKey); identity(ownerEpoch); time(nowMs);
  if (request.preparationLocked !== false) return false;
  const row = await db.prepare(`
    INSERT INTO recruitment_outbound_operations
      (account_id,operation_key,owner_epoch,reserved_at_ms,state)
    SELECT ?,?,?,?,'reserved'
    WHERE EXISTS (SELECT 1 FROM integration_settings WHERE key='outbound_paused' AND value='0')
      AND EXISTS (SELECT 1 FROM recruitment_outbound_control
        WHERE account_id=? AND owner='harness' AND owner_epoch=?
          AND reconciled_at_ms BETWEEN ? AND ?)
      AND NOT EXISTS (SELECT 1 FROM recruitment_outbound_operations
        WHERE account_id=? AND (state='uncertain' OR reserved_at_ms>?
          OR (state='reserved' AND reserved_at_ms<=?)))
      AND NOT EXISTS (SELECT 1 FROM recruitment_outbound_observations
        WHERE account_id=? AND sent_at_ms>?)
      AND (
        (SELECT COUNT(*) FROM recruitment_outbound_operations o
          WHERE o.account_id=? AND o.reserved_at_ms>? AND o.reserved_at_ms<=?
            AND NOT EXISTS (SELECT 1 FROM recruitment_outbound_observations e
              WHERE e.account_id=o.account_id AND e.message_id=o.message_id))
        + (SELECT COUNT(*) FROM recruitment_outbound_observations
          WHERE account_id=? AND sent_at_ms>? AND sent_at_ms<=?)
      ) < ?
    ON CONFLICT(account_id,operation_key) DO NOTHING
    RETURNING operation_key
  `).bind(accountId, operationKey, ownerEpoch, nowMs,
    accountId, ownerEpoch, Math.max(0, nowMs - FRESH_MS), nowMs,
    accountId, nowMs, nowMs - FRESH_MS,
    accountId, nowMs,
    accountId, nowMs - HOUR_MS, nowMs,
    accountId, nowMs - HOUR_MS, nowMs, CAP).first();
  return row !== null;
}

/** Call after any timeout/ambiguous Graph response. There is intentionally no
 * automatic release method: absence of an echo is not proof of non-delivery.
 */
export async function markRecruitmentOutboundUncertain(db: D1Database, accountId: string, operationKey: string): Promise<void> {
  identity(accountId); identity(operationKey);
  await db.prepare(`UPDATE recruitment_outbound_operations SET state='uncertain'
    WHERE account_id=? AND operation_key=? AND state='reserved'`).bind(accountId, operationKey).run();
}

/** Store an authenticated API acknowledgement. If the echo arrived first its
 * actual timestamp wins. A message ID cannot acknowledge two operations.
 */
export async function acknowledgeRecruitmentOutbound(db: D1Database, input: {
  accountId: string; operationKey: string; messageId: string; acknowledgedAtMs: number;
}): Promise<void> {
  const { accountId, operationKey, messageId, acknowledgedAtMs } = input;
  identity(accountId); identity(operationKey); identity(messageId); time(acknowledgedAtMs);
  const result = await db.batch([
    db.prepare(`UPDATE recruitment_outbound_operations SET state='sent',message_id=?
      WHERE account_id=? AND operation_key=? AND reserved_at_ms<=?
        AND (message_id IS NULL OR message_id=?) RETURNING operation_key`)
      .bind(messageId, accountId, operationKey, acknowledgedAtMs, messageId),
    db.prepare(`INSERT INTO recruitment_outbound_observations(account_id,message_id,sent_at_ms,observed_at_ms)
      SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM recruitment_outbound_operations
        WHERE account_id=? AND operation_key=? AND message_id=? AND state='sent')
      ON CONFLICT(account_id,message_id) DO UPDATE SET
        sent_at_ms=MIN(sent_at_ms,excluded.sent_at_ms),
        observed_at_ms=MAX(observed_at_ms,excluded.observed_at_ms)`)
      .bind(accountId, messageId, acknowledgedAtMs, acknowledgedAtMs, accountId, operationKey, messageId),
  ]);
  if (result[0].results.length !== 1) throw new Error('Acknowledgement does not match an operation');
}

/** ONLY call after signature verification + account routing. This separate echo
 * path does not update last_inbound_at, run scenarios or send any response.
 * Delayed echoes retain actual timestamps. Future timestamps are rejected.
 */
export async function observeRecruitmentOutboundEcho(db: D1Database, input: {
  accountId: string; senderIgUserId: string; messageId: string; isEcho: boolean;
  sentAtMs: number; receivedAtMs: number;
}): Promise<void> {
  const { accountId, senderIgUserId, messageId, sentAtMs, receivedAtMs } = input;
  identity(accountId); identity(senderIgUserId); identity(messageId); time(sentAtMs); time(receivedAtMs);
  if (input.isEcho !== true || sentAtMs > receivedAtMs) throw new Error('Invalid outgoing echo');
  const row = await db.prepare(`INSERT INTO recruitment_outbound_observations
      (account_id,message_id,sent_at_ms,observed_at_ms)
    SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM ig_accounts WHERE id=? AND ig_user_id=?)
    ON CONFLICT(account_id,message_id) DO UPDATE SET
      sent_at_ms=MIN(sent_at_ms,excluded.sent_at_ms), observed_at_ms=MAX(observed_at_ms,excluded.observed_at_ms)
    RETURNING message_id`).bind(accountId, messageId, sentAtMs, receivedAtMs, accountId, senderIgUserId).first();
  if (!row) throw new Error('Echo account identity mismatch');
}
