import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {applyMigrations} from './migration-runner.mjs';
import {fixedRegisteredAccountVerified,readStoppedInstallationSnapshot} from './stopped-installation-snapshot.mjs';
const row=()=>({ig_user_id:'17841402028638204',username:'soykufu',page_id:'1632563283635095',connection_type:'facebook_login',is_active:1,is_default:0,token_encrypted:1});
test('only the fixed encrypted nondefault account qualifies',()=>assert.equal(fixedRegisteredAccountVerified([row()]),true));
for(const patch of [{ig_user_id:'other'},{username:'other'},{page_id:'other'},{connection_type:'instagram_login'},{is_active:0},{is_default:1},{token_encrypted:0},{token_encrypted:'1'}])test(`reject registered metadata ${Object.keys(patch)}`,()=>assert.equal(fixedRegisteredAccountVerified([{...row(),...patch}]),false));
for(const rows of [undefined,[],[row(),row()]])test(`unknown, empty or duplicate rows cannot pass ${rows?.length}`,()=>assert.equal(fixedRegisteredAccountVerified(rows),false));
test('an actual isolated 41-schema registry is observed read-only with stop retained',async()=>{
 const db=new DatabaseSync(':memory:');const query=async sql=>db.prepare(sql).all();
 try{
  await applyMigrations({repoDir:process.cwd(),query,execute:async sql=>db.exec(sql),log:()=>{}});
  db.prepare("INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  db.prepare("INSERT INTO ig_accounts(id,ig_user_id,username,access_token,is_active,is_default,connection_type,page_id,created_at,updated_at) VALUES('test-account','17841402028638204','soykufu','enc:v1:fixture',1,0,'facebook_login','1632563283635095','2026-11-24T00:00:00Z','2026-11-24T00:00:00Z')").run();
  const before=db.prepare('SELECT * FROM integration_settings ORDER BY key').all();
  await assert.rejects(readStoppedInstallationSnapshot({repoDir:process.cwd(),query}));
  const r=await readStoppedInstallationSnapshot({repoDir:process.cwd(),query,registeredAccount:true});
  assert.equal(r.connectedAccounts,1);assert.equal(r.registeredAccountVerified,true);assert.equal(r.schemaReady,true);assert.equal(r.appliedMigrationCount,41);assert.equal(r.deploymentAuthorized,false);
  assert.deepEqual(db.prepare('SELECT * FROM integration_settings ORDER BY key').all(),before);
  assert.ok(!JSON.stringify(r).includes('enc:v1:fixture'));
  db.prepare("UPDATE ig_accounts SET page_id='other'").run();await assert.rejects(readStoppedInstallationSnapshot({repoDir:process.cwd(),query,registeredAccount:true}));
 }finally{db.close();}
});
test('registered phase never adopts an empty database or releases the stop',async()=>{
 const db=new DatabaseSync(':memory:');const query=async sql=>db.prepare(sql).all();
 try{
  await applyMigrations({repoDir:process.cwd(),query,execute:async sql=>db.exec(sql),log:()=>{}});
  db.prepare("INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  const empty=await readStoppedInstallationSnapshot({repoDir:process.cwd(),query});assert.equal(empty.connectedAccounts,0);assert.equal(empty.schemaReady,true);
  await assert.rejects(readStoppedInstallationSnapshot({repoDir:process.cwd(),query,registeredAccount:true}));
  db.prepare("UPDATE integration_settings SET value='0' WHERE key='outbound_paused'").run();
  await assert.rejects(readStoppedInstallationSnapshot({repoDir:process.cwd(),query}));
 }finally{db.close();}
});
test('phase must be explicit boolean, never an inferred row count',async()=>{
 let calls=0;await assert.rejects(readStoppedInstallationSnapshot({repoDir:'unused',query:async()=>{calls++;return[];},registeredAccount:'true'}));assert.equal(calls,0);
});
