import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyOfficialRun,dedicatedValue,maskVerifyColumns,installVerifyTokenOnce} from './stopped-receiving-verify-token-once.mjs';
const official={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'soykufu/ig-harness-oss',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_NUMBER:'93',GITHUB_RUN_ATTEMPT:'1',APPROVED_RECEIVING_VERIFY_TOKEN:'fixed-account-verification-only'};
function fixture(){
 let changed=false;const calls=[];
 const snapshot=()=>({
 runtime:{deploymentStable:true,deployedBindingsVerified:true,preparationLockVerified:true,extraFlagsVerified:true,r2DirectPublicAccessDisabled:true,deploymentFingerprint:'154f4550c1a25a023cbc2e2b01239e07bddd138e0a6095f4dd7a6ceee3e868e6',connectionCredentialMetadata:{stable:true}},
 installation:{stopped:true,connectedAccounts:1,followers:0,registeredAccountVerified:true,schemaReady:true,appliedMigrationCount:41},
 account:{id:'12345678-1234-1234-1234-123456789abc',igUserId:'17841402028638204',username:'soykufu',pageId:'1632563283635095',connectionType:'facebook_login',isActive:true,isDefault:false,hasAppSecret:true},
 business:{schema:'stable-schema',data:'unchanged-except-two-allowed-columns'},candidateMatches:changed,paused:true,integrity:true});
 return {calls,options:{official:true,credentialValid:true,snapshot:async()=>snapshot(),inspectApp:async()=>({ok:true,appIdentityVerified:true,listingIncomplete:false,appObjectCount:0,unrelatedObjectCount:0,objects:[]}),patch:async id=>{calls.push(['patch',id]);changed=true;return true;}}};
}
test('official run is exactly scoped and rejects other context or repeat',()=>{
 assert.equal(verifyOfficialRun(official),true);
 for(const [key,value]of Object.entries({GITHUB_ACTIONS:'false',GITHUB_REPOSITORY:'other/repo',GITHUB_REF:'refs/heads/other',GITHUB_EVENT_NAME:'push',GITHUB_RUN_NUMBER:'94',GITHUB_RUN_ATTEMPT:'2',APPROVED_RECEIVING_VERIFY_TOKEN:''})){
  assert.equal(verifyOfficialRun({...official,[key]:value}),false);
 }
});
test('dedicated candidate must have safe format and cannot reuse existing credentials',()=>{
 const v='synthetic_test_value_only_123456789';
 assert.equal(dedicatedValue({IG_WEBHOOK_VERIFY_TOKEN:v}),true);
 for(const value of [undefined,'','short','x'.repeat(257),'x'.repeat(32)+'\n','文字'.repeat(40),{}])assert.equal(dedicatedValue({IG_WEBHOOK_VERIFY_TOKEN:value}),false);
 for(const key of ['IG_HARNESS_API_KEY','IG_META_APP_SECRET'])assert.equal(dedicatedValue({IG_WEBHOOK_VERIFY_TOKEN:v,[key]:v}),false);
});
test('one fixed account credential PATCH, matching postcheck and no webhook request or subscription',async()=>{
 const f=fixture(),r=await installVerifyTokenOnce(f.options);
 assert.equal(r.ok,true);assert.equal(r.credentialAccepted,true);assert.equal(r.existingPageTokenUnchanged,true);assert.equal(r.existingAppSecretUnchanged,true);
 assert.equal(r.webhookRequestAttempted,false);assert.equal(r.subscriptionAttempted,false);assert.equal(r.messagesSent,0);assert.equal(r.receivingVerified,false);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'patch');
});
test('already matching candidate is audited without reapplying',async()=>{
 const f=fixture(),snapshot=f.options.snapshot;f.options.snapshot=async()=>({...await snapshot(),candidateMatches:true});
 const r=await installVerifyTokenOnce(f.options);assert.equal(r.ok,true);assert.equal(r.alreadyConfigured,true);assert.deepEqual(f.calls,[]);
});
for(const mode of ['not-official','bad-candidate','unpaused','unlocked','wrong-page','wrong-schema','live-followers','bad-integrity','changed-runtime','active-subscription','incomplete-listing','precheck-drift'])test('no write for '+mode,async()=>{
 const f=fixture(),snapshot=f.options.snapshot;let n=0;
 if(mode==='not-official')f.options.official=false;
 if(mode==='bad-candidate')f.options.credentialValid=false;
 if(mode==='active-subscription')f.options.inspectApp=async()=>({ok:true,appIdentityVerified:true,listingIncomplete:false,objects:[{object:'instagram'}]});
 if(mode==='incomplete-listing')f.options.inspectApp=async()=>({ok:true,appIdentityVerified:true,listingIncomplete:true,objects:[]});
 f.options.snapshot=async()=>{
  const s=await snapshot();n++;
  if(mode==='unpaused')s.paused=false;if(mode==='unlocked')s.runtime.preparationLockVerified=false;
  if(mode==='wrong-page')s.account.pageId='foreign';if(mode==='wrong-schema')s.installation.appliedMigrationCount=40;
  if(mode==='live-followers')s.installation.followers=1;if(mode==='bad-integrity')s.integrity=false;
  if(mode==='changed-runtime')s.runtime.deploymentFingerprint='new-version';
  if(mode==='precheck-drift'&&n>=2)s.business.data='changed';
  return s;
 };
 const r=await installVerifyTokenOnce(f.options);assert.equal(r.ok,false);assert.equal(r.credentialWriteAttempted,false);assert.deepEqual(f.calls,[]);
});
test('ambiguous PATCH is never retried and raw failure is suppressed',async()=>{
 const f=fixture();f.options.patch=async()=>{f.calls.push('patch');throw Error('sensitive transport details');};
 const r=await installVerifyTokenOnce(f.options);assert.equal(r.ok,false);assert.equal(r.credentialWriteAttempted,true);assert.equal(f.calls.length,1);assert.doesNotMatch(JSON.stringify(r),/sensitive transport details/);
});
for(const mode of ['unchanged-value','business-change','runtime-change','stop-change','subscription-change','final-drift'])test('hold post-write '+mode+' without retry',async()=>{
 const f=fixture(),snapshot=f.options.snapshot,app=f.options.inspectApp;let n=0,a=0;
 f.options.snapshot=async()=>{
  const s=await snapshot();n++;
  if(n>=3){
   if(mode==='unchanged-value')s.candidateMatches=false;
   if(mode==='business-change')s.business.data='foreign-change';
   if(mode==='runtime-change')s.runtime.deploymentFingerprint='new';
   if(mode==='stop-change')s.paused=false;
   if(mode==='final-drift'&&n>=4)s.business.data='foreign-final';
  }
  return s;
 };
 f.options.inspectApp=async()=>{const v=await app();if(mode==='subscription-change'&&++a>=2)v.objects=[{object:'instagram'}];return v;};
 const r=await installVerifyTokenOnce(f.options);assert.equal(r.ok,false);assert.equal(r.credentialAccepted,true);assert.equal(f.calls.length,1);
});
test('mask exactly verify_token and updated_at, preserving other account cells',()=>{
 const columns=['id','verify_token','updated_at','access_token','app_secret'].map(name=>({name}));
 const before=[{t0:'text',v0:'id',t1:'null',v1:'',t2:'text',v2:'old-time',t3:'text',v3:'page-cipher',t4:'text',v4:'secret-cipher'}];
 const changed=structuredClone(before);changed[0].t1='text';changed[0].v1='new-private-value';changed[0].v2='new-time';
 assert.deepEqual(maskVerifyColumns(before,columns),maskVerifyColumns(changed,columns));
 for(const k of ['v0','v3','v4']){const foreign=structuredClone(changed);foreign[0][k]='different';assert.notDeepEqual(maskVerifyColumns(before,columns),maskVerifyColumns(foreign,columns));}
 assert.equal(before[0].t1,'null');assert.throws(()=>maskVerifyColumns([],columns));assert.throws(()=>maskVerifyColumns([...before,...before],columns));assert.throws(()=>maskVerifyColumns(before,columns.slice(0,1)));
});
test('consumed CLI has no live credential or network transport',async()=>{
 const source=await readFile(new URL('./stopped-receiving-verify-token-once.mjs',import.meta.url),'utf8');
 assert.match(source,/receiving_verify_token_retired/);
 assert.match(source,/consumedRunId:45617138533/);
 assert.doesNotMatch(source,/process\.env|fetch\(|method:'PATCH'|boundedJson|IG_META_USER_ACCESS_TOKEN/);
});
