import {sha256} from '../lib/security.js';
import {parseBroadcastTagFilter} from './broadcast.js';
export async function recruitmentBroadcastVersion(row:{message_type:string;body:string;tag_filter:string|null}):Promise<string>{
 return sha256(JSON.stringify([row.message_type,row.body,row.tag_filter]));
}
export async function assertRecruitmentBroadcastReady(db:D1Database,accountId:string,followerId:number,key:string,version:string|undefined,nowMs:number):Promise<void>{
 const m=/^broadcast:([1-9][0-9]*):([1-9][0-9]*)$/.exec(key);
 if(!m||Number(m[2])!==followerId||!version||!/^[a-f0-9]{64}$/.test(version))throw Error('Invalid broadcast evidence');
 const row=await db.prepare(`SELECT b.message_type,b.body,b.tag_filter,r.attempted_at FROM broadcasts b
 JOIN broadcast_recipients r ON r.broadcast_id=b.id AND r.follower_id=?
 JOIN followers f ON f.id=r.follower_id AND f.account_id=b.account_id
 WHERE b.id=? AND b.account_id=? AND b.status='sending' AND r.status='processing'`)
 .bind(followerId,Number(m[1]),accountId).first<{message_type:string;body:string;tag_filter:string|null;attempted_at:string}>();
 const attempted=Date.parse(row?.attempted_at??'');
 if(!row||!Number.isFinite(attempted)||attempted>nowMs||attempted<nowMs-60000||await recruitmentBroadcastVersion(row)!==version)throw Error('Broadcast requires reconciliation');
 const tag=parseBroadcastTagFilter(row.tag_filter);
 if(tag!==undefined&&!await db.prepare('SELECT 1 FROM follower_tags ft JOIN tags t ON t.id=ft.tag_id WHERE ft.follower_id=? AND ft.tag_id=? AND t.account_id=?').bind(followerId,tag,accountId).first())throw Error('Broadcast recipient no longer matches');
}
