import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
export const RECOVERY_SCOPE=Object.freeze({accountId:'e76a3f504309ca9289d8dfa3ee504502',databaseId:'e55c3b84-ea9a-48fd-a7a3-08253089d295',bucketName:'soykufu-ig-harness-20261119'});
const FORMAT='soykufu-recovery-reference-v1',DAY=86400000,MAX_AGE=7*DAY-3600000;
const hash=/^[a-f0-9]{64}$/,sha=/^[a-f0-9]{40}$/;
const bookmark=/^[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{32}$/i;
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('Recovery reference requires reconciliation');}
function iso(value){if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw Error('Recovery reference requires reconciliation');return Date.parse(value);}
function header(input){exact(input,['format','accountId','databaseId','bucketName','sourceSha']);if(input.format!==FORMAT||Object.entries(RECOVERY_SCOPE).some(([k,v])=>input[k]!==v)||(typeof input.sourceSha!=='string'||!sha.test(input.sourceSha)))throw Error('Recovery scope requires reconciliation');return{format:FORMAT,...RECOVERY_SCOPE,sourceSha:input.sourceSha};}
function validate(input,now){
 exact(input,['kind','accountId','databaseId','bucketName','sourceSha','timestamp','observedAt','bookmark','migrationInventoryHash','deploymentFingerprint']);
 if(!Number.isSafeInteger(now)||now<0||input.kind!=='cloudflare_d1_time_travel'||Object.entries(RECOVERY_SCOPE).some(([k,v])=>input[k]!==v)||(typeof input.sourceSha!=='string'||!sha.test(input.sourceSha))||typeof input.bookmark!=='string'||!bookmark.test(input.bookmark)||typeof input.migrationInventoryHash!=='string'||!hash.test(input.migrationInventoryHash)||typeof input.deploymentFingerprint!=='string'||!hash.test(input.deploymentFingerprint))throw Error('Recovery reference requires reconciliation');
 const point=iso(input.timestamp),observed=iso(input.observedAt);
 if(point<0||point>observed||observed-point>60000||observed>now||now>=point+MAX_AGE)throw Error('Recovery reference is stale or future dated');
 return{kind:input.kind,...RECOVERY_SCOPE,sourceSha:input.sourceSha,timestamp:input.timestamp,observedAt:input.observedAt,bookmark:input.bookmark,migrationInventoryHash:input.migrationInventoryHash,deploymentFingerprint:input.deploymentFingerprint};
}
export function recoveryKeyEligible(secret){return typeof secret==='string'&&/^[\x21-\x7e]{32,4096}$/.test(secret);}
function key(secret,salt){if(!recoveryKeyEligible(secret))throw Error('Recovery key unavailable');return Buffer.from(hkdfSync('sha256',Buffer.from(secret,'utf8'),salt,Buffer.from(FORMAT),32));}
function encode(value){return value.toString('base64url');}
function decode(value,size){if(typeof value!=='string'||value.length>16384||!value.length||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('Recovery envelope requires reconciliation');const buffer=Buffer.from(value,'base64url');if(encode(buffer)!==value||size&&buffer.length!==size)throw Error('Recovery envelope requires reconciliation');return buffer;}
/** Pure preparation only. Caller-provided references are not live provider
 * evidence. There is deliberately no storage/network/restore/deploy method. */
export function sealRecoveryReference(input,secret,now=Date.now()){
 try{const reference=validate(input,now),scope=header({format:FORMAT,...RECOVERY_SCOPE,sourceSha:reference.sourceSha}),salt=randomBytes(32),iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(secret,salt),iv,{authTagLength:16});cipher.setAAD(Buffer.from(JSON.stringify(scope)));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(reference),'utf8'),cipher.final()]);return{scope,salt:encode(salt),iv:encode(iv),ciphertext:encode(ciphertext),tag:encode(cipher.getAuthTag())};}catch{throw Error('Recovery reference could not be sealed');}
}
export function openRecoveryReference(envelope,secret,expected,now=Date.now()){
 try{exact(envelope,['scope','salt','iv','ciphertext','tag']);const scope=header(envelope.scope);if(JSON.stringify(scope)!==JSON.stringify(header({format:FORMAT,...expected})))throw Error('Scope mismatch');const decipher=createDecipheriv('aes-256-gcm',key(secret,decode(envelope.salt,32)),decode(envelope.iv,12),{authTagLength:16});decipher.setAAD(Buffer.from(JSON.stringify(scope)));decipher.setAuthTag(decode(envelope.tag,16));const plain=Buffer.concat([decipher.update(decode(envelope.ciphertext)),decipher.final()]);const reference=validate(JSON.parse(plain.toString('utf8')),now);if(reference.sourceSha!==scope.sourceSha)throw Error('Source mismatch');return{reference,expiresAt:new Date(Date.parse(reference.timestamp)+MAX_AGE).toISOString(),restoreTested:false,backupVerified:false,deploymentAuthorized:false};}catch{throw Error('Recovery reference could not be verified');}
}
