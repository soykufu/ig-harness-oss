import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {verifyStoppedExport} from './stopped-export-drill.mjs';
const sql="CREATE TABLE integration_settings(key TEXT,value TEXT); INSERT INTO integration_settings VALUES('outbound_paused','1'); CREATE TABLE ig_accounts(id TEXT); CREATE TABLE followers(id TEXT); CREATE TABLE ig_schema_migrations(name TEXT,sha256 TEXT); INSERT INTO ig_schema_migrations VALUES('one','PRIVATE_FIXTURE_ROW');";
async function run(mode='valid'){
 const db=new DatabaseSync(':memory:');db.exec(sql);const output=[],errors=[];let polls=0,downloads=0,runtimeCalls=0;
 const process={env:{CLOUDFLARE_API_TOKEN:'OFFICIAL_TEST_TOKEN',GITHUB_SHA:'a'.repeat(40)},exitCode:0};
 const source=(await readFile(new URL('./stopped-export-drill-entry.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const execute=new (Object.getPrototypeOf(async function(){}).constructor)('verifyStoppedExport','readStoppedRuntimeSnapshot','isStoppedRuntimeReadPath','process','fetch','console','setTimeout',source);
 try{await execute(verifyStoppedExport,async()=>{runtimeCalls++;return{deploymentStable:true,deployedBindingsVerified:true,preparationLockVerified:true,extraFlagsVerified:true,deploymentFingerprint:mode==='runtime-change'&&runtimeCalls===2?'changed':'same'};},()=>true,process,async(url,options)=>{
  if(String(url).includes('api.cloudflare.com')){
   assert.equal(options.headers.Authorization,'Bearer OFFICIAL_TEST_TOKEN');assert.equal(options.method,'POST');const body=JSON.parse(options.body);let result;
   if(String(url).endsWith('/query')){assert.match(body.sql,/^(SELECT|PRAGMA)/);result=[{results:db.prepare(body.sql).all()}];}
   else{assert.ok(String(url).endsWith('/d1/database/e55c3b84-ea9a-48fd-a7a3-08253089d295/export'));polls++;assert.equal(body.output_format,'polling');assert.equal(body.dump_options.compatibility,'d1');if(polls>1)assert.equal(body.current_bookmark,'00000001-00000002-00004e2f-0a83ea2fceebc654de0640c422be4653');result=polls===1||mode==='incomplete'?{at_bookmark:'00000001-00000002-00004e2f-0a83ea2fceebc654de0640c422be4653'}:{status:'complete',success:true,result:{signed_url:'https://provider.invalid/download?signature=PRIVATE_SIGNED_URL'}};}
   return new Response(JSON.stringify({success:true,result}));
  }
  downloads++;assert.equal(options.headers,undefined);assert.equal(options.redirect,'error');return new Response(mode==='invalid-sql'?'not a database dump':sql);
 },{log:x=>output.push(x),error:x=>errors.push(x)},callback=>{callback();return 0;});return{output,errors,polls,downloads,exitCode:process.exitCode};}finally{db.close();}
}
test('official entry restores locally, polls one export and never sends credentials to download or raw values to logs',async()=>{const r=await run();assert.equal(r.exitCode,0);assert.equal(r.polls,2);assert.equal(r.downloads,1);assert.equal(r.output.length,1);assert.match(r.output[0],/"localRestoreVerified":true/);assert.match(r.output[0],/"backupVerified":false/);assert.doesNotMatch(JSON.stringify(r.output),/PRIVATE_|OFFICIAL_TEST_TOKEN|INSERT/);});
for(const mode of ['incomplete','runtime-change','invalid-sql'])test('official entry holds '+mode+' without retrying export from the beginning or leaking source',async()=>{const r=await run(mode);assert.equal(r.exitCode,1);assert.equal(r.output.length,0);assert.equal(r.polls,mode==='incomplete'?6:2);assert.equal(r.downloads,mode==='incomplete'?0:1);assert.doesNotMatch(r.errors.join(' '),/PRIVATE_|OFFICIAL_TEST_TOKEN|provider.invalid/);});
