import {afterEach,expect,it} from 'vitest';
import {Hono} from 'hono';
import type {Env} from '../../index.js';
import {friends} from '../friends.js';
import {testDatabase} from '../../test-utils/d1.js';
import {recruitmentSubjectHash} from '../../services/recruitment-inbound-holds.js';
const close:Array<()=>void>=[];afterEach(()=>{while(close.length)close.pop()!();});
async function fixture(){
 const {db,sqlite}=await testDatabase();close.push(()=>sqlite.close());
 sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01'),('b','222','test',0,'2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,account_id) VALUES(1,'student','a'),(2,'other','a'),(3,'foreign','b')");
 sqlite.prepare("INSERT INTO recruitment_inbound_holds VALUES('a','opaque',?,'consulting',0,1000),('a','second',?,'stopped',0,2000),('a','deleted',NULL,'hold',0,3000)").run(await recruitmentSubjectHash('a','student'),await recruitmentSubjectHash('a','student'));
 let role:string|undefined='owner';
 const app=new Hono<Env>().use('*',async(c,next)=>{if(role)c.set('staff',{id:'test',name:'test',role} as never);await next();}).route('/',friends);
 const get=(id='1',account='a')=>app.fetch(new Request(`https://test.invalid/api/friends/${id}/recruitment-holds?account_id=${account}`),{DB:db});
 return{sqlite,get,setRole:(r?:string)=>{role=r;}};
}
it('shows held states without writing or granting resume, and hides subject-free tombstones',async()=>{
 const {sqlite,get}=await fixture();const n=sqlite.prepare('SELECT total_changes() n').get()?.n;
 const res=await get();expect(res.status).toBe(200);expect(res.headers.get('Cache-Control')).toBe('no-store');
 const b=await res.json() as any;expect(b.data).toMatchObject({needsReview:true,mayResume:false,holds:[{state:'consulting',count:1,oldestAtMs:1000},{state:'stopped',count:1,latestAtMs:2000}]});
 expect(JSON.stringify(b)).not.toMatch(/student|opaque|subject_hash/);expect(sqlite.prepare('SELECT total_changes() n').get()?.n).toBe(n);
});
it('keeps recipients and accounts isolated and distinguishes empty state',async()=>{
 const {get}=await fixture();expect((await(await get('2')).json() as any).data).toMatchObject({needsReview:false,holds:[],mayResume:false});
 expect((await get('3')).status).toBe(404);expect((await get('1','b')).status).toBe(404);expect((await get('x')).status).toBe(400);
});
it('requires owner/admin and never treats unavailable schema as zero',async()=>{
 const {sqlite,get,setRole}=await fixture();for(const r of ['staff',undefined]){setRole(r);expect((await get()).status).toBe(403);}
 setRole('admin');expect((await get()).status).toBe(200);sqlite.exec('DROP TABLE recruitment_inbound_holds');expect((await get()).status).toBe(503);
});
