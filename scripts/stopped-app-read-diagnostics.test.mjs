import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectReceivingPreflight} from './stopped-receiving-preflight.mjs';
const env={GITHUB_REPOSITORY:'soykufu/ig-harness-oss',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch'};
function fixture(readFailure){return{env,
 readRuntime:async()=>({deploymentStable:true,deployedBindingsVerified:true,preparationLockVerified:true,extraFlagsVerified:true,deploymentFingerprint:'90cb7e59e4e7f173314fae5f6f4eb6617b9272b7059f738465ca6407413c4093'}),
 readAccounts:async()=>[{igUserId:'17841402028638204',username:'soykufu',pageId:'1632563283635095',connectionType:'facebook_login',isActive:true,isDefault:false}],
 readApp:async()=>({ok:true,appIdentityVerified:true}),
 readWorkerApp:async()=>({appId:'2224712165014101',status:'unknown',objects:[],message:'アプリ側の購読情報を確認できませんでした。',readFailure}),
};}
for(const code of ['transport','http_auth','http_rate_limit','http_other','body_read','response_too_large','invalid_json','invalid_response','invalid_fields','invalid_app_id'])test('retains fixed diagnostic '+code,async()=>{
 const r=await inspectReceivingPreflight(fixture(code));assert.equal(r.workerAppReadFailure,code);assert.equal(r.ok,false);assert.equal(r.subscriptionAttempted,false);assert.equal(r.credentialWritesAttempted,false);assert.equal(r.messagesSent,0);
});
for(const code of [undefined,'private-secret-value',{message:'private-secret-value'}])test('does not echo unknown or missing diagnostic '+typeof code,async()=>{
 const r=await inspectReceivingPreflight(fixture(code));assert.equal(r.workerAppReadFailure,'unavailable');assert.doesNotMatch(JSON.stringify(r),/private-secret-value/);
});
