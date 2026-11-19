import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { friends } from '../friends.js';
import { testDatabase } from '../../test-utils/d1.js';
const NOW=Date.parse('2026-11-20T03:00:00Z');
const close:(()=>void)[]=[];
afterEach(()=>{while(close.length)close.pop()!();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function fixture(){
  vi.spyOn(Date,'now').mockReturnValue(NOW);
  const {sqlite,db}=await testDatabase();close.push(()=>sqlite.close());
  sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,token_expires_at,is_default,created_at,updated_at) VALUES('a','111','test',9999999999,1,'2026-01-01','2026-01-01'),('b','222','test',9999999999,0,'2026-01-01','2026-01-01'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
  sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(NOW);
  for(const [id,igsid,account] of [[1,'student','a'],[2,'other','a'],[3,'foreign','b']])sqlite.prepare('INSERT INTO followers(id,igsid,account_id,last_inbound_at) VALUES(?,?,?,?)').run(id,igsid,account,new Date(NOW-1000).toISOString());
  const fetch=vi.fn(async()=>new Response(JSON.stringify({message_id:'mid',recipient_id:'student'})));vi.stubGlobal('fetch',fetch);
  const app=new Hono().route('/',friends);
  const env={DB:db,IG_USER_ID:'',IG_ACCESS_TOKEN:'',RECRUITMENT_LEDGER_ENFORCEMENT:'1',OUTBOUND_PREPARATION_LOCK:'0'};
  const post=(nonce='same-action-123456',text='hello',id=1)=>app.fetch(new Request(`https://test.invalid/api/friends/${id}/messages?account_id=a`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':nonce},body:JSON.stringify({content:JSON.stringify({text})})}),env);
  return {sqlite,db,fetch,post,env};
}
it('allows only one send for concurrent taps and returns recorded success for replay',async()=>{
  const {sqlite,fetch,post}=await fixture();
  const results=await Promise.all(Array.from({length:12},()=>post()));
  expect(results.every(r=>[200,409].includes(r.status))).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()?.n).toBe(1);
  expect((await post()).status).toBe(200);expect(fetch).toHaveBeenCalledTimes(1);
});
it('binds the same operation to exact content and recipient',async()=>{
  const {fetch,post}=await fixture();expect((await post()).status).toBe(200);
  expect((await post('same-action-123456','changed')).status).toBe(409);
  expect((await post('same-action-123456','hello',2)).status).toBe(409);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each(['timeout','log-failure'])('does not resend after %s',async mode=>{
  const {sqlite,fetch,post}=await fixture();
  if(mode==='timeout')fetch.mockImplementation(async()=>{throw new Error('offline');});
  else sqlite.exec("CREATE TRIGGER log_fail BEFORE INSERT ON messages_log BEGIN SELECT RAISE(ABORT,'test log failure'); END");
  expect((await post()).status).toBe(500);
  expect((await post()).status).toBe(409);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sqlite.prepare('SELECT status FROM recruitment_manual_intents').get()?.status).toBe('uncertain');
});
it('rejects absent nonce, wrong account, stop and preparation lock before a send',async()=>{
  const {sqlite,fetch,post,env}=await fixture();
  expect((await post('')).status).toBe(400);
  expect((await post('same-action-123456','hello',3)).status).toBe(404);
  env.OUTBOUND_PREPARATION_LOCK='1';expect((await post()).status).toBe(409);
  env.OUTBOUND_PREPARATION_LOCK='0';sqlite.exec("UPDATE integration_settings SET value='1' WHERE key='outbound_paused'");expect((await post()).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_manual_intents').get()?.n).toBe(0);
});
it('does not hold plaintext content or the raw nonce in the intent journal',async()=>{
  const {sqlite,post}=await fixture();await post('same-action-123456','private text');
  const record=JSON.stringify(sqlite.prepare('SELECT * FROM recruitment_manual_intents').all());
  expect(record).not.toContain('private text');expect(record).not.toContain('same-action-123456');
});
