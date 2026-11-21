import {afterEach,it,expect,vi} from 'vitest';
import {InstagramClient} from './client.js';
import {renderRichActions,richActionMessage} from './rich-actions.js';
import type {RichMessageBlock} from './types.js';
afterEach(()=>vi.unstubAllGlobals());
const context={gateId:'g',deliveryId:'d',rewardUrl:'https://example.com/r',followerUsername:'$&{{IGSID}}'};
const blocks:RichMessageBlock[]=[{type:'text',text:'{FOLLOWER_USERNAME}'},{type:'image',url:'https://example.com/{IGSID}.jpg'},{type:'card',title:'{FOLLOWER_USERNAME}',buttons:[{type:'postback',label:'確認',payload:'{GATE_ID}:{DELIVERY_ID}'},{type:'url',label:'特典',url:'{REWARD_URL}'}]},{type:'carousel',cards:[{title:'card',buttons:[]}]},{type:'quick_replies',text:'選ぶ',replies:[{label:'見学',payload:'visit'}]}];
it('renders every block through the same raw payload used by the actual SDK',async()=>{
 const calls:unknown[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{calls.push(JSON.parse(options.body));return new Response(JSON.stringify({message_id:'m'+calls.length,recipient_id:'student'}));}));
 const client=new InstagramClient({accessToken:'test',igUserId:'111'});expect(await client.sendRichMessage('student',blocks,context)).toEqual({sentBlocks:5});
 expect(calls).toEqual(renderRichActions('student',blocks,context).map(action=>({recipient:{id:'student'},message:richActionMessage(action)})));
 expect(JSON.stringify(calls[0])).toContain('$&{{IGSID}}');
});
it.each([{blocks:[]},{blocks:[{type:'unknown'}]},{blocks:[{type:'text',text:'valid'},{type:'unknown'}]}])('validates all blocks before the first network mutation',async ({blocks:bad})=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const client=new InstagramClient({accessToken:'test',igUserId:'111'});
 await expect(client.sendRichMessage('student',bad as unknown as RichMessageBlock[])).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});
