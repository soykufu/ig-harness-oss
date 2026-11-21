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

it('keeps legacy clipping while strict reviewed rendering refuses changed copy',()=>{
 const long:RichMessageBlock[]=[{type:'text',text:'あ'.repeat(1001)}];expect(renderRichActions('student',long)[0]).toEqual({type:'text',text:'あ'.repeat(1000)});expect(()=>renderRichActions('student',long,{}, {preserveCopy:true})).toThrow('without truncation');
});
it.each([
 {type:'card',title:'あ'.repeat(81),buttons:[]},
 {type:'card',title:'見学',subtitle:'あ'.repeat(81),buttons:[]},
 {type:'card',title:'見学',buttons:[{type:'postback',label:'あ'.repeat(21),payload:'visit'}]},
 {type:'card',title:'見学',buttons:[{type:'url',label:'あ'.repeat(21),url:'https://example.com'}]},
 {type:'text',text:'あ'.repeat(1001)},
 {type:'quick_replies',text:'あ'.repeat(1001),replies:[]},
 {type:'quick_replies',text:'選ぶ',replies:[{label:'あ'.repeat(21),payload:'visit'}]},
 {type:'carousel',cards:[{title:'ok',buttons:[]},{title:'あ'.repeat(81),buttons:[]}]},
 {type:'text',text:'invalid\ud800'},
 {type:'card',title:'invalid\udc00',buttons:[]},
] as RichMessageBlock[])('strict rendering rejects an unsafe later block before any plan can be sent: %j',bad=>{
 expect(()=>renderRichActions('student',[{type:'text',text:'first'},bad],{}, {preserveCopy:true})).toThrow();
});
it('checks the complete expanded values and keeps literal replacement tokens',()=>{
 const block:RichMessageBlock[]=[{type:'card',title:'{FOLLOWER_USERNAME}',buttons:[]}];expect(()=>renderRichActions('student',block,{followerUsername:'あ'.repeat(81)}, {preserveCopy:true})).toThrow('limits');
 expect(renderRichActions('student',blocks,context,{preserveCopy:true})).toEqual(renderRichActions('student',blocks,context));
});
it('retains complete valid emoji, combining marks and boundary-sized copy',()=>{
 const emoji='👩‍💻🇯🇵か\u3099';const input:RichMessageBlock[]=[{type:'card',title:'あ'.repeat(80),subtitle:emoji,buttons:[{type:'url',label:emoji,url:'https://example.com'}]},{type:'quick_replies',text:emoji,replies:[{label:emoji,payload:'visit'}]}];
 const rendered=renderRichActions('student',input,{}, {preserveCopy:true});expect(rendered).toEqual(renderRichActions('student',input));expect(JSON.stringify(rendered)).toContain(emoji);
});
