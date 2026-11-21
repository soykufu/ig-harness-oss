import {afterEach,it,expect,vi} from 'vitest';
import {Hono} from 'hono';
import {createForm} from '@ig-harness/db';
import {forms} from '../forms.js';
import {testDatabase} from '../../test-utils/d1.js';
const close:(()=>void)[]=[];afterEach(()=>{while(close.length)close.pop()!();vi.unstubAllGlobals();});
async function fixture(){const f=await testDatabase();close.push(()=>f.sqlite.close());
 f.sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01'),('b','222','test',0,'2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,account_id,metadata) VALUES(1,'student','a','{\"recruitment_delivery\":{\"state\":\"stopped\"}}'),(2,'foreign','b','{}'),(3,'another','a','{}'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0'); INSERT INTO tags(id,name,account_id) VALUES(1,'interest','a'); INSERT INTO scenarios(id,name,trigger_type,account_id) VALUES(1,'followup','manual','a')");
 const form=await createForm(f.db,{name:'identified survey',accountId:'a',fields:JSON.stringify([{name:'hope',label:'希望',type:'text'}]),onSubmitTagId:'1',onSubmitScenarioId:'1',onSubmitMessageType:'text',onSubmitMessageContent:'{"text":"auto"}'});
 const app=new Hono().route('/',forms);const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const env={DB:f.db,RECRUITMENT_LEDGER_ENFORCEMENT:'1',OUTBOUND_PREPARATION_LOCK:'1'};
 const nonce='stable-form-request-123456';
 const post=(data:unknown={hope:'見学'},friendId='1',key=nonce,id=String(form.id))=>app.fetch(new Request(`https://test.invalid/api/forms/${id}/submit`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({friendId,data})}),env);
 return{...f,form,fetch,post,nonce,env};}
it('persists one held receipt for concurrent taps and replays, without any profile, tag, scenario or send effect',async()=>{
 const f=await fixture();const before=f.sqlite.prepare('SELECT metadata FROM followers WHERE id=1').get()?.metadata;
 const responses=await Promise.all(Array.from({length:12},()=>f.post()));expect(responses.filter(r=>r.status===201)).toHaveLength(1);expect(responses.filter(r=>r.status===200)).toHaveLength(11);
 expect(f.sqlite.prepare('SELECT COUNT(*) n FROM form_submissions').get()?.n).toBe(1);expect(f.sqlite.prepare('SELECT submit_count FROM forms').get()?.submit_count).toBe(1);
 const replay=await f.post();expect(await replay.json()).toMatchObject({data:{id:'1',replayed:true,sideEffectsStatus:'held',requiresIdentityVerification:true}});
 expect(f.sqlite.prepare('SELECT metadata FROM followers WHERE id=1').get()?.metadata).toBe(before);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM follower_tags').get()?.n).toBe(0);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM follower_scenarios').get()?.n).toBe(0);expect(f.fetch).not.toHaveBeenCalled();
 expect(JSON.stringify(f.sqlite.prepare('SELECT * FROM form_submissions').all())).not.toContain(f.nonce);
});
it.each(['body','respondent','foreign','missing-key','short-key','inactive-form'])('does not reuse or create a different receipt for conflicting %s evidence',async mode=>{
 const f=await fixture();expect((await f.post()).status).toBe(201);
 if(mode==='inactive-form')f.sqlite.exec('UPDATE forms SET is_active=0');
 const res=await f.post(mode==='body'?{hope:'面接'}:{hope:'見学'},mode==='respondent'?'3':mode==='foreign'?'2':'1',mode==='missing-key'?'':mode==='short-key'?'short':f.nonce);
 expect([400,409]).toContain(res.status);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM form_submissions').get()?.n).toBe(1);expect(f.sqlite.prepare('SELECT submit_count FROM forms').get()?.submit_count).toBe(1);expect(f.fetch).not.toHaveBeenCalled();
});
it('separates form identities and never retries incomplete side effects on replay',async()=>{
 const f=await fixture();await f.post();const form2=await createForm(f.db,{name:'second',accountId:'a',fields:'[]'});
 expect((await f.post({hope:'見学'},'1',f.nonce,String(form2.id))).status).toBe(201);
 f.env.OUTBOUND_PREPARATION_LOCK='0';expect((await f.post()).status).toBe(200);expect(f.fetch).not.toHaveBeenCalled();
 expect(f.sqlite.prepare('SELECT COUNT(*) n FROM form_submissions').get()?.n).toBe(2);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM follower_tags').get()?.n).toBe(0);
});
it('reports unavailable receipt schema as unresolved, with zero submissions or side effects',async()=>{
 const f=await fixture();f.sqlite.exec('DROP INDEX idx_form_submission_request; ALTER TABLE form_submissions DROP COLUMN request_key');
 expect((await f.post()).status).toBe(409);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM form_submissions').get()?.n).toBe(0);expect(f.fetch).not.toHaveBeenCalled();
});
