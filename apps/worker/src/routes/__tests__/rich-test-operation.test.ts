import {afterEach,it,expect,vi} from 'vitest';
import {Hono} from 'hono';
import {createRichMessage} from '@ig-harness/db';
import type {Env} from '../../index.js';
import {richMessages} from '../rich-messages.js';
import {testDatabase} from '../../test-utils/d1.js';
const NOW=Date.parse('2026-11-21T06:00:00Z'),close:(()=>void)[]=[];
afterEach(()=>{while(close.length)close.pop()!();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function fixture(){vi.spyOn(Date,'now').mockReturnValue(NOW);const f=await testDatabase();close.push(()=>f.sqlite.close());
 f.sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01'),('b','222','test',0,'2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,account_id) VALUES(1,'student','a'); INSERT INTO staff_members(id,name,role,api_key) VALUES('owner','test','owner','test'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
 f.sqlite.prepare('UPDATE followers SET last_inbound_at=?,metadata=?').run(new Date(NOW-1000).toISOString(),JSON.stringify({recruitment_delivery:{state:'active',owner_epoch:'epoch',observed_at_ms:NOW,valid_until_ms:NOW+300000}}));f.sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(NOW);
 const rich=await createRichMessage(f.db,{name:'test',kind:'generic',blocks:[{type:'text',text:'hello'},{type:'text',text:'next'}],accountId:'a'});
 let role='owner';const app=new Hono<Env>().use('*',async(c,next)=>{c.set('staff',{id:'owner',name:'test',role} as never);await next();}).route('/',richMessages);
 const env={DB:f.db,RECRUITMENT_LEDGER_ENFORCEMENT:'1',OUTBOUND_PREPARATION_LOCK:'0'};
 const fetch=vi.fn(async()=>new Response(JSON.stringify({message_id:'m'+fetch.mock.calls.length,recipient_id:'student'})));vi.stubGlobal('fetch',fetch);
 const post=(nonce='same-rich-action-123456',params:Record<string,unknown>={to_igsid:'student'},account='a')=>app.fetch(new Request(`https://test.invalid/api/rich-messages/${rich.id}/test-send?account_id=${account}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':nonce},body:JSON.stringify(params)}),env);
 return{...f,fetch,post,rich,env,setRole:(r:string)=>{role=r;}};}
it('uses one durable action and two slots for concurrent taps, with no duplicate send on replay',async()=>{
 const f=await fixture();const responses=await Promise.all(Array.from({length:10},()=>f.post()));expect(responses.every(r=>[200,409].includes(r.status))).toBe(true);
 expect(f.fetch).toHaveBeenCalledTimes(2);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM recruitment_manual_intents').get()?.n).toBe(1);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM recruitment_outbound_operations').get()?.n).toBe(2);
 const replay=await f.post();expect(replay.status).toBe(200);expect(await replay.json()).toMatchObject({data:{replayed:true,sent_blocks:2,recipientReceipt:'unknown'}});expect(f.fetch).toHaveBeenCalledTimes(2);
});
it.each(['role','db-role','inactive','nonce','template-precondition','foreign-template','unowned-template','bad-context','paused','preparation-lock','standby','expired','timeout','wrong-ack','changed-template','missing-slot'])( 'holds rich test operation for %s evidence',async mode=>{
 const f=await fixture();
 if(mode==='role')f.setRole('staff');if(mode==='db-role')f.sqlite.exec("UPDATE staff_members SET role='staff'");if(mode==='inactive')f.sqlite.exec('UPDATE staff_members SET is_active=0');
 if(mode==='unowned-template')f.sqlite.exec('UPDATE rich_messages SET account_id=NULL');
 if(mode==='foreign-template')f.sqlite.exec("UPDATE rich_messages SET account_id='b'");if(mode==='paused')f.sqlite.exec("UPDATE integration_settings SET value='1'");if(mode==='preparation-lock')f.env.OUTBOUND_PREPARATION_LOCK='1';
 if(mode==='standby')f.sqlite.exec("UPDATE followers SET messaging_owner='standby'");if(mode==='expired')f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date(NOW-86400001).toISOString());
 if(mode==='timeout')f.fetch.mockRejectedValue(new Error('timeout'));if(mode==='wrong-ack')f.fetch.mockResolvedValue(new Response(JSON.stringify({message_id:'wrong',recipient_id:'foreign'})));
 if(mode==='changed-template')f.fetch.mockImplementation(async()=>{f.sqlite.prepare('UPDATE rich_messages SET blocks=?').run(JSON.stringify([{type:'text',text:'changed'},{type:'text',text:'changed2'}]));return new Response(JSON.stringify({message_id:'first',recipient_id:'student'}));});
 if(mode==='missing-slot'){expect((await f.post()).status).toBe(200);f.sqlite.exec("DELETE FROM recruitment_outbound_operations WHERE operation_key LIKE '%:1'");}
 const res=await f.post(mode==='nonce'?'':undefined,mode==='template-precondition'?{to_igsid:'student',template_version:'0'.repeat(64)}:mode==='bad-context'?{to_igsid:'student',reward_url:{url:'wrong'}}:undefined);expect(res.status).not.toBe(200);
 const expected=['timeout','wrong-ack','changed-template'].includes(mode)?1:mode==='missing-slot'?2:0;expect(f.fetch).toHaveBeenCalledTimes(expected);
 const count=f.fetch.mock.calls.length;expect((await f.post(mode==='nonce'?'':undefined,mode==='template-precondition'?{to_igsid:'student',template_version:'0'.repeat(64)}:mode==='bad-context'?{to_igsid:'student',reward_url:{url:'wrong'}}:undefined)).status).not.toBe(200);expect(f.fetch).toHaveBeenCalledTimes(count);
});
