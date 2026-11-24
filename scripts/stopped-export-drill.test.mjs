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
test('restores only in memory, matches schema/counts/ledger/contents without backup or deployment grants',async()=>{const r=await run();assert.equal(r.exports,1);assert.equal(r.downloads,1);assert.equal(r.result.localRestoreVerified,true);assert.equal(r.result.rowContentsVerified,true);assert.equal(r.result.tableCount,4);for(const k of ['referencePersisted','timeTravelRestoreTested','backupVerified','deploymentAuthorized'])assert.equal(r.result[k],false);assert.doesNotMatch(JSON.stringify(r),/SECRET|private|signed_url|INSERT/);});
for(const mode of ['connected','incomplete','http','invalid','file','row-mismatch','drift'])test('holds '+mode+' without raw SQL or URL in errors',async()=>{await assert.rejects(run(mode),e=>e.message==='Stopped export drill requires reconciliation');});
async function compareRows(source,copy,change){const db=new DatabaseSync(':memory:');db.exec(sql+source);try{return await verifyStoppedExport({query:async q=>db.prepare(q).all(),exportDatabase:async()=>({status:'complete',success:true,result:{signed_url:'https://provider.invalid/copy'}}),download:async()=>{change?.(db);return sql+copy;}});}finally{db.close();}}
const payload="CREATE TABLE payload(value);";
for(const [label,a,b] of [
 ['same-count text',"'secret-a'","'secret-b'"],
 ['null versus empty',"NULL","''"],
 ['text versus blob',"'abc'","X'616263'"],
 ['embedded NUL suffix',"'a'||char(0)||'b'","'a'||char(0)||'c'"],
 ['64-bit integer precision','9223372036854775806','9223372036854775807'],
 ['adjacent floating values','1.0000000000000002','1.0000000000000004'],
 ['blob bytes',"X'00FF'","X'0000'"]
])test('same schema and counts cannot hide '+label,async()=>{await assert.rejects(compareRows(payload+`INSERT INTO payload VALUES(${a});`,payload+`INSERT INTO payload VALUES(${b});`),/^Error: Stopped export drill requires reconciliation$/);});
test('duplicate rows are counted even when unique values match',async()=>{await assert.rejects(compareRows(payload+"INSERT INTO payload VALUES('a'),('a'),('b');",payload+"INSERT INTO payload VALUES('a'),('b'),('b');"));});
test('row order does not change the content comparison',async()=>{const r=await compareRows(payload+"INSERT INTO payload VALUES('日本語'),(NULL),(X'00FF');",payload+"INSERT INTO payload VALUES(X'00FF'),('日本語'),(NULL);");assert.equal(r.rowContentsVerified,true);assert.equal(Object.hasOwn(r,'rowContentsHash'),false);});
test('same-count source edit while exporting is held',async()=>{const data=payload+"INSERT INTO payload VALUES('before');";await assert.rejects(compareRows(data,data,db=>db.exec("UPDATE payload SET value='after'")));});
test('generated columns are included in the comparison',async()=>{const data="CREATE TABLE payload(value TEXT,extra TEXT GENERATED ALWAYS AS (value||'!') STORED); INSERT INTO payload(value) VALUES('日本語');";assert.equal((await compareRows(data,data)).rowContentsVerified,true);});

