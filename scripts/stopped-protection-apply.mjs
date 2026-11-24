import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {summarizeWorkerBundle} from './stopped-backup-preflight.mjs';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
import {readStoppedInstallationSnapshot} from './stopped-installation-snapshot.mjs';
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
async function main(){
 const token=process.env.CLOUDFLARE_API_TOKEN,key=process.env.IG_HARNESS_API_KEY,mode=process.env.PROTECTION_ACTION;
 const official=process.env.GITHUB_REPOSITORY==='soykufu/ig-harness-oss'&&process.env.GITHUB_REF==='refs/heads/main'&&process.env.GITHUB_EVENT_NAME==='workflow_dispatch'&&!!token&&!!key;
 if(!official)return performProtection({mode,official:false});
 const request=async(path,{method='GET',body,headers={}}={})=>fetch('https://api.cloudflare.com/client/v4'+path,{method,body,redirect:'error',headers:{Authorization:`Bearer ${token}`,...headers},signal:AbortSignal.timeout(25000)});
 const json=async(path,options)=>{const r=await request(path,options),b=await r.json();if(!r.ok||b.success!==true)throw Error('provider_failed');return b.result;};
 const runtime=()=>readStoppedRuntimeSnapshot({read:path=>{if(!isStoppedRuntimeReadPath(path))throw Error('read_path');return json(path);}});
 const query=async sql=>{if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)||sql.includes(';'))throw Error('sql_read_only');const b=await json(DB+'/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql})});if(!Array.isArray(b[0]?.results))throw Error('sql_read_failed');return b[0].results;};
 let original;
 const bundle=async()=>{const r=await request(WORKER+'/content/v2');if(!r.ok)throw Error('code_read_failed');const bytes=Buffer.from(await r.arrayBuffer());const summary=await summarizeWorkerBundle(bytes,r.headers.get('content-type'),r.headers.get('cf-entrypoint'));if(summary.entrypoint==='index.js'&&summary.modules.length===1){const form=await new Response(bytes,{headers:{'Content-Type':r.headers.get('content-type')}}).formData();const file=form.get('index.js');if(!file||typeof file==='string')throw Error('source_unavailable');original=Buffer.from(await file.arrayBuffer());}return summary;};
 const installation=async()=>{
  const state=await readStoppedInstallationSnapshot({repoDir:process.cwd(),query});
  const schema=await query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND substr(name,1,4)!='_cf_' ORDER BY type,name");
  const counts=[];for(const row of schema.filter(x=>x.type==='table'&&x.name!=='rate_limit_buckets')){if(typeof row.name!=='string')throw Error('bad_table');counts.push([row.name,(await query('SELECT COUNT(*) AS n FROM '+JSON.stringify(row.name)))[0]?.n]);}
  return {...state,schemaHash:digest(JSON.stringify(schema)),businessCountsHash:digest(JSON.stringify(counts))};
 };
 const settings=()=>json(WORKER+'/settings');
 const snapshot=async()=>{const r=await runtime();const i=await installation();const b=await bundle();const s=await settings();const dep=await json(WORKER+'/deployments');const version=await json(WORKER+'/versions/'+dep.deployments[0].versions[0].version_id);const last=await runtime();if(canonical(r)!==canonical(last))throw Error('runtime_moved');return{runtime:r,installation:i,bundle:b,settings:s,versionId:version.id,versionResourceFields:Object.keys(version.resources||{}).sort()};};
 const guard=await readFile(new URL('./recovery-bucket-guard.mjs',import.meta.url),'utf8');
 // Verify object-read permission and fixed canary absence before any deployment.
 for(const name of ['__private_recovery__/protection-canary-20261124.txt','protection-canary-20261124.txt']){const r=await request(ROOT+'/r2/buckets/'+SCRIPT+'/objects/'+name);if(r.status!==404)throw Error('canary_preflight_unavailable');}
 return performProtection({mode,official,snapshot,replace:async()=>{
  const modules=protectionModules(original,guard),form=new FormData();form.set('metadata',JSON.stringify({main_module:'backup-guard.js'}));for(const m of modules)form.set(m.name,new Blob([m.data],{type:'application/javascript+module'}),m.name);
  // Content-only endpoint preserves existing config and metadata. No script upload,
  // binding replacement, trigger update or deployment API is exposed here.
  const r=await request(WORKER+'/content',{method:'PUT',body:form});const b=await r.json();return r.ok&&b.success===true;
 },verify:async before=>{
  const after=await snapshot();const expected=protectionModules(original,guard).map(m=>({name:m.name,type:'application/javascript+module',sha256:digest(m.data)})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  const ok=canonical(before.settings)===canonical(after.settings)&&canonical(before.installation)===canonical(after.installation)&&after.bundle.entrypoint==='backup-guard.js'&&canonical(after.bundle.modules)===canonical(expected)&&after.runtime.deploymentStable&&after.runtime.deployedBindingsVerified&&after.runtime.preparationLockVerified&&after.runtime.extraFlagsVerified&&after.runtime.r2DirectPublicAccessDisabled;
  return{ok,fingerprint:after.runtime.deploymentFingerprint};
 },canary:()=>runCanary({request,key})});
}
async function runCanary({request,key}){
 const body=Buffer.from('SOY-KUFU non-sensitive protection acceptance 2026-11-24'),names=['__private_recovery__/protection-canary-20261124.txt','protection-canary-20261124.txt'],owned=[];
 const path=name=>ROOT+'/r2/buckets/'+SCRIPT+'/objects/'+name;
 const receipt={ok:false,privateGet404:false,privateHead404:false,range404:false,encoded404:false,galleryHidden:false,ordinaryMediaVerified:false,cleanupVerified:false};
 const read=async name=>{const r=await request(path(name));if(r.status===404)return null;if(!r.ok)throw Error('object_read_failed');return Buffer.from(await r.arrayBuffer());};
 const worker=(suffix,options={})=>fetch(ORIGIN+suffix,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
 try{
  for(const name of names)if(await read(name)!==null)throw Error('canary_exists');
  for(const name of names){owned.push(name);const r=await request(path(name),{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body});const b=await r.json();if(!r.ok||b.success!==true)throw Error('canary_put_unknown');if(!(await read(name))?.equals(body))throw Error('canary_readback_failed');}
  const suffix='/images/'+names[0],encoded='/images/'+encodeURIComponent(names[0]);
  receipt.privateGet404=(await worker(suffix)).status===404;
  receipt.privateHead404=(await worker(suffix,{method:'HEAD'})).status===404;
  receipt.range404=(await worker(encoded,{headers:{Range:'bytes=0-7'}})).status===404;
  receipt.encoded404=(await worker(encoded)).status===404&&(await worker('/images/'+encodeURIComponent(encodeURIComponent(names[0])))).status===404;
  const normal=await worker('/images/'+names[1]);const range=await worker('/images/'+names[1],{headers:{Range:'bytes=0-7'}});receipt.ordinaryMediaVerified=normal.ok&&Buffer.from(await normal.arrayBuffer()).equals(body)&&range.status===206&&Buffer.from(await range.arrayBuffer()).equals(body.subarray(0,8));
  let cursor;let hidden=true,seenNormal=false,complete=false;
  for(let page=0;page<20;page++){
   const r=await worker('/api/images?limit=200'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{headers:{Authorization:`Bearer ${key}`}});const b=await r.json();if(!r.ok||b.success!==true||!Array.isArray(b.data?.items))throw Error('gallery_failed');
   if(b.data.items.some(x=>x.key===names[0]||x.key?.startsWith('__private_recovery__/')))hidden=false;
   if(b.data.items.some(x=>x.key===names[1]))seenNormal=true;
   if(!b.data.truncated){complete=true;break;}if(!b.data.cursor||b.data.cursor===cursor)throw Error('gallery_cursor_failed');cursor=b.data.cursor;
  }
  receipt.galleryHidden=hidden&&seenNormal&&complete;
 }catch{/* No retry, raw error, object data or credentials in receipt. */}
 finally{
  let cleaned=true;for(const name of owned){try{const current=await read(name);if(current===null)continue;if(!current.equals(body)){cleaned=false;continue;}const r=await request(path(name),{method:'DELETE'});if(!r.ok||await read(name)!==null)cleaned=false;}catch{cleaned=false;}}receipt.cleanupVerified=cleaned&&owned.length===2;
 }
 receipt.ok=Object.entries(receipt).filter(([k])=>k!=='ok').every(([,v])=>v===true);return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let r;try{r=await main();}catch{r={ok:false,state:'protection_held',reason:'preparation_read_failed',replacementAttempted:false};}console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}
