import {afterEach,it,expect,vi} from 'vitest';
import {InstagramClient} from '@ig-harness/ig-sdk';
import {createRichMessage} from '@ig-harness/db';
import {testDatabase} from '../../test-utils/d1.js';
import {recruitmentMessageLifecycle} from '../recruitment-message-lifecycle.js';
import {claimRecruitmentManualIntent} from '../recruitment-manual-intent.js';
import {recruitmentRichTestContent} from '../recruitment-rich-test.js';
import {sha256} from '../../lib/security.js';
const NOW=Date.parse('2026-11-21T06:00:00Z'),close:(()=>void)[]=[];afterEach(()=>{while(close.length)close.pop()!();vi.unstubAllGlobals();});
it.each(['valid','payload','recipient','context','actor','template','extra-block'])( 'rechecks rich-test %s at the real SDK boundary',async mode=>{
 const {db,sqlite}=await testDatabase();close.push(()=>sqlite.close());
 sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','111','test','2026-01-01','2026-01-01'); INSERT INTO staff_members(id,name,role,api_key) VALUES('owner','test','owner','test'); INSERT INTO followers(id,igsid,account_id) VALUES(1,'student','a'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
 sqlite.prepare('UPDATE followers SET last_inbound_at=?,metadata=?').run(new Date(NOW-1000).toISOString(),JSON.stringify({recruitment_delivery:{state:'active',owner_epoch:'epoch',observed_at_ms:NOW,valid_until_ms:NOW+300000}}));sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(NOW);
 const rich=await createRichMessage(db,{name:'test',kind:'generic',blocks:[{type:'text',text:'hello {REWARD_URL}'}],accountId:'a'});
 const proof={richId:rich.id,followerId:1,actorId:'owner',rewardUrl:'https://example.com/yes',followerUsername:null,definitionVersion:''};const content=recruitmentRichTestContent(rich,proof);proof.definitionVersion=await sha256(content);
 const claim=await claimRecruitmentManualIntent(db,{accountId:'a',followerId:1,nonce:'rich-purpose-123456',messageType:'rich-test',content},false,NOW);
 const fetch=vi.fn(async()=>new Response(JSON.stringify({message_id:'one',recipient_id:'student'})));vi.stubGlobal('fetch',fetch);
 const client=new InstagramClient({accessToken:'test',igUserId:'111',messageLifecycle:recruitmentMessageLifecycle(db,'a',{key:claim.key!,ownerEpoch:'epoch',richTest:proof},async()=>{},()=>NOW),transformMessage:async(_id,message)=>{if(mode==='actor')sqlite.exec("UPDATE staff_members SET role='staff'");if(mode==='template')sqlite.exec("UPDATE rich_messages SET blocks='[]'");return message;}});
 const send=mode==='payload'?client.sendText('student','unreviewed'):client.sendRichMessage(mode==='recipient'?'foreign':'student',mode==='extra-block'?[...rich.blocks,{type:'text',text:'extra'}]:rich.blocks,{gateId:'preview-gate',deliveryId:'preview-delivery',rewardUrl:mode==='context'?'https://example.com/no':proof.rewardUrl});
 if(['valid','extra-block'].includes(mode)){if(mode==='valid')await send;else await expect(send).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);}else{await expect(send).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();}
});
