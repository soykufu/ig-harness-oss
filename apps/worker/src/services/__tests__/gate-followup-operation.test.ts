import {afterEach,it,expect,vi} from 'vitest';
import {gateFixture} from '../../test-utils/gate-fixture.js';
import {processFollowupDrip} from '../engagement-gate.js';
import {recruitmentJobClientFactory} from '../../lib/accounts.js';
import {reserveRecruitmentOutbound} from '../recruitment-outbound-ledger.js';
import {recruitmentSubjectHash} from '../recruitment-inbound-holds.js';
const NOW=Date.parse('2026-11-21T06:00:00Z');const close:(()=>void)[]=[];
afterEach(()=>{while(close.length)close.pop()!();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
async function fixture(image=false,button=false){
 vi.useFakeTimers();vi.setSystemTime(NOW);const f=await gateFixture();close.push(()=>f.sqlite.close());
 f.addGate('g',{followup_dm_sequence:JSON.stringify([{text:'follow $& {IGSID} {REWARD_URL}',delay_minutes:1,...image?{image_url:'https://example.com/photo.jpg'}:{},...button?{button_label:'guide',button_url:'https://example.com/guide'}:{}}])});
 f.sqlite.prepare('UPDATE followers SET last_inbound_at=?,metadata=?').run(new Date(NOW-1000).toISOString(),JSON.stringify({recruitment_delivery:{state:'active',owner_epoch:'epoch',observed_at_ms:NOW,valid_until_ms:NOW+300000}}));
 f.sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(NOW);f.sqlite.exec("INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
 f.sqlite.prepare("INSERT INTO gate_deliveries(id,gate_id,follower_id,igsid,status,delivered_at,next_followup_at) VALUES('d','g',1,'user-1','delivered',?,?)").run(new Date(NOW-10000).toISOString(),new Date(NOW-1000).toISOString());
 const account=await f.db.prepare("SELECT * FROM ig_accounts WHERE id='a'").first<any>();
 const factory=recruitmentJobClientFactory({IG_USER_ID:'',IG_ACCESS_TOKEN:'',IG_REQUIRE_APPSECRET_PROOF:'true',IG_APP_SECRET:'test-secret',RECRUITMENT_LEDGER_ENFORCEMENT:'1',OUTBOUND_PREPARATION_LOCK:'0'},f.db,account)!;
 let n=0;const fetch=vi.fn(async()=>new Response(JSON.stringify({recipient_id:'user-1',message_id:'mid-'+ ++n})));vi.stubGlobal('fetch',fetch);
 const run=(make=factory)=>processFollowupDrip(f.db,f.client as any,undefined,50,undefined,'a',make);
 return{...f,factory,fetch,run};
}
it.each([[false,false],[true,false],[false,true],[true,true]])('uses the stable delivery/step identity with image=%s button=%s',async(image,button)=>{
 const f=await fixture(image,button);expect(await f.run()).toEqual({sent:1,skipped:0});expect(await f.run()).toEqual({sent:0,skipped:0});expect(f.fetch).toHaveBeenCalledTimes(image?2:1);
 const rows=f.sqlite.prepare('SELECT operation_key,state FROM recruitment_outbound_operations ORDER BY operation_key').all();expect(rows.map(r=>r.operation_key)).toEqual(image?['gate-followup:d:0:0','gate-followup:d:0:1']:['gate-followup:d:0:0']);expect(rows.every(r=>r.state==='sent')).toBe(true);
 const body=JSON.parse(String((f.fetch.mock.calls.at(-1) as any)[1].body));expect(JSON.stringify(body)).toContain('follow $& user-1');expect(f.client.sendText).not.toHaveBeenCalled();
});
it('one of twelve competing cron processors claims the follow-up',async()=>{
 const f=await fixture();const result=await Promise.all(Array.from({length:12},()=>f.run()));expect(result.reduce((sum,r)=>sum+r.sent,0)).toBe(1);expect(f.fetch).toHaveBeenCalledOnce();
});
it.each(['paused','step-edit','reward-url-edit','scope','dropped','igsid','step-advanced','phase-edited','claim-expired','pause','business-stop','new-consultation','owner','deletion','payload-edited','last-inbound','pause-during-sign'])('rejects %s before the real Graph fetch',async mode=>{
 const f=await fixture();const change=async(proof:any)=>{
  if(mode==='paused')f.sqlite.exec("UPDATE engagement_gates SET status='paused'");if(mode==='step-edit')f.sqlite.exec("UPDATE engagement_gates SET followup_dm_sequence='[]'");if(mode==='reward-url-edit')f.sqlite.exec("UPDATE engagement_gates SET reward_url='https://example.com/new'");if(mode==='scope')f.sqlite.exec("UPDATE engagement_gates SET account_id=NULL");if(mode==='dropped')f.sqlite.exec("UPDATE gate_deliveries SET status='dropped'");if(mode==='igsid')f.sqlite.exec("UPDATE gate_deliveries SET igsid='other'");if(mode==='step-advanced')f.sqlite.exec('UPDATE gate_deliveries SET followup_step_sent=1');if(mode==='phase-edited')f.sqlite.exec("UPDATE gate_deliveries SET end_reason='stopped'");if(mode==='claim-expired')f.sqlite.prepare("UPDATE gate_deliveries SET metadata=json_set(metadata,'$.recruitment_followup.claimed_at_ms',?)").run(NOW-60001);
  if(mode==='pause'||mode==='pause-during-sign')f.sqlite.exec("UPDATE integration_settings SET value='1'");if(mode==='business-stop')f.sqlite.exec("UPDATE followers SET metadata='{\"recruitment_delivery\":{\"state\":\"stopped\"}}'");if(mode==='new-consultation')f.sqlite.prepare("INSERT INTO recruitment_inbound_holds VALUES('a','new',?,'consulting',?,?)").run(await recruitmentSubjectHash('a','user-1'),NOW,NOW);if(mode==='owner')f.sqlite.exec("UPDATE recruitment_outbound_control SET owner='legacy'");if(mode==='deletion')f.sqlite.exec("INSERT INTO data_deletion_locks VALUES('a','delete')");if(mode==='payload-edited')proof.messages[0]={text:'changed'};if(mode==='last-inbound')f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date(NOW-86400001).toISOString());
 };
 const make:typeof f.factory=async(key,version,subject,proof)=>{if(mode==='pause-during-sign'){const sign=crypto.subtle.sign.bind(crypto.subtle);vi.spyOn(crypto.subtle,'sign').mockImplementation(async(...args)=>{const out=await sign(...args);await change(proof);return out;});}else await change(proof);return f.factory(key,version,subject,proof);};
 expect((await f.run(make)).sent).toBe(0);expect(f.fetch).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT followup_step_sent,next_followup_at FROM gate_deliveries').get()).toMatchObject({followup_step_sent:mode==='step-advanced'?1:0,next_followup_at:null});
});
it('stops the second block if the gate changes after the image acknowledgement',async()=>{
 const f=await fixture(true);f.fetch.mockImplementation(async()=>{f.sqlite.exec("UPDATE engagement_gates SET status='paused'");return new Response(JSON.stringify({recipient_id:'user-1',message_id:'image-mid'}));});
 expect((await f.run()).sent).toBe(0);expect(f.fetch).toHaveBeenCalledOnce();expect(f.sqlite.prepare('SELECT end_reason FROM gate_deliveries').get()?.end_reason).toBe('outcome_unknown');expect(await f.run()).toEqual({sent:0,skipped:0});
 expect(await reserveRecruitmentOutbound(f.db,{accountId:'a',operationKey:'manual:another',ownerEpoch:'epoch',nowMs:NOW,preparationLocked:false})).toBe(false);
});
it('holds missing acknowledgements without advancing, minting IDs or retrying',async()=>{
 const f=await fixture();f.fetch.mockImplementation(async()=>new Response('{}'));expect((await f.run()).sent).toBe(0);expect(f.fetch).toHaveBeenCalledOnce();expect(f.sqlite.prepare('SELECT state FROM recruitment_outbound_operations').get()?.state).toBe('uncertain');expect(f.sqlite.prepare('SELECT end_reason FROM gate_deliveries').get()?.end_reason).toBe('outcome_unknown');await f.run();expect(f.fetch).toHaveBeenCalledOnce();
});
it('does not create or fall back around an unverified LINE handoff in enforced mode',async()=>{
 const f=await fixture();f.sqlite.exec("UPDATE engagement_gates SET line_connection_id='unverified'");expect((await f.run()).sent).toBe(0);expect(f.fetch).not.toHaveBeenCalled();expect(f.client.sendText).not.toHaveBeenCalled();
});
it('cannot construct an operation client with a missing follow-up purpose',async()=>{
 const f=await fixture();await expect(f.factory('gate-followup:d:0','a'.repeat(64))).rejects.toThrow('purpose required');expect(f.fetch).not.toHaveBeenCalled();
});

it.each(['paused-after-ack','edited-after-ack','journal-failed'])('does not advance or schedule after %s',async mode=>{
 const f=await fixture();if(mode==='journal-failed')f.sqlite.exec("CREATE TRIGGER fail_followup_completion BEFORE UPDATE ON gate_deliveries WHEN NEW.followup_step_sent>OLD.followup_step_sent BEGIN SELECT RAISE(ABORT,'journal failure'); END");
 f.fetch.mockImplementation(async()=>{if(mode==='paused-after-ack')f.sqlite.exec("UPDATE engagement_gates SET status='paused'");if(mode==='edited-after-ack')f.sqlite.exec("UPDATE engagement_gates SET followup_dm_sequence='[]'");return new Response(JSON.stringify({recipient_id:'user-1',message_id:'ack'}));});
 expect((await f.run()).sent).toBe(0);expect(f.fetch).toHaveBeenCalledOnce();expect(f.sqlite.prepare('SELECT followup_step_sent,next_followup_at,end_reason FROM gate_deliveries').get()).toMatchObject({followup_step_sent:0,next_followup_at:null,end_reason:'outcome_unknown'});expect(f.sqlite.prepare('SELECT state FROM recruitment_outbound_operations').get()?.state).toBe('sent');await f.run();expect(f.fetch).toHaveBeenCalledOnce();
});
