import {afterEach,it,expect,vi} from 'vitest';
import {Hono} from 'hono';
import {friends} from '../friends.js';
import {forms} from '../forms.js';
import {testDatabase} from '../../test-utils/d1.js';
const close:(()=>void)[]=[];afterEach(()=>{while(close.length)close.pop()!();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function fixture(){
 const f=await testDatabase();close.push(()=>f.sqlite.close());
 f.sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01'),('b','222','test',0,'2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,account_id) VALUES(1,'student','a'),(2,'foreign','b'); INSERT INTO forms(id,name,fields,account_id) VALUES(1,'survey','[]','a'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1')");
 const metadata=JSON.stringify({recruitment_delivery:{state:'declined',owner_epoch:'epoch',observed_at_ms:1,valid_until_ms:2},note:'keep'});f.sqlite.prepare('UPDATE followers SET metadata=?').run(metadata);
 const app=new Hono().route('/',friends).route('/',forms),fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const update=(body:unknown,id=1)=>app.fetch(new Request(`https://test.invalid/api/friends/${id}/metadata?account_id=a`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{DB:f.db});
 const submit=(body:unknown)=>app.fetch(new Request('https://test.invalid/api/forms/1/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{DB:f.db});
 return{...f,metadata,fetch,update,submit};
}
it.each([null,[],{recruitment_delivery:{state:'active',owner_epoch:'epoch',observed_at_ms:999999,valid_until_ms:9999999}},{recruitment_delivery:null}])('rejects protected or non-object generic metadata without writing: %j',async body=>{
 const f=await fixture();const n=f.sqlite.prepare('SELECT total_changes() n').get()?.n;
 expect((await f.update(body)).status).toBe(400);expect(f.sqlite.prepare('SELECT metadata FROM followers WHERE id=1').get()?.metadata).toBe(f.metadata);expect(f.sqlite.prepare('SELECT total_changes() n').get()?.n).toBe(n);expect(f.fetch).not.toHaveBeenCalled();
});
it('allows ordinary fields and null values while preserving the delivery evidence',async()=>{
 const f=await fixture();expect((await f.update({note:'updated',preference:null})).status).toBe(200);
 expect(JSON.parse(String(f.sqlite.prepare('SELECT metadata FROM followers WHERE id=1').get()?.metadata))).toEqual({...JSON.parse(f.metadata),note:'updated',preference:null});
 expect((await f.update({note:'foreign'},2)).status).toBe(404);expect(f.fetch).not.toHaveBeenCalled();
});
it('refuses stale metadata writes after another worker changes delivery evidence',async()=>{
 const f=await fixture();const original=f.db.prepare.bind(f.db);let changed=false;
 vi.spyOn(f.db,'prepare').mockImplementation((sql:string)=>{if(sql.startsWith('UPDATE followers SET metadata')&&!changed){changed=true;f.sqlite.prepare('UPDATE followers SET metadata=? WHERE id=1').run(JSON.stringify({recruitment_delivery:{state:'stopped'},note:'newer'}));}return original(sql);});
 expect((await f.update({note:'stale'})).status).toBe(409);
 expect(JSON.parse(String(f.sqlite.prepare('SELECT metadata FROM followers WHERE id=1').get()?.metadata))).toEqual({recruitment_delivery:{state:'stopped'},note:'newer'});
});
it.each([{data:{recruitment_delivery:{state:'active'}}},{data:[]},{data:'bad'},{friendId:'2',data:{}},{lineUserId:'foreign',data:{}},{friendId:'1',lineUserId:'foreign',data:{}},{friendId:'999',data:{}}])('rejects untrusted form control data and cross-account identity before submission or side effects: %j',async body=>{
 const f=await fixture();const n=f.sqlite.prepare('SELECT total_changes() n').get()?.n;
 expect((await f.submit(body)).status).toBe(400);expect(f.sqlite.prepare('SELECT total_changes() n').get()?.n).toBe(n);
 expect(f.sqlite.prepare('SELECT COUNT(*) n FROM form_submissions').get()?.n).toBe(0);expect(f.fetch).not.toHaveBeenCalled();
});
it('does not use a default account to adopt an unowned public form',async()=>{
 const f=await fixture();f.sqlite.exec('UPDATE forms SET account_id=NULL');expect((await f.submit({friendId:'1',data:{note:'x'}})).status).toBe(400);expect(f.fetch).not.toHaveBeenCalled();
});
