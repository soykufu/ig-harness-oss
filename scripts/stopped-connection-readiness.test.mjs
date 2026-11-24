import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectConnectionCredentialMetadata as inspect, assessStoppedConnectionReadiness as assess} from './stopped-connection-readiness.mjs';
const fingerprint = '693814e3519ac1d1521ab0fb40288043d18952cf32cbee232d784fa5f72ac145';
const bindings = [{name:'TOKEN_ENCRYPTION_KEY',type:'secret_text'}];
const fixture = () => ({stopped:true,preparationLockVerified:true,extraFlagsVerified:true,connectedAccounts:0,followers:0,
  schemaReady:true,migrationInventory:{expected:41,applied:41,matching:41,missing:[],modified:[],unexpected:[],duplicates:[]},
  deploymentStable:true,deployedBindingsVerified:true,deploymentFingerprint:fingerprint,connectionCredentialMetadata:inspect(bindings)});
test('registration planning cannot imply reception, subscription or send authorization',()=>{
  const r=assess(fixture()); assert.equal(r.state,'stopped_registration_review_ready');
  assert.deepEqual(r.receivingPrerequisites,['app_secret_not_observed','verify_token_not_observed','expected_app_id_not_observed']);
  assert.equal(r.registrationSpec.subscribeWebhooks,false);
  for(const key of ['registrationAuthorized','webhookActivationAuthorized','messagesAuthorized','metaIdentityRechecked','credentialValuesRead','registrationAttempted','subscriptionAttempted'])assert.equal(r[key],false);
});
test('all credential metadata present is still neither validity nor activation proof',()=>{
  const s=fixture();s.connectionCredentialMetadata=inspect([...bindings,{name:'IG_APP_SECRET',type:'secret_text'},{name:'IG_VERIFY_TOKEN',type:'secret_text'},{name:'IG_APP_ID',type:'plain_text',text:'2224712165014101'}]);
  const r=assess(s);assert.deepEqual(r.receivingPrerequisites,[]);assert.equal(r.webhookActivationAuthorized,false);assert.equal(r.metaIdentityRechecked,false);
});
for(const patch of [{stopped:false},{stopped:'1'},{preparationLockVerified:false},{extraFlagsVerified:false},{connectedAccounts:1},{followers:1},{connectedAccounts:'0'},
 {schemaReady:false},{deploymentStable:false},{deployedBindingsVerified:false},{deploymentFingerprint:'changed'},{connectionCredentialMetadata:undefined}])
 test(`hold changed prerequisite ${JSON.stringify(patch)}`,()=>assert.equal(assess({...fixture(),...patch}).state,'held'));
for(const name of ['missing','modified','unexpected','duplicates'])test(`hold ledger ${name}`,()=>{
  const s=fixture();s.migrationInventory[name]=['changed.sql'];assert.equal(assess(s).state,'held');
});
test('partial ledger cannot pass even with schemaReady',()=>{const s=fixture();s.migrationInventory.applied=40;assert.equal(assess(s).state,'held');});
test('unknown evidence cannot pass',()=>assert.equal(assess(null).state,'held'));
for(const name of ['TOKEN_ENCRYPTION_KEY','IG_APP_SECRET','IG_VERIFY_TOKEN']) {
  test(`reject malformed duplicate credential ${name}`,()=>assert.equal(inspect([...bindings,{name,type:'secret_text'},{name,type:'secret_text'}]).verified,false));
  test(`reject plaintext credential ${name}`,()=>assert.equal(inspect([{name,type:'plain_text',text:'sensitive-value'}]).verified,false));
}
test('metadata inspector never accesses secret value fields',()=>{
 const row={name:'TOKEN_ENCRYPTION_KEY',type:'secret_text'};
 Object.defineProperty(row,'text',{get(){throw Error('secret field accessed');}});
 assert.equal(inspect([row]).tokenEncryptionKeyPresent,true);
});
test('unknown/duplicate environment defaults prevent accidental bootstrap planning',()=>{
 for(const row of [{name:'IG_ACCESS_TOKEN',type:'secret_text'},{name:'IG_USER_ID',type:'plain_text',text:'17841402028638204'}]){
 const s=fixture();s.connectionCredentialMetadata=inspect([...bindings,row]);assert.equal(assess(s).state,'held');}
});
test('raw binding values and extraneous response data cannot leak into report',()=>{
 const marker='private-fixture-do-not-output';const s=fixture();s.raw=marker;
 s.connectionCredentialMetadata=inspect([...bindings,{name:'IG_APP_SECRET',type:'secret_text',text:marker},{name:'OTHER',type:'plain_text',text:marker}]);
 assert.ok(!JSON.stringify(assess(s)).includes(marker));
});
test('review output is fresh and cannot mutate later plans',()=>{
 const r=assess(fixture());r.registrationSpec.subscribeWebhooks=true;
 assert.equal(assess(fixture()).registrationSpec.subscribeWebhooks,false);
});
