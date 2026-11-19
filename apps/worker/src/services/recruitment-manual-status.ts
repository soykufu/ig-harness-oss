import { sha256 } from '../lib/security.js';

/** Read evidence only. Missing records and missing echoes never authorize a retry. */
export async function readRecruitmentManualStatus(db: D1Database, accountId: string, followerId: number, nonce: string) {
  const key = 'manual:' + await sha256(JSON.stringify([accountId, nonce]));
  const intent = await db.prepare(`SELECT i.status,i.created_at_ms,i.owner_epoch FROM recruitment_manual_intents i
    JOIN followers f ON f.id=i.follower_id AND f.account_id=i.account_id
    WHERE i.account_id=? AND i.follower_id=? AND i.operation_key=?`)
    .bind(accountId, followerId, key).first<{status: string; created_at_ms: number; owner_epoch: string}>();
  if (!intent) return null;
  const result = await db.prepare(`SELECT o.state,o.message_id,o.owner_epoch,
      EXISTS(SELECT 1 FROM recruitment_outbound_observations e
        WHERE e.account_id=o.account_id AND e.message_id=o.message_id) AS recorded
    FROM recruitment_outbound_operations o WHERE o.account_id=?
      AND substr(o.operation_key,1,length(?)+1)=? || ':' ORDER BY o.operation_key`)
    .bind(accountId, key, key).all<{state: string; message_id: string | null; recorded: number; owner_epoch: string}>();
  const operations = result.results.map(row => ({
    state: row.state,
    apiAcknowledged: row.state === 'sent' && !!row.message_id && row.owner_epoch === intent.owner_epoch,
    messageRecordedInLedger: row.recorded === 1,
  }));
  // The observation table mixes API acknowledgements and webhook echoes. It
  // cannot establish which source was observed, nor receipt/read by a student.
  const recordedSuccess = intent.status === 'sent' && operations.length > 0
    && operations.every(op => op.apiAcknowledged && op.messageRecordedInLedger);
  return { intentStatus: intent.status, createdAtMs: intent.created_at_ms, operations,
    recordedSuccess, needsReview: !recordedSuccess, mayRetry: false,
    echoEvidence: 'unknown' as const, recipientReceipt: 'unknown' as const };
}
