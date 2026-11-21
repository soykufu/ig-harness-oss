import {afterEach,it,expect,vi} from 'vitest';
import {createRichMessage} from '@ig-harness/db';
import {gateFixture} from '../../test-utils/gate-fixture.js';
import {handleFollowCheckPostback} from '../engagement-gate.js';
import {recruitmentJobClientFactory} from '../../lib/accounts.js';
import {queueWebhookEvents} from '../webhook-queue.js';
import {recruitmentSubjectHash} from '../recruitment-inbound-holds.js';
const NOW=Date.parse('2026-11-21T06:00:00Z'),close:(()=>void)[]=[];
afterEach(()=>{while(close.length)close.pop()!();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
async function fixture(follow=true,rich=false){
 vi.useFakeTimers();vi.setSystemTime(NOW);const f=await gateFixture();close.push(()=>f.sqlite.close());f.addGate('g',{require_follow:follow?0:1,reward_dm_text:'Reward $& {IGSID}'});
 if(rich){const r=await createRichMessage(f.db,{name:'test',kind:'reward',blocks:[{type:'text',text:'one'},{type:'text',text:'two'}],accountId:'a'});f.sqlite.prepare('UPDATE engagement_gates SET reward_dm_rich_message_id=?').run(r.id);}
 f.sqlite.prepare('UPDATE followers SET last_inbound_at=?,metadata=?').run(new Date(NOW-1000).toISOString(),JSON.stringify({recruitment_delivery:{state:'active',owner_epoch:'epoch',observed_at_ms:NOW,valid_until_ms:NOW+300000}}));f.sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(NOW);f.sqlite.exec("INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0');INSERT INTO gate_deliveries(id,gate_id,follower_id,igsid,status) VALUES('d','g',1,'user-1','cta_sent')");
 const addEvent=async(mid='first')=>{await queueWebhookEvents(f.db,'a',[{kind:'messaging',value:{sender:{id:'user-1'},timestamp:NOW,postback:{mid,payload:'CHECK_FOLLOW:g:d'}}}]);const e=f.sqlite.prepare("SELECT event_key FROM webhook_events WHERE json_extract(payload,'$.postback.mid')=?").get(mid)!;f.sqlite.prepare("UPDATE webhook_events SET status='processing',started_at=? WHERE event_key=?").run(new Date(NOW).toISOString(),e.event_key);return String(e.event_key);};
 const eventKey=await addEvent();const account=await f.db.prepare("SELECT * FROM ig_accounts WHERE id='a'").first<any>();const factory=recruitmentJobClientFactory({IG_USER_ID:'',IG_ACCESS_TOKEN:'',IG_REQUIRE_APPSECRET_PROOF:'true',IG_APP_SECRET:'test-secret',RECRUITMENT_LEDGER_ENFORCEMENT:'1',OUTBOUND_PREPARATION_LOCK:'0'},f.db,account)!;
 const fetch=vi.fn(async()=>new Response(JSON.stringify({recipient_id:'user-1',message_id:'mid-'+fetch.mock.calls.length})));vi.stubGlobal('fetch',fetch);f.client.getUserProfile.mockResolvedValue({username:'p',name:'p',is_user_follow_business:follow});
 const run=(make=factory,key=eventKey)=>handleFollowCheckPostback(f.db,f.client as any,{gateId:'g',deliveryId:'d',igsid:'user-1',accountId:'a',eventKey:key,clientFactory:make});return{...f,factory,fetch,run,eventKey,addEvent};
}
it.each([false,true])('claims a reward once for concurrent/replayed postbacks (rich=%s)',async rich=>{
 const f=await fixture(true,rich);await Promise.all(Array.from({length:12},()=>f.run()));await f.run();expect(f.fetch).toHaveBeenCalledTimes(rich?2:1);expect(f.sqlite.prepare('SELECT operation_key,state FROM recruitment_gate_operations').all()).toEqual([{operation_key:'gate-reward:d',state:'sent'}]);expect(f.sqlite.prepare('SELECT status FROM gate_deliveries').get()?.status).toBe('delivered');
});
it('one reminder per event and phase, with a new real click advancing the next loop',async()=>{
 const f=await fixture(false);await Promise.all(Array.from({length:8},()=>f.run()));await f.run();expect(f.fetch).toHaveBeenCalledOnce();expect(f.sqlite.prepare('SELECT status,loop_count FROM gate_deliveries').get()).toMatchObject({status:'pending_follow',loop_count:1});
 await f.run(f.factory,await f.addEvent('second'));expect(f.fetch).toHaveBeenCalledTimes(2);expect(f.sqlite.prepare('SELECT operation_key FROM recruitment_gate_operations ORDER BY operation_key').all()).toEqual([{operation_key:'gate-reminder:d:0'},{operation_key:'gate-reminder:d:1'}]);
});
it.each(['no-event','wrong-account','wrong-subject','wrong-payload','unclaimed-event','expired-event','unsigned-key'])('requires stored verified inbound evidence: %s',async mode=>{
 const f=await fixture();if(mode==='no-event')f.sqlite.exec('DELETE FROM webhook_events');if(mode==='wrong-account')f.sqlite.exec("UPDATE webhook_events SET account_id='other'");if(mode==='wrong-subject')f.sqlite.exec("UPDATE webhook_events SET subject_id='other'");if(mode==='wrong-payload')f.sqlite.exec("UPDATE webhook_events SET payload='{}'");if(mode==='unclaimed-event')f.sqlite.exec("UPDATE webhook_events SET status='pending'");if(mode==='expired-event')f.sqlite.prepare('UPDATE webhook_events SET started_at=?').run(new Date(NOW-60001).toISOString());
 await expect(f.run(f.factory,mode==='unsigned-key'?'arbitrary':f.eventKey)).rejects.toThrow();expect(f.fetch).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT COUNT(*) n FROM recruitment_gate_operations').get()?.n).toBe(0);
});
it.each(['paused','reward-edit','template-edit','scope','dropped','loop-changed','event-completed','event-edited','pause','owner','business-stop','new-consultation','expired-window','payload-edit','pause-during-sign'])('rechecks %s at actual SDK delivery',async mode=>{
 const f=await fixture(true,true);const mutate=async(proof:any)=>{
 if(mode==='paused')f.sqlite.exec("UPDATE engagement_gates SET status='paused'");if(mode==='reward-edit')f.sqlite.exec("UPDATE engagement_gates SET reward_dm_text='edited'");if(mode==='template-edit')f.sqlite.exec("UPDATE rich_messages SET blocks='[]'");if(mode==='scope')f.sqlite.exec('UPDATE engagement_gates SET account_id=NULL');if(mode==='dropped')f.sqlite.exec("UPDATE gate_deliveries SET status='dropped'");if(mode==='loop-changed')f.sqlite.exec('UPDATE gate_deliveries SET loop_count=1');if(mode==='event-completed')f.sqlite.exec("UPDATE webhook_events SET status='completed'");if(mode==='event-edited')f.sqlite.exec("UPDATE webhook_events SET payload='{}'");if(mode==='pause'||mode==='pause-during-sign')f.sqlite.exec("UPDATE integration_settings SET value='1'");if(mode==='owner')f.sqlite.exec("UPDATE recruitment_outbound_control SET owner='legacy'");if(mode==='business-stop')f.sqlite.exec("UPDATE followers SET metadata='{\"recruitment_delivery\":{\"state\":\"stopped\"}}'");if(mode==='new-consultation')f.sqlite.prepare("INSERT INTO recruitment_inbound_holds VALUES('a','consult',?,'consulting',?,?)").run(await recruitmentSubjectHash('a','user-1'),NOW,NOW);if(mode==='expired-window')f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date(NOW-86400001).toISOString());if(mode==='payload-edit')proof.messages[0]={text:'other'};
 };
 const make:typeof f.factory=async(key,v,subject,followup,proof)=>{if(mode==='pause-during-sign'){const sign=crypto.subtle.sign.bind(crypto.subtle);vi.spyOn(crypto.subtle,'sign').mockImplementation(async(...args)=>{const result=await sign(...args);await mutate(proof);return result;});}else await mutate(proof);return f.factory(key,v,subject,followup,proof);};
 await expect(f.run(make)).rejects.toThrow();expect(f.fetch).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT state FROM recruitment_gate_operations').get()?.state).toBe('uncertain');
});
it.each(['missing-ack','second-block','journal-failed','paused-after-ack'])('does not mark a reward delivered after %s',async mode=>{
 const f=await fixture(true,mode==='second-block');if(mode==='journal-failed')f.sqlite.exec("CREATE TRIGGER fail_gate_receipt BEFORE UPDATE ON recruitment_gate_operations WHEN NEW.state='sent' BEGIN SELECT RAISE(ABORT,'journal failure'); END");f.fetch.mockImplementation(async()=>{if(mode==='paused-after-ack')f.sqlite.exec("UPDATE engagement_gates SET status='paused'");if(mode==='second-block'&&f.fetch.mock.calls.length===1)f.sqlite.exec("UPDATE rich_messages SET blocks='[]'");return new Response(JSON.stringify(mode==='missing-ack'?{}:{recipient_id:'user-1',message_id:'ack'}));});
 await expect(f.run()).rejects.toThrow();expect(f.fetch).toHaveBeenCalledOnce();expect(f.sqlite.prepare('SELECT status,end_reason,next_followup_at FROM gate_deliveries').get()).toMatchObject({status:'cta_sent',end_reason:'outcome_unknown',next_followup_at:null});await f.run();expect(f.fetch).toHaveBeenCalledOnce();
});
it('does not use an absent follow boolean as proof to send a reminder',async()=>{
 const f=await fixture(false);f.client.getUserProfile.mockResolvedValue({username:'p',name:'p'} as any);await expect(f.run()).rejects.toThrow('could not be verified');expect(f.fetch).not.toHaveBeenCalled();
});
it('honors max loops with a skipped receipt and zero messages',async()=>{
 const f=await fixture(false);f.sqlite.exec('UPDATE engagement_gates SET max_loops=1;UPDATE gate_deliveries SET loop_count=1');await f.run();expect(f.fetch).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT state FROM recruitment_gate_operations').get()?.state).toBe('skipped');expect(f.sqlite.prepare('SELECT status FROM gate_deliveries').get()?.status).toBe('dropped');
});
it('never creates a LINE link or falls back for an unverified connection',async()=>{
 const f=await fixture();f.sqlite.exec("UPDATE engagement_gates SET line_connection_id='unverified'");await expect(f.run()).rejects.toThrow('handoff');expect(f.fetch).not.toHaveBeenCalled();
});
