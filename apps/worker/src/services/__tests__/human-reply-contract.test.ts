import {afterEach,it,expect} from 'vitest';
import {testDatabase} from '../../test-utils/d1.js';
import {recruitmentSubjectHash} from '../recruitment-inbound-holds.js';
import {prepareHumanReplyContract,claimHumanReplyContract,assertHumanReplyContract} from '../recruitment-human-reply.js';
const NOW=Date.parse('2026-11-21T06:00:00Z');const close:(()=>void)[]=[];
afterEach(()=>{while(close.length)close.pop()!();});
async function fixture(){const f=await testDatabase();close.push(()=>f.sqlite.close());
 f.sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','111','test','2026-01-01','2026-01-01'); INSERT INTO staff_members(id,name,role,api_key,is_active) VALUES('owner','test','owner','test',1),('other','test','admin','other',1); INSERT INTO followers(id,igsid,account_id) VALUES(1,'student','a'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
 f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date(NOW-1000).toISOString());f.sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(NOW);
 const subject=await recruitmentSubjectHash('a','student');
 const add=(key:string,state:string,at=NOW-1000)=>f.sqlite.prepare('INSERT INTO recruitment_inbound_holds VALUES(?,?,?,?,?,?)').run('a',key,subject,state,at,Math.max(at,NOW));
 add('old-stop','stopped',NOW-2000);add('question','consulting');
 const input={accountId:'a',followerId:1,actorId:'owner',nonce:'reviewed-action-123456',text:'ご質問への回答です'};
 return{...f,input,add};}
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
