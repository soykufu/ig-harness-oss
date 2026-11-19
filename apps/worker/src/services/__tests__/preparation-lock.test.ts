import { afterEach, expect, it, vi } from 'vitest';
import { testDatabase } from '../../test-utils/d1.js';
import { getAccountClient } from '../../lib/accounts.js';
import { setOutboundPaused } from '../human-touch.js';

afterEach(() => vi.unstubAllGlobals());

for (const mode of ['operator_pause', 'preparation_lock'] as const) {
  it(`${mode} blocks every outgoing message before any Graph or presence call`, async () => {
    const { sqlite, db } = await testDatabase();
    try {
      sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01')");
      const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
      await setOutboundPaused(db, mode === 'operator_pause');
      const env = { IG_USER_ID: '111', IG_ACCESS_TOKEN: 'test', OUTBOUND_PREPARATION_LOCK: mode === 'preparation_lock' ? '1' : '0' };
      const account = sqlite.prepare("SELECT * FROM ig_accounts WHERE id='a'").get();
      const client = await getAccountClient(env, db, account as any, { skipTokenRefresh: true });
      const sends = [
        () => client.sendText('u','hello'),
        () => client.sendImage('u','https://example.com/a.jpg'),
        () => client.sendGenericTemplate('u',[]),
        () => client.sendQuickReply('u','hello',[]),
        () => client.sendRichMessage('u',[]),
        () => client.sendPrivateReply('comment','hello'),
      ];
      for (const send of sends) await expect(send()).rejects.toHaveProperty('name','OutboundPausedError');
      expect(fetch).not.toHaveBeenCalled();
    } finally { sqlite.close(); }
  });
}

it('an existing client rechecks operator pause immediately before the next send', async () => {
  const { sqlite, db } = await testDatabase();
  try {
    sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01')");
    const fetch=vi.fn(); vi.stubGlobal('fetch',fetch);
    const account=sqlite.prepare("SELECT * FROM ig_accounts WHERE id='a'").get();
    const client=await getAccountClient({IG_USER_ID:'111',IG_ACCESS_TOKEN:'test'},db,account as any,{skipTokenRefresh:true});
    await setOutboundPaused(db,true);
    await expect(client.sendPrivateReply('comment','hello')).rejects.toHaveProperty('name','OutboundPausedError');
    expect(fetch).not.toHaveBeenCalled();
  } finally {sqlite.close();}
});
