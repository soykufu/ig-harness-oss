import { afterEach, expect, it, vi } from 'vitest';
import { testDatabase } from '../../test-utils/d1.js';
import { getAccountClient } from '../../lib/accounts.js';
const NOW = Date.parse('2026-11-20T03:00:00Z'); // noon JST
const close: (() => void)[] = [];
afterEach(() => { while(close.length) close.pop()!(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function fixture(key: string | undefined = 'operation') {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const { sqlite, db } = await testDatabase(); close.push(() => sqlite.close());
  sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
  sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(NOW);
  const fetch = vi.fn(async () => new Response(JSON.stringify({ message_id: `mid-${fetch.mock.calls.length}`, recipient_id: 'student' })));
  vi.stubGlobal('fetch',fetch);
  const account = sqlite.prepare("SELECT * FROM ig_accounts WHERE id='a'").get() as any;
  const env = { IG_USER_ID: '111', IG_ACCESS_TOKEN: 'test', RECRUITMENT_LEDGER_ENFORCEMENT: '1' };
  const make = (operationKey = key) => getAccountClient(env,db,account,{skipTokenRefresh:true,recruitmentOperation:operationKey ? {key:operationKey,ownerEpoch:'epoch'}:undefined});
  return { sqlite,db,fetch,make,env };
}
it('counts every actual rich block and rejects replay by a recreated client', async () => {
  const {sqlite,fetch,make} = await fixture();
  const client=await make();
  await client.sendRichMessage('student',[{type:'text',text:'one'},{type:'image',url:'https://example.com/a.jpg'}] as any);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(sqlite.prepare('SELECT operation_key,state FROM recruitment_outbound_operations ORDER BY operation_key').all()).toEqual([{operation_key:'operation:0',state:'sent'},{operation_key:'operation:1',state:'sent'}]);
  await expect((await make()).sendText('student','duplicate')).rejects.toThrow('denied');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('enforces the common quota across all six DM methods without presence calls', async () => {
  const {sqlite,fetch,make}=await fixture();
  for(let i=0;i<10;i++) sqlite.prepare("INSERT INTO recruitment_outbound_observations VALUES('a',?,?,?)").run('manual-'+i,NOW,NOW);
  let c=await make();
  const sends=[()=>c.sendText('student','x'),()=>c.sendImage('student','https://example.com/a.jpg'),()=>c.sendQuickReply('student','x',[]),()=>c.sendGenericTemplate('student',[]),()=>c.sendPrivateReply('comment','x'),()=>c.sendRichMessage('student',[{type:'text',text:'x'}])];
  for(let i=0;i<sends.length;i++) { c=await make('quota-'+i); await expect(sends[i]!()).rejects.toThrow('denied'); }
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['timeout','malformed','recipient-mismatch','ack-write-failure'])('holds %s without a retry or a later send',async mode=>{
  const {sqlite,fetch,make}=await fixture();
  if(mode==='timeout') fetch.mockImplementation(async()=>{throw new Error('offline');});
  if(mode==='malformed') fetch.mockImplementation(async()=>new Response('{}'));
  if(mode==='recipient-mismatch') fetch.mockImplementation(async()=>new Response(JSON.stringify({message_id:'sent',recipient_id:'other'})));
  if(mode==='ack-write-failure') sqlite.exec("CREATE TRIGGER reject_ack BEFORE UPDATE ON recruitment_outbound_operations WHEN NEW.state='sent' BEGIN SELECT RAISE(ABORT,'test write failure'); END");
  const client=await make();
  await expect(client.sendText('student','x')).rejects.toThrow();
  await expect(client.sendImage('student','https://example.com/a.jpg')).rejects.toThrow();
  await expect((await make('different-operation')).sendText('student','x')).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sqlite.prepare('SELECT state FROM recruitment_outbound_operations').get()?.state).toBe('uncertain');
});
it('requires operation ownership and respects a newly applied pause and preparation lock',async()=>{
  const {sqlite,fetch,make,env}=await fixture('');
  await expect((await make()).sendText('student','x')).rejects.toThrow();
  const client=await make('valid');
  sqlite.exec("UPDATE integration_settings SET value='1' WHERE key='outbound_paused'");
  await expect(client.sendPrivateReply('comment','x')).rejects.toThrow();
  sqlite.exec("UPDATE integration_settings SET value='0' WHERE key='outbound_paused'");
  Object.assign(env,{OUTBOUND_PREPARATION_LOCK:'1'});
  await expect((await make('locked')).sendText('student','x')).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it('blocks outside 8–21 JST even when ledger attestation is fresh',async()=>{
  const {sqlite,fetch,make}=await fixture();
  const outside=Date.parse('2026-11-20T12:00:00Z'); vi.mocked(Date.now).mockReturnValue(outside);
  sqlite.prepare('UPDATE recruitment_outbound_control SET reconciled_at_ms=?').run(outside);
  await expect((await make()).sendText('student','x')).rejects.toThrow('window'); expect(fetch).not.toHaveBeenCalled();
});
