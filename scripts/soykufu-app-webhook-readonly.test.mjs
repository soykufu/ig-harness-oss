import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectAppWebhook,APP_ID} from './soykufu-app-webhook-readonly.mjs';
const secret='a'.repeat(32);
const env={GITHUB_REPOSITORY:'soykufu/ig-harness-oss',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',IG_META_APP_SECRET:secret};
const callback='https://soykufu-ig-harness-20261119.soykufu.workers.dev/webhook';
function api(bodies=[{id:APP_ID},{data:[]}]){const calls=[];return{calls,fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(bodies[calls.length-1]));}};}
test('correct app metadata only; fixed endpoints, header auth, no redirect or callback request',async()=>{
 const a=api([{id:APP_ID},{data:[{object:'instagram',callback_url:callback,fields:[{name:'messages'}]}]}]);
 const r=await inspectAppWebhook(env,a.fetch);assert.equal(r.ok,true);assert.equal(r.objects[0].callbackMatches,true);
 assert.equal(r.receivingVerified,false);assert.equal(r.credentialsInstalled,false);assert.equal(r.subscriptionAttempted,false);assert.equal(a.calls.length,2);
 for(const {url,options}of a.calls){assert.equal(new URL(url).origin,'https://graph.facebook.com');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,`Bearer ${APP_ID}|${secret}`);assert.ok(!url.includes(secret));}
 assert.ok(!JSON.stringify(r).includes(secret));
});
for(const patch of [{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/other'},{GITHUB_EVENT_NAME:'push'},{GITHUB_EVENT_NAME:'pull_request'},{IG_META_APP_SECRET:''},{IG_META_APP_SECRET:' '+secret},{IG_META_APP_SECRET:secret+'\n'},{IG_META_APP_SECRET:'not-a-secret'}])test(`reject without network ${JSON.stringify(Object.keys(patch))}`,async()=>{let calls=0;const r=await inspectAppWebhook({...env,...patch},async()=>{calls++;});assert.equal(r.ok,false);assert.equal(calls,0);});
test('wrong app cannot inspect subscriptions',async()=>{const a=api([{id:'other'}]);const r=await inspectAppWebhook(env,a.fetch);assert.equal(r.state,'app_identity_mismatch');assert.equal(a.calls.length,1);});
test('foreign callbacks and unknown fields are recorded without raw URLs or values',async()=>{
 const marker='private-data-do-not-return';const a=api([{id:APP_ID},{data:[{object:'page',callback_url:'https://other.invalid/'+marker,fields:[{name:'messages'},{name:marker}],extra:secret}]}]);
 const r=await inspectAppWebhook(env,a.fetch);assert.equal(r.objects[0].callbackMatches,false);assert.equal(r.objects[0].unknownFieldsPresent,true);assert.ok(!JSON.stringify(r).includes(marker));assert.ok(!JSON.stringify(r).includes(secret));
});
test('does not union fields across callbacks or discard ambiguous duplicate objects',async()=>{
 const a=api([{id:APP_ID},{data:[{object:'page',callback_url:callback,fields:[{name:'messages'}]},{object:'page',callback_url:'https://other.invalid/',fields:[{name:'messaging_postbacks'}]}]}]);
 const r=await inspectAppWebhook(env,a.fetch);assert.equal(r.objects.length,2);assert.deepEqual(r.objects[0].fields,['messages']);assert.equal(r.receivingVerified,false);
});
test('pagination is marked incomplete and never followed',async()=>{const a=api([{id:APP_ID},{data:[],paging:{next:'https://evil.invalid/'+secret}}]);const r=await inspectAppWebhook(env,a.fetch);assert.equal(r.listingIncomplete,true);assert.equal(a.calls.length,2);assert.ok(!JSON.stringify(r).includes(secret));});
test('malformed listing is not an empty subscription list',async()=>{const a=api([{id:APP_ID},{data:null}]);assert.equal((await inspectAppWebhook(env,a.fetch)).state,'subscription_response_unverified');});
test('missing fields are unknown rather than success',async()=>{const a=api([{id:APP_ID},{data:[{object:'instagram',callback_url:callback}]}]);assert.equal((await inspectAppWebhook(env,a.fetch)).objects[0].fieldsVerified,false);});
test('documented string fields and active=false remain distinct from receiving success',async()=>{const a=api([{id:APP_ID},{data:[{object:'instagram',callback_url:callback,active:false,fields:['messages','messaging_postbacks']}]}]);const r=await inspectAppWebhook(env,a.fetch);assert.equal(r.objects[0].fieldsVerified,true);assert.deepEqual(r.objects[0].fields,['messages','messaging_postbacks']);assert.equal(r.objects[0].active,false);assert.equal(r.receivingVerified,false);});
test('HTTP errors do not read bodies or retry',async()=>{let calls=0;const r=await inspectAppWebhook(env,async()=>{calls++;return{ok:false,get body(){throw Error(secret);}};});assert.equal(r.state,'app_read_failed');assert.equal(calls,1);assert.ok(!JSON.stringify(r).includes(secret));});
for(const mode of ['throw','invalid-json','api-error','oversize'])test(`no transport disclosure ${mode}`,async()=>{
 let calls=0;const r=await inspectAppWebhook(env,async()=>{calls++;if(mode==='throw')throw Error(secret);if(mode==='invalid-json')return new Response(secret);if(mode==='api-error')return new Response(JSON.stringify({error:{message:secret}}));return new Response('x'.repeat(65537));});assert.equal(r.ok,false);assert.equal(calls,1);assert.ok(!JSON.stringify(r).includes(secret));
});

test('reports only counts for unrelated subscription shapes without exposing their values',async()=>{const marker='private-unrelated-field';const a=api([{id:APP_ID},{data:[{object:'threads',fields:[marker]}]}]);const r=await inspectAppWebhook(env,a.fetch);assert.equal(r.appObjectCount,1);assert.equal(r.unrelatedObjectCount,1);assert.equal(r.unrelatedFieldShapeUnverified,true);assert.deepEqual(r.objects,[]);assert.doesNotMatch(JSON.stringify(r),new RegExp(marker));});
