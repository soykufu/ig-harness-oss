import {assertStoppedDeploySchema} from './stopped-deploy-readiness.mjs';
/** Official-runner reads only. No secrets, row bodies, recipients or repair. */
export async function readStoppedInstallationSnapshot({repoDir,query}){
 const read=async(sql)=>{
  if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)||/;/.test(sql))throw Error('Snapshot accepts one read statement only');
  return query(sql);
 };
 const stateSql="SELECT (SELECT value FROM integration_settings WHERE key='outbound_paused') AS paused,(SELECT COUNT(*) FROM ig_accounts) AS accounts,(SELECT COUNT(*) FROM followers) AS followers";
 const first=(await read(stateSql))[0];
 if(first?.paused!=='1'||first.accounts!==0||first.followers!==0)throw Error('Stopped empty installation requires reconciliation');
 const tables=await read("SELECT name FROM sqlite_master WHERE type='table'");
 let appliedMigrationCount=null;
 if(tables.some(r=>r.name==='ig_schema_migrations')){
  const rows=await read('SELECT name,sha256 FROM ig_schema_migrations');
  appliedMigrationCount=rows.length;
 }
 let schemaReady=false;
 try{await assertStoppedDeploySchema({repoDir,query:read});schemaReady=true;}catch{/* An old/missing/modified schema is evidence to hold, never auto-migrate. */}
 const last=(await read(stateSql))[0];
 if(last?.paused!=='1'||last.accounts!==0||last.followers!==0)throw Error('Stopped installation changed during review');
 return{stopped:true,connectedAccounts:0,followers:0,appliedMigrationCount,schemaReady,backupVerified:false,deployedBindingsVerified:false,preparationLockVerified:false,extraFlagsVerified:false,deploymentAuthorized:false};
}
