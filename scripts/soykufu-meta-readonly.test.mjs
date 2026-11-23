import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyMeta, REQUIRED } from './soykufu-meta-readonly.mjs';
const secret = 'fixture-secret-never-log';
const env = { GITHUB_REPOSITORY: 'soykufu/ig-harness-oss', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', IG_META_USER_ACCESS_TOKEN: secret };
const page = { id:'1632563283635095', instagram_business_account:{id:'17841402028638204',username:'soykufu'} };
const permissions = {data:REQUIRED.map(permission=>({permission,status:'granted'}))};
function api(bodies=[page,permissions]) { let calls=[]; return {calls,fetch:async(url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify(bodies[calls.length-1]));}}; }
test('exact identity and grants; GET only, header auth, fixed host, no redirect',async()=>{const a=api();const result=await verifyMeta(env,a.fetch);assert.equal(result.ok,true);assert.equal(a.calls.length,2);for(const {url,opts}of a.calls){assert.equal(new URL(url).origin,'https://graph.facebook.com');assert.ok(!url.includes(secret));assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,`Bearer ${secret}`);}assert.ok(!JSON.stringify(result).includes(secret));});
for(const patch of [{GITHUB_EVENT_NAME:'push'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/test'},{IG_META_USER_ACCESS_TOKEN:''},{IG_META_USER_ACCESS_TOKEN:' key '},{IG_META_USER_ACCESS_TOKEN:'a\nb'}])test(`reject before network ${Object.keys(patch)}`,async()=>{let calls=0;assert.equal((await verifyMeta({...env,...patch},async()=>{calls++;})).ok,false);assert.equal(calls,0);});
test('mismatched IG rejects',async()=>{const a=api([{...page,instagram_business_account:{...page.instagram_business_account,id:'9'}},permissions]);assert.equal((await verifyMeta(env,a.fetch)).state,'account_mismatch');});
test('declined grant is reported without raw response',async()=>{const a=api([page,{data:permissions.data.map(r=>r.permission==='instagram_manage_messages'?{...r,status:'declined'}:r)}]);assert.deepEqual((await verifyMeta(env,a.fetch)).missing,['instagram_manage_messages']);});
test('duplicate grant rejects ambiguous response',async()=>{const a=api([page,{data:[...permissions.data,permissions.data[0]]}]);assert.equal((await verifyMeta(env,a.fetch)).ok,false);});
test('paged response is not followed, cannot silently pass incomplete grants',async()=>{const a=api([page,{data:[],paging:{next:'https://evil.invalid/?token='+secret}}]);assert.equal((await verifyMeta(env,a.fetch)).ok,false);assert.equal(a.calls.length,2);});
test('exception never leaks secret or raw error',async()=>{const r=await verifyMeta(env,async()=>{throw new Error(secret);});assert.deepEqual(r,{ok:false,state:'meta_request_failed'});});
test('HTTP error body never read or exposed, no retry',async()=>{let n=0;const r=await verifyMeta(env,async()=>{n++;return new Response(secret,{status:400});});assert.equal(r.state,'meta_http_error');assert.equal(n,1);});
test('JSON error drops raw error content',async()=>{const a=api([{error:{message:secret}}]);assert.deepEqual(await verifyMeta(env,a.fetch),{ok:false,state:'meta_invalid_response'});});
test('invalid JSON rejected without content',async()=>{assert.deepEqual(await verifyMeta(env,async()=>new Response(secret)),{ok:false,state:'meta_request_failed'});});
test('oversize streamed response rejected',async()=>{const r=await verifyMeta(env,async()=>new Response('x'.repeat(65537)));assert.equal(r.state,'meta_response_too_large');});
