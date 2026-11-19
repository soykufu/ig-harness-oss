import { afterEach, expect, it } from 'vitest';
import { testDatabase } from '../../test-utils/d1.js';
import {
  reserveRecruitmentOutbound as reserve,
  acknowledgeRecruitmentOutbound as acknowledge,
  markRecruitmentOutboundUncertain as uncertain,
  observeRecruitmentOutboundEcho as echo,
} from '../recruitment-outbound-ledger.js';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const cleanup: (() => void)[] = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });
async function fixture() {
  const { sqlite, db } = await testDatabase();
  cleanup.push(() => sqlite.close());
  for (const [id, ig] of [['a','111'],['b','222']]) {
    sqlite.prepare(`INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at)
      VALUES(?,?, 'test','2026-01-01','2026-01-01')`).run(id, ig);
    sqlite.prepare(`INSERT INTO recruitment_outbound_control VALUES(?,'epoch-1','harness',?)`).run(id, NOW);
  }
  sqlite.exec("INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
  const request = (operationKey: string, changes = {}) => ({ accountId: 'a', operationKey, ownerEpoch: 'epoch-1', nowMs: NOW, preparationLocked: false, ...changes });
  const outgoing = (messageId: string, changes = {}) => ({ accountId: 'a', senderIgUserId: '111', messageId, isEcho: true, sentAtMs: NOW, receivedAtMs: NOW, ...changes });
  const ack = (operationKey: string, messageId = operationKey) => acknowledge(db, { accountId: 'a', operationKey, messageId, acknowledgedAtMs: NOW });
  return { sqlite, db, request, outgoing, ack };
}

it('atomically grants only ten of 25 concurrent reservations and isolates accounts', async () => {
  const { db, request } = await fixture();
  const result = await Promise.all(Array.from({ length: 25 }, (_, i) => reserve(db, request(`op-${i}`))));
  expect(result.filter(Boolean)).toHaveLength(10);
  expect(await reserve(db, request('op-0', { accountId: 'b' }))).toBe(true);
});

it('requires explicit unlocked mode, pause=0 and fresh matching ownership', async () => {
  const { db, sqlite, request } = await fixture();
  expect(await reserve(db, request('locked', { preparationLocked: undefined }))).toBe(false);
  for (const changes of [{ ownerEpoch: 'old' }, { nowMs: NOW - 1 }, { nowMs: NOW + 60_001 }, { accountId: 'absent' }]) {
    expect(await reserve(db, request('invalid', changes))).toBe(false);
  }
  sqlite.exec("UPDATE recruitment_outbound_control SET owner='legacy'");
  expect(await reserve(db, request('legacy'))).toBe(false);
  sqlite.exec("UPDATE recruitment_outbound_control SET owner='harness'; DELETE FROM integration_settings WHERE key='outbound_paused'");
  expect(await reserve(db, request('missing-pause'))).toBe(false);
  sqlite.exec("INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1')");
  expect(await reserve(db, request('paused'))).toBe(false);
});

it('keeps duplicate operation keys idempotent after acknowledgement and an hour', async () => {
  const { db, sqlite, request, ack } = await fixture();
  expect(await reserve(db, request('once'))).toBe(true);
  expect(await reserve(db, request('once'))).toBe(false);
  await ack('once');
  await ack('once');
  sqlite.prepare('UPDATE recruitment_outbound_control SET reconciled_at_ms=?').run(NOW + HOUR);
  expect(await reserve(db, request('once', { nowMs: NOW + HOUR }))).toBe(false);
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM recruitment_outbound_operations').get()?.n).toBe(1);
});

it('combines manual echoes and harness acknowledgements without double counting', async () => {
  const { db, request, outgoing, ack, sqlite } = await fixture();
  for (let i = 0; i < 8; i++) await echo(db, outgoing(`manual-${i}`));
  expect(await reserve(db, request('api-1'))).toBe(true);
  await ack('api-1'); await echo(db, outgoing('api-1')); await echo(db, outgoing('api-1'));
  expect(await reserve(db, request('api-2'))).toBe(true);
  await echo(db, outgoing('api-2')); await ack('api-2');
  expect(await reserve(db, request('eleventh'))).toBe(false);
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM recruitment_outbound_observations').get()?.n).toBe(10);
});

it('uses a rolling hour rather than clock-hour buckets and preserves delayed echoes', async () => {
  const { db, request, outgoing, sqlite } = await fixture();
  for (let i = 0; i < 10; i++) await echo(db, outgoing(`old-${i}`, { sentAtMs: NOW - HOUR + 1 }));
  expect(await reserve(db, request('blocked'))).toBe(false);
  expect(await reserve(db, request('boundary', { nowMs: NOW + 1 }))).toBe(true);
  await echo(db, outgoing('very-old', { sentAtMs: NOW - HOUR - 500 }));
  expect(sqlite.prepare("SELECT sent_at_ms FROM recruitment_outbound_observations WHERE message_id='very-old'").get()?.sent_at_ms).toBe(NOW - HOUR - 500);
});

it('holds all new sends on uncertainty and cannot retry the uncertain operation', async () => {
  const { db, sqlite, request, outgoing, ack } = await fixture();
  expect(await reserve(db, request('timeout'))).toBe(true);
  await uncertain(db, 'a', 'timeout');
  await echo(db, outgoing('unknown-api-id'));
  expect(await reserve(db, request('next'))).toBe(false);
  expect(await reserve(db, request('timeout'))).toBe(false);
  sqlite.prepare('UPDATE recruitment_outbound_control SET reconciled_at_ms=?').run(NOW + 2 * HOUR);
  expect(await reserve(db, request('much-later', { nowMs: NOW + 2 * HOUR }))).toBe(false);
  await ack('timeout', 'unknown-api-id');
  expect(await reserve(db, request('resolved', { nowMs: NOW + 2 * HOUR }))).toBe(true);
});

it('holds abandoned reservations and future-dated ledger evidence', async () => {
  const { db, sqlite, request } = await fixture();
  expect(await reserve(db, request('abandoned', { nowMs: NOW }))).toBe(true);
  sqlite.prepare('UPDATE recruitment_outbound_control SET reconciled_at_ms=?').run(NOW + 60_000);
  expect(await reserve(db, request('later', { nowMs: NOW + 60_000 }))).toBe(false);
  sqlite.exec('DELETE FROM recruitment_outbound_operations');
  sqlite.prepare('UPDATE recruitment_outbound_control SET reconciled_at_ms=?').run(NOW);
  sqlite.prepare("INSERT INTO recruitment_outbound_observations VALUES('a','future',?,?)").run(NOW + 1, NOW + 1);
  expect(await reserve(db, request('clock-regressed'))).toBe(false);
});

it('rejects wrong accounts, inbound events, future timestamps and malformed identifiers', async () => {
  const { db, request, outgoing, sqlite } = await fixture();
  for (const changes of [{ senderIgUserId: '222' }, { accountId: 'b' }, { isEcho: false }, { sentAtMs: NOW + 1 }, { messageId: '' }, { sentAtMs: NaN }]) {
    await expect(echo(db, outgoing('bad', changes))).rejects.toThrow();
  }
  await expect(reserve(db, request(' bad '))).rejects.toThrow();
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM recruitment_outbound_observations').get()?.n).toBe(0);
});

it('does not infer inbound contact, trigger scenarios or alter follower state from echoes', async () => {
  const { db, outgoing, sqlite } = await fixture();
  const before = sqlite.prepare('SELECT * FROM followers').all();
  await echo(db, outgoing('manual-only'));
  expect(sqlite.prepare('SELECT * FROM followers').all()).toEqual(before);
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM follower_scenarios').get()?.n).toBe(0);
});

it('rejects conflicting acknowledgements atomically without releasing either reservation', async () => {
  const { db, sqlite, request, ack } = await fixture();
  await expect(ack('absent')).rejects.toThrow();
  await reserve(db, request('one')); await reserve(db, request('two'));
  await ack('one', 'same-message');
  await expect(ack('one', 'different-message')).rejects.toThrow();
  await expect(ack('two', 'same-message')).rejects.toThrow();
  expect(sqlite.prepare("SELECT state,message_id FROM recruitment_outbound_operations WHERE operation_key='two'").get()).toMatchObject({ state: 'reserved', message_id: null });
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM recruitment_outbound_observations').get()?.n).toBe(1);
});
