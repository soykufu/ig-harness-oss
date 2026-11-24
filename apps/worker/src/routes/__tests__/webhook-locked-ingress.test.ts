import {afterEach,it,expect,vi} from 'vitest';
import {Hono} from 'hono';
import {webhook} from '../webhook.js';
import {testDatabase} from '../../test-utils/d1.js';
import type {Env} from '../../index.js';
const cleanup:Array<()=>void>=[];
afterEach(()=>{for(const close of cleanup.splice(0))close();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function fixture(){
 const f=await testDatabase();cleanup.push(()=>f.sqlite.close());
 f.sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',0,'2026-01-01','2026-01-01');INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
 const scheduler=vi.fn(()=>{throw Error('must not arm while locked');}),fetch=vi.fn(()=>{throw Error('must not send while locked');});vi.stubGlobal('fetch',fetch);
 const env={DB:f.db,IG_APP_SECRET:'test-only-signature-secret',OUTBOUND_PREPARATION_LOCK:'1',TENANT_SCHEDULER:{idFromName:scheduler}} as unknown as Env['Bindings'];
 const app=new Hono<Env>();app.route('/',webhook);const pending:Promise<unknown>[]=[];
 const ctx={waitUntil:(p:Promise<unknown>)=>pending.push(p),passThroughOnException(){}} as unknown as ExecutionContext;
 const value={sender:{id:'new-person'},recipient:{id:'111'},timestamp:Date.now(),message:{mid:'stable-locked-mid',text:'guide'}};
 async function send(id='111',valid=true){
  const body=JSON.stringify({object:'instagram',entry:[{id,messaging:[value]}]});
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.IG_APP_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,'0')).join('');
  const response=await app.fetch(new Request('https://worker.example/webhook',{method:'POST',headers:{'X-Hub-Signature-256':'sha256='+(valid?signature:'0'.repeat(64))},body}),env,ctx);
  await Promise.all(pending.splice(0));return response;
 }
 return {...f,send,value,scheduler,fetch};
}
it('durably accepts a signed event once while keeping payload pending and no follower or scheduler work',async()=>{
 const f=await fixture();expect((await f.send()).status).toBe(200);const before=f.sqlite.prepare('SELECT * FROM webhook_events').get();
 expect(before).toMatchObject({account_id:'a',status:'pending',started_at:null,finished_at:null,payload:JSON.stringify(f.value)});
 expect((await f.send()).status).toBe(200);expect(f.sqlite.prepare('SELECT * FROM webhook_events').all()).toEqual([before]);
 expect(f.sqlite.prepare('SELECT COUNT(*) n FROM followers').get()?.n).toBe(0);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM active_mutations').get()?.n).toBe(0);
 expect(f.scheduler).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
});
it.each(['invalid-signature','foreign-account'])('does not ingest or send for %s',async mode=>{
 const f=await fixture();const r=await f.send(mode==='foreign-account'?'999':'111',mode!=='invalid-signature');expect(r.status).toBe(mode==='invalid-signature'?403:200);
 expect(f.sqlite.prepare('SELECT COUNT(*) n FROM webhook_events').get()?.n).toBe(0);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM followers').get()?.n).toBe(0);expect(f.scheduler).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
});
it('returns non-2xx if durable queue insertion fails instead of acknowledging lost data',async()=>{
 const f=await fixture();f.sqlite.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON webhook_events BEGIN SELECT RAISE(ABORT,'test durable failure');END");
 expect((await f.send()).status).toBeGreaterThanOrEqual(500);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM webhook_events').get()?.n).toBe(0);expect(f.scheduler).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
});
