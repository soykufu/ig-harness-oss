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
export async function main(){return{ok:false,state:'migration_apply_retired',consumedRunId:45306989204,applyAttempted:false,migrationsApplied:0};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){console.log(JSON.stringify(await main()));}
