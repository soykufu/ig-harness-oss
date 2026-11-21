import {beforeEach,afterEach,it,expect,vi} from 'vitest';
// Keep delivery-path tests inside the allowed JST window regardless of runner time.
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-21T03:00:00Z'));});
import {testDatabase} from '../../test-utils/d1.js';
import {processSingleDelivery} from '../step-delivery.js';
const close:(()=>void)[]=[];
afterEach(()=>{while(close.length)close.pop()!();vi.useRealTimers();});
async function fixture(){
 const f=await testDatabase();close.push(()=>f.sqlite.close());
 f.sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','111','test','2026-01-01','2026-01-01'); INSERT INTO scenarios(id,name,trigger_type,account_id) VALUES(1,'test','manual','a'); INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,body) VALUES(1,1,1,0,'text','{\"text\":\"test\"}'); INSERT INTO followers(id,igsid,account_id) VALUES(1,'student','a')");
 const now=new Date().toISOString();f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(now);
 f.sqlite.prepare("INSERT INTO follower_scenarios(id,follower_id,scenario_id,current_step,status,next_step_at) VALUES(1,1,1,0,'active',?)").run(now);
 const fs={id:'1',follower_id:'1',scenario_id:'1',current_step:0,status:'active',next_step_at:now};
 const shared={sendText:vi.fn()},keyed={sendText:vi.fn(async()=>({message_id:'one'}))};
 return {...f,fs,shared,keyed};
}
it('binds the durable enrollment and step, with no shared sender or duplicate send',async()=>{
 const f=await fixture();const factory=vi.fn(async()=>f.keyed as any);
 await processSingleDelivery(f.db,f.shared as any,f.fs,undefined,true,factory);
 await processSingleDelivery(f.db,f.shared as any,f.fs,undefined,true,factory);
 expect(factory).toHaveBeenCalledTimes(1);expect(factory).toHaveBeenCalledWith('step:1:1',expect.stringMatching(/^[a-f0-9]{64}$/),expect.stringMatching(/^[a-f0-9]{64}$/));expect(f.keyed.sendText).toHaveBeenCalledOnce();expect(f.shared.sendText).not.toHaveBeenCalled();
});
it('holds rather than falling back when authority cannot be read',async()=>{
 const f=await fixture();await expect(processSingleDelivery(f.db,f.shared as any,f.fs,undefined,true,async()=>{throw Error('missing owner');})).rejects.toThrow();
 expect(f.shared.sendText).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT next_step_at,end_reason FROM follower_scenarios').get()).toMatchObject({next_step_at:null,end_reason:'outcome_unknown'});
});
