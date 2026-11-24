import {it,expect,vi} from 'vitest';
import {processQueuedWebhooks} from '../webhook.js';
it('preparation lock leaves the durable queue untouched even if the database stop cannot be read',async()=>{
 const prepare=vi.fn(()=>{throw Error('queue must remain untouched');});const sendText=vi.fn();
 await processQueuedWebhooks({prepare} as never,{sendText} as never,{id:'account'} as never,undefined,{OUTBOUND_PREPARATION_LOCK:'1'} as never);
 expect(prepare).not.toHaveBeenCalled();expect(sendText).not.toHaveBeenCalled();
});
it('the existing database stop still holds processing when preparation lock is not set',async()=>{
 const first=vi.fn(async()=>({value:'1'})),prepare=vi.fn(()=>({first,bind:()=>({first})})),sendText=vi.fn();
 await processQueuedWebhooks({prepare} as never,{sendText} as never,{id:'account'} as never,undefined,{OUTBOUND_PREPARATION_LOCK:'0'} as never);
 expect(prepare).toHaveBeenCalledTimes(1);expect(sendText).not.toHaveBeenCalled();
});
