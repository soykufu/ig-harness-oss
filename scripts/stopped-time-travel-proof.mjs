import {createHash} from 'node:crypto';
import {RECOVERY_SCOPE,sealRecoveryReference,openRecoveryReference,recoveryKeyEligible} from './stopped-recovery-reference.mjs';
const base=`/accounts/${RECOVERY_SCOPE.accountId}/d1/database/${RECOVERY_SCOPE.databaseId}/time_travel/bookmark`;
const bookmark=/^[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{32}$/i;
const sha=/^[a-f0-9]{40}$/,hash=/^[a-f0-9]{64}$/;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function isTimeTravelProofPath(path){
 if(typeof path!=='string'||!path.startsWith(base+'?timestamp='))return false;
 try{const raw=path.slice((base+'?timestamp=').length),value=decodeURIComponent(raw);return value.length===24&&new Date(value).toISOString()===value&&encodeURIComponent(value)===raw;}catch{return false;}
}
/** A fixed timestamp is read twice, not retried after failure. Only a safe
 * fingerprint leaves the reader. Nothing is persisted or restored here. */
export async function readTimeTravelProof({read,sourceSha,migrationInventoryHash,deploymentFingerprint,recoveryKey,now=Date.now}){
 const held={available:false,repeatedBookmarkMatched:false,sealedRoundTripVerified:false,recoveryEnvelopeState:'not_attempted',referencePersisted:false,restoreTested:false,backupVerified:false,deploymentAuthorized:false};
 try{
  if(typeof sourceSha!=='string'||!sha.test(sourceSha)||typeof migrationInventoryHash!=='string'||!hash.test(migrationInventoryHash)||typeof deploymentFingerprint!=='string'||!hash.test(deploymentFingerprint))return held;
  const point=now();if(!Number.isSafeInteger(point)||point<0)return held;const timestamp=new Date(point).toISOString(),path=base+'?timestamp='+encodeURIComponent(timestamp);
  if(!isTimeTravelProofPath(path))return held;
  const first=(await read(path))?.bookmark;if(typeof first!=='string'||!bookmark.test(first))return held;
  const second=(await read(path))?.bookmark,observed=now();
  if(first!==second||!Number.isSafeInteger(observed)||observed<point||observed-point>60000)return held;
  const reference={kind:'cloudflare_d1_time_travel',...RECOVERY_SCOPE,sourceSha,timestamp,observedAt:new Date(observed).toISOString(),bookmark:first,migrationInventoryHash,deploymentFingerprint};
  let sealedRoundTripVerified=false,recoveryEnvelopeState='key_not_eligible';
  if(recoveryKeyEligible(recoveryKey))try{const envelope=sealRecoveryReference(reference,recoveryKey,observed);const result=openRecoveryReference(envelope,recoveryKey,{...RECOVERY_SCOPE,sourceSha},observed);sealedRoundTripVerified=JSON.stringify(result.reference)===JSON.stringify(reference);recoveryEnvelopeState=sealedRoundTripVerified?'verified':'round_trip_mismatch';}catch{recoveryEnvelopeState='envelope_check_failed';}
  return{...held,available:true,repeatedBookmarkMatched:true,sealedRoundTripVerified,recoveryEnvelopeState,proof:{kind:reference.kind,...RECOVERY_SCOPE,sourceSha,timestamp,observedAt:reference.observedAt,expiresAt:new Date(point+7*86400000-3600000).toISOString(),bookmarkSha256:digest(first),migrationInventoryHash,deploymentFingerprint}};
 }catch{return held;}
}
