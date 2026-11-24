import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

const stateSql="SELECT (SELECT value FROM integration_settings WHERE key='outbound_paused') AS paused,(SELECT COUNT(*) FROM ig_accounts) AS accounts,(SELECT COUNT(*) FROM followers) AS followers";
const schemaSql="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND substr(name,1,4)!='_cf_' ORDER BY type,name";
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hold=()=>{throw Error('Stopped export drill requires reconciliation');};
async function inspect(query){
 const state=(await query(stateSql))[0];
 if(state?.paused!=='1'||state.accounts!==0||state.followers!==0)hold();
 const schema=await query(schemaSql);
 if(!Array.isArray(schema)||!schema.length||schema.some(r=>typeof r.name!=='string'||!['table','view','trigger','index'].includes(r.type)))hold();
 const counts=[],contents=[];
 for(const row of schema.filter(r=>r.type==='table')){
  const name='"'+row.name.replaceAll('"','""')+'"';
  const n=(await query(`SELECT COUNT(*) AS n FROM ${name}`))[0]?.n;
  if(!Number.isSafeInteger(n)||n<0||n>10000)hold();counts.push([row.name,n]);
  const columns=await query(`PRAGMA table_xinfo(${name})`);
  if(!Array.isArray(columns)||!columns.length||columns.some(c=>typeof c.name!=='string'||![0,2,3].includes(c.hidden)))hold();
  const fields=columns.flatMap((c,i)=>{const q='"'+c.name.replaceAll('"','""')+'"';return [`typeof(${q}) AS t${i}`,`CASE typeof(${q}) WHEN 'real' THEN printf('%!.26g',${q}) ELSE hex(CAST(${q} AS BLOB)) END AS v${i}`];});
  const rows=await query(`SELECT ${fields.join(',')} FROM ${name} LIMIT 10001`);
  if(!Array.isArray(rows)||rows.length!==n)hold();
  const canonical=rows.map(r=>JSON.stringify(columns.map((_,i)=>{const type=r['t'+i],value=r['v'+i];if(!['null','integer','real','text','blob'].includes(type)||typeof value!=='string')hold();return[type,value];}))).sort();
  if(Buffer.byteLength(JSON.stringify(canonical))>16*1024*1024)hold();
  contents.push([row.name,columns.map(c=>c.name),hash(canonical)]);
 }
 const ledger=await query('SELECT name,sha256 FROM ig_schema_migrations ORDER BY name');
 return{schemaHash:hash(schema),countsHash:hash(counts),ledgerHash:hash(ledger),rowContentsHash:hash(contents),tableCount:counts.length};
}
/** Official export bytes remain only in runner memory. Local SQLite writes
 * never target D1. This is not an in-place Time Travel restore or durable backup. */
export async function verifyStoppedExport({query,exportDatabase,download}){
 let db;
 try{
  const before=await inspect(query);
  const result=await exportDatabase();
  if(result?.status!=='complete'||result.success!==true)hold();
  const url=new URL(result.result?.signed_url);
  if(url.protocol!=='https:'||url.username||url.password||url.port)hold();
  const sql=await download(url.href);
  if(typeof sql!=='string'||!sql.length||Buffer.byteLength(sql)>16*1024*1024||/\b(?:ATTACH|DETACH|VACUUM|load_extension|writefile|readfile)\b/i.test(sql))hold();
  db=new DatabaseSync(':memory:',{allowExtension:false});db.exec(sql);db.exec('PRAGMA query_only=ON');
  const check=db.prepare('PRAGMA integrity_check').all();
  if(check.length!==1||Object.values(check[0])[0]!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)hold();
  const local=await inspect(async statement=>db.prepare(statement).all());
  const after=await inspect(query);
  if(JSON.stringify(before)!==JSON.stringify(local)||JSON.stringify(before)!==JSON.stringify(after))hold();
  return{kind:'d1_export_memory_restore',localRestoreVerified:true,integrityVerified:true,schemaMatched:true,tableCountsMatched:true,migrationLedgerMatched:true,tableCount:before.tableCount,schemaSha256:before.schemaHash,countsSha256:before.countsHash,ledgerSha256:before.ledgerHash,rowContentsVerified:true,referencePersisted:false,timeTravelRestoreTested:false,backupVerified:false,deploymentAuthorized:false};
 }catch{throw Error('Stopped export drill requires reconciliation');}finally{db?.close();}
}

