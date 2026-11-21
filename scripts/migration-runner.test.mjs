import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, splitSql } from './migration-runner.mjs';
const repoDir = fileURLToPath(new URL('../', import.meta.url));
function adapter(db, fail) {
  return { repoDir, log() {}, query: async (sql) => db.prepare(sql).all(), execute: async (sql) => {
    db.exec('BEGIN');
    try { for (const statement of splitSql(sql)) { if (fail?.(statement)) throw new Error('injected failure'); db.exec(statement); } db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
}
test('fresh install, second run, staff hashing and account ownership preservation', async () => {
  const db = new DatabaseSync(':memory:');
  await applyMigrations(adapter(db));
  for (const table of ['gate_clicks','integration_settings','line_harness_connections','media_posts','broadcast_recipients','webhook_events','rate_limit_buckets']) assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table));
  db.exec("INSERT INTO staff_members(id,name,api_key) VALUES ('uuid-staff','Staff','igh_TEST_ONLY'); INSERT INTO comment_rules(name,response_type,response_body,account_id) VALUES ('test','text','{}','account-a')");
  await applyMigrations(adapter(db));
  assert.match(db.prepare('SELECT api_key FROM staff_members').get().api_key, /^sha256:[a-f0-9]{64}$/);
  assert.equal(db.prepare('SELECT account_id FROM comment_rules').get().account_id, 'account-a');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ig_schema_migrations').get().n, 41);
  db.close();
});
test('a failed file has no success marker and can resume without losing earlier migrations', async () => {
  const db = new DatabaseSync(':memory:');
  await assert.rejects(applyMigrations(adapter(db, (sql) => sql.includes('CREATE TABLE broadcast_runs'))), /0018_delivery_safety/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ig_schema_migrations WHERE name LIKE '0018%'").get().n, 0);
  await applyMigrations(adapter(db));
  assert.ok(db.prepare("SELECT name FROM ig_schema_migrations WHERE name LIKE '0018%'").get());
  db.close();
});
test('applied-file drift stops rather than silently skipping a changed migration', async () => {
  const db = new DatabaseSync(':memory:');
  await applyMigrations(adapter(db));
  db.exec("UPDATE ig_schema_migrations SET sha256='wrong' WHERE name='0001_engagement_gates.sql'");
  await assert.rejects(applyMigrations(adapter(db)), /Applied migration changed/);
  db.close();
});
test('adopts an untracked partially upgraded DB without dropping staff metadata or account scope', async () => {
  const { readFileSync } = await import('node:fs');
  const db = new DatabaseSync(':memory:');
  const schema = readFileSync(new URL('../packages/db/schema.sql', import.meta.url), 'utf8')
    .replace('  line_friend_uuid TEXT,\n', '').replace('CREATE INDEX IF NOT EXISTS idx_followers_line_friend_uuid ON followers(line_friend_uuid);', '');
  db.exec(schema);
  db.exec("ALTER TABLE staff_members ADD COLUMN email TEXT; ALTER TABLE staff_members ADD COLUMN updated_at TEXT; INSERT INTO staff_members(id,name,role,api_key,email,updated_at) VALUES(1,'Test','owner','test-only','owner@example.invalid','2026-01-01'); INSERT INTO comment_rules(name,response_type,response_body,account_id) VALUES('Keep','text','{}','account-a')");
  await applyMigrations(adapter(db));
  assert.equal(db.prepare('SELECT account_id FROM comment_rules').get().account_id, 'account-a');
  assert.deepEqual({ ...db.prepare('SELECT id,email,updated_at FROM staff_members').get() }, { id: '1', email: 'owner@example.invalid', updated_at: '2026-01-01' });
  await applyMigrations(adapter(db));
  db.close();
});
test('does not trust a completion ledger when the real schema has drifted', async () => {
  const db = new DatabaseSync(':memory:'); await applyMigrations(adapter(db));
  db.exec('ALTER TABLE followers DROP COLUMN profile_fetched_at');
  await assert.rejects(applyMigrations(adapter(db)), /Schema verification failed: followers.profile_fetched_at/);
  db.close();
});

test('adopts legacy repeat-delivery history without recreating the removed unique index', async () => {
  const db = new DatabaseSync(':memory:');
  await assert.rejects(applyMigrations(adapter(db, sql => sql.includes('CREATE TABLE broadcast_runs'))), /0018/);
  db.exec("DELETE FROM ig_schema_migrations; INSERT INTO followers(id,igsid) VALUES(1,'test-user'); INSERT INTO engagement_gates(id,name,trigger_type,initial_dm_text,follow_reminder_dm_text,reward_dm_text,allow_repeat) VALUES('g','Test','comment_on_post','Hi','Follow','Reward',1); INSERT INTO gate_deliveries(id,gate_id,follower_id,igsid) VALUES('one','g',1,'test-user'),('two','g',1,'test-user')");
  await applyMigrations(adapter(db));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM gate_deliveries').get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='uq_gate_deliveries_gate_follower'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ig_schema_migrations').get().n, 41);
  db.close();
});

for(const table of ['recruitment_echo_receipts','recruitment_inbound_holds','recruitment_human_reply_contracts'])test(`refuses false readiness when ${table} is absent despite an applied ledger`,async()=>{
 const db=new DatabaseSync(':memory:');
 try {
  await applyMigrations(adapter(db));db.exec(`DROP TABLE ${table}`);
  await assert.rejects(applyMigrations(adapter(db)),new RegExp('Schema verification failed: '+table));
 } finally {db.close();}
});

for(const column of ['condition_type','condition_value','next_step_on_false'])test(`rejects missing scenario condition column ${column} despite a complete ledger`,async()=>{
 const db=new DatabaseSync(':memory:');
 try {await applyMigrations(adapter(db));db.exec(`ALTER TABLE scenario_steps DROP COLUMN ${column}`);await assert.rejects(applyMigrations(adapter(db)),new RegExp('Schema verification failed: scenario_steps.'+column));}finally{db.close();}
});

for(const column of ['description','trigger_tag_id'])test(`rejects missing scenario editor column ${column} despite a complete ledger`,async()=>{
 const db=new DatabaseSync(':memory:');
 try {await applyMigrations(adapter(db));db.exec(`ALTER TABLE scenarios DROP COLUMN ${column}`);await assert.rejects(applyMigrations(adapter(db)),new RegExp('Schema verification failed: scenarios.'+column));}finally{db.close();}
});

test('form editor migration preserves existing IDs, answers and timestamps and derives the legacy count',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  await assert.rejects(applyMigrations(adapter(db,sql=>/^ALTER TABLE forms ADD COLUMN description\b/.test(sql))),/Migration failed: 0035_form_editor_fields/);
  db.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','111','test','2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,account_id) VALUES(7,'student','a'); INSERT INTO forms(id,name,fields,account_id,created_at) VALUES(17,'legacy','[]','a','2026-01-01'); INSERT INTO form_submissions(id,form_id,follower_id,answers,submitted_at) VALUES(23,17,7,'{\"hope\":\"visit\"}','2026-01-02')");
  const answers=db.prepare('SELECT id,form_id,follower_id,answers,submitted_at FROM form_submissions').all(),form=db.prepare('SELECT id,name,fields,account_id,created_at FROM forms').get();
  await applyMigrations(adapter(db));assert.deepEqual(db.prepare('SELECT id,form_id,follower_id,answers,submitted_at FROM form_submissions').all(),answers);assert.deepEqual(db.prepare('SELECT id,name,fields,account_id,created_at FROM forms').get(),form);assert.equal(db.prepare('SELECT submit_count FROM forms').get().submit_count,1);
  await applyMigrations(adapter(db));assert.deepEqual(db.prepare('SELECT id,form_id,follower_id,answers,submitted_at FROM form_submissions').all(),answers);
 }finally{db.close();}
});
for(const column of ['description','save_to_metadata','updated_at'])test(`rejects missing form editor column ${column} despite a complete ledger`,async()=>{
 const db=new DatabaseSync(':memory:');try{await applyMigrations(adapter(db));db.exec(`ALTER TABLE forms DROP COLUMN ${column}`);await assert.rejects(applyMigrations(adapter(db)),new RegExp('Schema verification failed: forms.'+column));}finally{db.close();}
});
for(const column of ['request_hash','side_effect_state'])test(`rejects missing form receipt column ${column} despite a complete ledger`,async()=>{
 const db=new DatabaseSync(':memory:');try{await applyMigrations(adapter(db));db.exec(`ALTER TABLE form_submissions DROP COLUMN ${column}`);await assert.rejects(applyMigrations(adapter(db)),new RegExp('Schema verification failed: form_submissions.'+column));}finally{db.close();}
});
for(const mode of ['missing','not-unique','wrong-columns'])test(`rejects ${mode} form receipt uniqueness despite a complete ledger`,async()=>{
 const db=new DatabaseSync(':memory:');try{
  await applyMigrations(adapter(db));db.exec('DROP INDEX idx_form_submission_request');
  if(mode==='not-unique')db.exec('CREATE INDEX idx_form_submission_request ON form_submissions(form_id,request_key)');
  if(mode==='wrong-columns')db.exec('CREATE UNIQUE INDEX idx_form_submission_request ON form_submissions(form_id,request_hash)');
  await assert.rejects(applyMigrations(adapter(db)),/Schema verification failed: form request uniqueness/);
 }finally{db.close();}
});
for(const column of ['public_reply_status','public_reply_id','reply_mode','public_reply_plan_hash','public_reply_owner_epoch','public_reply_claimed_at'])test(`rejects missing public phase column ${column} despite a complete ledger`,async()=>{
 const db=new DatabaseSync(':memory:');try{await applyMigrations(adapter(db));db.exec(`ALTER TABLE comment_rule_jobs DROP COLUMN ${column}`);await assert.rejects(applyMigrations(adapter(db)),new RegExp('Schema verification failed: comment_rule_jobs.'+column));}finally{db.close();}
});

test('public phase migration leaves legacy acknowledgement and outcome unchanged', async()=>{
 const db=new DatabaseSync(':memory:');try{
  await applyMigrations(adapter(db));
  db.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','u','t','2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,account_id) VALUES(1,'s','a'); INSERT INTO comment_rule_jobs(id,account_id,comment_id,follower_id,message_type,body,due_at,expires_at,status,public_reply_status,public_reply_id) VALUES('j','a','c',1,'text','{}','2026-11-21','2026-11-22','sent','sent','old-ack')");
  const row=db.prepare('SELECT public_reply_status,public_reply_id,public_reply_plan_hash,public_reply_owner_epoch,public_reply_claimed_at FROM comment_rule_jobs').get();
  assert.deepEqual({...row},{public_reply_status:'sent',public_reply_id:'old-ack',public_reply_plan_hash:null,public_reply_owner_epoch:null,public_reply_claimed_at:null});
 }finally{db.close();}
});

for(const [table,column] of [['gate_deliveries','metadata'],['gate_deliveries','end_reason'],['gate_deliveries','followup_step_sent'],['engagement_gates','followup_dm_sequence']])test(`rejects missing gate purpose field ${table}.${column} despite a complete ledger`,async()=>{
 const db=new DatabaseSync(':memory:');try{await applyMigrations(adapter(db));db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);await assert.rejects(applyMigrations(adapter(db)),new RegExp('Schema verification failed: '+table+'.'+column));}finally{db.close();}
});

for(const column of ['event_key','definition_version','payload_version','claimed_at_ms','expected_messages'])test(`rejects missing gate receipt column ${column} despite a complete ledger`,async()=>{
 const db=new DatabaseSync(':memory:');try{await applyMigrations(adapter(db));
 // Rebuild a deliberately damaged receipt table; the migration ledger is unchanged.
 db.exec('ALTER TABLE recruitment_gate_operations RENAME TO damaged_gate_operations');
 const cols=db.prepare('PRAGMA table_info(damaged_gate_operations)').all().filter(c=>c.name!==column).map(c=>c.name+' '+c.type);
 db.exec('CREATE TABLE recruitment_gate_operations('+cols.join(',')+')');
 await assert.rejects(applyMigrations(adapter(db)),new RegExp('Schema verification failed: recruitment_gate_operations.'+column));}finally{db.close();}
});
test('gate receipt uniqueness is verified independently of the migration completion ledger',async()=>{
 const db=new DatabaseSync(':memory:');try{await applyMigrations(adapter(db));db.exec('ALTER TABLE recruitment_gate_operations RENAME TO damaged_gate_operations');const cols=db.prepare('PRAGMA table_info(damaged_gate_operations)').all().map(c=>c.name+' '+c.type);db.exec('CREATE TABLE recruitment_gate_operations('+cols.join(',')+')');await assert.rejects(applyMigrations(adapter(db)),/gate operation uniqueness missing/);}finally{db.close();}
});

for(const column of ['event_key','source_hash','payload_version','expected_messages','owner_epoch'])test(`rejects missing CTA receipt ${column} despite a complete ledger`,async()=>{
 const db=new DatabaseSync(':memory:');try{await applyMigrations(adapter(db));db.exec('ALTER TABLE recruitment_gate_cta_operations RENAME TO damaged_cta');const cols=db.prepare('PRAGMA table_info(damaged_cta)').all().filter(c=>c.name!==column).map(c=>c.name+' '+c.type);db.exec('CREATE TABLE recruitment_gate_cta_operations('+cols.join(',')+')');await assert.rejects(applyMigrations(adapter(db)),new RegExp('Schema verification failed: recruitment_gate_cta_operations.'+column));}finally{db.close();}
});
for(const missing of ['operation_key','event_key','delivery_id'])test(`verifies CTA uniqueness for ${missing} independently of the migration ledger`,async()=>{
 const db=new DatabaseSync(':memory:');try{await applyMigrations(adapter(db));db.exec('ALTER TABLE recruitment_gate_cta_operations RENAME TO damaged_cta');const cols=db.prepare('PRAGMA table_info(damaged_cta)').all().map(c=>c.name+' '+c.type);for(const field of ['operation_key','event_key','delivery_id'])if(field!==missing)cols.push('UNIQUE(account_id,'+field+')');db.exec('CREATE TABLE recruitment_gate_cta_operations('+cols.join(',')+')');await assert.rejects(applyMigrations(adapter(db)),/CTA operation uniqueness missing/);}finally{db.close();}
});

for(const column of ['step_index','definition_version','payload_version','expected_messages','owner_epoch','claimed_at_ms','state'])test('rejects missing followup receipt column '+column,async()=>{const db=new DatabaseSync(':memory:');try{await applyMigrations(adapter(db));db.exec('ALTER TABLE recruitment_gate_followup_operations RENAME TO damaged_followups');const cols=db.prepare('PRAGMA table_info(damaged_followups)').all().filter(c=>c.name!==column).map(c=>c.name+' '+c.type);db.exec('CREATE TABLE recruitment_gate_followup_operations('+cols.join(',')+')');await assert.rejects(applyMigrations(adapter(db)),new RegExp('Schema verification failed: recruitment_gate_followup_operations.'+column));}finally{db.close();}});
test('rejects followup receipt tables without operation and delivery-step uniqueness',async()=>{const db=new DatabaseSync(':memory:');try{await applyMigrations(adapter(db));db.exec('ALTER TABLE recruitment_gate_followup_operations RENAME TO damaged_followups');const cols=db.prepare('PRAGMA table_info(damaged_followups)').all().map(c=>c.name+' '+c.type);db.exec('CREATE TABLE recruitment_gate_followup_operations('+cols.join(',')+')');await assert.rejects(applyMigrations(adapter(db)),/follow-up operation uniqueness missing/);}finally{db.close();}});

test('followup receipt migration never manufactures evidence for legacy delivered steps',async()=>{const db=new DatabaseSync(':memory:');try{await applyMigrations(adapter(db));db.exec("DROP TABLE recruitment_gate_followup_operations;DELETE FROM ig_schema_migrations WHERE name='0041_gate_followup_operations.sql';INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','111','fake','2026-01-01','2026-01-01');INSERT INTO followers(id,igsid,account_id) VALUES(1,'person','a');INSERT INTO engagement_gates(id,name,trigger_type,initial_dm_text,follow_reminder_dm_text,reward_dm_text,account_id) VALUES('g','g','dm_keyword','a','b','c','a');INSERT INTO gate_deliveries(id,gate_id,follower_id,igsid,status,followup_step_sent,metadata) VALUES('d','g',1,'person','delivered',3,'{\"recruitment_followup\":{\"step\":2,\"version\":\"legacy\"}}')");const before=db.prepare('SELECT * FROM gate_deliveries').get();await applyMigrations(adapter(db));assert.deepEqual(db.prepare('SELECT * FROM gate_deliveries').get(),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM recruitment_gate_followup_operations').get().n,0);}finally{db.close();}});
