import {test} from 'node:test';
import {assessStoppedConnectionReadiness} from './stopped-connection-readiness.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {applyMigrations,splitSql} from './migration-runner.mjs';
import {readStoppedInstallationSnapshot,migrationLedgerFingerprint} from './stopped-installation-snapshot.mjs';
import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
const repoDir=fileURLToPath(new URL('../',import.meta.url));
const key='DUMMY_OWNER_KEY_32_CHARACTERS_LONG',token='DUMMY_CLOUDFLARE_TOKEN';
async function run(mode){const db=new DatabaseSync(':memory:');await applyMigrations({repoDir,query:async sql=>db.prepare(sql).all(),execute:async sql=>{for(const statement of splitSql(sql))db.exec(statement);},log(){}});db.exec("INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1')");const output=[],errors=[],calls=[];const process={env:{IG_HARNESS_API_KEY:key,CLOUDFLARE_API_TOKEN:token,GITHUB_SHA:'a'.repeat(40)},cwd:()=>repoDir,exitCode:0};let bookmarks=0;
 const fetch=async(url,options={})=>{url=String(url);calls.push([url,options.method??'GET']);if(url.endsWith('/login/'))return new Response('<html lang="ja"><script src="/_next/static/test.js"></script>',{headers:{'content-type':'text/html'}});if(url.includes('/_next/static/'))return new Response('test');if(url.endsWith('/api/health'))return options.headers?.Authorization?new Response(JSON.stringify({success:true,data:{db_ok:true}})):new Response('{}',{status:401});
 if(url.includes('/d1/database/')&&url.endsWith('/query')){assert.equal(options.method,'POST');const sql=JSON.parse(options.body).sql;assert.match(sql,/^\s*(SELECT|PRAGMA)\b/);assert.ok(!sql.includes(';'));return new Response(JSON.stringify({success:true,result:[{results:db.prepare(sql).all()}]}));}
 assert.equal(options.method,'GET');assert.ok(isStoppedRuntimeReadPath(url.replace('https://api.cloudflare.com/client/v4','')));let result;
 if(url.endsWith('/deployments'))result={deployments:[{id:'11111111-1111-4111-8111-111111111111',created_on:'2026-11-19T01:00:00Z',versions:[{version_id:'22222222-2222-4222-8222-222222222222',percentage:100}]}]};
 else if(url.includes('/versions/'))result={id:'22222222-2222-4222-8222-222222222222',resources:{bindings:[{name:'DB',type:'d1',id:'e55c3b84-ea9a-48fd-a7a3-08253089d295'},{name:'IMAGES',type:'r2_bucket',bucket_name:'soykufu-ig-harness-20261119'},{name:'OUTBOUND_PREPARATION_LOCK',type:'plain_text',text:'1'}]}};
 else if(url.includes('/time_travel/bookmark?timestamp=')){bookmarks++;result={bookmark:'00000001-00000002-00004e2f-0a83ea2fceebc654de0640c422be4653'};if(bookmarks===2){if(mode==='ledger-drift')db.exec("UPDATE ig_schema_migrations SET sha256='changed' WHERE name='0041_gate_followup_operations.sql'");if(mode==='stop-drift')db.exec("UPDATE integration_settings SET value='0'");}}
 else if(url.endsWith('/managed'))result={enabled:false};else if(url.endsWith('/custom'))result={domains:[]};else throw Error('Unexpected provider request');return new Response(JSON.stringify({success:true,result}));};
 if(mode==='registered'){
  process.env.STOPPED_REGISTERED_PHASE='1';
  db.exec("INSERT INTO ig_accounts(id,ig_user_id,username,access_token,is_active,is_default,connection_type,page_id,created_at,updated_at) VALUES('test-id','17841402028638204','soykufu','enc:v1:private-fixture',1,0,'facebook_login','1632563283635095','2026-11-24T00:00:00Z','2026-11-24T00:00:00Z')");
 }
 const source=(await readFile(new URL('./soykufu-smoke.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');const execute=new (Object.getPrototypeOf(async function(){}).constructor)('readStoppedInstallationSnapshot','migrationLedgerFingerprint','readStoppedRuntimeSnapshot','isStoppedRuntimeReadPath','assessStoppedConnectionReadiness','process','fetch','console',source);
 try{await execute(readStoppedInstallationSnapshot,migrationLedgerFingerprint,readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath,assessStoppedConnectionReadiness,process,fetch,{log:v=>output.push(v),error:v=>errors.push(v)});return{exitCode:process.exitCode,output,errors,calls,bookmarks};}finally{db.close();}}
test('the real smoke entry makes only allowlisted reads and publishes a scoped proof without secret/reference values',async()=>{const result=await run('valid');assert.equal(result.exitCode,0);assert.equal(result.bookmarks,2);const line=result.output.find(s=>s.startsWith('Stopped preparation snapshot'));const json=JSON.parse(line.slice(line.indexOf('{')));assert.equal(json.timeTravelRecoveryProof.available,true);assert.equal(json.timeTravelRecoveryProof.sealedRoundTripVerified,true);assert.equal(json.timeTravelRecoveryProof.referencePersisted,false);assert.equal(json.backupVerified,false);assert.equal(json.deploymentAuthorized,false);const readinessLine=result.output.find(s=>s.startsWith('Stopped connection readiness'));const readiness=JSON.parse(readinessLine.slice(readinessLine.indexOf('{')));assert.equal(readiness.registrationSpec.subscribeWebhooks,false);assert.equal(readiness.registrationAuthorized,false);assert.equal(readiness.webhookActivationAuthorized,false);assert.equal(readiness.messagesAuthorized,false);assert.ok(readiness.blockers.includes('token_encryption_key_unverified'));assert.doesNotMatch(JSON.stringify(result.output),/DUMMY_OWNER|DUMMY_CLOUDFLARE|00004e2f|ciphertext/);});
for(const mode of ['ledger-drift','stop-drift'])test('the smoke entry refuses '+mode+' introduced while reading the provider reference',async()=>{const result=await run(mode);assert.equal(result.exitCode,1);assert.ok(!result.output.some(s=>s.startsWith('Stopped preparation snapshot')));assert.doesNotMatch(result.errors.join(' '),/DUMMY|00004e2f|changed/);});
test('the real registered-phase entry verifies exactly one fixed encrypted account without claiming receiving or permission to send',async()=>{
 const r=await run('registered');assert.equal(r.exitCode,0);
 const snapshot=JSON.parse(r.output.find(s=>s.startsWith('Stopped preparation snapshot')).split(': ').slice(1).join(': '));
 assert.equal(snapshot.connectedAccounts,1);assert.equal(snapshot.registeredAccountVerified,true);assert.equal(snapshot.schemaReady,true);
 const readiness=JSON.parse(r.output.find(s=>s.startsWith('Stopped connection readiness')).split(': ').slice(1).join(': '));
 assert.equal(readiness.state,'stopped_registered_account_observed');assert.equal(readiness.receivingVerified,false);assert.equal(readiness.registrationAuthorized,false);assert.equal(readiness.messagesAuthorized,false);
 assert.doesNotMatch(JSON.stringify(r.output),/private-fixture|DUMMY_OWNER|DUMMY_CLOUDFLARE/);
});

