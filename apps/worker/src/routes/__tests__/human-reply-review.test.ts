import {afterEach,it,expect,vi} from 'vitest';
import {Hono} from 'hono';
import type {Env} from '../../index.js';
import {friends} from '../friends.js';
import {testDatabase} from '../../test-utils/d1.js';
import {recruitmentSubjectHash} from '../../services/recruitment-inbound-holds.js';
const close:(()=>void)[]=[];afterEach(()=>{while(close.length)close.pop()!();vi.restoreAllMocks();});
async function fixture(){const {db,sqlite}=await testDatabase();close.push(()=>sqlite.close());const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);
 sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01'),('b','222','test',0,'2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,account_id) VALUES(1,'student','a'),(2,'foreign','b'); INSERT INTO staff_members(id,name,role,api_key) VALUES('owner','test','owner','test'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1')");
 sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date(now).toISOString());sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(now);sqlite.prepare("INSERT INTO recruitment_inbound_holds VALUES('a','in',?,'consulting',?,?)").run(await recruitmentSubjectHash('a','student'),now,now);
 let role='owner';const app=new Hono<Env>().use('*',async(c,next)=>{c.set('staff',{id:'owner',name:'test',role} as never);await next();}).route('/',friends);
 const env={DB:db,RECRUITMENT_LEDGER_ENFORCEMENT:'1'};
 const post=(id=1,account='a')=>app.fetch(new Request(`https://test.invalid/api/friends/${id}/human-reply-review?account_id=${account}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'operator-action-123456'},body:JSON.stringify({text:'相談への回答',actorId:'injected'})}),env);
 return {db,sqlite,post,env,setRole:(r:string)=>{role=r;}};}
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
