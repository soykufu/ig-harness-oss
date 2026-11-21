import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyLatestSchema} from './migration-runner.mjs';
/** Read-only prerequisite, not permission to deploy. The caller must separately
 * reconcile the real backup, existing version/bindings and change results. */
export async function assertStoppedDeploySchema({repoDir,query}){
 const read=async sql=>{
  if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql))throw Error('Deployment readiness accepts reads only');
  return query(sql);
 };
 const stateSql="SELECT (SELECT value FROM integration_settings WHERE key='outbound_paused') AS paused,(SELECT COUNT(*) FROM ig_accounts) AS accounts,(SELECT COUNT(*) FROM followers) AS followers";
 const state=(await read(stateSql))[0];
 if(state?.paused!=='1'||state.accounts!==0||state.followers!==0)throw Error('Deployment requires a stopped, unconnected installation');
 const files=(await readdir(join(repoDir,'packages/db/migrations'))).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
 const rows=await read('SELECT name,sha256 FROM ig_schema_migrations');
 const applied=new Map(rows.map(row=>[row.name,row.sha256]));
 if(applied.size!==rows.length||applied.size!==files.length)throw Error('Deployment migration set requires reconciliation');
 for(const name of files){
  const expected=createHash('sha256').update(await readFile(join(repoDir,'packages/db/migrations',name),'utf8')).digest('hex');
  if(applied.get(name)!==expected)throw Error('Deployment migration evidence mismatch: '+name);
 }
 await verifyLatestSchema(read);
 const finalRows=await read('SELECT name,sha256 FROM ig_schema_migrations');
 if(JSON.stringify(finalRows.map(row=>[row.name,row.sha256]).sort())!==JSON.stringify(rows.map(row=>[row.name,row.sha256]).sort()))throw Error('Deployment migration evidence changed during review');
 const finalState=(await read(stateSql))[0];
 if(finalState?.paused!=='1'||finalState.accounts!==0||finalState.followers!==0)throw Error('Deployment stop or connection state changed during review');
 return{migrationCount:files.length,stopped:true,connectedAccounts:0,backupVerified:false,deploymentAuthorized:false};
}
