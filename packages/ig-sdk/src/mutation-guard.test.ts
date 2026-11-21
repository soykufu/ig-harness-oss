import {afterEach,it,expect,vi} from 'vitest';
import {InstagramClient} from './client.js';
afterEach(()=>vi.unstubAllGlobals());
it.each(['public-reply','mention-comment','sender-action'])('checks the final mutation guard before %s reaches the network',async mode=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const guard=vi.fn(async()=>{throw Error('paused')});
 const client=new InstagramClient({accessToken:'test',igUserId:'111',beforeMutation:guard});
 const call=mode==='public-reply'?client.replyToComment('comment','text'):mode==='mention-comment'?client.postCommentToMedia('media','text'):client.sendSenderAction('student','typing_on');
 await expect(call).rejects.toThrow('paused');expect(guard).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
});
