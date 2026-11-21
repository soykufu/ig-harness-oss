import {afterEach,it,expect,vi} from 'vitest';
import {gateFixture} from '../../test-utils/gate-fixture.js';
import {handleMessagingEvent} from '../../routes/webhook.js';
const close:(()=>void)[]=[];afterEach(()=>{while(close.length)close.pop()!();vi.useRealTimers();});
it.each(['primary','standby','paused'])('uses a version-bound immediate step client for %s inbox events',async mode=>{
 vi.useFakeTimers();vi.setSystemTime(Date.parse('2026-11-21T06:00:00Z'));
 const f=await gateFixture();close.push(()=>f.sqlite.close());
 f.sqlite.exec("INSERT INTO scenarios(id,name,trigger_type,trigger_keyword,account_id) VALUES(1,'test','dm_keyword','guide','a'); INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,body) VALUES(1,1,1,0,'text','{\"text\":\"test\"}')");
 const now=Date.now();f.sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(now);f.sqlite.prepare('UPDATE followers SET metadata=?').run(JSON.stringify({recruitment_delivery:{state:'active',owner_epoch:'epoch',observed_at_ms:now,valid_until_ms:now+300000}}));
 if(mode!=='paused')f.sqlite.exec("INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
 if(mode==='paused')f.sqlite.exec("INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1')");
 const keyed={...f.client,sendText:vi.fn(async()=>({message_id:'one'}))};const factory=vi.fn(async()=>keyed as any);
 const event={sender:{id:'user-1'},recipient:{id:'111'},timestamp:Date.now(),message:{mid:'inbound',text:'guide'}};
 await handleMessagingEvent(f.db,f.client as any,event,undefined,undefined,'a',mode==='standby',factory);
 if(mode==='primary'){
  expect(factory).toHaveBeenCalledOnce();expect(factory).toHaveBeenCalledWith('step:1:1',expect.stringMatching(/^[a-f0-9]{64}$/),expect.stringMatching(/^[a-f0-9]{64}$/));expect(keyed.sendText).toHaveBeenCalledOnce();
  await handleMessagingEvent(f.db,f.client as any,event,undefined,undefined,'a',false,factory);expect(factory).toHaveBeenCalledOnce();
 }else{expect(factory).not.toHaveBeenCalled();expect(keyed.sendText).not.toHaveBeenCalled();}
 expect(f.client.sendText).not.toHaveBeenCalled();
});
