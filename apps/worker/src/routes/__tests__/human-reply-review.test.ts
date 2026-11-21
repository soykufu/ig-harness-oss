import {afterEach,it,expect,vi} from 'vitest';
import {Hono} from 'hono';
import type {Env} from '../../index.js';
import {friends} from '../friends.js';
import {testDatabase} from '../../test-utils/d1.js';
import {recruitmentSubjectHash} from '../../services/recruitment-inbound-holds.js';
const close:(()=>void)[]=[];afterEach(()=>{while(close.length)close.pop()!();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function fixture(){const {db,sqlite}=await testDatabase();close.push(()=>sqlite.close());const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);
 sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01'),('b','222','test',0,'2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,account_id) VALUES(1,'student','a'),(2,'foreign','b'); INSERT INTO staff_members(id,name,role,api_key) VALUES('owner','test','owner','test'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1')");
 sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date(now).toISOString());sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(now);sqlite.prepare("INSERT INTO recruitment_inbound_holds VALUES('a','in',?,'consulting',?,?)").run(await recruitmentSubjectHash('a','student'),now,now);
 let role='owner';const app=new Hono<Env>().use('*',async(c,next)=>{c.set('staff',{id:'owner',name:'test',role} as never);await next();}).route('/',friends);
 sqlite.exec("UPDATE ig_accounts SET token_expires_at='2030-01-01T00:00:00Z'");
 const env={DB:db,RECRUITMENT_LEDGER_ENFORCEMENT:'1',OUTBOUND_PREPARATION_LOCK:'0'};
 const post=(id=1,account='a',kind='human-reply-review',text='相談への回答')=>app.fetch(new Request(`https://test.invalid/api/friends/${id}/${kind}?account_id=${account}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'operator-action-123456'},body:JSON.stringify({text,actorId:'injected'})}),env);
 const status=(id=1,account='a')=>app.fetch(new Request(`https://test.invalid/api/friends/${id}/human-reply-status?account_id=${account}`,{headers:{'Idempotency-Key':'operator-action-123456'}}),env);
 return {db,sqlite,post,status,env,setRole:(r:string)=>{role=r;}};}
it('prepares only a draft using the authenticated actor while paused, with no send or resume',async()=>{
 const {sqlite,post}=await fixture();const res=await post();expect(res.status).toBe(200);expect(res.headers.get('Cache-Control')).toBe('no-store');expect(await res.json()).toMatchObject({data:{prepared:true,maySend:false}});
 expect(sqlite.prepare('SELECT actor_id,status FROM recruitment_human_reply_contracts').get()).toMatchObject({actor_id:'owner',status:'prepared'});expect(sqlite.prepare("SELECT value FROM integration_settings WHERE key='outbound_paused'").get()?.value).toBe('1');expect(sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()?.n).toBe(0);expect((await post()).status).toBe(409);
});
it('requires both the authenticated role and the current active DB role, enforcing account boundaries',async()=>{
 const {sqlite,post,setRole}=await fixture();setRole('staff');expect((await post()).status).toBe(403);setRole('owner');expect((await post(2)).status).toBe(404);expect((await post(1,'b')).status).toBe(404);sqlite.exec("UPDATE staff_members SET role='staff'");expect((await post()).status).toBe(409);expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_human_reply_contracts').get()?.n).toBe(0);
});
it('keeps default-disabled or missing-schema state from granting preparation or sending',async()=>{
 const {sqlite,post,env}=await fixture();env.RECRUITMENT_LEDGER_ENFORCEMENT='0';expect((await post()).status).toBe(409);env.RECRUITMENT_LEDGER_ENFORCEMENT='1';sqlite.exec('DROP TABLE recruitment_human_reply_contracts');expect((await post()).status).toBe(409);expect(sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()?.n).toBe(0);
});

it('sends one reviewed text only, preserving holds and preventing repeat claims',async()=>{
 const {sqlite,post}=await fixture();const fetch=vi.fn(async()=>new Response(JSON.stringify({message_id:'one',recipient_id:'student'})));vi.stubGlobal('fetch',fetch);
 expect((await post()).status).toBe(200);sqlite.exec("UPDATE integration_settings SET value='0'");
 const res=await post(1,'a','human-replies');expect(res.status).toBe(200);expect(await res.json()).toMatchObject({data:{sent:true,automaticDeliveryResumed:false}});
 expect(fetch).toHaveBeenCalledOnce();expect(sqlite.prepare('SELECT status FROM recruitment_human_reply_contracts').get()?.status).toBe('sent');expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_inbound_holds').get()?.n).toBe(1);
 expect((await post(1,'a','human-replies')).status).toBe(409);expect(fetch).toHaveBeenCalledOnce();
});
it.each(['unreviewed','changed-body','paused','preparation-lock','stop-before-claim','timeout','wrong-ack','log-failure'])( 'does not permit unsafe human delivery: %s',async mode=>{
 const {sqlite,post,env}=await fixture();const fetch=vi.fn(async()=>{if(mode==='timeout')throw Error('offline');return new Response(JSON.stringify({message_id:'one',recipient_id:mode==='wrong-ack'?'foreign':'student'}));});vi.stubGlobal('fetch',fetch);
 if(mode!=='unreviewed')expect((await post()).status).toBe(200);
 if(mode!=='paused')sqlite.exec("UPDATE integration_settings SET value='0'");
 if(mode==='preparation-lock')env.OUTBOUND_PREPARATION_LOCK='1';
 if(mode==='log-failure')sqlite.exec("CREATE TRIGGER fail_log BEFORE INSERT ON messages_log BEGIN SELECT RAISE(ABORT,'test log failure'); END");
 if(mode==='stop-before-claim')sqlite.prepare("UPDATE recruitment_inbound_holds SET state='stopped'").run();
 const res=await post(1,'a','human-replies',mode==='changed-body'?'changed':'相談への回答');expect(res.status).toBe(409);
 expect(fetch).toHaveBeenCalledTimes(['timeout','wrong-ack','log-failure'].includes(mode)?1:0);
 const count=fetch.mock.calls.length;expect((await post(1,'a','human-replies',mode==='changed-body'?'changed':'相談への回答')).status).toBe(409);expect(fetch).toHaveBeenCalledTimes(count);
});

it('reads only matching human reply history without changing data, retry rights or receipt claims',async()=>{
 const {sqlite,post,status}=await fixture();vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({message_id:'one',recipient_id:'student'})));
 expect((await status()).status).toBe(404);await post();const prepared=await status();expect(await prepared.json()).toMatchObject({data:{status:'prepared',apiAcknowledged:false,mayRetry:false,recipientReceipt:'unknown'}});
 sqlite.exec("UPDATE integration_settings SET value='0'");await post(1,'a','human-replies');
 const n=sqlite.prepare('SELECT total_changes() n').get()?.n;const sent=await status();expect(sent.headers.get('Cache-Control')).toBe('no-store');expect(await sent.json()).toMatchObject({data:{status:'sent',apiAcknowledged:true,mayRetry:false,recipientReceipt:'unknown'}});
 expect(sqlite.prepare('SELECT total_changes() n').get()?.n).toBe(n);expect((await status(1,'b')).status).toBe(404);expect((await status(2,'a')).status).toBe(404);
 sqlite.exec('DROP TABLE recruitment_human_reply_contracts');expect((await status()).status).toBe(503);
});
it('never mistakes an uncertain or mismatched ledger for a confirmed reply',async()=>{
 const {sqlite,post,status}=await fixture();vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({message_id:'one',recipient_id:'student'})));await post();sqlite.exec("UPDATE integration_settings SET value='0'");await post(1,'a','human-replies');
 sqlite.exec("UPDATE recruitment_outbound_operations SET owner_epoch='wrong'");expect(await(await status()).json()).toMatchObject({data:{apiAcknowledged:false,mayRetry:false}});
 sqlite.exec("UPDATE recruitment_human_reply_contracts SET status='uncertain'");expect(await(await status()).json()).toMatchObject({data:{status:'uncertain',apiAcknowledged:false,mayRetry:false}});
});
it('cancels only an unclaimed review, even with preparation and outbound locks retained',async()=>{
 const {sqlite,post,status,env}=await fixture();const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await post();env.OUTBOUND_PREPARATION_LOCK='1';env.RECRUITMENT_LEDGER_ENFORCEMENT='0';
 const canceled=await post(1,'a','human-reply-cancel');expect(canceled.status).toBe(200);expect(canceled.headers.get('Cache-Control')).toBe('no-store');
 expect(await canceled.json()).toMatchObject({data:{canceled:true,mayCreateNewDraft:true,mayRetry:false,automaticDeliveryResumed:false}});
 expect(await(await status()).json()).toMatchObject({data:{canceled:true,mayCreateNewDraft:true,apiAcknowledged:false}});
 env.RECRUITMENT_LEDGER_ENFORCEMENT='1';env.OUTBOUND_PREPARATION_LOCK='0';sqlite.exec("UPDATE integration_settings SET value='0'");
 expect((await post(1,'a','human-replies')).status).toBe(409);expect((await post()).status).toBe(409);expect(fetch).not.toHaveBeenCalled();
});
it.each(['role','inactive','account','follower','claimed','uncertain','sent','missing','schema'])( 'does not release an unsafe cancellation: %s',async mode=>{
 const {sqlite,post,status,setRole}=await fixture();const fetch=vi.fn();vi.stubGlobal('fetch',fetch);if(mode!=='missing')await post();
 if(mode==='role')setRole('staff');if(mode==='inactive')sqlite.exec('UPDATE staff_members SET is_active=0');
 if(['claimed','uncertain','sent'].includes(mode))sqlite.prepare('UPDATE recruitment_human_reply_contracts SET status=?').run(mode);
 if(mode==='schema')sqlite.exec('DROP TABLE recruitment_human_reply_contracts');
 const res=await post(mode==='follower'?2:1,mode==='account'?'b':'a','human-reply-cancel');expect(res.status).not.toBe(200);expect(fetch).not.toHaveBeenCalled();
 if(!['missing','schema','role','inactive'].includes(mode))expect(await(await status()).json()).toMatchObject({data:{canceled:false,mayCreateNewDraft:false}});
});
