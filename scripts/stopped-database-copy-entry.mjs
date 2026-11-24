import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {copyStoppedDatabaseOnce} from './stopped-database-copy-once.mjs';
import {verifyStoppedExport} from './stopped-export-drill.mjs';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
import {summarizeWorkerBundle} from './stopped-backup-preflight.mjs';
import {migrationLedgerFingerprint} from './stopped-installation-snapshot.mjs';
import {wrapper} from './stopped-protection-apply.mjs';
const ACCOUNT='e76a3f504309ca9289d8dfa3ee504502',DATABASE='e55c3b84-ea9a-48fd-a7a3-08253089d295',BUCKET='soykufu-ig-harness-20261119';
const ROOT='/accounts/'+ACCOUNT,WORKER=ROOT+'/workers/scripts/'+BUCKET,DB=ROOT+'/d1/database/'+DATABASE;
const COPY_KEY='__private_recovery__/database-copy-20261124-once.json',OBJECT=ROOT+'/r2/buckets/'+BUCKET+'/objects/'+COPY_KEY;
const FINGERPRINT='f7e412a0dbb7360d2cf7db15c74908a039472c14bc34217cb06ce1cb2d4e9112';
const ORIGINAL='6624a33372e212b3d8a796b9eb77fd7183456651517d802cce10fdb434cab685';
const digest=x=>createHash('sha256').update(x).digest('hex');
// One new dispatch number only. Same-run retries and any later dispatch cannot
// initiate another export, including when the first result was unknown.
export function copyExecutionAllowed(env){return env.GITHUB_REPOSITORY==='soykufu/ig-harness-oss'&&env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_RUN_NUMBER==='40'&&env.GITHUB_RUN_ATTEMPT==='1'&&env.DATABASE_COPY==='true';}
export async function main(){
 const env=process.env;if(!copyExecutionAllowed(env))return{ok:false,state:'database_copy_held',reason:'one_authorized_dispatch_required',exportAttempted:false,objectWriteAttempted:false};
 const token=env.CLOUDFLARE_API_TOKEN,secret=env.IG_DATABASE_BACKUP_KEY;if(!token||!/^([a-fA-F0-9]{64})$/.test(secret||''))return{ok:false,state:'database_copy_held',reason:'credential_not_verified',exportAttempted:false,objectWriteAttempted:false};
 const encryptionKey=Buffer.from(secret,'hex');let providerReceipt,exportProof;
 const request=(path,{method='GET',body,headers={}}={})=>fetch('https://api.cloudflare.com/client/v4'+path,{method,body,redirect:'error',headers:{Authorization:`Bearer ${token}`,...headers},signal:AbortSignal.timeout(25000)});
 const json=async(path,options)=>{const r=await request(path,options),b=await r.json();if(!r.ok||b.success!==true)throw Error('provider_failed');return b.result;};
 const query=async sql=>{if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)||sql.includes(';'))throw Error('read_only');const b=await json(DB+'/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql})});if(!Array.isArray(b?.[0]?.results))throw Error('query_failed');return b[0].results;};
 const bounded=async(r,max)=>{if(!r.ok||!r.body)throw Error('read_failed');const reader=r.body.getReader(),parts=[];let size=0;try{while(true){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>max)throw Error('too_large');parts.push(v.value);}}finally{await reader.cancel();}return Buffer.concat(parts);};
 const guard=await readFile(new URL('./recovery-bucket-guard.mjs',import.meta.url));
 const privacy=async()=>{
  const r=await readStoppedRuntimeSnapshot({read:path=>{if(!isStoppedRuntimeReadPath(path))throw Error('read_path');return json(path);}});
  if(!r.deploymentStable||!r.deployedBindingsVerified||!r.preparationLockVerified||!r.extraFlagsVerified||!r.r2DirectPublicAccessDisabled||r.deploymentFingerprint!==FINGERPRINT)return false;
  const response=await request(WORKER+'/content/v2'),bytes=await bounded(response,20*1024*1024),bundle=await summarizeWorkerBundle(bytes,response.headers.get('content-type'),response.headers.get('cf-entrypoint'));
  const expected=[{name:'index.js',type:'application/javascript+module',sha256:ORIGINAL},{name:'recovery-bucket-guard.mjs',type:'application/javascript+module',sha256:digest(guard)},{name:'backup-guard.js',type:'application/javascript+module',sha256:digest(Buffer.from(wrapper))}].sort((a,b)=>a.name.localeCompare(b.name,'en'));
  if(bundle.entrypoint!=='backup-guard.js'||JSON.stringify(bundle.modules)!==JSON.stringify(expected))return false;
  const state=(await query("SELECT (SELECT value FROM integration_settings WHERE key='outbound_paused') AS paused,(SELECT COUNT(*) FROM ig_accounts) AS accounts,(SELECT COUNT(*) FROM followers) AS followers"))[0];
  const ledger=await query('SELECT name,sha256 FROM ig_schema_migrations');
  return state?.paused==='1'&&state.accounts===0&&state.followers===0&&migrationLedgerFingerprint(ledger)==='1f434b319a3d61d77dc1fa81a61399281f4afbbb60fe36085782b02fb510bcad';
 };
 const exists=async()=>{const r=await request(OBJECT);if(r.status===404)return false;if(r.ok)return true;throw Error('object_preflight_failed');};
 const createdAt=new Date().toISOString();const metadata={accountId:ACCOUNT,databaseId:DATABASE,bucketName:BUCKET,sourceSha:env.GITHUB_SHA,createdAt,expiresAt:new Date(Date.now()+6*86400000).toISOString(),schemaHash:'5f2f633b8f4e722a07c1514cab845db3e82944610feca8502f1b5d74519d1dda',ledgerHash:'1f434b319a3d61d77dc1fa81a61399281f4afbbb60fe36085782b02fb510bcad',migrationPlanId:'3352210b62a1c9b9060bd0ddabb1e85d8b5525f8321f0031c194a83bd716dc97'};
 try{
  const privacyVerified=await privacy();
  const result=await copyStoppedDatabaseOnce({privacyVerified,encryptionKey,metadata,exists,
   exportAndVerify:async()=>{
    let raw;
    exportProof=await verifyStoppedExport({query,exportDatabase:async()=>{
     let current;
     for(let poll=0;poll<6;poll++){
      const value=await json(DB+'/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({output_format:'polling',dump_options:{compatibility:'d1'},...(current?{current_bookmark:current}:{})})});
      if(value?.status==='complete'){providerReceipt=value;return value;}
      if(value?.status==='error'||typeof value?.at_bookmark!=='string'||!/^[a-f0-9-]{59,64}$/i.test(value.at_bookmark)||current&&current!==value.at_bookmark)throw Error('export_held');
      current=value.at_bookmark;if(poll<5)await new Promise(resolve=>setTimeout(resolve,2000));
     }throw Error('export_pending');
    },download:async url=>{
     const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(25000)});raw=await bounded(r,16*1024*1024);return raw.toString('utf8');
    }});
    if(exportProof.schemaSha256!==metadata.schemaHash)throw Error('schema_changed');
    return{sql:raw,rowContentsVerified:exportProof.rowContentsVerified};
   },put:async bytes=>{
    if(await exists())throw Error('object_race');
    if(await privacy()!==true)throw Error('privacy_changed');
    const r=await request(OBJECT,{method:'PUT',headers:{'Content-Type':'application/json'},body:bytes});const b=await r.json();if(!r.ok||b.success!==true)throw Error('write_unknown');
   },readback:async()=>bounded(await request(OBJECT),64*1024*1024),
   verifyRestored:async sql=>verifyStoppedExport({query,exportDatabase:async()=>providerReceipt,download:async()=>sql.toString('utf8')}),
   checkFinal:privacy,
  });
  return{...result,kind:'encrypted_database_copy_once',copyKey:COPY_KEY,accountId:ACCOUNT,databaseId:DATABASE,bucketName:BUCKET,sourceSha:env.GITHUB_SHA,createdAt,expiresAt:metadata.expiresAt,protectionRunId:45303824595,deploymentFingerprint:FINGERPRINT,...(exportProof?{tableCount:exportProof.tableCount}:{}),messagesSent:0,migrationsApplied:0};
 }finally{encryptionKey.fill(0);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let r;try{r=await main();}catch{r={ok:false,state:'database_copy_held',reason:'preflight_failed',exportAttempted:false,objectWriteAttempted:false};}console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}
