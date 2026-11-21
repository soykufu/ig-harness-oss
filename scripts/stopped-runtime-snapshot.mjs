import {readTimeTravelProof,isTimeTravelProofPath} from './stopped-time-travel-proof.mjs';
import {createHash} from 'node:crypto';
const account='e76a3f504309ca9289d8dfa3ee504502';
const database='e55c3b84-ea9a-48fd-a7a3-08253089d295';
const script='soykufu-ig-harness-20261119';
const worker=`/accounts/${account}/workers/scripts/${script}`;
const r2Domains=`/accounts/${account}/r2/buckets/${script}/domains`;
const bookmarkPath=`/accounts/${account}/d1/database/${database}/time_travel/bookmark`;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const flags=['RECRUITMENT_LEDGER_ENFORCEMENT','RECRUITMENT_ECHO_INGESTION','RECRUITMENT_INBOUND_SUPPRESSION'];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function isStoppedRuntimeReadPath(path){return isTimeTravelProofPath(path)||path===worker+'/deployments'||path===bookmarkPath||path===r2Domains+'/managed'||path===r2Domains+'/custom'||path.startsWith(worker+'/versions/')&&uuid.test(path.slice((worker+'/versions/').length));}
function active(result){const row=result?.deployments?.[0];if(!row||!uuid.test(row.id)||!Array.isArray(row.versions)||row.versions.length!==1||row.versions[0].percentage!==100||!uuid.test(row.versions[0].version_id)||!Number.isFinite(Date.parse(row.created_on)))throw Error('Deployment requires reconciliation');return{id:row.id,created_on:row.created_on,version:row.versions[0].version_id};}
function inspect(bindings){
 if(!Array.isArray(bindings))return{deployedBindingsVerified:false,preparationLockVerified:false,extraFlagsVerified:false};
 const named=name=>bindings.filter(b=>b?.name===name);
 const resources=bindings.filter(b=>['d1','r2_bucket'].includes(b?.type));
 const db=named('DB'),r2=named('IMAGES'),lock=named('OUTBOUND_PREPARATION_LOCK');
 const deployedBindingsVerified=resources.length===2&&db.length===1&&db[0].type==='d1'&&db[0].id===database&&r2.length===1&&r2[0].type==='r2_bucket'&&r2[0].bucket_name===script;
 const preparationLockVerified=lock.length===1&&lock[0].type==='plain_text'&&lock[0].text==='1';
 // Missing optional flags are disabled in the existing application. A secret,
 // duplicate or unexpected value is unverified; never read a secret endpoint.
 const extraFlagsVerified=flags.every(name=>{const rows=named(name);return rows.length===0||rows.length===1&&rows[0].type==='plain_text'&&rows[0].text==='0';});
 return{deployedBindingsVerified,preparationLockVerified,extraFlagsVerified};
}
/** Read-only official runner metadata. Never return raw bindings or API errors.
 * A bookmark is availability evidence, never a restore-tested backup. */
export async function readStoppedRuntimeSnapshot({read,sourceSha,migrationInventoryHash,recoveryKey,now=Date.now}){
 const result={deploymentEvidenceAvailable:false,deploymentStable:false,deployedBindingsVerified:false,preparationLockVerified:false,extraFlagsVerified:false,timeTravelBookmarkAvailable:false,r2DirectPublicAccessDisabled:false,workerProxyExposureVerified:false,backupVerified:false,deploymentAuthorized:false};
 const safeRead=async path=>{if(!isStoppedRuntimeReadPath(path))throw Error('Unexpected runtime read');return read(path);};
 let first=null;
 try{first=active(await safeRead(worker+'/deployments'));const version=await safeRead(worker+'/versions/'+first.version);if(version?.id!==first.version)throw Error('Version identity changed');const checks=inspect(version.resources?.bindings);const last=active(await safeRead(worker+'/deployments'));if(JSON.stringify(first)!==JSON.stringify(last))throw Error('Deployment changed');Object.assign(result,checks,{deploymentEvidenceAvailable:true,deploymentStable:true,deploymentFingerprint:digest(first)});}catch{/* Permission/error/ambiguous rollout: do not retry or reveal transport details. */}
 if(sourceSha&&migrationInventoryHash&&result.deploymentStable&&result.deployedBindingsVerified&&result.preparationLockVerified&&result.extraFlagsVerified){
  const proof=await readTimeTravelProof({read:safeRead,sourceSha,migrationInventoryHash,deploymentFingerprint:result.deploymentFingerprint,recoveryKey,now});result.timeTravelRecoveryProof=proof;result.timeTravelBookmarkAvailable=proof.available;if(proof.available)result.timeTravelBookmarkSha256=proof.proof.bookmarkSha256;
 }else{
 try{const value=(await safeRead(bookmarkPath))?.bookmark;if(typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{32}$/i.test(value)){result.timeTravelBookmarkAvailable=true;result.timeTravelBookmarkSha256=digest(value);}}catch{/* No restore or fallback; absence of proof remains explicit. */}
 }
 // This covers direct R2 domains only. A bound Worker can expose objects
 // independently, so do not call this a private backup destination.
 try{const [managed,custom]=await Promise.all([safeRead(r2Domains+'/managed'),safeRead(r2Domains+'/custom')]);result.r2DirectPublicAccessDisabled=managed?.enabled===false&&Array.isArray(custom?.domains)&&custom.domains.every(d=>d?.enabled===false);}catch{/* No domain change, fallback or retry. */}
 // Metadata can change during the later provider reads. Do not retain proof
 // for an earlier serving version when the final observation is unavailable.
 if(result.deploymentStable)try{const final=active(await safeRead(worker+'/deployments'));if(JSON.stringify(first)!==JSON.stringify(final))throw Error('Deployment changed');}catch{Object.assign(result,{deploymentEvidenceAvailable:false,deploymentStable:false,deployedBindingsVerified:false,preparationLockVerified:false,extraFlagsVerified:false,timeTravelBookmarkAvailable:false});delete result.deploymentFingerprint;delete result.timeTravelRecoveryProof;delete result.timeTravelBookmarkSha256;}
 return result;
}
