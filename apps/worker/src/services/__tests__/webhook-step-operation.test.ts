import {afterEach,it,expect,vi} from 'vitest';
import {gateFixture} from '../../test-utils/gate-fixture.js';
import {handleMessagingEvent} from '../../routes/webhook.js';
const close:(()=>void)[]=[];afterEach(()=>{while(close.length)close.pop()!();});
it.each(['primary','standby','paused'])('uses a version-bound immediate step client for %s inbox events',async mode=>{
 const f=await gateFixture();close.push(()=>f.sqlite.close());
 f.sqlite.exec("INSERT INTO scenarios(id,name,trigger_type,trigger_keyword,account_id) VALUES(1,'test','dm_keyword','guide','a'); INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,body) VALUES(1,1,1,0,'text','{\"text\":\"test\"}')");
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
