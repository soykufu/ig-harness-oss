import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { friends } from '../friends.js';
import type { Env } from '../../index.js';
import { testDatabase } from '../../test-utils/d1.js';
import { sha256 } from '../../lib/security.js';

const close: (() => void)[] = [];
afterEach(() => { while (close.length) close.pop()!(); vi.unstubAllGlobals(); });
async function fixture() {
  const { sqlite, db } = await testDatabase(); close.push(() => sqlite.close());
  sqlite.exec(`INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01'),('b','222','test',0,'2026-01-01','2026-01-01');
    INSERT INTO followers(id,igsid,account_id) VALUES(1,'student','a'),(2,'other','a'),(3,'foreign','b');
    INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1');`);
  const nonce = 'pending-action-123456';
  const key = 'manual:' + await sha256(JSON.stringify(['a', nonce]));
  sqlite.prepare('INSERT INTO recruitment_manual_intents VALUES(?,?,?,?,?,?,?)').run('a', key, 1, 'hash', 'epoch', 'sent', 1000);
  sqlite.prepare('INSERT INTO recruitment_outbound_operations VALUES(?,?,?,?,?,?)').run('a', key + ':0', 'epoch', 1000, 'sent', 'mid');
  sqlite.prepare('INSERT INTO recruitment_outbound_observations VALUES(?,?,?,?)').run('a', 'mid', 1000, 1000);
  const fetch = vi.fn(() => { throw new Error('Read-only reconciliation must not call Meta'); }); vi.stubGlobal('fetch', fetch);
  let role: string | undefined = 'owner';
  const app = new Hono<Env>().use('*', async (c, next) => {
    if (role) c.set('staff', { id: 'test', name: 'test', role } as never);
    await next();
  }).route('/', friends);
  const get = (id = '1', account = 'a', token = nonce) => app.fetch(new Request(
    `https://test.invalid/api/friends/${id}/manual-delivery-status?account_id=${account}`,
    { headers: { 'Idempotency-Key': token } }), { DB: db, OUTBOUND_PREPARATION_LOCK: '1' });
  return { sqlite, get, fetch, key, setRole: (value?: string) => { role = value; } };
}
it('reads recorded success while paused, without writing, unlocking or calling Meta', async () => {
  const { sqlite, get, fetch } = await fixture();
  const before = sqlite.prepare('SELECT total_changes() n').get()?.n;
  const response = await get(); const body = await response.json() as any;
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(body.data).toMatchObject({ recordedSuccess: true, needsReview: false, mayRetry: false,
    echoEvidence: 'unknown', recipientReceipt: 'unknown', operations: [{apiAcknowledged: true, messageRecordedInLedger: true}] });
  expect(sqlite.prepare('SELECT total_changes() n').get()?.n).toBe(before);
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(body)).not.toMatch(/pending-action|manual:|hash|mid/);
});
it.each(['claimed', 'uncertain'])('retains %s intent despite API acknowledgement', async status => {
  const {sqlite, get} = await fixture(); sqlite.prepare('UPDATE recruitment_manual_intents SET status=?').run(status);
  const body = await (await get()).json() as any;
  expect(body.data).toMatchObject({recordedSuccess: false, needsReview: true, mayRetry: false});
  expect(body.data.operations[0].apiAcknowledged).toBe(true);
  expect(sqlite.prepare('SELECT status FROM recruitment_manual_intents').get()?.status).toBe(status);
});
it.each(['reserved', 'uncertain'])('does not treat a %s transport as acknowledged', async state => {
  const {sqlite, get} = await fixture(); sqlite.prepare('UPDATE recruitment_outbound_operations SET state=?').run(state);
  const body = await (await get()).json() as any;
  expect(body.data.recordedSuccess).toBe(false); expect(body.data.operations[0].apiAcknowledged).toBe(false);
});
it.each(['operation', 'message-id', 'observation'])('holds incomplete %s evidence', async missing => {
  const {sqlite, get} = await fixture();
  if (missing === 'operation') sqlite.exec('DELETE FROM recruitment_outbound_operations');
  if (missing === 'message-id') sqlite.exec('UPDATE recruitment_outbound_operations SET message_id=NULL');
  if (missing === 'observation') sqlite.exec('DELETE FROM recruitment_outbound_observations');
  expect((await (await get()).json() as any).data).toMatchObject({recordedSuccess: false, needsReview: true, mayRetry: false});
});
it('requires all rich-message slots to be acknowledged', async () => {
  const {sqlite, get, key} = await fixture();
  sqlite.prepare('INSERT INTO recruitment_outbound_operations VALUES(?,?,?,?,?,?)').run('a',key+':1','epoch',1000,'uncertain',null);
  expect((await (await get()).json() as any).data.recordedSuccess).toBe(false);
});
it('does not trust a transport from a different ownership epoch', async () => {
  const {sqlite,get} = await fixture(); sqlite.exec("UPDATE recruitment_outbound_operations SET owner_epoch='old'");
  expect((await (await get()).json() as any).data.recordedSuccess).toBe(false);
});
it('holds missing schema instead of reporting success or invoking transport', async () => {
  const {sqlite,get,fetch} = await fixture(); sqlite.exec('DROP TABLE recruitment_manual_intents');
  expect((await get()).status).toBe(503); expect(fetch).not.toHaveBeenCalled();
});
it('scopes records to the acting account, recipient and exact nonce', async () => {
  const {sqlite,get} = await fixture();
  for (const args of [['2','a'],['3','b'],['1','b'],['1','a','different-action-1234']]) expect((await get(...args as [string,string,string?])).status).toBe(404);
  sqlite.exec("UPDATE followers SET account_id='b' WHERE id=1"); expect((await get()).status).toBe(404);
});
it('rejects invalid identity and unauthorized roles', async () => {
  const {get,setRole} = await fixture();
  expect((await get('1','a','')).status).toBe(400); expect((await get('1.2')).status).toBe(400);
  for (const role of ['staff',undefined]) { setRole(role); expect((await get()).status).toBe(403); }
  setRole('admin'); expect((await get()).status).toBe(200);
});
