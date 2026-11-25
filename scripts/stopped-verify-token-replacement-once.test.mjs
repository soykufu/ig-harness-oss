import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {verifyReplacementRun} from './stopped-verify-token-replacement-once.mjs';
import {installVerifyTokenOnce} from './stopped-receiving-verify-token-once.mjs';
const official={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'soykufu/ig-harness-oss',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_NUMBER:'96',GITHUB_RUN_ATTEMPT:'1',APPROVED_VERIFY_TOKEN_REPLACEMENT:'saved-note-replacement-only'};
test('only separately approved replacement run 96 attempt 1 is authorized',()=>{
 assert.equal(verifyReplacementRun(official),true);
 for(const [key,value]of Object.entries({GITHUB_ACTIONS:'false',GITHUB_REPOSITORY:'foreign/repo',GITHUB_REF:'refs/heads/other',GITHUB_EVENT_NAME:'push',GITHUB_RUN_NUMBER:'93',GITHUB_RUN_ATTEMPT:'2',APPROVED_VERIFY_TOKEN_REPLACEMENT:'fixed-account-verification-only'}))assert.equal(verifyReplacementRun({...official,[key]:value}),false);
 for(const n of ['95','97'])assert.equal(verifyReplacementRun({...official,GITHUB_RUN_NUMBER:n}),false);
});
test('consumed replacement CLI cannot read live secrets or perform network requests',async()=>{
 const source=await readFile(new URL('./stopped-verify-token-replacement-once.mjs',import.meta.url),'utf8');
 assert.match(source,/verify_token_replacement_retired/);assert.match(source,/consumedRunId:45624136946/);
 assert.doesNotMatch(source,/process\.env|fetch\(|method:'PATCH'|boundedJson/);
});
test('retired CLI emits only consumed state without the candidate',()=>{
 const value='synthetic_candidate_value_1234567890';
 const r=spawnSync(process.execPath,[new URL('./stopped-verify-token-replacement-once.mjs',import.meta.url).pathname],{env:{...official,IG_WEBHOOK_VERIFY_TOKEN:value},encoding:'utf8'});
 assert.equal(r.status,1);const receipt=JSON.parse(r.stdout);assert.equal(receipt.state,'verify_token_replacement_retired');assert.equal(receipt.consumedRunId,45624136946);assert.equal(receipt.credentialWriteAttempted,false);assert.ok(!r.stdout.includes(value));assert.equal(r.stderr,'');
});
test('prior one-time CLI remains retired and has no credential transport',async()=>{
 const source=await readFile(new URL('./stopped-receiving-verify-token-once.mjs',import.meta.url),'utf8');
 assert.match(source,/consumedRunId:45617138533/);assert.match(source,/receiving_verify_token_retired/);
 assert.doesNotMatch(source,/process\.env|fetch\(|method:'PATCH'/);
});
function fixture(){
 let changed=false;const calls=[];
 const stable={runtime:{deploymentStable:true,deployedBindingsVerified:true,preparationLockVerified:true,extraFlagsVerified:true,r2DirectPublicAccessDisabled:true,deploymentFingerprint:'154f4550c1a25a023cbc2e2b01239e07bddd138e0a6095f4dd7a6ceee3e868e6'},installation:{stopped:true,connectedAccounts:1,followers:0,registeredAccountVerified:true,schemaReady:true,appliedMigrationCount:41},account:{id:'12345678-1234-1234-1234-123456789abc',igUserId:'17841402028638204',username:'soykufu',pageId:'1632563283635095',connectionType:'facebook_login',isActive:true,isDefault:false,hasAppSecret:true},business:{data:'same'},paused:true,integrity:true};
 return{calls,options:{official:true,credentialValid:true,snapshot:async()=>({...stable,candidateMatches:changed}),inspectApp:async()=>({ok:true,appIdentityVerified:true,listingIncomplete:false,appObjectCount:0,unrelatedObjectCount:0,objects:[]}),patch:async()=>{calls.push('patch');changed=true;return true;}}};
}
test('replacement preserves previous controls and reports exact matching without exposing value',async()=>{
 const f=fixture(),r=await installVerifyTokenOnce(f.options);assert.equal(r.ok,true);assert.equal(r.dedicatedCandidateMatched,true);assert.equal(r.existingPageTokenUnchanged,true);assert.equal(r.existingAppSecretUnchanged,true);assert.equal(r.guardrailsPaused,true);assert.equal(r.preparationLock,true);assert.equal(r.subscriptionAttempted,false);assert.equal(r.webhookRequestAttempted,false);assert.equal(r.messagesSent,0);assert.deepEqual(f.calls,['patch']);
});
test('already equal candidate is never rewritten',async()=>{
 const f=fixture(),read=f.options.snapshot;f.options.snapshot=async()=>({...await read(),candidateMatches:true});const r=await installVerifyTokenOnce(f.options);assert.equal(r.ok,true);assert.equal(r.alreadyConfigured,true);assert.deepEqual(f.calls,[]);
});
test('ambiguous replacement is not retried and transport details stay hidden',async()=>{
 const f=fixture();f.options.patch=async()=>{f.calls.push('patch');throw Error('private-response');};const r=await installVerifyTokenOnce(f.options);assert.equal(r.ok,false);assert.equal(r.credentialWriteAttempted,true);assert.deepEqual(f.calls,['patch']);assert.doesNotMatch(JSON.stringify(r),/private-response/);
});
