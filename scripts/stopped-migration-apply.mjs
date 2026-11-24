import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {splitSql,verifyLatestSchema} from './migration-runner.mjs';
import {openDatabaseCopy} from './stopped-database-envelope.mjs';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
const A='e76a3f504309ca9289d8dfa3ee504502',D='e55c3b84-ea9a-48fd-a7a3-08253089d295',B='soykufu-ig-harness-20261119',ROOT='/accounts/'+A,DB=ROOT+'/d1/database/'+D;
const FP='f7e412a0dbb7360d2cf7db15c74908a039472c14bc34217cb06ce1cb2d4e9112',PLAN='0dc42308327f12540b455dec601a6f8008f10dafdfce2eaaaa634de9252bfcc3';
const hash=x=>createHash('sha256').update(x).digest('hex'),quote=x=>"'"+x.replaceAll("'","''")+"'";
export async function prepareBatch({review,repoDir,at}){
 if(!review?.ok||review.applyAuthorized!==false||review.planId!==PLAN||hash(JSON.stringify(review.plan))!==PLAN||review.plan.migrations.length!==14||!Number.isFinite(Date.parse(at)))throw Error('plan_mismatch');
 const batch=[];for(const [i,m]of review.plan.migrations.entries()){
  if(Number(m.name.slice(0,4))!==28+i)throw Error('scope_mismatch');const sql=await readFile(join(repoDir,'packages/db/migrations',m.name),'utf8');if(hash(sql)!==m.sha256)throw Error('source_changed');
  batch.push(...splitSql(sql).map(sql=>({sql})),{sql:`INSERT INTO ig_schema_migrations(name,sha256,applied_at) VALUES(${quote(m.name)},${quote(m.sha256)},${quote(at)})`});
 }return batch;
}
export async function businessSnapshot(query){
 const schema=await query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND substr(name,1,4)!='_cf_' ORDER BY type,name");const data=[];
 for(const t of schema.filter(x=>x.type==='table'&&x.name!=='rate_limit_buckets')){
  const name=JSON.stringify(t.name),cols=await query(`PRAGMA table_xinfo(${name})`);if(cols.some(c=>![0,2,3].includes(c.hidden)))throw Error('column_unverified');
  const fields=cols.flatMap((c,i)=>{const q=JSON.stringify(c.name);return[`typeof(${q}) AS t${i}`,`CASE typeof(${q}) WHEN 'real' THEN printf('%!.26g',${q}) ELSE hex(CAST(${q} AS BLOB)) END AS v${i}`];});
  const rows=await query(`SELECT ${fields.join(',')} FROM ${name} LIMIT 10001`);if(rows.length>10000)throw Error('row_limit');const values=rows.map(r=>JSON.stringify(cols.map((_,i)=>[r['t'+i],r['v'+i]]))).sort();if(Buffer.byteLength(JSON.stringify(values))>16*1024*1024)throw Error('size_limit');data.push([t.name,cols.map(c=>c.name),values]);
 }return{schema:hash(JSON.stringify(schema)),data:hash(JSON.stringify(data)),businessTables:data.length};
}
export async function main(){
 const e=process.env,r={ok:false,state:'migration_apply_held',applyAttempted:false,applyAccepted:false,migrationsApplied:0,messagesSent:0,deploymentAuthorized:false};let local,key,opened;
 try{
  if(e.GITHUB_REPOSITORY!=='soykufu/ig-harness-oss'||e.GITHUB_REF!=='refs/heads/main'||e.GITHUB_EVENT_NAME!=='workflow_dispatch'||e.GITHUB_RUN_NUMBER!=='44'||e.GITHUB_RUN_ATTEMPT!=='1'||e.APPLY_STOPPED_MIGRATIONS!=='true')throw Error('one_dispatch_required');
  if(!e.CLOUDFLARE_API_TOKEN||!/^([a-fA-F0-9]{64})$/.test(e.IG_DATABASE_BACKUP_KEY||''))throw Error('credentials_missing');key=Buffer.from(e.IG_DATABASE_BACKUP_KEY,'hex');
  const request=(path,body)=>fetch('https://api.cloudflare.com/client/v4'+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{Authorization:`Bearer ${e.CLOUDFLARE_API_TOKEN}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
  const api=async(path,body)=>{const response=await request(path,body),b=await response.json();if(!response.ok||b.success!==true||Array.isArray(b.result)&&b.result.some(x=>x.success===false))throw Error('provider_result_unverified');return b.result;};
  const query=async sql=>{if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)||sql.includes(';'))throw Error('read_only');return(await api(DB+'/query',{sql}))[0].results;};
  const runtime=async()=>{const x=await readStoppedRuntimeSnapshot({read:path=>{if(!isStoppedRuntimeReadPath(path))throw Error('read_path');return api(path);}});if(!x.deploymentStable||!x.deployedBindingsVerified||!x.preparationLockVerified||!x.extraFlagsVerified||!x.r2DirectPublicAccessDisabled||x.deploymentFingerprint!==FP)throw Error('runtime_changed');return x;};
  const stopped=async()=>{const x=(await query("SELECT (SELECT value FROM integration_settings WHERE key='outbound_paused') AS paused,(SELECT COUNT(*) FROM ig_accounts) AS accounts,(SELECT COUNT(*) FROM followers) AS followers"))[0];if(x?.paused!=='1'||x.accounts!==0||x.followers!==0)throw Error('stop_changed');};
  await runtime();await stopped();
  const review=JSON.parse(await readFile(new URL('./stopped-approved-migration-plan.json',import.meta.url),'utf8'));const at=new Date().toISOString(),batch=await prepareBatch({review,repoDir:process.cwd(),at});
  const response=await request(ROOT+'/r2/buckets/'+B+'/objects/__private_recovery__/database-copy-20261124-once.json');if(!response.ok)throw Error('backup_missing');const raw=await response.arrayBuffer();if(raw.byteLength>64*1024*1024)throw Error('backup_oversize');
  const expected={accountId:A,databaseId:D,bucketName:B,sourceSha:'d4c3edb788388324bbfba3ddd0e6d3454c1dbc9e',createdAt:'2026-11-24T01:24:26.478Z',expiresAt:'2026-11-30T01:24:26.478Z',schemaHash:'5f2f633b8f4e722a07c1514cab845db3e82944610feca8502f1b5d74519d1dda',ledgerHash:'1f434b319a3d61d77dc1fa81a61399281f4afbbb60fe36085782b02fb510bcad',migrationPlanId:'3352210b62a1c9b9060bd0ddabb1e85d8b5525f8321f0031c194a83bd716dc97'};
  opened=openDatabaseCopy({envelope:JSON.parse(Buffer.from(raw).toString('utf8')),encryptionKey:key,expected});
  local=new DatabaseSync(':memory:',{allowExtension:false});local.exec(opened.sql.toString('utf8'));local.exec('PRAGMA foreign_keys=ON');const localQuery=async sql=>local.prepare(sql).all();
  const before=await businessSnapshot(query);if(JSON.stringify(before)!==JSON.stringify(await businessSnapshot(localQuery)))throw Error('backup_business_drift');
  if((await query('SELECT COUNT(*) AS n FROM ig_schema_migrations'))[0]?.n!==27)throw Error('ledger_changed');
  local.exec('BEGIN');try{for(const x of batch)local.exec(x.sql);local.exec('COMMIT');}catch{local.exec('ROLLBACK');throw Error('local_migration_failed');}
  await verifyLatestSchema(localQuery);const target=await businessSnapshot(localQuery);
  await runtime();await stopped();if(JSON.stringify(before)!==JSON.stringify(await businessSnapshot(query)))throw Error('pre_apply_drift');
  r.applyAttempted=true;
  // One REST batch. No bootstrap, staff-key hashing, restore or retry is exposed.
  const results=await api(DB+'/query',{batch});if(!Array.isArray(results)||results.length!==batch.length)throw Error('batch_result_unknown');r.applyAccepted=true;
  if((await query('SELECT COUNT(*) AS n FROM ig_schema_migrations'))[0]?.n!==41)throw Error('ledger_postcheck_failed');
  if(JSON.stringify(target)!==JSON.stringify(await businessSnapshot(query)))throw Error('postcheck_changed');
  await verifyLatestSchema(query);const checks=await query('PRAGMA quick_check');if(checks.length!==1||Object.values(checks[0])[0]!=='ok'||(await query('PRAGMA foreign_key_check')).length)throw Error('integrity_failed');
  await stopped();await runtime();
  return{...r,ok:true,state:'stopped_migrations_verified',migrationsApplied:14,ledgerCount:41,sourceDataPreserved:true,backupAuthenticated:true,businessRowsMatched:true,volatileRateTableExcluded:true,planId:PLAN,deploymentFingerprint:FP};
 }catch{return r;}finally{local?.close();key?.fill(0);opened?.sql?.fill(0);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){console.log(JSON.stringify(await main()));}
