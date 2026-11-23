import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {RECOVERY_SCOPE} from './stopped-recovery-reference.mjs';
const FORMAT='soykufu-database-copy-v1',MAX_BYTES=32*1024*1024,MAX_AGE=7*86400000;
const HASH=/^[a-f0-9]{64}$/,SHA=/^[a-f0-9]{40}$/;
const fail=()=>Error('Database copy envelope requires reconciliation');
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw fail();}
function scope(value,now){
 exact(value,['format','accountId','databaseId','bucketName','sourceSha','createdAt','expiresAt','schemaHash','ledgerHash','migrationPlanId']);
 if(value.format!==FORMAT||Object.entries(RECOVERY_SCOPE).some(([k,v])=>value[k]!==v)||typeof value.sourceSha!=='string'||!SHA.test(value.sourceSha)||!['schemaHash','ledgerHash','migrationPlanId'].every(k=>typeof value[k]==='string'&&HASH.test(value[k]))||!Number.isSafeInteger(now))throw fail();
 const times=['createdAt','expiresAt'].map(k=>{const t=Date.parse(value[k]);if(typeof value[k]!=='string'||!Number.isFinite(t)||new Date(t).toISOString()!==value[k])throw fail();return t;});
 if(times[0]>now||times[1]<=now||times[1]<=times[0]||times[1]-times[0]>MAX_AGE)throw fail();
 return {...value};
}
function key(value){if(!Buffer.isBuffer(value)||value.length!==32)throw fail();return value;}
function decode(value,max,exactBytes){if(typeof value!=='string'||!value.length||value.length>Math.ceil(max*4/3)+4||!/^[A-Za-z0-9_-]+$/.test(value))throw fail();const b=Buffer.from(value,'base64url');if(b.length>max||exactBytes&&b.length!==exactBytes||b.toString('base64url')!==value)throw fail();return b;}
const digest=value=>createHash('sha256').update(value).digest('hex');
/** Pure in-memory codec only: no database export, R2 storage, key generation or
 * persistence, SQL execution, restore, deployment or permission grant. Expiry
 * limits use as evidence; it never deletes a stored copy. */
export function sealDatabaseCopy({sql,metadata,encryptionKey,now=Date.now()}){
 let payload;
 try{
  const header=scope({format:FORMAT,...metadata},now);
  if(typeof sql!=='string'&&!Buffer.isBuffer(sql))throw fail();
  const raw=Buffer.from(sql);if(!raw.length||raw.length>MAX_BYTES||!raw.toString('utf8').trim())throw fail();
  payload=Buffer.from(JSON.stringify({sql:raw.toString('base64url'),sha256:digest(raw),bytes:raw.length}));
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(encryptionKey),iv,{authTagLength:16});
  cipher.setAAD(Buffer.from(JSON.stringify(header)));
  return {scope:header,iv:iv.toString('base64url'),ciphertext:Buffer.concat([cipher.update(payload),cipher.final()]).toString('base64url'),tag:cipher.getAuthTag().toString('base64url')};
 }catch{throw fail();}finally{payload?.fill(0);}
}
export function openDatabaseCopy({envelope,encryptionKey,expected,now=Date.now()}){
 let plain;
 try{
  exact(envelope,['scope','iv','ciphertext','tag']);const header=scope(envelope.scope,now);
  if(JSON.stringify(header)!==JSON.stringify(scope({format:FORMAT,...expected},now)))throw fail();
  const decipher=createDecipheriv('aes-256-gcm',key(encryptionKey),decode(envelope.iv,12,12),{authTagLength:16});
  decipher.setAAD(Buffer.from(JSON.stringify(header)));decipher.setAuthTag(decode(envelope.tag,16,16));
  plain=Buffer.concat([decipher.update(decode(envelope.ciphertext,MAX_BYTES*2)),decipher.final()]);
  const result=JSON.parse(plain.toString('utf8'));exact(result,['sql','sha256','bytes']);
  const sql=decode(result.sql,MAX_BYTES);if(!Number.isSafeInteger(result.bytes)||sql.length!==result.bytes||digest(sql)!==result.sha256)throw fail();
  return {sql,sha256:result.sha256,bytes:sql.length,backupVerified:false,restoreTested:false,deploymentAuthorized:false};
 }catch{throw fail();}finally{plain?.fill(0);}
}
