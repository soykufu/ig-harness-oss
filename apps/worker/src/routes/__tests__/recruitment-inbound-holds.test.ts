import {afterEach,expect,it,vi} from 'vitest';
import {Hono} from 'hono';
import {webhook} from '../webhook.js';
import {testDatabase} from '../../test-utils/d1.js';
import {assertNoRecruitmentInboundHold,recruitmentSubjectHash} from '../../services/recruitment-inbound-holds.js';
const NOW=1700000000000;
const closes:Array<()=>void>=[];
afterEach(()=>{while(closes.length)closes.pop()!();vi.unstubAllGlobals();});
async function fixture(){
 const {sqlite,db}=await testDatabase();closes.push(()=>sqlite.close());
 sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1')");
 const fetch=vi.fn(()=>{throw Error('Network forbidden');});vi.stubGlobal('fetch',fetch);
 const app=new Hono().route('/',webhook);
 const event=(mid='incoming',text='質問があります')=>({sender:{id:'student'},recipient:{id:'111'},timestamp:NOW,message:{mid,text}});
 async function post(events:any[], options:{signature?:string;flag?:string;account?:string}={}){
  const body=JSON.stringify({object:'instagram',entry:[{id:options.account??'111',messaging:events,standby:events}]});
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body));
  const signature='sha256='+Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('');
  const pending:Promise<unknown>[]=[];
  const res=await app.fetch(new Request('https://test.invalid/webhook',{method:'POST',headers:{'X-Hub-Signature-256':options.signature??signature},body}),{DB:db,IG_APP_SECRET:'secret',RECRUITMENT_INBOUND_SUPPRESSION:options.flag??'1',OUTBOUND_PREPARATION_LOCK:'1'},{waitUntil:(p:Promise<unknown>)=>pending.push(p),passThroughOnException(){}} as any);
  await Promise.all(pending);return res;
 }
 return{sqlite,db,fetch,event,post};
}
it('persists a signed consultation before acknowledgement while paused, including unknown follower',async()=>{
 const {sqlite,db,fetch,event,post}=await fixture();expect((await post([event()])).status).toBe(200);
 const rows=sqlite.prepare('SELECT * FROM recruitment_inbound_holds').all();expect(rows).toHaveLength(1);expect(rows[0].state).toBe('consulting');
 expect(JSON.stringify(rows)).not.toMatch(/質問|student|incoming/);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM followers').get()?.n).toBe(0);
 await expect(assertNoRecruitmentInboundHold(db,'a','student')).rejects.toThrow('human review');
 await expect(assertNoRecruitmentInboundHold(db,'a','other')).resolves.toBeUndefined();
 expect(fetch).not.toHaveBeenCalled();
});
it('keeps stop sticky through repeated, delayed and later inbound messages',async()=>{
 const {sqlite,db,event,post}=await fixture();
 for(const e of [event('stop','停止'),event('stop','停止'),{...event('old','ありがとうございます'),timestamp:NOW-1000},event('later','再開')])expect((await post([e])).status).toBe(200);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_inbound_holds').get()?.n).toBe(3);
 expect(sqlite.prepare("SELECT COUNT(*) n FROM recruitment_inbound_holds WHERE state='stopped'").get()?.n).toBe(1);
 await expect(assertNoRecruitmentInboundHold(db,'a','student')).rejects.toThrow();
});
it.each(['配信停止','STOP','unsubscribe','辞退','応募辞退'])('recognises explicit suppression %s',async text=>{
 const {sqlite,event,post}=await fixture();await post([event('message',text)]);
 expect(sqlite.prepare('SELECT state FROM recruitment_inbound_holds').get()?.state).toBe(['辞退','応募辞退'].includes(text)?'declined':'stopped');
});
it('ignores echoes, receipts and wrong account and remains opt-in',async()=>{
 const {sqlite,event,post}=await fixture();
 await post([{...event(),message:{mid:'echo',is_echo:true}}]);await post([{sender:{id:'student'},recipient:{id:'111'},read:{watermark:NOW}}]);
 await post([event()],{flag:'0'});await post([event()],{account:'other'});
 expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_inbound_holds').get()?.n).toBe(0);
});
it('rejects bad signature and validates the entire batch before persisting',async()=>{
 const {sqlite,event,post}=await fixture();expect((await post([event()],{signature:'sha256'+'0'.repeat(64)})).status).toBe(403);
 for(const bad of [{...event(),timestamp:Date.now()+60000},{...event(),recipient:{id:'wrong'}},{...event(),sender:{id:' student'}},{...event(),message:{mid:'',text:'停止'}}])expect((await post([event(),bad])).status).toBe(400);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_inbound_holds').get()?.n).toBe(0);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM webhook_events').get()?.n).toBe(0);
});
it('does not acknowledge storage failure or deletion lock',async()=>{
 const {sqlite,event,post}=await fixture();sqlite.exec("INSERT INTO data_deletion_locks VALUES('a','request')");expect((await post([event()])).status).toBe(503);
 sqlite.exec("DELETE FROM data_deletion_locks; CREATE TRIGGER fail_holds BEFORE INSERT ON recruitment_inbound_holds BEGIN SELECT RAISE(ABORT,'test failure'); END");expect((await post([event()])).status).toBe(500);
 for(const table of ['recruitment_inbound_holds','webhook_events','active_mutations'])expect(sqlite.prepare('SELECT COUNT(*) n FROM '+table).get()?.n).toBe(0);
});
it('retains a subject-free dedup tombstone after personal deletion',async()=>{
 const {sqlite,db,event,post}=await fixture();await post([event()]);
 sqlite.prepare('UPDATE recruitment_inbound_holds SET subject_hash=NULL WHERE account_id=? AND subject_hash=?').run('a',await recruitmentSubjectHash('a','student'));
 await post([event()]);expect(sqlite.prepare('SELECT subject_hash FROM recruitment_inbound_holds').all()).toEqual([{subject_hash:null}]);
});
