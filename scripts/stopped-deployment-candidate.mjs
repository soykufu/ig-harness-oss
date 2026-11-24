import {readFile,readdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve,relative} from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';import {readStoppedInstallationSnapshot} from './stopped-installation-snapshot.mjs';
const A='e76a3f504309ca9289d8dfa3ee504502',D='e55c3b84-ea9a-48fd-a7a3-08253089d295',NAME='soykufu-ig-harness-20261119',W='/accounts/'+A+'/workers/scripts/'+NAME;
// Accepted backend run45322776381, registration run45323225017 and read-only run45326563764.
// A later deployment must be reconciled explicitly, never learned automatically.
export const CANDIDATE_BASELINE_FINGERPRINT='66d2c1c0033633bf497964e2adaa2639ba1f02e37cc3afe91c667026f8340564';
const FP=CANDIDATE_BASELINE_FINGERPRINT;
export function candidateBaselineReady(runtime,installation){
 const m=installation?.migrationInventory;
 return runtime?.deploymentStable===true&&runtime?.deployedBindingsVerified===true
  &&runtime?.preparationLockVerified===true&&runtime?.extraFlagsVerified===true
  &&runtime?.deploymentFingerprint===FP&&installation?.stopped===true
  &&installation?.connectedAccounts===1&&installation?.registeredAccountVerified===true&&installation?.followers===0
  &&installation?.appliedMigrationCount===41&&installation?.schemaReady===true
  &&m?.expected===41&&m?.applied===41&&m?.matching===41
  &&['missing','modified','unexpected','duplicates'].every(k=>Array.isArray(m[k])&&m[k].length===0);
}
const hash=b=>createHash('sha256').update(b).digest('hex');
export function candidateConfig(settings,repo){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(settings?.compatibility_date||'')||!Array.isArray(settings.bindings))throw Error('settings_invalid');
 const db=settings.bindings.filter(b=>b.name==='DB'),r2=settings.bindings.filter(b=>b.name==='IMAGES'),lock=settings.bindings.filter(b=>b.name==='OUTBOUND_PREPARATION_LOCK');
 if(db.length!==1||db[0].type!=='d1'||db[0].id!==D||r2.length!==1||r2[0].type!=='r2_bucket'||r2[0].bucket_name!==NAME||lock.length!==1||lock[0].text!=='1')throw Error('binding_drift');
 return{name:NAME,main:resolve(repo,'apps/worker/src/index.ts'),compatibility_date:settings.compatibility_date,compatibility_flags:settings.compatibility_flags||[],account_id:A,workers_dev:true,preview_urls:false,assets:{directory:resolve(repo,'apps/web/out'),binding:'ASSETS',run_worker_first:true},d1_databases:[{binding:'DB',database_name:NAME,database_id:D}],r2_buckets:[{binding:'IMAGES',bucket_name:NAME}],vars:Object.fromEntries(settings.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text])),triggers:{crons:[]}};
}
export function buildEnvironment(env){const allowed=['PATH','HOME','PNPM_HOME','COREPACK_HOME','CI','TMPDIR','RUNNER_TEMP','NODE_OPTIONS'];return{...Object.fromEntries(allowed.filter(k=>typeof env[k]==='string').map(k=>[k,env[k]])),WRANGLER_SEND_METRICS:'false',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SAME_ORIGIN_API:'1'};}
async function inventory(dir){const rows=[];async function walk(p){for(const d of await readdir(p,{withFileTypes:true})){const file=join(p,d.name);if(d.isSymbolicLink())throw Error('symlink');if(d.isDirectory())await walk(file);else{const bytes=await readFile(file);rows.push({name:relative(dir,file),bytes:bytes.length,sha256:hash(bytes)});}}}await walk(dir);rows.sort((a,b)=>a.name.localeCompare(b.name));return rows;}
async function main(){let temp;try{
 const e=process.env;if(e.GITHUB_REPOSITORY!=='soykufu/ig-harness-oss'||e.GITHUB_REF!=='refs/heads/main'||e.GITHUB_EVENT_NAME!=='workflow_dispatch'||!e.CLOUDFLARE_API_TOKEN)throw Error('official_runner_required');
 const api=async(path,sql)=>{if(sql===undefined){if(!isStoppedRuntimeReadPath(path)&&path!==W+'/settings')throw Error('read_path');}else if(path!=='/accounts/'+A+'/d1/database/'+D+'/query'||!/^\s*(SELECT|PRAGMA)\b/i.test(sql)||sql.includes(';'))throw Error('read_only');const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method:sql===undefined?'GET':'POST',redirect:'error',headers:{Authorization:`Bearer ${e.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},...(sql===undefined?{}:{body:JSON.stringify({sql})}),signal:AbortSignal.timeout(20000)});const b=await r.json();if(!r.ok||b.success!==true)throw Error('provider_read_failed');return b.result;};
 const snapshot=async()=>{const runtime=await readStoppedRuntimeSnapshot({read:path=>api(path)}),installation=await readStoppedInstallationSnapshot({repoDir:process.cwd(),registeredAccount:true,query:async sql=>(await api('/accounts/'+A+'/d1/database/'+D+'/query',sql))[0].results});if(!candidateBaselineReady(runtime,installation))throw Error('baseline_changed');return{runtime,installation};};
 const before=await snapshot(),settings=await api(W+'/settings'),config=candidateConfig(settings,process.cwd());temp=await mkdtemp(join(tmpdir(),'soykufu-candidate-'));const path=join(temp,'wrangler.json');await writeFile(path,JSON.stringify(config),{mode:0o600});
 const run=(args,cwd)=>{const r=spawnSync('pnpm',args,{cwd,env:buildEnvironment(e),encoding:'utf8',timeout:300000,maxBuffer:32*1024*1024});if(r.error||r.status!==0)throw Error('offline_build_failed');};
 run(['--filter','web','build'],process.cwd());
 run(['exec','wrangler','deploy','--dry-run','--outdir',join(temp,'worker'),'--config',path],resolve('apps/worker'));
 const modules=await inventory(join(temp,'worker')),assets=await inventory(resolve('apps/web/out'));if(!modules.some(m=>m.name.endsWith('.js'))||!assets.some(m=>m.name.endsWith('.html')))throw Error('build_empty');
 const after=await snapshot(),afterSettings=await api(W+'/settings');if(before.runtime.deploymentFingerprint!==after.runtime.deploymentFingerprint||JSON.stringify(before.installation)!==JSON.stringify(after.installation)||JSON.stringify(settings)!==JSON.stringify(afterSettings))throw Error('baseline_drift');
 return{ok:true,state:'stopped_deployment_candidate_built',sourceSha:e.GITHUB_SHA,registeredAccountVerified:true,deploymentFingerprint:FP,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,bindingInventory:settings.bindings.map(b=>({name:b.name,type:b.type})),workerModules:modules,assetCount:assets.length,assetManifestSha256:hash(JSON.stringify(assets)),cronCount:0,newDurableObjectBindings:0,productionMutations:0,secretsChanged:0,deploymentAuthorized:false};
 }catch(e){return{ok:false,state:'deployment_candidate_held',reason:['offline_build_failed','baseline_changed','baseline_drift','settings_invalid','binding_drift'].includes(e?.message)?e.message:'validation_failed',productionMutations:0,deploymentAuthorized:false};}finally{if(temp)await rm(temp,{recursive:true,force:true});}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await main();console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}
