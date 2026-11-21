import {InstagramClient} from '@ig-harness/ig-sdk';
import {recruitmentMessageLifecycle} from '../recruitment-message-lifecycle.js';
import {afterEach,it,expect,vi} from 'vitest';
import {testDatabase} from '../../test-utils/d1.js';
import {recruitmentSubjectHash} from '../recruitment-inbound-holds.js';
import {prepareHumanReplyContract,claimHumanReplyContract,assertHumanReplyContract,cancelHumanReplyReview,readHumanReplyStatus} from '../recruitment-human-reply.js';
const NOW=Date.parse('2026-11-21T06:00:00Z');const close:(()=>void)[]=[];
afterEach(()=>{while(close.length)close.pop()!();vi.unstubAllGlobals();});
async function fixture(){const f=await testDatabase();close.push(()=>f.sqlite.close());
 f.sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','111','test','2026-01-01','2026-01-01'); INSERT INTO staff_members(id,name,role,api_key,is_active) VALUES('owner','test','owner','test',1),('other','test','admin','other',1); INSERT INTO followers(id,igsid,account_id) VALUES(1,'student','a'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
 f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date(NOW-1000).toISOString());f.sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(NOW);
 const subject=await recruitmentSubjectHash('a','student');
 const add=(key:string,state:string,at=NOW-1000)=>f.sqlite.prepare('INSERT INTO recruitment_inbound_holds VALUES(?,?,?,?,?,?)').run('a',key,subject,state,at,Math.max(at,NOW));
 add('old-stop','stopped',NOW-2000);add('question','consulting');
 const input={accountId:'a',followerId:1,actorId:'owner',nonce:'reviewed-action-123456',text:'ご質問への回答です'};
 return{...f,input,add};}
it('cancels a prepared review while paused, preserves its key and prevents old preparation or claim forever',async()=>{
 const {db,sqlite,input}=await fixture();await prepareHumanReplyContract(db,input,true,NOW);
 sqlite.exec("UPDATE integration_settings SET value='1'");await cancelHumanReplyReview(db,'a',1,'owner',input.nonce);
 expect(await readHumanReplyStatus(db,'a',1,'owner',input.nonce)).toMatchObject({canceled:true,mayCreateNewDraft:true,mayRetry:false,automaticDeliveryResumed:false});
 sqlite.exec("UPDATE integration_settings SET value='0'");await expect(claimHumanReplyContract(db,input,true,NOW)).rejects.toThrow();await expect(prepareHumanReplyContract(db,input,true,NOW)).rejects.toThrow();
 expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_human_reply_contracts').get()?.n).toBe(1);expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_inbound_holds').get()?.n).toBe(2);
 await cancelHumanReplyReview(db,'a',1,'owner',input.nonce); // Same monotonic tombstone, no new permission.
});
it('settles concurrent cancellation and claim to exactly one winner',async()=>{
 const {db,sqlite,input}=await fixture();await prepareHumanReplyContract(db,input,true,NOW);
 const results=await Promise.allSettled([claimHumanReplyContract(db,input,true,NOW),cancelHumanReplyReview(db,'a',1,'owner',input.nonce)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const row=sqlite.prepare('SELECT status,created_at_ms,expires_at_ms FROM recruitment_human_reply_contracts').get();
 if(row?.status==='claimed')expect(row.expires_at_ms).toBe(NOW+60000);else expect(row?.expires_at_ms).toBe(row?.created_at_ms);
});
it.each(['claimed','sent','uncertain','actor','account','follower','inactive','staff','deletion','ledger-slot'])( 'refuses cancellation when %s is not safely unclaimed',async mode=>{
 const {db,sqlite,input}=await fixture();const key=await prepareHumanReplyContract(db,input,true,NOW);
 if(['claimed','sent','uncertain'].includes(mode))sqlite.prepare('UPDATE recruitment_human_reply_contracts SET status=?').run(mode);
 if(mode==='inactive')sqlite.exec('UPDATE staff_members SET is_active=0');if(mode==='staff')sqlite.exec("UPDATE staff_members SET role='staff'");
 if(mode==='deletion')sqlite.exec("INSERT INTO data_deletion_locks(account_id,request_code) VALUES('a','test')");
 if(mode==='ledger-slot')sqlite.prepare("INSERT INTO recruitment_outbound_operations(account_id,operation_key,owner_epoch,state,reserved_at_ms) VALUES('a',?,'epoch','uncertain',?)").run(key+':1',NOW);
 await expect(cancelHumanReplyReview(db,mode==='account'?'b':'a',mode==='follower'?2:1,mode==='actor'?'other':'owner',input.nonce)).rejects.toThrow();
 expect(sqlite.prepare('SELECT expires_at_ms FROM recruitment_human_reply_contracts').get()?.expires_at_ms).toBe(NOW+60000);
});
it('does not confuse expiry, missing rows or anomalous delivery slots with cancellation proof',async()=>{
 const {db,sqlite,input}=await fixture();expect(await readHumanReplyStatus(db,'a',1,'owner',input.nonce)).toBeNull();
 const key=await prepareHumanReplyContract(db,input,true,NOW);sqlite.prepare('UPDATE recruitment_human_reply_contracts SET created_at_ms=?,expires_at_ms=?').run(NOW-120000,NOW-60000);expect(await readHumanReplyStatus(db,'a',1,'owner',input.nonce)).toMatchObject({canceled:false,mayCreateNewDraft:false});
 await cancelHumanReplyReview(db,'a',1,'owner',input.nonce);
 sqlite.prepare("INSERT INTO recruitment_outbound_operations(account_id,operation_key,owner_epoch,state,reserved_at_ms) VALUES('a',?,'epoch','uncertain',?)").run(key+':1',NOW);
 expect(await readHumanReplyStatus(db,'a',1,'owner',input.nonce)).toMatchObject({canceled:false,mayCreateNewDraft:false});
});
it('prepares and consumes one reviewed reply without clearing old stop or granting automatic delivery',async()=>{
 const {db,sqlite,input}=await fixture();const key=await prepareHumanReplyContract(db,input,true,NOW);expect(key).toMatch(/^human:[a-f0-9]{64}$/);
 await claimHumanReplyContract(db,input,true,NOW);await assertHumanReplyContract(db,input,key,true,NOW);
 await expect(claimHumanReplyContract(db,input,true,NOW)).rejects.toThrow();await expect(prepareHumanReplyContract(db,input,true,NOW)).rejects.toThrow();
 expect(sqlite.prepare("SELECT COUNT(*) n FROM recruitment_inbound_holds WHERE state='stopped'").get()?.n).toBe(1);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_outbound_operations').get()?.n).toBe(0);expect(sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()?.n).toBe(0);
 const record=JSON.stringify(sqlite.prepare('SELECT * FROM recruitment_human_reply_contracts').all());expect(record).not.toContain(input.text);expect(record).not.toContain(input.nonce);
});
it.each(['disabled','staff','inactive','foreign','standby','no-inbound','latest-stop','latest-decline','latest-unknown','timestamp-future'])( 'holds preparation when %s',async mode=>{
 const {db,sqlite,input,add}=await fixture();
 if(mode==='staff')sqlite.exec("UPDATE staff_members SET role='staff'");if(mode==='inactive')sqlite.exec('UPDATE staff_members SET is_active=0');if(mode==='foreign')input.accountId='foreign';
 if(mode==='standby')sqlite.exec("UPDATE followers SET messaging_owner='standby'");if(mode==='no-inbound')sqlite.exec('DELETE FROM recruitment_inbound_holds');
 if(mode==='latest-stop')add('latest','stopped',NOW);if(mode==='latest-decline')add('latest','declined',NOW);if(mode==='latest-unknown')add('latest','hold',NOW);if(mode==='timestamp-future')add('latest','consulting',NOW+1);
 await expect(prepareHumanReplyContract(db,input,mode!=='disabled',NOW)).rejects.toThrow();expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_human_reply_contracts').get()?.n).toBe(0);
});
it.each(['body','actor','new-event','same-time-event','owner','role','expired','paused'])( 'rejects %s changed after review',async mode=>{
 const {db,sqlite,input,add}=await fixture();const key=await prepareHumanReplyContract(db,input,true,NOW);
 if(mode==='body')input.text='changed';if(mode==='actor')input.actorId='other';if(mode==='new-event')add('new','stopped',NOW);if(mode==='same-time-event')add('new','consulting');if(mode==='owner')sqlite.exec("UPDATE recruitment_outbound_control SET owner_epoch='changed'");if(mode==='role')sqlite.exec("UPDATE staff_members SET role='staff' WHERE id='owner'");if(mode==='paused')sqlite.exec("UPDATE integration_settings SET value='1'");
 await expect(claimHumanReplyContract(db,input,true,mode==='expired'?NOW+60000:NOW)).rejects.toThrow();
 expect(sqlite.prepare('SELECT status FROM recruitment_human_reply_contracts').get()?.status).toBe('prepared');
 await expect(assertHumanReplyContract(db,input,key,true,NOW)).rejects.toThrow();
});
it('rechecks a new event after claim and retains the stop history',async()=>{
 const {db,input,add}=await fixture();const key=await prepareHumanReplyContract(db,input,true,NOW);await claimHumanReplyContract(db,input,true,NOW);add('another','consulting',NOW);
 await expect(assertHumanReplyContract(db,input,key,true,NOW)).rejects.toThrow();
});

it('only one concurrent claim can consume a reviewed action',async()=>{
 const {db,input}=await fixture();await prepareHumanReplyContract(db,input,true,NOW);
 const results=await Promise.allSettled(Array.from({length:8},()=>claimHumanReplyContract(db,input,true,NOW)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
});
it.each(['paused','revoked','new-stop','deleted','owner-change'])('rejects final validation after %s',async mode=>{
 const {db,sqlite,input,add}=await fixture();const key=await prepareHumanReplyContract(db,input,true,NOW);await claimHumanReplyContract(db,input,true,NOW);
 if(mode==='paused')sqlite.exec("UPDATE integration_settings SET value='1'");if(mode==='revoked')sqlite.exec("UPDATE staff_members SET is_active=0");if(mode==='new-stop')add('stop-now','stopped',NOW);if(mode==='deleted')sqlite.exec('DELETE FROM followers');if(mode==='owner-change')sqlite.exec("UPDATE recruitment_outbound_control SET owner='legacy'");
 await expect(assertHumanReplyContract(db,input,key,true,NOW)).rejects.toThrow();
});

it.each(['valid','new-stop','new-consult','actor-revoked','changed-text','other-recipient','image','second-block'])( 'enforces the reviewed contract at the real SDK boundary: %s',async mode=>{
 const {db,sqlite,input,add}=await fixture();const key=await prepareHumanReplyContract(db,input,true,NOW);await claimHumanReplyContract(db,input,true,NOW);
 const fetch=vi.fn(async()=>new Response(JSON.stringify({message_id:'one',recipient_id:'student'})));vi.stubGlobal('fetch',fetch);
 const client=new InstagramClient({accessToken:'test',igUserId:'111',messageLifecycle:recruitmentMessageLifecycle(db,'a',{key,ownerEpoch:'epoch',humanReply:input},async()=>{},()=>NOW),transformMessage:async(_id,message)=>{
  if(mode==='new-stop')add('new','stopped',NOW);if(mode==='new-consult')add('new','consulting',NOW);if(mode==='actor-revoked')sqlite.exec("UPDATE staff_members SET is_active=0");return message;
 }});
 const send=mode==='image'?client.sendImage('student','https://example.com/a.jpg'):mode==='second-block'?client.sendRichMessage('student',[{type:'text',text:input.text},{type:'text',text:input.text}]):client.sendText(mode==='other-recipient'?'foreign':'student',mode==='changed-text'?'changed':input.text);
 if(mode==='valid')await send;else await expect(send).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(['valid','second-block'].includes(mode)?1:0);
 expect(sqlite.prepare("SELECT COUNT(*) n FROM recruitment_inbound_holds WHERE state='stopped'").get()?.n).toBeGreaterThan(0);
});
