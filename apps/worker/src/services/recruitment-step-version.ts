import { sha256 } from '../lib/security.js';
export type StepVersion = {id:string|number;scenario_id:string|number;step_order:number;delay_minutes:number;message_type:string;body:string;condition_type?:string|null;condition_value?:string|null;next_step_on_false?:number|null};
/** The operation key stays stable across edits. Version evidence must never
 * create a new operation identity or authorize a retry. No plaintext journal. */
export async function recruitmentStepVersion(step:StepVersion):Promise<string>{
 return sha256(JSON.stringify([String(step.id),String(step.scenario_id),step.step_order,step.delay_minutes,step.message_type,step.body,step.condition_type??null,step.condition_value??null,step.next_step_on_false??null]));
}
export type StepSubject={id:string|number;account_id?:string|null;igsid?:string;display_name?:string|null;name?:string|null;username?:string|null};
export function stepVariableValues(friend:StepSubject){
 return{name:friend.display_name||friend.name||friend.username||'',username:friend.username||'',friend_id:String(friend.id)};
}
/** Pin the actual substitution source without logging names or identifiers. */
export async function recruitmentStepSubjectVersion(friend:StepSubject):Promise<string>{
 return sha256(JSON.stringify([friend.account_id??null,friend.igsid??null,stepVariableValues(friend)]));
}
