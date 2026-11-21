import {afterEach,it,expect,vi} from 'vitest';
import {Hono} from 'hono';
import {createForm,updateForm,getFormSubmissions,createFormSubmission} from '@ig-harness/db';
import {forms} from '../../routes/forms.js';
import {testDatabase} from '../../test-utils/d1.js';
const close:(()=>void)[]=[];afterEach(()=>{while(close.length)close.pop()!();vi.unstubAllGlobals();});
async function fixture(){const f=await testDatabase();close.push(()=>f.sqlite.close());
 f.sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01'),('b','222','test',0,'2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,account_id) VALUES(1,'student','a'),(2,'foreign','b'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1')");
 const app=new Hono().route('/',forms);const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const submit=(id:string,body:unknown)=>app.fetch(new Request(`https://test.invalid/api/forms/${id}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{DB:f.db});
 return{...f,submit,fetch};}
it('creates and edits forms with real SQLite IDs without overwriting existing forms',async()=>{
 const f=await fixture();f.sqlite.exec("INSERT INTO forms(id,name,fields,account_id) VALUES(17,'legacy','[]','a')");
 const form=await createForm(f.db,{name:'新規',fields:'[]',accountId:'a',description:'説明'});expect(Number(form.id)).toBe(18);
 expect(await updateForm(f.db,String(form.id),{name:'変更',isActive:false,description:null})).toMatchObject({name:'変更',is_active:0,description:null});
 expect(f.sqlite.prepare('SELECT name FROM forms WHERE id=17').get()?.name).toBe('legacy');
});
it('keeps canonical response columns and exposes the existing API aliases, with atomic counts',async()=>{
 const f=await fixture();const form=await createForm(f.db,{name:'survey',fields:JSON.stringify([{name:'note',label:'補足',type:'text'}]),accountId:'a'});
 const response=await createFormSubmission(f.db,{formId:String(form.id),friendId:'1',data:'{"hope":"見学"}'});
 expect(Number(response.id)).toBe(1);expect(Number(response.friend_id)).toBe(1);expect(response.data).toBe('{"hope":"見学"}');
 expect(f.sqlite.prepare('SELECT follower_id,answers,submitted_at FROM form_submissions').get()).toMatchObject({follower_id:1,answers:response.data,submitted_at:response.created_at});
 expect(await getFormSubmissions(f.db,String(form.id))).toHaveLength(1);expect(f.sqlite.prepare('SELECT submit_count FROM forms').get()?.submit_count).toBe(1);
});
it.each(['foreign','inactive','anonymous','count-failure'])('does not leave partial receipts or counts for %s submissions',async mode=>{
 const f=await fixture();const form=await createForm(f.db,{name:'survey',fields:'[]',accountId:'a'});
 if(mode==='inactive')f.sqlite.exec('UPDATE forms SET is_active=0');
 if(mode==='count-failure')f.sqlite.exec("CREATE TRIGGER test_count BEFORE UPDATE ON forms BEGIN SELECT RAISE(ABORT,'injected count failure'); END");
 await expect(createFormSubmission(f.db,{formId:String(form.id),friendId:mode==='anonymous'?null:mode==='foreign'?'2':'1',data:'{}'})).rejects.toThrow();
 expect(f.sqlite.prepare('SELECT COUNT(*) n FROM form_submissions').get()?.n).toBe(0);expect(f.sqlite.prepare('SELECT submit_count FROM forms').get()?.submit_count).toBe(0);
});
it('accepts a scoped identified response while paused and preserves protected metadata',async()=>{
 const f=await fixture();const form=await createForm(f.db,{name:'survey',fields:JSON.stringify([{name:'note',label:'補足',type:'text'}]),accountId:'a'});
 f.sqlite.prepare('UPDATE followers SET metadata=? WHERE id=1').run(JSON.stringify({recruitment_delivery:{state:'stopped'},note:'before'}));
 const res=await f.submit(String(form.id),{friendId:'1',data:{note:'after',unlisted:'not profile evidence'}});expect(res.status).toBe(201);
 expect(await res.json()).toMatchObject({data:{id:'1',formId:String(form.id),friendId:'1',data:{note:'after'}}});
 expect(JSON.parse(String(f.sqlite.prepare('SELECT metadata FROM followers WHERE id=1').get()?.metadata))).toEqual({recruitment_delivery:{state:'stopped'},note:'after'});expect(f.fetch).not.toHaveBeenCalled();
});
it('rejects unidentified public submissions cleanly without a synthetic follower or receipt',async()=>{
 const f=await fixture();const form=await createForm(f.db,{name:'survey',fields:'[]',accountId:'a'});expect((await f.submit(String(form.id),{data:{note:'unknown'}})).status).toBe(400);
 expect(f.sqlite.prepare('SELECT COUNT(*) n FROM form_submissions').get()?.n).toBe(0);expect(f.fetch).not.toHaveBeenCalled();
});
