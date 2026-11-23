import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {verifyStoppedExport} from './stopped-export-drill.mjs';
const sql="CREATE TABLE integration_settings(key TEXT,value TEXT); INSERT INTO integration_settings VALUES('outbound_paused','1'); CREATE TABLE ig_accounts(id TEXT); CREATE TABLE followers(id TEXT); CREATE TABLE ig_schema_migrations(name TEXT,sha256 TEXT); INSERT INTO ig_schema_migrations VALUES('one','hash');";
async function run(mode='valid'){
 const db=new DatabaseSync(':memory:');db.exec(sql);let exports=0,downloads=0;
 if(mode==='connected')db.exec("INSERT INTO ig_accounts VALUES('one')");
 try{return {result:await verifyStoppedExport({query:async q=>db.prepare(q).all(),exportDatabase:async()=>{exports++;return{status:mode==='incomplete'?'pending':'complete',success:true,result:{signed_url:mode==='http'?'http://invalid.test/private':'https://provider.invalid/private?signature=SECRET'}};},download:async()=>{downloads++;if(mode==='drift')db.exec("INSERT INTO ig_schema_migrations VALUES('two','hash')");return mode==='invalid'?'not SQL':mode==='file'?'ATTACH DATABASE \'/tmp/no\' AS other;':mode==='row-mismatch'?sql+"INSERT INTO ig_schema_migrations VALUES('two','hash');":sql;}}),exports,downloads};}
 finally{db.close();}
}
test('restores only in memory, matches schema/counts/ledger and does not grant backup or deployment',async()=>{const r=await run();assert.equal(r.exports,1);assert.equal(r.downloads,1);assert.equal(r.result.localRestoreVerified,true);assert.equal(r.result.tableCount,4);for(const k of ['rowContentsVerified','referencePersisted','timeTravelRestoreTested','backupVerified','deploymentAuthorized'])assert.equal(r.result[k],false);assert.doesNotMatch(JSON.stringify(r),/SECRET|private|signed_url|INSERT/);});
for(const mode of ['connected','incomplete','http','invalid','file','row-mismatch','drift'])test('holds '+mode+' without raw SQL or URL in errors',async()=>{await assert.rejects(run(mode),e=>e.message==='Stopped export drill requires reconciliation');});
