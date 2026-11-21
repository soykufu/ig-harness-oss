import {it,expect} from 'vitest';
import {expandCommentCopy} from '../comment-copy.js';
import {commentRulePublicReply} from '../../routes/webhook.js';
import {gateFixture} from '../../test-utils/gate-fixture.js';
import {triggerGateForComment} from '../engagement-gate.js';
it.each(['$&','$$',"$'",'$`','{{igsid}}','{{follower_id}}','👩‍💻か\u3099'])('preserves %s as literal comment text in one pass',username=>{
 expect(expandCommentCopy('前 {{username}} / {{ username }} 後',{username})).toBe(`前 ${username} / ${username} 後`);expect(commentRulePublicReply('@{{username}}さん',username)).toBe('@'+username+'さん');
});
it('does not reinterpret substitutions as another field, JSON data or replacement instructions',()=>{
 const input='{"text":"{{igsid}} / {{username}} / {{follower_id}} / {{unknown}}"}';const result=expandCommentCopy(input,{igsid:'{{username}}',username:'{{follower_id}} $&',follower_id:'17'});expect(JSON.parse(result).text).toBe('{{username}} / {{follower_id}} $& / 17 / {{unknown}}');
});
it('preserves absent variables and ordinary defaults',()=>{expect(expandCommentCopy('{{username}} {{igsid}} {{unknown}}',{username:''})).toBe(' {{igsid}} {{unknown}}');expect(commentRulePublicReply(null,'alice')).toBe('@alice コメントありがとう！📩 DMを送りました！');expect(commentRulePublicReply('','alice')).toBeNull();});
it('stores exactly the selected public copy in the stable comment job',async()=>{const f=await gateFixture();try{f.addGate('g',{trigger_keyword:'guide',comment_reply_text:'@{{username}} コメントありがとうございます'});await triggerGateForComment(f.db,f.client as any,{...f.args,commenterUsername:'$&{{igsid}}'});expect(f.sqlite.prepare('SELECT reply_text FROM comment_rule_jobs').get()?.reply_text).toBe('@$&{{igsid}} コメントありがとうございます');expect(f.client.replyToComment).not.toHaveBeenCalled();expect(f.client.sendPrivateReply).not.toHaveBeenCalled();}finally{f.sqlite.close();}});
