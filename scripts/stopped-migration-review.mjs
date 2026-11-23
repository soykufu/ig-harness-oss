import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {readStoppedInstallationSnapshot} from './stopped-installation-snapshot.mjs';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
const ACCOUNT='e76a3f504309ca9289d8dfa3ee504502',DATABASE='e55c3b84-ea9a-48fd-a7a3-08253089d295';
const DB=`/accounts/${ACCOUNT}/d1/database/${DATABASE}`,HASH=/^[a-f0-9]{64}$/;
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const held=reason=>({ok:false,state:'migration_review_held',reason,applyAuthorized:false,backupVerified:false,deploymentAuthorized:false});
async function shape(query){
 const schema=await query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND substr(name,1,4)!='_cf_' ORDER BY type,name");
 if(!Array.isArray(schema)||!schema.length)throw Error('Invalid schema');
 const counts=[];for(const row of schema.filter(x=>x.type==='table')){if(typeof row.name!=='string')throw Error('Invalid table');const n=(await query('SELECT COUNT(*) AS n FROM '+JSON.stringify(row.name)))[0]?.n;if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid count');if(row.name!=='rate_limit_buckets')counts.push([row.name,n]);}
 return {schemaHash:digest(schema),businessCountsHash:digest(counts)};
}
// Supplied receipts are reviewed evidence, not self-authenticating grants.
// This produces a candidate plan only: it never executes or authorizes SQL.
export async function reviewStoppedMigration({repoDir,query,readRuntime,evidence,now=Date.now()}){
 try{
  if(!evidence||evidence.accountId!==ACCOUNT||evidence.databaseId!==DATABASE||evidence.restoreAccepted!==true||evidence.postRestoreVerified!==true||!Number.isSafeInteger(evidence.restoreRunId)||evidence.restoreRunId<=0||!Number.isSafeInteger(evidence.auditRunId)||evidence.auditRunId<=0)return held('native_receipt_missing');
  if(!Number.isSafeInteger(now)||!Number.isFinite(Date.parse(evidence.verifiedAt))||!Number.isFinite(Date.parse(evidence.expiresAt))||Date.parse(evidence.verifiedAt)>now||Date.parse(evidence.expiresAt)<=now||Date.parse(evidence.expiresAt)-Date.parse(evidence.verifiedAt)>7*86400000)return held('native_receipt_expired_or_invalid');
  for(const k of ['schemaHash','businessCountsHash','ledgerHash','fingerprint'])if(typeof evidence[k]!=='string'||!HASH.test(evidence[k]))return held('native_receipt_invalid');
  const read=sql=>{if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)||sql.includes(';'))throw Error('Read only');return query(sql);};
  const before=await readStoppedInstallationSnapshot({repoDir,query:read}),runtime=await readRuntime(),data=await shape(read);
  if(before.stopped!==true||before.connectedAccounts!==0||before.followers!==0||runtime.deploymentStable!==true||runtime.deployedBindingsVerified!==true||runtime.preparationLockVerified!==true||runtime.extraFlagsVerified!==true)return held('installation_changed');
  if(data.schemaHash!==evidence.schemaHash||data.businessCountsHash!==evidence.businessCountsHash||before.migrationLedgerSha256!==evidence.ledgerHash||runtime.deploymentFingerprint!==evidence.fingerprint)return held('recovery_scope_changed');
  const inv=before.migrationInventory;
  if(before.appliedMigrationCount!==27||inv.expected!==41||inv.matching!==27||inv.missing.length!==14||inv.modified.length||inv.unexpected.length||inv.duplicates.length||inv.missing.some((n,i)=>Number(n.slice(0,4))!==28+i))return held('migration_inventory_changed');
  const migrations=[];for(const name of inv.missing){const sql=await readFile(join(repoDir,'packages/db/migrations',name),'utf8');migrations.push({name,sha256:createHash('sha256').update(sql).digest('hex')});}
  const after=await readStoppedInstallationSnapshot({repoDir,query:read}),afterRuntime=await readRuntime(),afterData=await shape(read);
  if(JSON.stringify(before)!==JSON.stringify(after)||JSON.stringify(data)!==JSON.stringify(afterData)||afterRuntime.deploymentStable!==true||afterRuntime.deployedBindingsVerified!==true||afterRuntime.preparationLockVerified!==true||afterRuntime.extraFlagsVerified!==true||afterRuntime.deploymentFingerprint!==runtime.deploymentFingerprint)return held('review_changed_in_flight');
  const plan={kind:'stopped_migration_review_v1',accountId:ACCOUNT,databaseId:DATABASE,recoveryReceipt:{restoreRunId:evidence.restoreRunId,auditRunId:evidence.auditRunId,expiresAt:evidence.expiresAt},baseline:{...data,ledgerHash:before.migrationLedgerSha256,fingerprint:runtime.deploymentFingerprint},migrations};
  return {ok:true,state:'migration_candidate_ready_for_review',planId:digest(plan),plan,nativeEvidenceMatched:true,applyAuthorized:false,backupVerified:false,deploymentAuthorized:false,messagesSent:0};
 }catch{return held('read_or_validation_failed');}
}
async function main(){
 if(process.env.GITHUB_REPOSITORY!=='soykufu/ig-harness-oss'||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch')return held('runtime_not_authorized');
 const token=process.env.CLOUDFLARE_API_TOKEN;if(!token)return held('credential_missing');
 const api=async(path,sql)=>{
  if(sql===undefined){if(!isStoppedRuntimeReadPath(path))throw Error('Read only');}
  else if(path!==DB+'/query'||!/^\s*(SELECT|PRAGMA)\b/i.test(sql)||sql.includes(';'))throw Error('Read only');
  const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method:sql===undefined?'GET':'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(sql===undefined?{}:{body:JSON.stringify({sql})}),signal:AbortSignal.timeout(15000)});
  const b=await r.json();if(!r.ok||b.success!==true)throw Error('Read failed');return b.result;
 };
 return reviewStoppedMigration({repoDir:process.cwd(),query:async sql=>(await api(DB+'/query',sql))[0]?.results,readRuntime:()=>readStoppedRuntimeSnapshot({read:path=>api(path)}),evidence:JSON.parse(process.env.NATIVE_RECOVERY_EVIDENCE||'null')});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let r;try{r=await main();}catch{r=held('review_failed');}console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}
