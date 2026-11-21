import {recruitmentBroadcastVersion} from '../recruitment-broadcast-admission.js';
import {recruitmentStepVersion,recruitmentStepSubjectVersion} from '../recruitment-step-version.js';
import { afterEach, expect, it, vi } from 'vitest';
import { InstagramClient } from '@ig-harness/ig-sdk';
import { testDatabase } from '../../test-utils/d1.js';
import { ingestRecruitmentInboundHolds } from '../recruitment-inbound-holds.js';
import { recruitmentMessageLifecycle } from '../recruitment-message-lifecycle.js';
const NOON = Date.parse('2026-11-20T03:00:00Z');
const cleanup: (()=>void)[]=[];
afterEach(()=>{while(cleanup.length)cleanup.pop()!();vi.unstubAllGlobals();});
async function fixture() {
  const {sqlite,db}=await testDatabase();cleanup.push(()=>sqlite.close());
  sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','111','test','2026-01-01','2026-01-01'); INSERT INTO integration_settings(key,value) VALUES('outbound_paused','0')");
  let now=NOON, locked=false;
  sqlite.prepare("INSERT INTO recruitment_outbound_control VALUES('a','epoch','harness',?)").run(now);
  sqlite.prepare("INSERT INTO followers(igsid,account_id,last_inbound_at) VALUES('student','a',?)").run(new Date(now-1000).toISOString());
  sqlite.prepare('UPDATE followers SET metadata=?').run(JSON.stringify({recruitment_delivery:{state:'active',owner_epoch:'epoch',observed_at_ms:NOON,valid_until_ms:NOON+300_000}}));
  const fetch=vi.fn(async()=>new Response(JSON.stringify({message_id:'message-'+fetch.mock.calls.length,recipient_id:'student'})));
  vi.stubGlobal('fetch',fetch);
  const make=(mutate:()=>void|Promise<void>,key='operation',stepVersion?:string,subjectVersion?:string)=>new InstagramClient({accessToken:'test',igUserId:'111',appSecret:'test-secret',
    messageLifecycle:recruitmentMessageLifecycle(db,'a',{key,ownerEpoch:'epoch',definitionVersion:stepVersion,subjectVersion},async()=>{if(locked)throw new Error('Preparation locked');},()=>now),
    transformMessage:async(_id,message)=>{await Promise.resolve();await mutate();return message;},
  });
  return {sqlite,db,fetch,make,setNow:(n:number)=>{now=n;},lock:()=>{locked=true;}};
}
it.each(['pause','preparation-lock','owner-change','epoch-change','account-inactive','standby','inbound-expired','inbound-future','follower-deleted','stale','window-end','future-evidence','deletion-lock','manual-cap','other-uncertain'])(
  'rejects %s introduced during asynchronous transformation before fetch',async change=>{
    const {sqlite,fetch,make,setNow,lock}=await fixture();
    const mutate=()=>{
      if(change==='pause')sqlite.exec("UPDATE integration_settings SET value='1' WHERE key='outbound_paused'");
      if(change==='preparation-lock')lock();
      if(change==='owner-change')sqlite.exec("UPDATE recruitment_outbound_control SET owner='legacy'");
      if(change==='epoch-change')sqlite.exec("UPDATE recruitment_outbound_control SET owner_epoch='new-owner'");
      if(change==='stale')setNow(NOON+60_001);
      if(change==='window-end') {const t=Date.parse('2026-11-20T12:00:00Z');setNow(t);sqlite.prepare('UPDATE recruitment_outbound_control SET reconciled_at_ms=?').run(t);}
      if(change==='future-evidence')sqlite.prepare("INSERT INTO recruitment_outbound_observations VALUES('a','future',?,?)").run(NOON+1,NOON+1);
      if(change==='deletion-lock')sqlite.exec("INSERT INTO data_deletion_locks VALUES('a','delete')");
      if(change==='manual-cap')for(let i=0;i<10;i++)sqlite.prepare("INSERT INTO recruitment_outbound_observations VALUES('a',?,?,?)").run('manual-'+i,NOON,NOON);
      if(change==='other-uncertain')sqlite.prepare("INSERT INTO recruitment_outbound_operations VALUES('a','other','epoch',?,'uncertain',NULL)").run(NOON);
      if(change==='account-inactive')sqlite.exec("UPDATE ig_accounts SET is_active=0");
      if(change==='standby')sqlite.exec("UPDATE followers SET messaging_owner='standby'");
      if(change==='inbound-expired')sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date(NOON-86400000).toISOString());
      if(change==='inbound-future')sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date(NOON+1000).toISOString());
      if(change==='follower-deleted')sqlite.exec('DELETE FROM followers');
    };
    const client=make(mutate);
    await expect(client.sendText('student','test')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT state FROM recruitment_outbound_operations WHERE operation_key='operation:0'").get()?.state).toBe('uncertain');
    await expect(client.sendText('student','retry')).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
  });
it('permits exactly ten including manual messages after transformation/signing',async()=>{
  const {sqlite,fetch,make}=await fixture();
  const client=make(()=>{for(let i=0;i<9;i++)sqlite.prepare("INSERT INTO recruitment_outbound_observations VALUES('a',?,?,?)").run('manual-'+i,NOON,NOON);});
  await client.sendImage('student','https://example.com/a.jpg');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sqlite.prepare("SELECT state FROM recruitment_outbound_operations").get()?.state).toBe('sent');
});
it('rechecks each rich block after a stop arrives following the first success',async()=>{
  const {sqlite,fetch,make}=await fixture();
  fetch.mockImplementation(async()=>{sqlite.exec("UPDATE integration_settings SET value='1' WHERE key='outbound_paused'");return new Response(JSON.stringify({message_id:'one',recipient_id:'student'}));});
  await expect(make(()=>{}).sendRichMessage('student',[{type:'text',text:'one'},{type:'text',text:'two'}])).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM recruitment_outbound_operations').get()?.n).toBe(1);
});

it.each(['consulting','stopped','declined','hold','missing','malformed','expired','future','wrong-owner','too-long'])(
  'blocks business state %s changed during link generation',async change=>{
    const {sqlite,fetch,make}=await fixture();
    const mutate=()=>{
      let value:any={state:'active',owner_epoch:'epoch',observed_at_ms:NOON,valid_until_ms:NOON+300_000};
      if(['consulting','stopped','declined','hold'].includes(change))value.state=change;
      if(change==='expired')value.valid_until_ms=NOON;
      if(change==='future')value.observed_at_ms=NOON+1;
      if(change==='wrong-owner')value.owner_epoch='other';
      if(change==='too-long')value.valid_until_ms=NOON+300_001;
      sqlite.prepare('UPDATE followers SET metadata=?').run(change==='malformed'?'bad':JSON.stringify(change==='missing'?{}:{recruitment_delivery:value}));
    };
    await expect(make(mutate).sendText('student','test')).rejects.toThrow('business state');
    expect(fetch).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT state FROM recruitment_outbound_operations').get()?.state).toBe('uncertain');
  });

it('rechecks signed inbound holds arriving during async preparation even with active metadata',async()=>{
 const {db,fetch,make}=await fixture();
 await expect(make(async()=>{await ingestRecruitmentInboundHolds(db,{id:'a',ig_user_id:'111'},[{kind:'messaging',value:{sender:{id:'student'},recipient:{id:'111'},timestamp:NOON,message:{mid:'stop-now',text:'停止'}}}],NOON);}).sendText('student','test')).rejects.toThrow('human review');
 expect(fetch).not.toHaveBeenCalled();
});

async function privateFixture(){
 const f=await fixture();const t=new Date(NOON).toISOString();
 f.sqlite.prepare("INSERT INTO comment_rule_jobs(id,account_id,follower_id,comment_id,message_type,body,due_at,expires_at,status,started_at,delivery_mode,comment_created_at) VALUES('job','a',1,'comment','text','{}',?,?,'processing',?,'private_reply',?)").run(t,new Date(NOON+86400000).toISOString(),t,t);
 f.sqlite.prepare("INSERT INTO private_reply_attempts(account_id,comment_id,follower_id,status,attempted_at) VALUES('a','comment',1,'processing',?)").run(t);
 return f;
}
it('uses a claimed comment job and its separate 7-day policy without opening a DM window',async()=>{
 const {sqlite,fetch,make}=await privateFixture();sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date(NOON-2*86400000).toISOString());
 await make(()=>{},'comment:job').sendPrivateReply('comment','test');expect(fetch).toHaveBeenCalledTimes(1);
});
it.each(['expired','future','missing-created','live','job-stopped','attempt-sent','stale-claim','wrong-job','standby'])(
 'blocks private reply when %s changes during preparation',async change=>{
 const {sqlite,fetch,make}=await privateFixture();
 const mutate=()=>{
   if(change==='expired')sqlite.prepare('UPDATE comment_rule_jobs SET comment_created_at=?').run(new Date(NOON-7*86400000).toISOString());
   if(change==='future')sqlite.prepare('UPDATE comment_rule_jobs SET comment_created_at=?').run(new Date(NOON+1).toISOString());
   if(change==='missing-created')sqlite.exec('UPDATE comment_rule_jobs SET comment_created_at=NULL');
   if(change==='live')sqlite.exec('UPDATE comment_rule_jobs SET is_live=1');
   if(change==='job-stopped')sqlite.exec("UPDATE comment_rule_jobs SET status='skipped'");
   if(change==='attempt-sent')sqlite.exec("UPDATE private_reply_attempts SET status='sent'");
   if(change==='stale-claim')sqlite.prepare('UPDATE private_reply_attempts SET attempted_at=?').run(new Date(NOON-60001).toISOString());
   if(change==='wrong-job')sqlite.exec("UPDATE comment_rule_jobs SET comment_id='other'");
   if(change==='standby')sqlite.exec("UPDATE followers SET messaging_owner='standby'");
 };
 await expect(make(mutate,'comment:job').sendPrivateReply('comment','test')).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});

it.each(['valid','wrong-follower','wrong-igsid','dropped','delivered','ended','inactive','wrong-account'])(
 'reconciles private reply gate %s at the last network boundary',async change=>{
 const {sqlite,fetch,make}=await privateFixture();
 sqlite.exec("INSERT INTO engagement_gates(id,name,trigger_type,initial_dm_text,follow_reminder_dm_text,reward_dm_text,account_id,require_follow,status) VALUES('gate','test','comment_on_post','hello','follow','guide','a',0,'active'); INSERT INTO gate_deliveries(id,gate_id,follower_id,igsid,status) VALUES('delivery','gate',1,'student','triggered'); UPDATE comment_rule_jobs SET gate_delivery_id='delivery'");
 const mutate=()=>{
   if(change==='wrong-follower'){sqlite.exec("INSERT INTO followers(id,igsid,account_id) VALUES(2,'other','a'); UPDATE gate_deliveries SET follower_id=2");}
   if(change==='wrong-igsid')sqlite.exec("UPDATE gate_deliveries SET igsid='other'");
   if(change==='dropped'||change==='delivered')sqlite.prepare('UPDATE gate_deliveries SET status=?').run(change);
   if(change==='ended')sqlite.exec("UPDATE gate_deliveries SET end_reason='stopped'");
   if(change==='inactive')sqlite.exec("UPDATE engagement_gates SET status='paused'");
   if(change==='wrong-account'){sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('b','222','test','2026-01-01','2026-01-01'); UPDATE engagement_gates SET account_id='b'");}
 };
 const send=make(mutate,'comment:job').sendPrivateReply('comment','test');
 if(change==='valid'){await send;expect(fetch).toHaveBeenCalledTimes(1);}
 else {await expect(send).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();}
});

it.each(['valid','completed','paused-scenario','wrong-account','wrong-follower','claim-lost','advanced','step-deleted','reordered','condition-follow','condition-unknown','condition-missing','body-edit','type-edit','delay-edit','fallback-edit','version-missing','name-edit','username-edit','subject-missing','subject-wrong'])(
 'checks scheduled step %s after asynchronous message preparation',async change=>{
 const {sqlite,fetch,make}=await fixture();
 sqlite.exec("INSERT INTO scenarios(id,name,trigger_type,account_id) VALUES(1,'test','manual','a'); INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,body) VALUES(1,1,1,0,'text','{}'); INSERT INTO follower_scenarios(id,follower_id,scenario_id,current_step,status,next_step_at,end_reason) VALUES(1,1,1,0,'active',NULL,'delivery_in_progress')");
 const version=await recruitmentStepVersion(sqlite.prepare('SELECT * FROM scenario_steps WHERE id=1').get() as any);
 const mutate=()=>{
  if(change==='body-edit')sqlite.exec("UPDATE scenario_steps SET body='changed'");
  if(change==='type-edit')sqlite.exec("UPDATE scenario_steps SET message_type='image'");
  if(change==='delay-edit')sqlite.exec('UPDATE scenario_steps SET delay_minutes=5');
  if(change==='fallback-edit')sqlite.exec('UPDATE scenario_steps SET next_step_on_false=99');
  if(change==='name-edit')sqlite.exec("UPDATE followers SET name='changed'");
  if(change==='username-edit')sqlite.exec("UPDATE followers SET username='changed'");
  if(change==='completed')sqlite.exec("UPDATE follower_scenarios SET status='completed'");
  if(change==='paused-scenario')sqlite.exec('UPDATE scenarios SET is_active=0');
  if(change==='wrong-account'){sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('b','222','test','2026-01-01','2026-01-01'); UPDATE scenarios SET account_id='b'");}
  if(change==='wrong-follower'){sqlite.exec("INSERT INTO followers(id,igsid,account_id) VALUES(2,'other','a'); UPDATE follower_scenarios SET follower_id=2");}
  if(change==='claim-lost')sqlite.exec("UPDATE follower_scenarios SET end_reason=NULL");
  if(change==='advanced')sqlite.exec('UPDATE follower_scenarios SET current_step=1');
  if(change==='step-deleted')sqlite.exec('DELETE FROM scenario_steps');
  if(change==='condition-follow')sqlite.exec("UPDATE scenario_steps SET condition_type='user_following',condition_value=NULL; UPDATE followers SET is_following=0");
  if(change==='condition-unknown')sqlite.exec("UPDATE scenario_steps SET condition_type='new-condition',condition_value='x'");
  if(change==='condition-missing')sqlite.exec("UPDATE scenario_steps SET condition_type='tag_exists',condition_value=NULL");
  if(change==='reordered')sqlite.exec("UPDATE scenario_steps SET step_order=2; INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,body) VALUES(2,1,1,0,'text','{}')");
 };
 const subjectVersion=await recruitmentStepSubjectVersion(sqlite.prepare('SELECT * FROM followers WHERE id=1').get() as any);
 const send=make(mutate,'step:1:1',change==='version-missing'?undefined:version,change==='subject-missing'?undefined:change==='subject-wrong'?'e'.repeat(64):subjectVersion).sendText('student','test');
 if(change==='valid'){await send;expect(fetch).toHaveBeenCalledOnce();}
 else{await expect(send).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();}
});

it.each(['valid','body-edit','stopped','recipient-stopped','wrong-account','stale','missing-proof','tag-valid','tag-removed'])(
 'rechecks broadcast %s at the SDK boundary',async change=>{
 const {sqlite,fetch,make}=await fixture();
 sqlite.exec("INSERT INTO broadcasts(id,name,message_type,body,account_id,status) VALUES(1,'test','text','{}','a','sending')");
 sqlite.prepare("INSERT INTO broadcast_recipients(broadcast_id,follower_id,status,attempted_at) VALUES(1,1,'processing',?)").run(new Date(NOON).toISOString());
 if(change==='tag-valid'||change==='tag-removed')sqlite.exec("INSERT INTO tags(id,name,account_id) VALUES(1,'tag','a'); INSERT INTO follower_tags(follower_id,tag_id) VALUES(1,1); UPDATE broadcasts SET tag_filter='{\"tagId\":1}'");
 const version=await recruitmentBroadcastVersion(sqlite.prepare('SELECT * FROM broadcasts').get() as any);
 const mutate=()=>{
  if(change==='tag-removed')sqlite.exec('DELETE FROM follower_tags');
  if(change==='body-edit')sqlite.exec("UPDATE broadcasts SET body='changed'");
  if(change==='stopped')sqlite.exec("UPDATE broadcasts SET status='draft'");
  if(change==='recipient-stopped')sqlite.exec("UPDATE broadcast_recipients SET status='skipped'");
  if(change==='wrong-account'){sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('b','222','test','2026-01-01','2026-01-01'); UPDATE broadcasts SET account_id='b'");}
  if(change==='stale')sqlite.prepare('UPDATE broadcast_recipients SET attempted_at=?').run(new Date(NOON-60001).toISOString());
 };
 const send=make(mutate,'broadcast:1:1',change==='missing-proof'?undefined:version).sendText('student','test');
 if(change==='valid'||change==='tag-valid'){await send;expect(fetch).toHaveBeenCalledOnce();}else{await expect(send).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();}
});
