import {afterEach,it,expect,vi} from 'vitest';
import {InstagramClient} from '@ig-harness/ig-sdk';
import {testDatabase} from '../../test-utils/d1.js';
import {enqueueCommentRuleJob,processCommentRuleJobs} from '../comment-rule-jobs.js';
import {claimRecruitmentPublicReply,assertRecruitmentPublicReplyReady,recruitmentPublicReplyVersion} from '../recruitment-public-reply.js';
import {reserveRecruitmentOutbound,assertRecruitmentReservationReady} from '../recruitment-outbound-ledger.js';
import {recruitmentSubjectHash} from '../recruitment-inbound-holds.js';
import {recruitmentJobClientFactory} from '../../lib/accounts.js';
const NOW=Date.parse('2026-11-21T06:00:00Z'),close:(()=>void)[]=[];
afterEach(()=>{while(close.length)close.pop()!();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
async function fixture(ready=true,gate=false,mode:'thread'|'mention'='thread'){
 vi.useFakeTimers();vi.setSystemTime(NOW);const f=await testDatabase();close.push(()=>f.sqlite.close());
 f.sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,account_id) VALUES(1,'student','a'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
 f.sqlite.prepare('UPDATE followers SET metadata=?').run(JSON.stringify({recruitment_delivery:{state:'active',owner_epoch:'epoch',observed_at_ms:NOW,valid_until_ms:NOW+300000}}));f.sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(NOW);
 if(gate)f.sqlite.exec("INSERT INTO engagement_gates(id,name,trigger_type,initial_dm_text,follow_reminder_dm_text,reward_dm_text,account_id) VALUES('g','test','comment_on_post','hello','follow','reward','a'); INSERT INTO gate_deliveries(id,gate_id,follower_id,igsid,status) VALUES('d','g',1,'student','cta_sent')");
 await enqueueCommentRuleJob(f.db,{accountId:'a',ruleId:'r',commentId:'c1',followerId:1,messageType:'text',body:'{"text":"hello"}',replyText:'公開返信 $&',mediaId:'m1',replyMode:mode,gateDeliveryId:gate?'d':undefined,delaySeconds:0,commentCreatedAt:new Date(NOW-1000).toISOString()});
 if(ready){
  f.sqlite.prepare("UPDATE comment_rule_jobs SET status='sent',started_at=?,finished_at=?,attempt_count=1").run(new Date(NOW).toISOString(),new Date(NOW).toISOString());
  f.sqlite.prepare("INSERT INTO private_reply_attempts VALUES('a','c1',1,'sent',?,'dm-mid',NULL,NULL)").run(new Date(NOW).toISOString());
  f.sqlite.prepare("INSERT INTO recruitment_outbound_operations VALUES('a','comment:a:c1:r:0','epoch',?,'sent','dm-mid')").run(NOW);
  f.sqlite.prepare("INSERT INTO recruitment_outbound_observations VALUES('a','dm-mid',?,?)").run(NOW,NOW);
 }
 const plan=f.sqlite.prepare('SELECT j.*,f.igsid FROM comment_rule_jobs j JOIN followers f ON f.id=j.follower_id').get() as any;
 const version=await recruitmentPublicReplyVersion('a',plan);
 return{...f,plan,version,claim:()=>claimRecruitmentPublicReply(f.db,'a',plan.id,version,true,NOW)};
}
it('atomically claims the one durable public phase without reserving another DM slot',async()=>{
 const f=await fixture();const result=await Promise.allSettled(Array.from({length:12},()=>f.claim()));expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(f.sqlite.prepare('SELECT public_reply_status FROM comment_rule_jobs').get()?.public_reply_status).toBe('processing');expect(f.sqlite.prepare('SELECT COUNT(*) n FROM recruitment_outbound_operations').get()?.n).toBe(1);
});
it.each(['thread','mention'] as const)('admits only the exact %s endpoint/text and an acknowledged private DM',async mode=>{
 const f=await fixture(true,false,mode);const op=await f.claim();const fetch=vi.fn(async()=>new Response(JSON.stringify({id:'public-id'})));vi.stubGlobal('fetch',fetch);
 const client=new InstagramClient({accessToken:'test',igUserId:'111',appSecret:'test-secret',beforeMutation:req=>assertRecruitmentPublicReplyReady(f.db,'a',op,req,NOW)});
 if(mode==='mention')await client.postCommentToMedia('m1',f.plan.reply_text);else await client.replyToComment('c1',f.plan.reply_text);
 expect(fetch).toHaveBeenCalledOnce();await expect(f.claim()).rejects.toThrow();
});
it.each(['pause','owner','stale','future','inactive','standby','business-stop','new-consultation','private-uncertain','wrong-private-mid','wrong-private-epoch','job-canceled','text-edit','mode-edit','media-edit','comment-edit','body-edit','deletion','other-uncertain','gate-inactive','gate-dropped','wrong-path','wrong-text','wrong-method','pause-during-sign','proof-hash','proof-owner','proof-future','proof-stale'])( 'blocks %s changes after claim at the real SDK boundary',async mode=>{
 const f=await fixture(true,true);const op=await f.claim();
 const mutate=async()=>{
  if(mode==='proof-hash')f.sqlite.exec("UPDATE comment_rule_jobs SET public_reply_plan_hash='wrong'");
  if(mode==='proof-owner')f.sqlite.exec("UPDATE comment_rule_jobs SET public_reply_owner_epoch='wrong'");
  if(mode==='proof-future'||mode==='proof-stale')f.sqlite.prepare('UPDATE comment_rule_jobs SET public_reply_claimed_at=?').run(new Date(NOW+(mode==='proof-future'?1:-60001)).toISOString());
  if(mode==='pause'||mode==='pause-during-sign')f.sqlite.exec("UPDATE integration_settings SET value='1'");
  if(mode==='owner')f.sqlite.exec("UPDATE recruitment_outbound_control SET owner='legacy'");
  if(mode==='stale')f.sqlite.prepare('UPDATE recruitment_outbound_control SET reconciled_at_ms=?').run(NOW-60001);
  if(mode==='future')f.sqlite.prepare('UPDATE recruitment_outbound_control SET reconciled_at_ms=?').run(NOW+1);
  if(mode==='inactive')f.sqlite.exec('UPDATE ig_accounts SET is_active=0');if(mode==='standby')f.sqlite.exec("UPDATE followers SET messaging_owner='standby'");
  if(mode==='business-stop')f.sqlite.exec("UPDATE followers SET metadata='{\"recruitment_delivery\":{\"state\":\"stopped\"}}'");
  if(mode==='new-consultation')f.sqlite.prepare("INSERT INTO recruitment_inbound_holds VALUES('a','new',?,'consulting',?,?)").run(await recruitmentSubjectHash('a','student'),NOW,NOW);
  if(mode==='private-uncertain')f.sqlite.exec("UPDATE private_reply_attempts SET status='uncertain'");if(mode==='wrong-private-mid')f.sqlite.exec("UPDATE private_reply_attempts SET message_id='wrong'");if(mode==='wrong-private-epoch')f.sqlite.exec("UPDATE recruitment_outbound_operations SET owner_epoch='wrong'");
  if(mode==='job-canceled')f.sqlite.exec("UPDATE comment_rule_jobs SET status='skipped'");if(mode==='text-edit')f.sqlite.exec("UPDATE comment_rule_jobs SET reply_text='changed'");if(mode==='mode-edit')f.sqlite.exec("UPDATE comment_rule_jobs SET reply_mode='mention'");if(mode==='media-edit')f.sqlite.exec("UPDATE comment_rule_jobs SET media_id='other'");if(mode==='comment-edit')f.sqlite.exec("UPDATE comment_rule_jobs SET comment_id='other'");if(mode==='body-edit')f.sqlite.exec("UPDATE comment_rule_jobs SET body='changed'");
  if(mode==='deletion')f.sqlite.exec("INSERT INTO data_deletion_locks VALUES('a','test')");if(mode==='other-uncertain')f.sqlite.prepare("INSERT INTO recruitment_outbound_operations VALUES('a','other','epoch',?,'uncertain',NULL)").run(NOW);
  if(mode==='gate-inactive')f.sqlite.exec("UPDATE engagement_gates SET status='paused'");if(mode==='gate-dropped')f.sqlite.exec("UPDATE gate_deliveries SET status='dropped'");
 };
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 if(mode==='pause-during-sign'){const sign=crypto.subtle.sign.bind(crypto.subtle);vi.spyOn(crypto.subtle,'sign').mockImplementation(async(...args)=>{const result=await sign(...args);await mutate();return result;});}else await mutate();
 const client=new InstagramClient({accessToken:'test',igUserId:'111',appSecret:'test-secret',beforeMutation:req=>assertRecruitmentPublicReplyReady(f.db,'a',op,mode==='wrong-method'?{...req,method:'DELETE'}:req,NOW)});
 const send=client.replyToComment(mode==='wrong-path'?'other':'c1',mode==='wrong-text'?'changed':f.plan.reply_text);await expect(send).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});
it.each(['private-missing','public-sent','public-uncertain','changed-plan','missing-timestamp','wrong-epoch','disabled'])( 'does not start public work for %s evidence',async mode=>{
 const f=await fixture();if(mode==='private-missing')f.sqlite.exec('DELETE FROM private_reply_attempts');if(mode==='public-sent'||mode==='public-uncertain')f.sqlite.prepare('UPDATE comment_rule_jobs SET public_reply_status=?').run(mode.slice(7));
 if(mode==='changed-plan')f.sqlite.exec("UPDATE comment_rule_jobs SET reply_text='new'");if(mode==='missing-timestamp')f.sqlite.exec('UPDATE comment_rule_jobs SET finished_at=NULL');if(mode==='wrong-epoch')f.sqlite.exec("UPDATE recruitment_outbound_control SET owner_epoch='new'");
 await expect(claimRecruitmentPublicReply(f.db,'a',f.plan.id,f.version,mode!=='disabled',NOW)).rejects.toThrow();
});
it('connects the real job factory to separate DM and public clients and records both acknowledgements once',async()=>{
 const f=await fixture(false);const account=await f.db.prepare("SELECT * FROM ig_accounts WHERE id='a'").first<any>();
 const fetch=vi.fn(async(url)=>new Response(JSON.stringify(String(url).includes('/messages')?{recipient_id:'student',message_id:'dm-mid'}:{id:'public-mid'})));vi.stubGlobal('fetch',fetch);
 const factory=recruitmentJobClientFactory({IG_USER_ID:'',IG_ACCESS_TOKEN:'',RECRUITMENT_LEDGER_ENFORCEMENT:'1',OUTBOUND_PREPARATION_LOCK:'0'},f.db,account)!;
 await processCommentRuleJobs(f.db,{} as any,'a',factory);await processCommentRuleJobs(f.db,{} as any,'a',factory);
 expect(fetch).toHaveBeenCalledTimes(2);expect(f.sqlite.prepare('SELECT status,public_reply_status,public_reply_id FROM comment_rule_jobs').get()).toMatchObject({status:'sent',public_reply_status:'sent',public_reply_id:'public-mid'});
});
it.each(['missing-id','numeric-id','empty-id','journal-failure','factory-failure','meta-rejection'])( 'never claims public success or retries after %s',async mode=>{
 const f=await fixture(false);const account=await f.db.prepare("SELECT * FROM ig_accounts WHERE id='a'").first<any>();
 if(mode==='journal-failure')f.sqlite.exec("CREATE TRIGGER fail_public_journal BEFORE UPDATE ON comment_rule_jobs WHEN NEW.public_reply_status='sent' BEGIN SELECT RAISE(ABORT,'journal failure'); END");
 const fetch=vi.fn(async(url)=>{
  if(String(url).includes('/messages'))return new Response(JSON.stringify({recipient_id:'student',message_id:'dm-mid'}));
  if(mode==='meta-rejection')return new Response(JSON.stringify({error:{code:200,message:'permission rejected'}}),{status:403});
  return new Response(JSON.stringify(mode==='missing-id'?{}:{id:mode==='numeric-id'?1:mode==='empty-id'?'':'public-mid'}));
 });vi.stubGlobal('fetch',fetch);
 const real=recruitmentJobClientFactory({IG_USER_ID:'',IG_ACCESS_TOKEN:'',RECRUITMENT_LEDGER_ENFORCEMENT:'1',OUTBOUND_PREPARATION_LOCK:'0'},f.db,account)!;
 const factory=async(key:string,version?:string)=>{if(mode==='factory-failure'&&key.startsWith('comment-public:'))throw Error('authority unavailable');return real(key,version);};
 await processCommentRuleJobs(f.db,{} as any,'a',factory);await processCommentRuleJobs(f.db,{} as any,'a',factory);
 expect(fetch).toHaveBeenCalledTimes(mode==='factory-failure'?1:2);
 const row=f.sqlite.prepare('SELECT status,public_reply_status,public_reply_id FROM comment_rule_jobs').get();expect(row?.status).toBe('sent');expect(row?.public_reply_status).toBe(mode==='journal-failure'?'processing':mode==='meta-rejection'?'failed':'uncertain');expect(row?.public_reply_id).toBeNull();
});

it.each(['processing','uncertain'])('holds new and already reserved DMs while public outcome is %s',async status=>{
 const f=await fixture();const input={accountId:'a',operationKey:'manual:new',ownerEpoch:'epoch',nowMs:NOW,preparationLocked:false};
 expect(await reserveRecruitmentOutbound(f.db,input)).toBe(true);
 f.sqlite.prepare('UPDATE comment_rule_jobs SET public_reply_status=?').run(status);
 expect(await reserveRecruitmentOutbound(f.db,{...input,operationKey:'manual:other'})).toBe(false);
 await expect(assertRecruitmentReservationReady(f.db,input)).rejects.toThrow();
});
it('persists the claimed immutable plan and owner evidence without changing a historical reply',async()=>{
 const f=await fixture();await f.claim();expect(f.sqlite.prepare('SELECT public_reply_plan_hash,public_reply_owner_epoch,public_reply_claimed_at FROM comment_rule_jobs').get()).toEqual({public_reply_plan_hash:f.version,public_reply_owner_epoch:'epoch',public_reply_claimed_at:new Date(NOW).toISOString()});
 f.sqlite.exec("UPDATE comment_rule_jobs SET public_reply_status='sent',public_reply_id='ack'");await expect(f.claim()).rejects.toThrow();expect(f.sqlite.prepare('SELECT public_reply_id FROM comment_rule_jobs').get()?.public_reply_id).toBe('ack');
});

for(const table of ['recruitment_gate_operations','recruitment_gate_cta_operations','recruitment_gate_followup_operations'])it.each(['stale','future','other-owner','uncertain','fresh','settled'])(`public reply rechecks ${table} %s at claim and final SDK boundary`,async mode=>{
 const blocked=!['fresh','settled'].includes(mode);
 for(const stage of ['claim','transport']){
  const f=await fixture(true,true);const operation=stage==='transport'?await f.claim():null;
  const row={account_id:'a',operation_key:'other-purpose',delivery_id:'d',follower_id:1,definition_version:'d'.repeat(64),owner_epoch:mode==='other-owner'?'other':'epoch',claimed_at_ms:mode==='stale'?NOW-60000:mode==='future'?NOW+1:NOW,state:mode==='settled'?'sent':mode==='uncertain'?'uncertain':'claimed',...(table==='recruitment_gate_operations'?{event_key:'event',phase:'reward',loop_count:0}:table==='recruitment_gate_cta_operations'?{event_key:'event',mode:'keyword',source_hash:'s'.repeat(64),payload_version:'p'.repeat(64),expected_messages:1}:{step_index:0})};
  f.sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  if(stage==='claim'){if(blocked)await expect(f.claim()).rejects.toThrow('reconciliation');else await f.claim();}
  else{const fetch=vi.fn(async()=>new Response(JSON.stringify({id:'public'})));vi.stubGlobal('fetch',fetch);const client=new InstagramClient({accessToken:'test',igUserId:'111',beforeMutation:req=>assertRecruitmentPublicReplyReady(f.db,'a',operation!,req,NOW)});if(blocked){await expect(client.replyToComment('c1',f.plan.reply_text)).rejects.toThrow('reconciliation');expect(fetch).not.toHaveBeenCalled();}else{await client.replyToComment('c1',f.plan.reply_text);expect(fetch).toHaveBeenCalledOnce();}}
  expect(f.sqlite.prepare(`SELECT state FROM ${table}`).get()?.state).toBe(row.state);
 }
});
it.each(['missing-observation','stale-slot','future-slot','future-observation','unknown-delivery'])('holds public reply for %s before and after claiming',async mode=>{
 for(const stage of ['claim','transport']){const f=await fixture(true,true);const op=stage==='transport'?await f.claim():null;
 if(mode==='missing-observation')f.sqlite.exec('DELETE FROM recruitment_outbound_observations');if(mode==='stale-slot'||mode==='future-slot')f.sqlite.prepare("INSERT INTO recruitment_outbound_operations VALUES('a','other','epoch',?,'reserved',NULL)").run(mode==='stale-slot'?NOW-60000:NOW+1);if(mode==='future-observation')f.sqlite.prepare("INSERT INTO recruitment_outbound_observations VALUES('a','future',?,?)").run(NOW+1,NOW+1);if(mode==='unknown-delivery')f.sqlite.exec("UPDATE gate_deliveries SET end_reason='outcome_unknown'");
 if(stage==='claim')await expect(f.claim()).rejects.toThrow('reconciliation');else await expect(assertRecruitmentPublicReplyReady(f.db,'a',op!,{method:'POST',path:'/c1/replies?message='+encodeURIComponent(f.plan.reply_text),body:undefined},NOW)).rejects.toThrow('reconciliation');
 }
});
