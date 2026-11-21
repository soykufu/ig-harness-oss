import {afterEach,it,expect} from 'vitest';
import {testDatabase} from '../../test-utils/d1.js';
import {createScenario,createScenarioStep,getScenarioById,updateScenarioStep,enrollFriendInScenario} from '@ig-harness/db';
const close:(()=>void)[]=[];afterEach(()=>{while(close.length)close.pop()!();});
it('creates and edits scenarios and conditional steps against the actual migrated schema',async()=>{
 const {sqlite,db}=await testDatabase();close.push(()=>sqlite.close());
 sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','111','test','2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,account_id) VALUES(1,'student','a')");
 const scenario=await createScenario(db,{name:'test',description:'description',triggerType:'manual',accountId:'a'});
 expect(Number.isSafeInteger(Number(scenario.id))).toBe(true);expect(scenario.description).toBe('description');
 const step=await createScenarioStep(db,{scenarioId:String(scenario.id),stepOrder:1,messageType:'text',messageContent:'{"text":"test"}',conditionType:'tag_exists',conditionValue:'tag',nextStepOnFalse:3});
 expect(step.condition_type).toBe('tag_exists');expect(step.next_step_on_false).toBe(3);
 await updateScenarioStep(db,String(step.id),{condition_value:'other'});
 const loaded=await getScenarioById(db,String(scenario.id));expect(loaded?.steps[0].condition_value).toBe('other');
 const enrolled=await enrollFriendInScenario(db,1,String(scenario.id));expect(Number(enrolled.scenario_id)).toBe(Number(scenario.id));
 expect(sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()?.n).toBe(0);
});
