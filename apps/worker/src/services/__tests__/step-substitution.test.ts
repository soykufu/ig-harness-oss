import {expect,it} from 'vitest';
import {expandVariables} from '../step-delivery.js';
import {recruitmentStepSubjectVersion,stepVariableValues} from '../recruitment-step-version.js';

it('uses the actual DB name, with backwards-compatible display name and username fallbacks',()=>{
 expect(expandVariables('{{name}} / {{username}} / {{friend_id}}',{id:7,name:'佐々木',username:'student'})).toBe('佐々木 / student / 7');
 expect(stepVariableValues({id:7,display_name:'表示名',name:'DB名',username:'ig'}).name).toBe('表示名');
 expect(stepVariableValues({id:7,name:null,username:'ig'}).name).toBe('ig');
 expect(stepVariableValues({id:7}).name).toBe('');
});
it.each(['$&',"$`$'",'{{username}}','\\"\n改行','🙂美容学生'])( 'preserves a literal profile name in plain text and nested JSON: %s',name=>{
 const friend={id:1,name,username:'student'};
 expect(expandVariables('{{name}} さん',friend)).toBe(name+' さん');
 const authored={text:'{{name}} さん',blocks:[{title:'{{username}}',note:'{{name}}'}],flag:true,count:1,nothing:null};
 const out=JSON.parse(expandVariables(JSON.stringify(authored),friend));
 expect(out).toEqual({text:name+' さん',blocks:[{title:'student',note:name}],flag:true,count:1,nothing:null});
});
it('keeps JSON-shaped profile text as a string, never a second message or recipient',()=>{
 const name='x","recipient":{"id":"foreign"},"text":"y';
 expect(JSON.parse(expandVariables('{"text":"{{name}}"}',{id:1,name}))).toEqual({text:name});
});
it('pins account, recipient, name, username and ID without binding unrelated metadata',async()=>{
 const friend={id:1,account_id:'a',igsid:'one',name:'名',username:'ig'};
 const original=await recruitmentStepSubjectVersion(friend);expect(original).toMatch(/^[a-f0-9]{64}$/);
 for(const patch of [{account_id:'b'},{igsid:'two'},{name:'別名'},{username:'other'},{id:2}])expect(await recruitmentStepSubjectVersion({...friend,...patch})).not.toBe(original);
 expect(await recruitmentStepSubjectVersion({...friend,id:'1'})).toBe(original);
});
