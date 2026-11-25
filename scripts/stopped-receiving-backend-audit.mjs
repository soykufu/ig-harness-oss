import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import {readFile} from 'node:fs/promises';
import{backendEntry}from'./stopped-receiving-backend-once.mjs';import{summarizeWorkerBundle}from'./stopped-backup-preflight.mjs';
import{readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath}from'./stopped-runtime-snapshot.mjs';import{readStoppedInstallationSnapshot}from'./stopped-installation-snapshot.mjs';
const A='e76a3f504309ca9289d8dfa3ee504502',D='e55c3b84-ea9a-48fd-a7a3-08253089d295',NAME='soykufu-ig-harness-20261119',ORIGIN='https://'+NAME+'.soykufu.workers.dev';
export const RECEIVING_INDEX_SHA256='e8992c2d517bd120947ce954356a2e5782d8d52450cf2a73e08abeba6c4efb07';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function auditReceivingBackend({official,readSnapshot,readModules,readAccounts,readGuardrails,readIntegrity}){
 const held=reason=>({ok:false,state:'receiving_backend_audit_held',reason,replacementAttempted:false,credentialWriteAttempted:false,subscriptionAttempted:false,messagesSent:0});
 try{
  if(!official)return held('official_runner_required');const before=await readSnapshot();
  const valid=x=>x?.runtime?.deploymentStable===true&&x.runtime.deployedBindingsVerified===true&&x.runtime.preparationLockVerified===true&&x.runtime.extraFlagsVerified===true&&x.runtime.r2DirectPublicAccessDisabled===true&&x.installation?.registeredAccountVerified===true&&x.installation.schemaReady===true&&x.installation.stopped===true&&x.installation.connectedAccounts===1&&x.installation.followers===0;
  if(!valid(before))return held('stopped_state_unverified');if(await readModules()!==true)return held('module_unverified');
  const rows=await readAccounts();if(!Array.isArray(rows)||rows.length!==1)return held('account_unverified');const a=rows[0];
  if(a.igUserId!=='17841402028638204'||a.username!=='soykufu'||a.pageId!=='1632563283635095'||a.connectionType!=='facebook_login'||a.isActive!==true||a.isDefault!==false)return held('account_unverified');
  if(await readGuardrails(a.id)!==true)return held('pause_unverified');if(await readIntegrity()!==true)return held('integrity_unverified');
  const after=await readSnapshot(),projection=x=>[x.runtime.deploymentFingerprint,x.runtime.connectionCredentialMetadata,x.installation];
  if(!valid(after)||JSON.stringify(projection(before))!==JSON.stringify(projection(after)))return held('state_changed');
  return{ok:true,state:'stopped_receiving_backend_audited',deploymentFingerprint:after.runtime.deploymentFingerprint,backendSha256:RECEIVING_INDEX_SHA256,registeredAccountVerified:true,guardrailsPaused:true,integrity:true,preparationLock:true,replacementAttempted:false,credentialWriteAttempted:false,subscriptionAttempted:false,messagesSent:0};
 }catch{return held('read_failed');}
}
async function main(){const e=process.env,official=e.GITHUB_REPOSITORY==='soykufu/ig-harness-oss'&&e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_EVENT_NAME==='workflow_dispatch';
 const request=(url,init={})=>fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});
 const parse=async r=>{if(!r.ok)throw Error('read_failed');const b=await r.json();if(!b||b.error||b.success===false)throw Error('read_failed');return b;};
 const query=async sql=>{if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)||sql.includes(';'))throw Error('read_only');const b=await parse(await request('https://api.cloudflare.com/client/v4/accounts/'+A+'/d1/database/'+D+'/query',{method:'POST',headers:{Authorization:'Bearer '+e.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({sql})}));return b.result[0].results;};
 const readRuntime=()=>readStoppedRuntimeSnapshot({read:async path=>{if(!isStoppedRuntimeReadPath(path))throw Error('read_path');return(await parse(await request('https://api.cloudflare.com/client/v4'+path,{headers:{Authorization:'Bearer '+e.CLOUDFLARE_API_TOKEN}}))).result;}});
 const worker=async path=>parse(await request(ORIGIN+path,{headers:{Authorization:'Bearer '+e.IG_HARNESS_API_KEY}}));
 return auditReceivingBackend({official,readSnapshot:async()=>({runtime:await readRuntime(),installation:await readStoppedInstallationSnapshot({repoDir:process.cwd(),registeredAccount:true,query})}),readModules:async()=>{
  const r=await request('https://api.cloudflare.com/client/v4/accounts/'+A+'/workers/scripts/'+NAME+'/content/v2',{headers:{Authorization:'Bearer '+e.CLOUDFLARE_API_TOKEN}});if(!r.ok)throw Error('read_failed');
  const b=await summarizeWorkerBundle(Buffer.from(await r.arrayBuffer()),r.headers.get('content-type'),r.headers.get('cf-entrypoint'));
  const expected=[{name:'index.js',type:'application/javascript+module',sha256:RECEIVING_INDEX_SHA256},{name:'backend-entry.js',type:'application/javascript+module',sha256:hash(Buffer.from(backendEntry))},{name:'recovery-bucket-guard.mjs',type:'application/javascript+module',sha256:hash(await readFile(new URL('./recovery-bucket-guard.mjs',import.meta.url)))}].sort((a,b)=>a.name.localeCompare(b.name,'en'));
  return b.entrypoint==='backend-entry.js'&&JSON.stringify(b.modules)===JSON.stringify(expected);
 },readAccounts:async()=>(await worker('/api/accounts')).data,readGuardrails:async id=>{if(!/^[a-f0-9-]{36}$/i.test(id))return false;const scoped=await worker('/api/delivery-guardrails?account_id='+id),single=await worker('/api/delivery-guardrails');return scoped.success===true&&scoped.data?.paused===true&&single.success===true&&single.data?.paused===true;},readIntegrity:async()=>{const quick=await query('PRAGMA quick_check'),fk=await query('PRAGMA foreign_key_check');return quick.length===1&&quick[0].quick_check==='ok'&&fk.length===0;}});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let r;try{r=await main();}catch{r={ok:false,state:'receiving_backend_audit_held',reason:'preparation_failed',replacementAttempted:false};}console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}
