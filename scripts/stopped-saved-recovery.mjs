import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
import {migrationLedgerFingerprint} from './stopped-installation-snapshot.mjs';
const ROOT='https://api.cloudflare.com/client/v4';
const DB='/accounts/e76a3f504309ca9289d8dfa3ee504502/d1/database/e55c3b84-ea9a-48fd-a7a3-08253089d295';
const HASH=/^[a-f0-9]{64}$/;
const bookmark=/^[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{32}$/i;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const held=()=>({ok:false,state:'recovery_reference_requires_reconciliation',restoreTested:false,backupVerified:false,deploymentAuthorized:false});
const stopped=s=>s?.paused==='1'&&s.accounts===0&&s.followers===0;
const runtimeValid=r=>r?.deploymentStable===true&&r.deployedBindingsVerified===true&&r.preparationLockVerified===true&&r.extraFlagsVerified===true;

// Reads the EXISTING saved point. A new current bookmark is not evidence that
// a saved recovery point remains available. Never restore, export or persist.
export async function verifySavedRecovery(ref,io,now=Date.now()){
 try{
  const keys=['referenceId','timestamp','expiresAt','bookmarkSha256','migrationInventoryHash','deploymentFingerprint'];
  if(!ref||Object.keys(ref).sort().join(',')!==keys.sort().join(',')||typeof ref.referenceId!=='string'||!/^d1-ts-[0-9TZ]{18,24}$/.test(ref.referenceId))return held();
  if(!Number.isSafeInteger(now)||!HASH.test(ref.bookmarkSha256)||!HASH.test(ref.migrationInventoryHash)||!HASH.test(ref.deploymentFingerprint))return held();
  const t=Date.parse(ref.timestamp),end=Date.parse(ref.expiresAt);
  if(!Number.isFinite(t)||!Number.isFinite(end)||new Date(t).toISOString()!==ref.timestamp||new Date(end).toISOString()!==ref.expiresAt||t>now||end<=now||end>t+7*86400000-3600000)return held();
  const before=await io.state(),runtime=await io.runtime();
  if(!stopped(before)||before.ledgerHash!==ref.migrationInventoryHash||!runtimeValid(runtime)||runtime.deploymentFingerprint!==ref.deploymentFingerprint)return held();
  const a=await io.bookmark(ref.timestamp),b=await io.bookmark(ref.timestamp);
  if(typeof a!=='string'||!bookmark.test(a)||a!==b||digest(a)!==ref.bookmarkSha256)return held();
  const afterRuntime=await io.runtime(),after=await io.state();
  if(!runtimeValid(afterRuntime)||afterRuntime.deploymentFingerprint!==runtime.deploymentFingerprint||!stopped(after)||after.ledgerHash!==before.ledgerHash)return held();
  return {ok:true,state:'saved_recovery_point_reverified',referenceId:ref.referenceId,expiresAt:ref.expiresAt,bookmarkMatched:true,stopped:true,runtimeMatched:true,ledgerMatched:true,restoreTested:false,backupVerified:false,deploymentAuthorized:false};
 }catch{return held();}
}

async function main(){
 if(process.env.GITHUB_REPOSITORY!=='soykufu/ig-harness-oss'||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch')return held();
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(!token)return held();
 const api=async(path,sql)=>{
  if(sql===undefined){if(!isStoppedRuntimeReadPath(path)&&!path.startsWith(DB+'/time_travel/bookmark?timestamp='))throw Error('Unexpected read');}
  else if(path!==DB+'/query'||!/^SELECT\b/.test(sql)||sql.includes(';'))throw Error('Unexpected query');
  const r=await fetch(ROOT+path,{method:sql===undefined?'GET':'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(sql===undefined?{}:{body:JSON.stringify({sql})}),signal:AbortSignal.timeout(15000)});
  const b=await r.json();if(!r.ok||b.success!==true)throw Error('Provider read failed');return b.result;
 };
 const query=async sql=>(await api(DB+'/query',sql))[0]?.results;
 const ref=JSON.parse(process.env.RECOVERY_REFERENCE||'null');
 return verifySavedRecovery(ref,{
  state:async()=>{const state=(await query("SELECT (SELECT value FROM integration_settings WHERE key='outbound_paused') AS paused,(SELECT COUNT(*) FROM ig_accounts) AS accounts,(SELECT COUNT(*) FROM followers) AS followers"))[0];return {...state,ledgerHash:migrationLedgerFingerprint(await query('SELECT name,sha256 FROM ig_schema_migrations'))};},
  runtime:()=>readStoppedRuntimeSnapshot({read:path=>api(path)}),
  bookmark:async timestamp=>(await api(DB+'/time_travel/bookmark?timestamp='+encodeURIComponent(timestamp)))?.bookmark,
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let r;try{r=await main();}catch{r=held();}console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}
