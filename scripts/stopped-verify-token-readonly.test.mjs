import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectVerifyToken} from './stopped-verify-token-readonly.mjs';
const official={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'soykufu/ig-harness-oss',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'push',GITHUB_RUN_NUMBER:'90',GITHUB_RUN_ATTEMPT:'1'};
test('only fixed official run accepts a dedicated verification value and emits metadata',()=>{
 const value='synthetic_boundary_value_1234567890';
 const result=inspectVerifyToken({...official,IG_WEBHOOK_VERIFY_TOKEN:value});
 assert.equal(result.ok,true);assert.equal(result.present,true);assert.equal(result.formatValid,true);
 assert.equal(result.credentialWritesAttempted,false);assert.equal(result.networkRequests,0);assert.equal(result.subscriptionAttempted,false);assert.equal(result.messagesSent,0);
 assert.ok(!JSON.stringify(result).includes(value));
});
test('missing and malformed values never leak into receipts',()=>{
 for(const value of [undefined,'','short','x'.repeat(257),'x'.repeat(32)+'\n','with spaces '+ 'x'.repeat(40),'記号'.repeat(32),{},null]){
  const r=inspectVerifyToken({...official,IG_WEBHOOK_VERIFY_TOKEN:value});
  assert.equal(r.ok,false);assert.equal(r.formatValid,false);assert.ok(Object.values(r).every(v=>typeof v==='string'||typeof v==='boolean'||typeof v==='number'));
  if(typeof value==='string'&&value.length>0)assert.ok(!JSON.stringify(r).includes(value));
 }
});
test('wrong repo ref event number and retry are refused before value lookup',()=>{
 for(const [key,value] of Object.entries({...official,GITHUB_ACTIONS:'false',GITHUB_REPOSITORY:'other/repo',GITHUB_REF:'refs/heads/other',GITHUB_EVENT_NAME:'pull_request',GITHUB_RUN_NUMBER:'91',GITHUB_RUN_ATTEMPT:'2'})){
  const env={...official,[key]:value};
  Object.defineProperty(env,'IG_WEBHOOK_VERIFY_TOKEN',{get(){throw Error('should_not_read');}});
  assert.equal(inspectVerifyToken(env).reason,'official_single_run_required');
 }
});
test('metadata checker has no remote transport persistence hashing or raw value output',async()=>{
 const source=await readFile(new URL('./stopped-verify-token-readonly.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/fetch\(|writeFile|setClipboard|createHash|crypto|console\.log\(value|throw.*value/);
 assert.match(source,/console\.log\(JSON.stringify\(result\)\)/);
});
