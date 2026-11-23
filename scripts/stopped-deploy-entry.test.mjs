import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {applyMigrations,splitSql} from './migration-runner.mjs';
import {assertStoppedDeploySchema} from './stopped-deploy-readiness.mjs';
const repoDir=fileURLToPath(new URL('../',import.meta.url));
// Execute the real entry body with injected I/O. No child process, file write,
// credential store or live Cloudflare request is reachable in this fixture.
async function run(mode){const db=new DatabaseSync(':memory:');const query=async sql=>db.prepare(sql).all();await applyMigrations({repoDir,query,execute:async sql=>{for(const statement of splitSql(sql))db.exec(statement);},log(){}});db.exec("INSERT INTO integration_settings(key,value) VALUES('outbound_paused','1')");if(mode==='unpaused')db.exec("UPDATE integration_settings SET value='0'");if(mode==='missing-schema')db.exec("DELETE FROM ig_schema_migrations WHERE name='0041_gate_followup_operations.sql'");
 const effects={writes:[],removals:[],commands:[],requests:[],errors:[]};const process={env:{CLOUDFLARE_API_TOKEN:'CF_TEST_TOKEN',IG_HARNESS_API_KEY:'INDEPENDENT_TEST_KEY_32_CHARACTERS'},exitCode:0};
 const raw=await readFile(new URL('./soykufu-deploy.mjs',import.meta.url),'utf8');const source=raw.replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('./soykufu-deploy.mjs',import.meta.url).href));
 const execute=new (Object.getPrototypeOf(async function(){}).constructor)('assertStoppedDeploySchema','writeFile','rm','spawnSync','randomBytes','fileURLToPath','process','fetch','console',source);
 try{await execute(assertStoppedDeploySchema,async(...args)=>{effects.writes.push(args);throw Error('Unexpected write');},async(...args)=>{effects.removals.push(args);throw Error('Unexpected removal');},(...args)=>{effects.commands.push(args);throw Error('Unexpected child process');},()=>{throw Error('Unexpected secret generation');},fileURLToPath,process,async(url,options)=>{effects.requests.push([String(url),options.method]);assert.match(String(url),/\/d1\/database\/e55c3b84-ea9a-48fd-a7a3-08253089d295\/query$/);assert.equal(options.method,'POST');const sql=JSON.parse(options.body).sql;assert.match(sql,/^\s*(SELECT|PRAGMA)\b/i);assert.ok(!sql.includes(';'));return new Response(JSON.stringify({success:true,result:[{results:await query(sql)}]}));},{log(){},error(message){effects.errors.push(message);}});return{effects,exitCode:process.exitCode};}finally{db.close();}}
test('even a fully matching schema cannot bypass missing backup/authorization or reach deployment mutations',async()=>{const {effects,exitCode}=await run('matching');assert.equal(exitCode,1);assert.match(effects.errors.join(' '),/backup and deployment evidence require reconciliation/);assert.deepEqual(effects.writes,[]);assert.deepEqual(effects.removals,[]);assert.deepEqual(effects.commands,[]);assert.ok(effects.requests.length>20);});
for(const mode of ['unpaused','missing-schema'])test('does not overwrite or remove an unowned config when '+mode+' preflight fails',async()=>{const {effects,exitCode}=await run(mode);assert.equal(exitCode,1);assert.deepEqual(effects.writes,[]);assert.deepEqual(effects.removals,[]);assert.deepEqual(effects.commands,[]);});

// Exercise the entry's actual before/after verification body with provider
// responses. No deployment authorization or mutation is enabled by this test.
async function verifyEntryState(state){
 const raw=await readFile(new URL('./soykufu-deploy.mjs',import.meta.url),'utf8');
 const body=/async function verifyStopped\(\) \{([\s\S]*?)\n\}\ntry/.exec(raw)?.[1];assert.ok(body);
 const execute=new (Object.getPrototypeOf(async function(){}).constructor)('api','database',body);
 let reads=0;await execute(async(path,body)=>{reads++;assert.equal(path,'d1/database/test-db/query');assert.match(body.sql,/^SELECT /);return[{results:[state]}];},'test-db');assert.equal(reads,1);
}
test('entry verification accepts only the stopped empty installation',async()=>{await verifyEntryState({paused:'1',accounts:0,followers:0});});
for (const state of [{paused:'1',accounts:0,followers:1},{paused:'1',accounts:1,followers:0},{paused:'1',accounts:null,followers:0},{paused:'1',accounts:0},{paused:'1',accounts:'0',followers:0},{paused:'0',accounts:0,followers:0}])test('entry verification rejects changed or incomplete final state '+JSON.stringify(state),async()=>{await assert.rejects(verifyEntryState(state),/Expected stopped/);});
