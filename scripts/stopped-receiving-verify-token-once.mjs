import {pathToFileURL} from 'node:url';

const ACCOUNT='e76a3f504309ca9289d8dfa3ee504502',DATABASE='e55c3b84-ea9a-48fd-a7a3-08253089d295';
const ORIGIN='https://soykufu-ig-harness-20261119.soykufu.workers.dev';
const FINGERPRINT='154f4550c1a25a023cbc2e2b01239e07bddd138e0a6095f4dd7a6ceee3e868e6';
const reasons=['official_single_run_required','dedicated_credential_unverified','stopped_state_unverified','account_unverified','app_subscription_requires_reconciliation','baseline_changed','credential_request_unknown','postcheck_failed'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function verifyOfficialRun(e){
 return e.GITHUB_ACTIONS==='true'&&e.GITHUB_REPOSITORY==='soykufu/ig-harness-oss'&&e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_EVENT_NAME==='workflow_dispatch'&&e.GITHUB_RUN_NUMBER==='93'&&e.GITHUB_RUN_ATTEMPT==='1'&&e.APPROVED_RECEIVING_VERIFY_TOKEN==='fixed-account-verification-only';
}
export function dedicatedValue(e){
 const v=e.IG_WEBHOOK_VERIFY_TOKEN;
 return typeof v==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(v)&&v!==e.IG_HARNESS_API_KEY&&v!==e.IG_META_APP_SECRET;
}
export function maskVerifyColumns(rows,columns){
 if(!Array.isArray(rows)||rows.length!==1||!Array.isArray(columns))throw Error('account_unverified');
 const out=structuredClone(rows);
 for(const name of ['verify_token','updated_at']){
  const i=columns.findIndex(c=>c.name===name);if(i<0)throw Error('account_unverified');
  out[0]['t'+i]='allowed_column';out[0]['v'+i]='allowed_column';
 }
 return out;
}
function validSnapshot(s){
 const r=s?.runtime,i=s?.installation,a=s?.account;
 return r?.deploymentStable===true&&r.deployedBindingsVerified===true&&r.preparationLockVerified===true&&r.extraFlagsVerified===true&&r.r2DirectPublicAccessDisabled===true&&r.deploymentFingerprint===FINGERPRINT&&
 i?.stopped===true&&i.connectedAccounts===1&&i.followers===0&&i.registeredAccountVerified===true&&i.schemaReady===true&&i.appliedMigrationCount===41&&
 a?.igUserId==='17841402028638204'&&a.username==='soykufu'&&a.pageId==='1632563283635095'&&a.connectionType==='facebook_login'&&a.isActive===true&&a.isDefault===false&&a.hasAppSecret===true&&/^[a-f0-9-]{36}$/i.test(a.id)&&s.paused===true&&s.integrity===true;
}
function stable(s){return [s.account.id,s.runtime.deploymentFingerprint,s.runtime.deployedBindingsVerified,s.runtime.preparationLockVerified,s.runtime.extraFlagsVerified,s.runtime.r2DirectPublicAccessDisabled,s.runtime.connectionCredentialMetadata,s.installation,s.business];}
function appAbsent(a){return a?.ok===true&&a.appIdentityVerified===true&&a.listingIncomplete===false&&a.appObjectCount===0&&a.unrelatedObjectCount===0&&Array.isArray(a.objects)&&a.objects.length===0;}
export async function installVerifyTokenOnce({official,credentialValid,snapshot,inspectApp,patch}){
 const r={ok:false,state:'receiving_verify_token_held',phase:'preflight',credentialWriteAttempted:false,credentialAccepted:false,subscriptionAttempted:false,webhookRequestAttempted:false,messagesSent:0};
 try{
  if(!official)throw Error('official_single_run_required');
  if(!credentialValid)throw Error('dedicated_credential_unverified');
  const before=await snapshot();if(!validSnapshot(before))throw Error('stopped_state_unverified');
  const app=await inspectApp();if(!appAbsent(app))throw Error('app_subscription_requires_reconciliation');
  const second=await snapshot();if(!validSnapshot(second)||!same(stable(before),stable(second))||before.candidateMatches!==second.candidateMatches)throw Error('baseline_changed');
  if(before.candidateMatches!==true){
   r.phase='credential_request';r.credentialWriteAttempted=true;
   if(await patch(before.account.id)!==true)throw Error('credential_request_unknown');
   r.credentialAccepted=true;
  }
  r.phase='postcheck';
  const after=await snapshot();
  if(!validSnapshot(after)||!same(stable(before),stable(after))||after.candidateMatches!==true)throw Error('postcheck_failed');
  const appAfter=await inspectApp();
  if(!appAbsent(appAfter)||!same(app,appAfter))throw Error('postcheck_failed');
  const final=await snapshot();
  if(!validSnapshot(final)||!same(stable(after),stable(final))||final.candidateMatches!==true)throw Error('postcheck_failed');
  return {...r,ok:true,state:'stopped_receiving_verify_token_verified',dedicatedCandidateMatched:true,alreadyConfigured:!r.credentialWriteAttempted,businessUnchanged:true,existingPageTokenUnchanged:true,existingAppSecretUnchanged:true,configurationUnchanged:true,subscriptionsUnchanged:true,guardrailsPaused:true,preparationLock:true,receivingVerified:false};
 }catch(e){return {...r,reason:reasons.includes(e?.message)?e.message:'validation_failed'};}
}

async function main(){return{ok:false,state:'receiving_verify_token_retired',consumedRunId:45617138533,credentialWriteAttempted:false,subscriptionAttempted:false,webhookRequestAttempted:false,messagesSent:0};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){console.log(JSON.stringify(await main()));process.exitCode=1;}
