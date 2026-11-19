import { afterEach, expect, it, vi } from 'vitest';
import { InstagramClient } from '@ig-harness/ig-sdk';
import { testDatabase } from '../../test-utils/d1.js';
import { recruitmentMessageLifecycle } from '../recruitment-message-lifecycle.js';
const NOON = Date.parse('2026-11-20T03:00:00Z');
const cleanup: (()=>void)[]=[];
afterEach(()=>{while(cleanup.length)cleanup.pop()!();vi.unstubAllGlobals();});
async function fixture() {
  const {sqlite,db}=await testDatabase();cleanup.push(()=>sqlite.close());
  sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','111','test','2026-01-01','2026-01-01'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
  let now=NOON, locked=false;
  sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(now);
  sqlite.prepare("INSERT INTO followers(igsid,account_id,last_inbound_at) VALUES('student','a',?)").run(new Date(now-1000).toISOString());
  const fetch=vi.fn(async()=>new Response(JSON.stringify({message_id:'message-'+fetch.mock.calls.length,recipient_id:'student'})));
  vi.stubGlobal('fetch',fetch);
  const make=(mutate:()=>void|Promise<void>,key='operation')=>new InstagramClient({accessToken:'test',igUserId:'111',appSecret:'test-secret',
    messageLifecycle:recruitmentMessageLifecycle(db,'a',{key,ownerEpoch:'epoch'},async()=>{if(locked)throw new Error('Preparation locked');},()=>now),
    transformMessage:async(_id,message)=>{await Promise.resolve();await mutate();return message;},
  });
  return {sqlite,db,fetch,make,setNow:(n:number)=>{now=n;},lock:()=>{locked=true;}};
}
it.each(['pause','preparation-lock','owner-change','epoch-change','account-inactive','standby','inbound-expired','inbound-future','follower-deleted','stale','window-end','future-evidence','deletion-lock','manual-cap','other-uncertain'])(
  'rejects %s introduced during asynchronous transformation before fetch',async change=>{
    const {sqlite,fetch,make,setNow,lock}=await fixture();
    const mutate=()=>{
      if(change==='pause')sqlite.exec("UPDATE integration_settings SET value='1' WHERE key='outbound_paused'");
      if(change==='preparation-lock')lock();
      if(change==='owner-change')sqlite.exec("UPDATE recruitment_outbound_control SET owner='legacy'");
      if(change==='epoch-change')sqlite.exec("UPDATE recruitment_outbound_control SET owner_epoch='new-owner'");
      if(change==='stale')setNow(NOON+60_001);
      if(change==='window-end') {const t=Date.parse('2026-11-20T12:00:00Z');setNow(t);sqlite.prepare('UPDATE recruitment_outbound_control SET reconciled_at_ms=?').run(t);}
      if(change==='future-evidence')sqlite.prepare("INSERT INTO recruitment_outbound_observations VALUES('a','future',?,?)").run(NOON+1,NOON+1);
      if(change==='deletion-lock')sqlite.exec("INSERT INTO data_deletion_locks VALUES('a','delete')");
      if(change==='manual-cap')for(let i=0;i<10;i++)sqlite.prepare("INSERT INTO recruitment_outbound_observations VALUES('a',?,?,?)").run('manual-'+i,NOON,NOON);
      if(change==='other-uncertain')sqlite.prepare("INSERT INTO recruitment_outbound_operations VALUES('a','other','epoch',?,'uncertain',NULL)").run(NOON);
      if(change==='account-inactive')sqlite.exec("UPDATE ig_accounts SET is_active=0");
      if(change==='standby')sqlite.exec("UPDATE followers SET messaging_owner='standby'");
      if(change==='inbound-expired')sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date(NOON-86400000).toISOString());
      if(change==='inbound-future')sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date(NOON+1000).toISOString());
      if(change==='follower-deleted')sqlite.exec('DELETE FROM followers');
    };
    const client=make(mutate);
    await expect(client.sendText('student','test')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT state FROM recruitment_outbound_operations WHERE operation_key='operation:0'").get()?.state).toBe('uncertain');
    await expect(client.sendText('student','retry')).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
  });
it('permits exactly ten including manual messages after transformation/signing',async()=>{
  const {sqlite,fetch,make}=await fixture();
  const client=make(()=>{for(let i=0;i<9;i++)sqlite.prepare("INSERT INTO recruitment_outbound_observations VALUES('a',?,?,?)").run('manual-'+i,NOON,NOON);});
  await client.sendImage('student','https://example.com/a.jpg');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sqlite.prepare("SELECT state FROM recruitment_outbound_operations").get()?.state).toBe('sent');
});
it('rechecks each rich block after a stop arrives following the first success',async()=>{
  const {sqlite,fetch,make}=await fixture();
  fetch.mockImplementation(async()=>{sqlite.exec("UPDATE integration_settings SET value='1' WHERE key='outbound_paused'");return new Response(JSON.stringify({message_id:'one',recipient_id:'student'}));});
  await expect(make(()=>{}).sendRichMessage('student',[{type:'text',text:'one'},{type:'text',text:'two'}])).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_outbound_operations').get()?.n).toBe(1);
});
