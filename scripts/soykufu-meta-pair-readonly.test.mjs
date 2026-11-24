import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMetaPair,PAIR_SCOPES,assessMetaTokenLifecycle,assessMetaTokenReplacement} from './soykufu-meta-pair-readonly.mjs';
const token='fixture+token&with?characters',secret='a'.repeat(32),time=Date.parse('2026-11-24T00:00:00Z');
const env={GITHUB_REPOSITORY:'soykufu/ig-harness-oss',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',IG_META_APP_SECRET:secret,IG_META_USER_ACCESS_TOKEN:token};
const data=()=>({app_id:'2224712165014101',type:'USER',is_valid:true,scopes:[...PAIR_SCOPES],granular_scopes:[{scope:'pages_show_list',target_ids:['fixed-page']}],expires_at:time/1000+86400,data_access_expires_at:time/1000+8640000,user_id:'private-user'});
const response=body=>async()=>new Response(JSON.stringify({data:body}));
const seconds=time/1000,day=86400;
const replacement=()=>({...data(),expires_at:seconds+60*day});
test('lifecycle labels current short token without authorizing exchange or storage',()=>{
 const r=assessMetaTokenLifecycle(data(),seconds);
 assert.deepEqual(r,{state:'exchange_review_ready',reason:null,remainingBand:'within_24_hours',exchangeReviewReady:true,exchangeAuthorized:false,storageAuthorized:false});
 assert.equal(assessMetaTokenLifecycle(replacement(),seconds).state,'validity_monitoring');
});
for(const [remaining,band]of [[901,'within_1_hour'],[3600,'within_1_hour'],[3601,'within_24_hours'],[day,'within_24_hours'],[day+1,'within_7_days'],[7*day,'within_7_days'],[7*day+1,'beyond_7_days']])test(`lifetime threshold ${remaining}`,()=>assert.equal(assessMetaTokenLifecycle({...data(),expires_at:seconds+remaining},seconds).remainingBand,band));
for(const patch of [{type:'PAGE'},{type:undefined},{app_id:'other'},{is_valid:false},{error:{message:token}},{scopes:[...PAIR_SCOPES,PAIR_SCOPES[0]]},{scopes:[...PAIR_SCOPES,'']},{expires_at:0},{expires_at:undefined},{expires_at:seconds},{expires_at:seconds+900},{expires_at:'9999999999'},{data_access_expires_at:0},{data_access_expires_at:seconds+900}])test(`lifecycle holds ${JSON.stringify(patch)}`,()=>{
 const r=assessMetaTokenLifecycle({...data(),...patch},seconds);assert.equal(r.state,'held');assert.equal(r.exchangeReviewReady,false);assert.equal(r.storageAuthorized,false);assert.ok(!JSON.stringify(r).includes(token));
});
for(const now of [NaN,Infinity,0,-1,seconds+.5])test(`invalid lifecycle clock ${now}`,()=>assert.equal(assessMetaTokenLifecycle(data(),now).state,'held'));
test('replacement accepts same subject/scopes/targets with documented lifetime range but grants no storage permission',()=>{
 const before=data(),after={...replacement(),scopes:[...PAIR_SCOPES].reverse()};
 const r=assessMetaTokenReplacement(before,after,seconds);
 assert.deepEqual(r,{state:'replacement_metadata_verified',reason:null,replacementVerified:true,storageAuthorized:false,registrationAuthorized:false});
 for(const value of ['private-user','fixed-page',token,secret])assert.ok(!JSON.stringify(r).includes(value));
 assert.equal(before.expires_at,seconds+day);
});
for(const patch of [{user_id:'other-user'},{user_id:undefined},{type:'PAGE'},{app_id:'other'},{is_valid:false},{expires_at:seconds+day},{expires_at:seconds+7*day},{expires_at:seconds+61*day+1},{expires_at:0},{scopes:[...PAIR_SCOPES,'new_permission']},{scopes:PAIR_SCOPES.slice(1)},{granular_scopes:undefined},{granular_scopes:[{scope:'pages_show_list',target_ids:['other-page']}]},{granular_scopes:[{scope:'pages_show_list',target_ids:['fixed-page','other-page']}]},{granular_scopes:[{scope:'pages_show_list',target_ids:['fixed-page','fixed-page']}]},{granular_scopes:[{scope:'pages_show_list',target_ids:['fixed-page']},{scope:'pages_show_list',target_ids:['fixed-page']}]},{data_access_expires_at:seconds+101*day},{data_access_expires_at:seconds+90*day}])test(`replacement rejects ${JSON.stringify(patch)}`,()=>{
 const r=assessMetaTokenReplacement(data(),{...replacement(),...patch},seconds);assert.equal(r.state,'held');assert.equal(r.replacementVerified,false);assert.equal(r.storageAuthorized,false);
});
test('expiry between validation stages cannot authorize a replacement',()=>assert.equal(assessMetaTokenReplacement(data(),replacement(),seconds+day).state,'held'));
test('unknown initial subject and target metadata cannot be adopted',()=>{
 assert.equal(assessMetaTokenReplacement({...data(),user_id:''},replacement(),seconds).state,'held');
 assert.equal(assessMetaTokenReplacement({...data(),granular_scopes:undefined},replacement(),seconds).state,'held');
});
test('a token already beyond seven days must not be repeatedly exchanged',()=>assert.equal(assessMetaTokenReplacement({...data(),expires_at:seconds+8*day},replacement(),seconds).reason,'exchange_not_needed'));
test('a nearly expired data-access grant cannot be hidden by a longer token',()=>{
 const before={...data(),data_access_expires_at:seconds+7*day};
 assert.equal(assessMetaTokenReplacement(before,{...replacement(),data_access_expires_at:before.data_access_expires_at},seconds).reason,'data_access_renewal_required');
});
test('target-set ordering does not create a false scope change',()=>{
 const targets=[{scope:'pages_show_list',target_ids:['a','b']},{scope:'business_management',target_ids:[]}];
 const reverse=[{scope:'business_management',target_ids:[]},{scope:'pages_show_list',target_ids:['b','a']}];
 assert.equal(assessMetaTokenReplacement({...data(),granular_scopes:targets},{...replacement(),granular_scopes:reverse},seconds).replacementVerified,true);
});
test('one official GET checks the pair; query/errors/identity never returned',async()=>{
 let calls=0;const r=await inspectMetaPair(env,async(url,options)=>{calls++;const u=new URL(url);assert.equal(u.origin,'https://graph.facebook.com');assert.equal(u.pathname,'/v25.0/debug_token');assert.equal(u.searchParams.get('input_token'),token);assert.equal(u.searchParams.has('access_token'),false);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,`Bearer 2224712165014101|${secret}`);return new Response(JSON.stringify({data:data()}));},()=>time);
 assert.equal(calls,1);assert.equal(r.state,'token_app_pair_verified');assert.equal(r.tokenExpiryWithin7Days,true);assert.equal(r.dataAccessExpiryWithin7Days,false);assert.equal(r.credentialsInstalled,false);assert.equal(r.registrationAttempted,false);assert.equal(r.targetAssetRechecked,false);for(const marker of [token,secret,'private-user','debug_token'])assert.ok(!JSON.stringify(r).includes(marker));
});
for(const patch of [{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/dev'},{GITHUB_EVENT_NAME:'push'},{GITHUB_EVENT_NAME:'pull_request'},{IG_META_APP_SECRET:''},{IG_META_USER_ACCESS_TOKEN:''},{IG_META_USER_ACCESS_TOKEN:' '+token},{IG_META_USER_ACCESS_TOKEN:'a\nb'},{IG_META_APP_SECRET:'bad'}])test(`reject before network ${Object.keys(patch)}`,async()=>{let calls=0;assert.equal((await inspectMetaPair({...env,...patch},async()=>{calls++;},()=>time)).ok,false);assert.equal(calls,0);});
for(const [patch,state]of [[{app_id:'other'},'token_app_mismatch'],[{is_valid:false},'token_not_valid'],[{is_valid:'true'},'token_not_valid'],[{expires_at:time/1000},'token_expired'],[{data_access_expires_at:time/1000-1},'token_expired'],[{expires_at:-1},'token_expiry_unverified'],[{expires_at:'0'},'token_expiry_unverified'],[{scopes:undefined},'token_scopes_unverified'],[{scopes:PAIR_SCOPES.slice(1)},'token_scopes_missing'],[{scopes:[...PAIR_SCOPES,PAIR_SCOPES[0]]},'token_scopes_missing']])test(`hold ${state} ${Object.keys(patch)}`,async()=>assert.equal((await inspectMetaPair(env,response({...data(),...patch}),()=>time)).state,state));
test('unknown or zero expiry is not unlimited-lifetime proof',async()=>{const r=await inspectMetaPair(env,response({...data(),expires_at:0,data_access_expires_at:undefined}),()=>time);assert.equal(r.ok,true);assert.equal(r.tokenExpiryWithin7Days,null);assert.equal(r.dataAccessExpiryWithin7Days,null);});
test('nested invalid-token response preserves only safe reason codes and expiry evidence',async()=>{
 const r=await inspectMetaPair(env,response({...data(),is_valid:false,expires_at:time/1000-1,error:{code:190,subcode:463,message:secret+token}}),()=>time);
 assert.deepEqual(r,{ok:false,state:'token_not_valid',graphCode:190,graphSubcode:463,appMatches:true,tokenValid:false,expiryElapsed:true});assert.ok(!JSON.stringify(r).includes(secret));
});
test('nested error cannot report a guessed app identity or expiry',async()=>{
 const r=await inspectMetaPair(env,response({is_valid:false,error:{code:190,error_subcode:467,message:token}}),()=>time);
 assert.equal(r.appMatches,null);assert.equal(r.expiryElapsed,null);assert.equal(r.graphSubcode,467);
});
test('non-numeric error codes never echo transport content',async()=>{
 const r=await inspectMetaPair(env,response({error:{code:token,subcode:secret,message:secret}}),()=>time);assert.equal(r.graphCode,null);assert.equal(r.graphSubcode,null);assert.ok(!JSON.stringify(r).includes(secret));
});
test('top-level API errors expose numeric diagnostics only',async()=>{
 const r=await inspectMetaPair(env,async()=>new Response(JSON.stringify({error:{code:190,error_subcode:463,message:token+secret}})),()=>time);assert.equal(r.graphCode,190);assert.equal(r.graphSubcode,463);assert.equal(r.appMatches,null);assert.ok(!JSON.stringify(r).includes(token));
});
test('HTTP failure does not inspect raw body or retry',async()=>{let calls=0;const r=await inspectMetaPair(env,async()=>{calls++;return{ok:false,get body(){throw Error(secret);}};});assert.equal(r.state,'pair_read_failed');assert.equal(calls,1);});
for(const mode of ['throw','invalid-json','api-error','oversize'])test(`no raw disclosure ${mode}`,async()=>{let calls=0;const r=await inspectMetaPair(env,async(url)=>{calls++;if(mode==='throw')throw Error(url+secret);if(mode==='invalid-json')return new Response(token);if(mode==='api-error')return new Response(JSON.stringify({error:{message:token+secret}}));return new Response('x'.repeat(65537));},()=>time);assert.equal(r.ok,false);assert.equal(calls,1);assert.ok(!JSON.stringify(r).includes(secret));assert.ok(!JSON.stringify(r).includes(token));});
