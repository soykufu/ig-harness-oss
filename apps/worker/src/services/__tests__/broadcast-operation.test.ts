import {afterEach,it,expect,vi} from 'vitest';
import {gateFixture} from '../../test-utils/gate-fixture.js';
import {processBroadcastSend} from '../broadcast.js';
const close:(()=>void)[]=[];afterEach(()=>{while(close.length)close.pop()!();});
it.each(['ready','failed','paused'])('uses durable per-recipient broadcast client for %s',async mode=>{
 const f=await gateFixture();close.push(()=>f.sqlite.close());f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date().toISOString());
 f.sqlite.exec("INSERT INTO broadcasts(id,name,message_type,body,account_id) VALUES(1,'test','text','{\"text\":\"guide\"}','a')");
 if(mode==='paused')f.sqlite.exec("INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1')");
 const keyed={...f.client,sendText:vi.fn(async()=>({message_id:'one'}))};const factory=vi.fn(async()=>{if(mode==='failed')throw Error('missing owner');return keyed as any;});
 await processBroadcastSend(f.db,f.client as any,1,undefined,'a',factory);
 if(mode==='ready'){expect(factory).toHaveBeenCalledWith('broadcast:1:1',expect.stringMatching(/^[a-f0-9]{64}$/));expect(keyed.sendText).toHaveBeenCalledOnce();await processBroadcastSend(f.db,f.client as any,1,undefined,'a',factory);expect(factory).toHaveBeenCalledOnce();}
 else if(mode==='failed'){expect(keyed.sendText).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT status FROM broadcast_recipients').get()?.status).toBe('uncertain');}
 else{expect(factory).not.toHaveBeenCalled();}
 expect(f.client.sendText).not.toHaveBeenCalled();
});
