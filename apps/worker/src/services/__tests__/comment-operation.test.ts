import {beforeEach,afterEach,expect,it,vi} from 'vitest';
// Keep delivery-path tests inside the allowed JST window regardless of runner time.
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-21T03:00:00Z'));});
import {gateFixture} from '../../test-utils/gate-fixture.js';
import {enqueueCommentRuleJob,processCommentRuleJobs,resumeCommentJobs} from '../comment-rule-jobs.js';
import {commentJobClientFactory} from '../../lib/accounts.js';
const close:(()=>void)[]=[];
afterEach(()=>{while(close.length)close.pop()!();vi.useRealTimers();vi.useRealTimers();});
async function fixture(){const f=await gateFixture();close.push(()=>f.sqlite.close());return f;}
async function queue(f:Awaited<ReturnType<typeof fixture>>,id='c'){await enqueueCommentRuleJob(f.db,{accountId:'a',ruleId:'r',commentId:id,followerId:1,messageType:'text',body:JSON.stringify({text:'guide'}),replyText:null,delaySeconds:0,commentCreatedAt:new Date(Date.now()-1000).toISOString()});}
it('keeps distinct durable private and post-inbound DM phase identities',async()=>{
 const f=await fixture();
 await enqueueCommentRuleJob(f.db,{accountId:'a',ruleId:'r',commentId:'c',followerId:1,messageType:'image',body:JSON.stringify({url:'https://example.com/a.jpg'}),replyText:null,delaySeconds:0,commentCreatedAt:new Date(Date.now()-1000).toISOString()});
 const keyed={...f.client,sendPrivateReply:vi.fn(async()=>({message_id:'private'})),sendImage:vi.fn(async()=>({message_id:'dm'}))};
 const factory=vi.fn(async(_key:string)=>keyed as any);
 await processCommentRuleJobs(f.db,f.client as any,'a',factory);
 expect(factory.mock.calls.map(c=>c[0])).toEqual(['comment:a:c:r']);
 expect(f.client.sendPrivateReply).not.toHaveBeenCalled();expect(keyed.sendPrivateReply).toHaveBeenCalledOnce();
 f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date().toISOString());
 await resumeCommentJobs(f.db,1,'a');
 await processCommentRuleJobs(f.db,f.client as any,'a',factory);
 expect(factory.mock.calls.map(c=>c[0])).toEqual(['comment:a:c:r','comment-dm:a:c:r']);
 expect(keyed.sendImage).toHaveBeenCalledOnce();expect(f.client.sendImage).not.toHaveBeenCalled();
 await processCommentRuleJobs(f.db,f.client as any,'a',factory);expect(factory).toHaveBeenCalledTimes(2);
});
it('never falls back to a shared sender when operation authority fails',async()=>{
 const f=await fixture();await queue(f);
 await processCommentRuleJobs(f.db,f.client as any,'a',async()=>{throw Error('authority missing');});
 expect(f.client.sendPrivateReply).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT status FROM comment_rule_jobs').get()?.status).toBe('uncertain');
});
it('does not construct clients or claim work while paused',async()=>{
 const f=await fixture();await queue(f);f.sqlite.exec("INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1')");const factory=vi.fn();
 await processCommentRuleJobs(f.db,f.client as any,'a',factory);expect(factory).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT status FROM comment_rule_jobs').get()?.status).toBe('pending');
});
it.each(['missing','legacy','stale','future'])( 'does not mint authority from %s ownership evidence',async state=>{
 const f=await fixture();const now=Date.now();
 if(state!=='missing')f.sqlite.prepare('INSERT INTO recruitment_outbound_control VALUES(?,?,?,?)').run('a','epoch',state==='legacy'?'legacy':'harness',state==='stale'?now-60001:state==='future'?now+10000:now);
 const factory=commentJobClientFactory({RECRUITMENT_LEDGER_ENFORCEMENT:'1',IG_USER_ID:'111',IG_ACCESS_TOKEN:'test'},f.db,{id:'a'} as any)!;
 await expect(factory('comment:a:c:r')).rejects.toThrow('reconciliation');
 expect(f.sqlite.prepare('SELECT COUNT(*) n FROM recruitment_outbound_operations').get()?.n).toBe(0);
});
