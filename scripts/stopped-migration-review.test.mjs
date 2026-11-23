import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {applyMigrations,splitSql} from './migration-runner.mjs';
import {migrationLedgerFingerprint} from './stopped-installation-snapshot.mjs';
import {reviewStoppedMigration} from './stopped-migration-review.mjs';
const repoDir=fileURLToPath(new URL('../',import.meta.url)),now=Date.parse('2026-01-02T00:00:00.000Z');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function fixture(){
 const db=new DatabaseSync(':memory:');
 await assert.rejects(applyMigrations({repoDir,query:async sql=>db.prepare(sql).all(),execute:async sql=>{db.exec('BEGIN');try{for(const s of splitSql(sql)){if(s.includes('CREATE TABLE IF NOT EXISTS recruitment_outbound_control'))throw Error('fixture stops at 27');db.exec(s);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}},log(){}}),/0028/);
 db.exec("INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1')");
 const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND substr(name,1,4)!='_cf_' ORDER BY type,name").all();
 const counts=schema.filter(r=>r.type==='table'&&r.name!=='rate_limit_buckets').map(r=>[r.name,db.prepare('SELECT COUNT(*) AS n FROM '+JSON.stringify(r.name)).get().n]);
 const runtime={deploymentStable:true,deployedBindingsVerified:true,preparationLockVerified:true,extraFlagsVerified:true,deploymentFingerprint:'a'.repeat(64)};
 const evidence={accountId:'e76a3f504309ca9289d8dfa3ee504502',databaseId:'e55c3b84-ea9a-48fd-a7a3-08253089d295',restoreRunId:11,auditRunId:12,restoreAccepted:true,postRestoreVerified:true,verifiedAt:'2026-01-01T23:00:00.000Z',expiresAt:'2026-01-07T23:00:00.000Z',schemaHash:hash(schema),businessCountsHash:hash(counts),ledgerHash:migrationLedgerFingerprint(db.prepare('SELECT name,sha256 FROM ig_schema_migrations').all()),fingerprint:runtime.deploymentFingerprint};
 let reads=0;const options={repoDir,evidence,now,readRuntime:async()=>({...runtime}),query:async sql=>{reads++;assert.match(sql,/^(SELECT|PRAGMA)/);assert.ok(!sql.includes(';'));return db.prepare(sql).all();}};
 return {db,runtime,evidence,options,get reads(){return reads;}};
}
test('valid recovery receipts yield exact 14 file review with zero write authority',async()=>{const f=await fixture();try{const before=f.db.prepare('SELECT COUNT(*) n FROM ig_schema_migrations').get().n;const p=await reviewStoppedMigration(f.options);assert.equal(p.ok,true);assert.equal(p.plan.migrations.length,14);assert.equal(p.plan.migrations[0].name,'0028_recruitment_outbound_ledger.sql');assert.equal(p.plan.migrations.at(-1).name,'0041_gate_followup_operations.sql');assert.match(p.planId,/^[a-f0-9]{64}$/);assert.equal(p.applyAuthorized,false);assert.equal(p.backupVerified,false);assert.equal(p.deploymentAuthorized,false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ig_schema_migrations').get().n,before);}finally{f.db.close();}});
for(const patch of [{restoreAccepted:'true'},{postRestoreVerified:false},{databaseId:'other'},{auditRunId:0},{expiresAt:'2026-01-01T00:00:00.000Z'},{verifiedAt:'2026-01-03T00:00:00.000Z'},{schemaHash:'invalid'}])test('invalid/stale receipt cannot read or grant '+JSON.stringify(Object.keys(patch)),async()=>{const f=await fixture();try{Object.assign(f.evidence,patch);assert.equal((await reviewStoppedMigration(f.options)).ok,false);assert.equal(f.reads,0);}finally{f.db.close();}});
test('changed business data holds review',async()=>{const f=await fixture();try{f.db.exec("INSERT INTO tags(name) VALUES('synthetic-new-data')");const p=await reviewStoppedMigration(f.options);assert.equal(p.reason,'recovery_scope_changed');}finally{f.db.close();}});
test('unpaused state holds review',async()=>{const f=await fixture();try{f.db.exec("UPDATE integration_settings SET value='0' WHERE key='outbound_paused'");assert.equal((await reviewStoppedMigration(f.options)).ok,false);}finally{f.db.close();}});
test('binding/lock drift cannot become a plan',async()=>{const f=await fixture();try{f.runtime.preparationLockVerified=false;assert.equal((await reviewStoppedMigration(f.options)).ok,false);}finally{f.db.close();}});
test('rate counter rows do not erase valid business recovery evidence',async()=>{const f=await fixture();try{f.db.exec("INSERT INTO rate_limit_buckets(bucket_key,hits,expires_at) VALUES('synthetic',1,99)");assert.equal((await reviewStoppedMigration(f.options)).ok,true);}finally{f.db.close();}});
test('state drift between first and final read is held',async()=>{const f=await fixture();try{const original=f.options.readRuntime;let n=0;f.options.readRuntime=async()=>({...await original(),deploymentFingerprint:++n===1?f.runtime.deploymentFingerprint:'b'.repeat(64)});const p=await reviewStoppedMigration(f.options);assert.equal(p.reason,'review_changed_in_flight');}finally{f.db.close();}});
