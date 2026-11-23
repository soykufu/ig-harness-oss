import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {verifySavedRecovery} from './stopped-saved-recovery.mjs';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
import {migrationLedgerFingerprint} from './stopped-installation-snapshot.mjs';
const ROOT='https://api.cloudflare.com/client/v4';
const DB='/accounts/e76a3f504309ca9289d8dfa3ee504502/d1/database/e55c3b84-ea9a-48fd-a7a3-08253089d295';
const APPROVED_HASH='3a3c57d6733ad563f14f0d01ee44ec8e7ecc96822964308bcc9a7f429d030efd';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const HASH=/^[a-f0-9]{64}$/;
const BM=/^[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{32}$/i;
const held=(attempted=false)=>({ok:false,state:attempted?'restore_result_requires_reconciliation_no_retry':'restore_preconditions_not_met',restoreAttempted:attempted,restoreVerified:false,deploymentAuthorized:false});
function approved(target,expectedHash){
 const keys=['referenceId','timestamp','expiresAt','bookmarkSha256','migrationInventoryHash','deploymentFingerprint'];
 return target&&Object.keys(target).length===keys.length&&digest(Object.fromEntries(keys.map(k=>[k,target[k]])))===expectedHash;
}
function restoredShapeMatches(a,b){const {countsHash:ah,tableCounts:at,...ac}=a;const {countsHash:bh,tableCounts:bt,...bc}=b;return JSON.stringify(ac)===JSON.stringify(bc);}
const safe=s=>s?.paused==='1'&&s.accounts===0&&s.followers===0&&s.lock===true&&s.extraFlags===true&&s.bindings===true&&s.stable===true;
export async function onceRestore(plan,io,env,now=()=>Date.now(),approvalHash=APPROVED_HASH){
 let attempted=false,stage="runtime_gate";
 const reject=()=>({...held(attempted),stage});
 try{
  if(env.GITHUB_REPOSITORY!=='soykufu/ig-harness-oss'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_RUN_ATTEMPT!=='1'||!approved(plan?.target,approvalHash))return reject();
  if(!['prepare','execute','audit'].includes(plan.mode))return reject();
  if(plan.mode==='execute'&&env.GITHUB_RUN_NUMBER!=='20')return reject();
  stage="target_read";
  if(!(await io.validateTarget(plan.target)).ok)return reject();
  stage="snapshot_before";
  const before=await io.snapshot();
  if(!safe(before)||before.ledgerHash!==plan.target.migrationInventoryHash||before.fingerprint!==plan.target.deploymentFingerprint)return reject();
  if(plan.mode==='audit'){
   const expected=plan.preflight?.snapshot;if(!safe(expected))return reject();
   const mismatchedFields=Object.keys(expected).filter(k=>!['countsHash','tableCounts'].includes(k)&&JSON.stringify(before[k])!==JSON.stringify(expected[k]));
   stage='audit_integrity';const integrity=await io.integrity();
   stage='audit_final_snapshot';const stable=JSON.stringify(await io.snapshot())===JSON.stringify(before);
   const ok=mismatchedFields.length===0&&integrity===true&&stable;
   return {ok,state:ok?'post_restore_readonly_verified':'post_restore_difference',mismatchedFields,integrityVerified:integrity,stable,restoreReplayed:false,snapshot:before,allTableCountsMatched:before.countsHash===expected.countsHash,rowContentsVerified:false,deploymentAuthorized:false};
  }
  if(plan.mode==='prepare'){
   stage="preflight_bookmark";
   const t=now(),undoTimestamp=new Date(t).toISOString();
   const a=await io.bookmark(undoTimestamp),b=await io.bookmark(undoTimestamp);
   if(typeof a!=='string'||!BM.test(a)||a!==b||now()-t>60000||now()<t||JSON.stringify(await io.snapshot())!==JSON.stringify(before))return reject();
   return {ok:true,state:'restore_preflight_prepared',sourceSha:env.GITHUB_SHA,preparedAt:new Date(now()).toISOString(),undoTimestamp,undoBookmarkSha256:digest(a),snapshot:before,restoreAttempted:false,restoreVerified:false,deploymentAuthorized:false};
  }
  stage="proof_gate";
  const proof=plan.preflight,t=Date.parse(proof?.preparedAt),u=Date.parse(proof?.undoTimestamp);
  if(proof?.state!=='restore_preflight_prepared'||proof.ok!==true||proof.sourceSha!==env.GITHUB_SHA||!Number.isFinite(t)||!Number.isFinite(u)||u>t||t-u>60000||t>now()||now()-t>15*60000||!HASH.test(proof.undoBookmarkSha256)||JSON.stringify(proof.snapshot)!==JSON.stringify(before))return reject();
  stage="undo_read";
  const undo=await io.bookmark(proof.undoTimestamp);
  if(typeof undo!=='string'||!BM.test(undo)||digest(undo)!==proof.undoBookmarkSha256)return reject();
  // Last read before the ONE mutation. No restore retries, including timeouts.
  stage="last_snapshot";
  if(JSON.stringify(await io.snapshot())!==JSON.stringify(before))return reject();
  stage="restore_post";attempted=true;
  const result=await io.restore(plan.target.timestamp);
  if(typeof result?.bookmark!=='string'||!BM.test(result.bookmark)||typeof result.previous_bookmark!=='string'||!BM.test(result.previous_bookmark))return reject();
  stage="after_snapshot";
  const after=await io.snapshot();
  if(!safe(after)||!restoredShapeMatches(after,before)||!(await io.integrity()))return reject();
  return {ok:true,state:'one_time_restore_verified',restoreAttempted:true,restoreVerified:true,restoreTimestamp:plan.target.timestamp,undoTimestamp:proof.undoTimestamp,previousBookmarkSha256:digest(result.previous_bookmark),restoredBookmarkSha256:digest(result.bookmark),businessSnapshotMatched:true,allTableCountsMatched:after.countsHash===before.countsHash,beforeTableCounts:before.tableCounts,afterTableCounts:after.tableCounts,integrityVerified:true,rowContentsVerified:false,messagesSent:0,deploymentAuthorized:false};
 }catch{return reject();}
}

async function main(){
 const token=process.env.CLOUDFLARE_API_TOKEN;if(!token)return held();
 const plan=JSON.parse(process.env.RESTORE_PLAN||'null');
 // The one approved restore has been consumed. This entry now has NO restore
 // transport at all, even if an old input is submitted in a later run.
 if(plan?.mode!=='audit')return held();
 const api=async(path,{sql}={})=>{
  if(sql!==undefined){if(path!==DB+'/query'||!/^\s*(SELECT|PRAGMA)\b/.test(sql)||sql.includes(';'))throw Error('Unexpected query');}
  else if(!isStoppedRuntimeReadPath(path)&&!path.startsWith(DB+'/time_travel/bookmark?timestamp='))throw Error('Unexpected read');
  const r=await fetch(ROOT+path,{method:sql!==undefined?'POST':'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(sql===undefined?{}:{body:JSON.stringify({sql})}),signal:AbortSignal.timeout(15000)});
  const b=await r.json();if(!r.ok||b.success!==true)throw Error('Provider action failed');return b.result;
 };
 const query=async sql=>(await api(DB+'/query',{sql}))[0]?.results;
 const runtime=()=>readStoppedRuntimeSnapshot({read:path=>api(path)});
 const state=async()=>({...((await query("SELECT (SELECT value FROM integration_settings WHERE key='outbound_paused') AS paused,(SELECT COUNT(*) FROM ig_accounts) AS accounts,(SELECT COUNT(*) FROM followers) AS followers"))[0]),ledgerHash:migrationLedgerFingerprint(await query('SELECT name,sha256 FROM ig_schema_migrations'))});
 const bookmark=async timestamp=>(await api(DB+'/time_travel/bookmark?timestamp='+encodeURIComponent(timestamp)))?.bookmark;
 const snapshot=async()=>{
  const s=await state(),r=await runtime();
  const schema=await query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND substr(name,1,4)!='_cf_' ORDER BY type,name");
  const counts=[];for(const row of schema.filter(x=>x.type==='table')){if(typeof row.name!=='string')throw Error('Invalid schema');const n=(await query('SELECT COUNT(*) AS n FROM '+JSON.stringify(row.name)))[0]?.n;if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid count');counts.push([row.name,n]);}
  return {...s,fingerprint:r.deploymentFingerprint,lock:r.preparationLockVerified,extraFlags:r.extraFlagsVerified,bindings:r.deployedBindingsVerified,stable:r.deploymentStable,schemaHash:digest(schema),countsHash:digest(counts),businessCountsHash:digest(counts.filter(([name])=>name!=='rate_limit_buckets')),tableCounts:counts};
 };
 return onceRestore(plan,{validateTarget:ref=>verifySavedRecovery(ref,{state,runtime,bookmark}),snapshot,bookmark,integrity:async()=>{const rows=await query('PRAGMA quick_check');return rows?.length===1&&Object.values(rows[0])[0]==='ok'&&(await query('PRAGMA foreign_key_check')).length===0;}},process.env);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let result;try{result=await main();}catch{result=held();}console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;}
