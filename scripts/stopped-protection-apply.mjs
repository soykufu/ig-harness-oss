import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const ACCOUNT='e76a3f504309ca9289d8dfa3ee504502',DATABASE='e55c3b84-ea9a-48fd-a7a3-08253089d295',SCRIPT='soykufu-ig-harness-20261119';
const ROOT='/accounts/'+ACCOUNT,WORKER=ROOT+'/workers/scripts/'+SCRIPT,DB=ROOT+'/d1/database/'+DATABASE;
const FINGERPRINT='483673d06f50743aae1b8e966d00e1bedc1f192472ea577efd234eb9d0ef2de1';
const ORIGINAL='6624a33372e212b3d8a796b9eb77fd7183456651517d802cce10fdb434cab685';
const ORIGIN='https://'+SCRIPT+'.soykufu.workers.dev';
const digest=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const wrapper="import original from './index.js';\nimport {wrapRecoveryGuard} from './recovery-bucket-guard.mjs';\nexport * from './index.js';\nexport default wrapRecoveryGuard(original);\n";
export function assertProtectionBaseline(snapshot){
 if(!snapshot||!snapshot.runtime?.deploymentStable||!snapshot.runtime.deployedBindingsVerified||!snapshot.runtime.preparationLockVerified||!snapshot.runtime.extraFlagsVerified||!snapshot.runtime.r2DirectPublicAccessDisabled||snapshot.runtime.deploymentFingerprint!==FINGERPRINT||snapshot.installation?.schemaHash!=='5f2f633b8f4e722a07c1514cab845db3e82944610feca8502f1b5d74519d1dda'||snapshot.installation.businessCountsHash!=='d91af589574360be62abc8b0be8f5acc1a980d7921f86aec0dd09103ff1f9c5b'||snapshot.installation.migrationLedgerSha256!=='1f434b319a3d61d77dc1fa81a61399281f4afbbb60fe36085782b02fb510bcad'||snapshot.installation?.stopped!==true||snapshot.installation.connectedAccounts!==0||snapshot.installation.followers!==0||snapshot.installation.appliedMigrationCount!==27||snapshot.installation.migrationInventory?.expected!==41||snapshot.installation.migrationInventory?.matching!==27||snapshot.installation.migrationInventory?.duplicates?.length!==0||snapshot.installation.migrationInventory?.missing?.length!==14||snapshot.installation.migrationInventory?.modified?.length||snapshot.installation.migrationInventory?.unexpected?.length||snapshot.bundle?.entrypoint!=='index.js'||snapshot.bundle.modules.length!==1||snapshot.bundle.modules[0].name!=='index.js'||snapshot.bundle.modules[0].sha256!==ORIGINAL)throw Error('baseline_changed');
}
export function protectionModules(original,guard){
 if(!Buffer.isBuffer(original)||digest(original)!==ORIGINAL||typeof guard!=='string'||!guard.includes('export function wrapRecoveryGuard('))throw Error('source_changed');
 return [{name:'index.js',data:original},{name:'recovery-bucket-guard.mjs',data:Buffer.from(guard)},{name:'backup-guard.js',data:Buffer.from(wrapper)}];
}
export async function performProtection({mode,official,snapshot,replace,verify,canary}){
 const receipt={ok:false,state:'protection_held',replacementAttempted:false,replacementAccepted:false,privacyVerified:false,backupVerified:false,migrationsApplied:0,messagesSent:0};
 try{
  if(!official||!['inspect','apply'].includes(mode))throw Error('official_runtime_required');
  const before=await snapshot();assertProtectionBaseline(before);
  if(mode==='inspect')return{...receipt,ok:true,state:'protection_baseline_observed',baseline:{fingerprint:before.runtime.deploymentFingerprint,entrypoint:before.bundle.entrypoint,originalSha256:ORIGINAL,settingsFields:Object.keys(before.settings).sort(),versionResourceFields:before.versionResourceFields,settingsReadable:true,stopped:true,originalVersionId:before.versionId}};
  receipt.originalVersionId=before.versionId;
  const second=await snapshot();assertProtectionBaseline(second);
  if(canonical(before)!==canonical(second))throw Error('baseline_changed_in_flight');
  receipt.replacementAttempted=true;
  const result=await replace();if(result!==true)throw Error('replacement_result_unknown');receipt.replacementAccepted=true;
  const after=await verify(before);if(after?.ok!==true)throw Error('post_deployment_verification_failed');
  Object.assign(receipt,{state:'protection_deployed_pending_canary',deploymentFingerprint:after.fingerprint,originalModulePreserved:true,settingsPreserved:true,installationPreserved:true});
  const acceptance=await canary();Object.assign(receipt,{canary:acceptance});
  if(acceptance?.ok!==true)throw Error('canary_not_accepted');
  const final=await verify(before);if(final?.ok!==true||final.fingerprint!==after.fingerprint)throw Error('post_deployment_verification_failed');
  return{...receipt,ok:true,state:'protection_applied_and_canary_verified',privacyVerified:true};
 }catch(e){return{...receipt,reason:['baseline_changed','baseline_changed_in_flight','official_runtime_required','replacement_result_unknown','post_deployment_verification_failed','canary_not_accepted'].includes(e?.message)?e.message:'protection_validation_failed'};}
}
async function main(){return{ok:false,state:'protection_execution_retired',consumedRunId:45303824595,replacementAttempted:false};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let r;try{r=await main();}catch{r={ok:false,state:'protection_held',reason:'preparation_read_failed',replacementAttempted:false};}console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}
