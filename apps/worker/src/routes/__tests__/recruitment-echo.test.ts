import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { webhook } from '../webhook.js';
import { testDatabase } from '../../test-utils/d1.js';
import { acknowledgeRecruitmentOutbound } from '../../services/recruitment-outbound-ledger.js';
import { ingestRecruitmentEchoes } from '../../services/recruitment-echo-ingestion.js';

const SECRET = 'test-app-secret';
const NOW = 1_700_000_000_000;
const cleanup: (() => void)[] = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); vi.unstubAllGlobals(); });

async function fixture() {
  const { sqlite, db } = await testDatabase();
  cleanup.push(() => sqlite.close());
  sqlite.exec(`INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at)
    VALUES('a','111','test',1,'2026-01-01','2026-01-01');
    INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1');
    INSERT INTO followers(igsid,account_id,last_inbound_at) VALUES('student','a','2026-01-01T00:00:00Z')`);
  const app = new Hono().route('/', webhook);
  const fetchMock = vi.fn(() => { throw new Error('Unexpected network'); }); vi.stubGlobal('fetch', fetchMock);
  const event = (changes: Record<string, unknown> = {}) => ({
    sender: { id: '111' }, recipient: { id: 'student' }, timestamp: NOW,
    message: { mid: 'message-1', is_echo: true, text: 'must-not-be-stored' }, ...changes,
  });
  const promises: Promise<unknown>[] = [];
  async function post(entries: unknown[], options: { flag?: string; signature?: string } = {}) {
    const body = JSON.stringify({ object: 'instagram', entry: entries });
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const signature = 'sha256=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
    const response = await app.fetch(new Request('https://test.invalid/webhook', {
      method: 'POST', headers: { 'X-Hub-Signature-256': options.signature ?? signature }, body,
    }), { DB: db, IG_APP_SECRET: SECRET, RECRUITMENT_ECHO_INGESTION: options.flag ?? '1', OUTBOUND_PREPARATION_LOCK: '1' },
    { waitUntil: (p: Promise<unknown>) => { promises.push(p); }, passThroughOnException() {} } as ExecutionContext);
    await Promise.all(promises.splice(0));
    return response;
  }
  return { sqlite, db, post, event, fetchMock };
}

it('ingests a signed echo durably while paused without opening inbound windows or sending', async () => {
  const { sqlite, post, event, fetchMock } = await fixture();
  const before = sqlite.prepare('SELECT * FROM followers').all();
  expect((await post([{ id: '111', messaging: [event()] }])).status).toBe(200);
  expect(sqlite.prepare('SELECT * FROM recruitment_outbound_observations').all()).toHaveLength(1);
  expect(sqlite.prepare('SELECT * FROM followers').all()).toEqual(before);
  for (const table of ['webhook_events','messages_log','follower_scenarios']) {
    expect(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n).toBe(0);
  }
  expect(fetchMock).not.toHaveBeenCalled();
  expect(sqlite.prepare('SELECT COUNT(*) n FROM active_mutations').get()?.n).toBe(0);
});

it('deduplicates messaging/standby and repeated webhooks by account + Meta ID', async () => {
  const { sqlite, post, event } = await fixture();
  const entries = [{ id: '111', messaging: [event()], standby: [event()] }];
  expect((await post(entries)).status).toBe(200); expect((await post(entries)).status).toBe(200);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_outbound_observations').get()?.n).toBe(1);
});

it('separates mixed inbound and echo batches while keeping inbound pending under pause', async () => {
  const { sqlite, post, event, fetchMock } = await fixture();
  const inbound = { sender: { id: 'student' }, recipient: { id: '111' }, timestamp: NOW, message: { mid: 'incoming-1', text: 'question' } };
  expect((await post([{ id: '111', messaging: [event(), inbound] }])).status).toBe(200);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_outbound_observations').get()?.n).toBe(1);
  expect(sqlite.prepare('SELECT kind,subject_id,status FROM webhook_events').all()).toEqual([{ kind: 'messaging', subject_id: 'student', status: 'pending' }]);
  expect(sqlite.prepare('SELECT last_inbound_at FROM followers').get()?.last_inbound_at).toBe('2026-01-01T00:00:00Z');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects bad HMAC before ingesting or queuing anything', async () => {
  const { sqlite, post, event } = await fixture();
  expect((await post([{ id: '111', messaging: [event()] }], { signature: 'sha256=' + '0'.repeat(64) })).status).toBe(403);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_outbound_observations').get()?.n).toBe(0);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_echo_receipts').get()?.n).toBe(0);
});

it('does not ingest entries whose exact account or App secret does not match', async () => {
  const { sqlite, post, event } = await fixture();
  expect((await post([{ id: 'not-111', messaging: [event()] }])).status).toBe(200);
  sqlite.exec("UPDATE ig_accounts SET app_secret='another-app'");
  expect((await post([{ id: '111', messaging: [event()] }])).status).toBe(200);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_outbound_observations').get()?.n).toBe(0);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_echo_receipts').get()?.n).toBe(0);
});

it('leaves ingestion disabled unless explicitly opted in', async () => {
  const { sqlite, post, event } = await fixture();
  expect((await post([{ id: '111', messaging: [event()] }], { flag: '0' })).status).toBe(200);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_outbound_observations').get()?.n).toBe(0);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_echo_receipts').get()?.n).toBe(0);
});

it('rejects a malformed echo batch before writing any earlier valid item', async () => {
  const { sqlite, post, event } = await fixture();
  for (const bad of [event({ sender: { id: 'other' } }), event({ recipient: { id: '111' } }), event({ timestamp: Date.now() + 60_000 }), event({ message: { mid: '', is_echo: true } })]) {
    expect((await post([{ id: '111', messaging: [event(), bad] }])).status).toBe(400);
  }
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_outbound_observations').get()?.n).toBe(0);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_echo_receipts').get()?.n).toBe(0);
});

it('does not acknowledge success on deletion lock or failed durable storage', async () => {
  const { sqlite, post, event } = await fixture();
  sqlite.exec("INSERT INTO data_deletion_locks(account_id,request_code) VALUES('a','deleting')");
  expect((await post([{ id: '111', messaging: [event()] }])).status).toBe(503);
  sqlite.exec('DELETE FROM data_deletion_locks; DROP TABLE recruitment_outbound_observations');
  expect((await post([{ id: '111', messaging: [event()] }])).status).toBe(500);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM active_mutations').get()?.n).toBe(0);
});

it('records delayed echoes without falsely refreshing reconciliation proof', async () => {
  const { sqlite, db, event } = await fixture();
  await ingestRecruitmentEchoes(db, { id: 'a', ig_user_id: '111' }, [{ kind: 'messaging', value: event() }], NOW + 7_200_000);
  expect(sqlite.prepare('SELECT sent_at_ms,observed_at_ms FROM recruitment_outbound_observations').get()).toMatchObject({ sent_at_ms: NOW, observed_at_ms: NOW + 7_200_000 });
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_outbound_control').get()?.n).toBe(0);
});

it('records signed provenance without body or recipient', async () => {
  const {sqlite,post,event}=await fixture(); await post([{id:'111',messaging:[event()]}]);
  const rows=sqlite.prepare('SELECT * FROM recruitment_echo_receipts').all();
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({account_id:'a',message_id:'message-1',sent_at_ms:NOW});
  expect(JSON.stringify(rows)).not.toMatch(/must-not-be-stored|student/);
});
it('deduplicates replays and preserves first/latest receipt', async () => {
  const {sqlite,db,event}=await fixture();
  for(const delay of [1000,3000,2000]) await ingestRecruitmentEchoes(db,{id:'a',ig_user_id:'111'},[{kind:'messaging',value:event()}],NOW+delay);
  expect(sqlite.prepare('SELECT * FROM recruitment_echo_receipts').all()).toEqual([{account_id:'a',message_id:'message-1',sent_at_ms:NOW,first_received_at_ms:NOW+1000,last_received_at_ms:NOW+3000}]);
});
it('never promotes API or legacy mixed evidence to signed echo', async () => {
  const {sqlite,db}=await fixture();
  sqlite.prepare("INSERT INTO recruitment_outbound_operations VALUES('a','api','epoch',?,'reserved',NULL)").run(NOW);
  await acknowledgeRecruitmentOutbound(db,{accountId:'a',operationKey:'api',messageId:'api-mid',acknowledgedAtMs:NOW});
  sqlite.prepare("INSERT INTO recruitment_outbound_observations VALUES('a','legacy',?,?)").run(NOW,NOW);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_echo_receipts').get()?.n).toBe(0);
});
it('rolls back observation when signed receipt storage fails', async () => {
  const {sqlite,post,event}=await fixture();
  sqlite.exec("CREATE TRIGGER receipt_failure BEFORE INSERT ON recruitment_echo_receipts BEGIN SELECT RAISE(ABORT,'test failure'); END");
  expect((await post([{id:'111',messaging:[event()]}])).status).toBe(500);
  for(const table of ['recruitment_outbound_observations','recruitment_echo_receipts','active_mutations']) expect(sqlite.prepare('SELECT COUNT(*) n FROM '+table).get()?.n).toBe(0);
});
it('separates accounts and cascades only the deleted observation evidence', async () => {
  const {sqlite,db,event}=await fixture();
  sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('b','222','test','2026-01-01','2026-01-01')");
  for(const [id,ig] of [['a','111'],['b','222']]) await ingestRecruitmentEchoes(db,{id,ig_user_id:ig},[{kind:'messaging',value:event({sender:{id:ig}})}],NOW);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_echo_receipts').get()?.n).toBe(2);
  sqlite.exec("DELETE FROM recruitment_outbound_observations WHERE account_id='a'");
  expect(sqlite.prepare('SELECT account_id FROM recruitment_echo_receipts').all()).toEqual([{account_id:'b'}]);
});
