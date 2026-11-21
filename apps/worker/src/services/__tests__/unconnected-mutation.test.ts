import {afterEach,it,expect,vi} from 'vitest';
import {getAccountClient} from '../../lib/accounts.js';
import {testDatabase} from '../../test-utils/d1.js';
const close:(()=>void)[]=[];afterEach(()=>{while(close.length)close.pop()!();vi.unstubAllGlobals();});
it.each(['public-reply','mention-comment','sender-action','pause-after-build'])('does not let %s bypass the account stop/purpose guard',async mode=>{
 const {db,sqlite}=await testDatabase();close.push(()=>sqlite.close());
 sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','111','test','2026-01-01','2026-01-01'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
 const account=await db.prepare('SELECT * FROM ig_accounts WHERE id=?').bind('a').first<any>();
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const client=await getAccountClient({IG_USER_ID:'',IG_ACCESS_TOKEN:'',RECRUITMENT_LEDGER_ENFORCEMENT:mode==='pause-after-build'?'0':'1',OUTBOUND_PREPARATION_LOCK:'0'},db,account,{skipTokenRefresh:true,recruitmentOperation:{key:'manual:unconnected',ownerEpoch:'epoch'}});
 if(mode==='pause-after-build')sqlite.exec("UPDATE integration_settings SET value='1'");
 const call=mode==='mention-comment'?client.postCommentToMedia('media','text'):mode==='sender-action'?client.sendSenderAction('student','typing_on'):client.replyToComment('comment','text');
 await expect(call).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});
