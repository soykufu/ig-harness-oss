import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {assertStoppedDeploySchema} from './stopped-deploy-readiness.mjs';
/** Official-runner reads only. No secrets, row bodies, recipients or repair. */
export function classifyMigrationInventory(expected,applied){
 const known=new Map(expected.map(r=>[r.name,r.sha256]));const actual=new Map();
 const duplicates=[];
 for(const row of applied){if(actual.has(row.name))duplicates.push(row.name);actual.set(row.name,row.sha256);}
 const missing=expected.filter(r=>!actual.has(r.name)).map(r=>r.name);
 const modified=expected.filter(r=>actual.has(r.name)&&actual.get(r.name)!==r.sha256).map(r=>r.name);
 const unexpected=[...actual.keys()].filter(n=>!known.has(n));
 const matching=expected.filter(r=>actual.get(r.name)===r.sha256).length;
 return{expected:expected.length,applied:applied.length,matching,missing,modified,unexpected,duplicates};
}
export function migrationLedgerFingerprint(rows){return createHash('sha256').update(JSON.stringify(rows.map(r=>[r.name,r.sha256]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0))).digest('hex');}
export async function readStoppedInstallationSnapshot({repoDir,query}){
 const read=async(sql)=>{
  if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)||/;/.test(sql))throw Error('Snapshot accepts one read statement only');
  return query(sql);
 };
 const stateSql="SELECT (SELECT value FROM integration_settings WHERE key='outbound_paused') AS paused,(SELECT COUNT(*) FROM ig_accounts) AS accounts,(SELECT COUNT(*) FROM followers) AS followers";
 const first=(await read(stateSql))[0];
 if(first?.paused!=='1'||first.accounts!==0||first.followers!==0)throw Error('Stopped empty installation requires reconciliation');
 const tables=await read("SELECT name FROM sqlite_master WHERE type='table'");
 let appliedMigrationCount=null,migrationInventory=null,migrationLedgerSha256=null;
 const names=(await readdir(join(repoDir,'packages/db/migrations'))).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
 const expected=await Promise.all(names.map(async name=>({name,sha256:createHash('sha256').update(await readFile(join(repoDir,'packages/db/migrations',name),'utf8')).digest('hex')})));
 if(tables.some(r=>r.name==='ig_schema_migrations')){
  const rows=await read('SELECT name,sha256 FROM ig_schema_migrations');
  appliedMigrationCount=rows.length;
  migrationLedgerSha256=migrationLedgerFingerprint(rows);
  migrationInventory=classifyMigrationInventory(expected,rows);
 }
 let schemaReady=false;
 try{await assertStoppedDeploySchema({repoDir,query:read});schemaReady=true;}catch{/* An old/missing/modified schema is evidence to hold, never auto-migrate. */}
 const last=(await read(stateSql))[0];
 if(last?.paused!=='1'||last.accounts!==0||last.followers!==0)throw Error('Stopped installation changed during review');
 return{stopped:true,connectedAccounts:0,followers:0,appliedMigrationCount,migrationInventory,migrationLedgerSha256,schemaReady,backupVerified:false,deployedBindingsVerified:false,preparationLockVerified:false,extraFlagsVerified:false,deploymentAuthorized:false};
}
