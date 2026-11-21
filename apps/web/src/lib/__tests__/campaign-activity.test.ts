import {it,expect} from 'vitest'
import {campaignActivity} from '../campaign-activity'
const counters={triggered:10,cta_sent:2,pending_follow:3,delivered:4,dropped:1,line_linked:8,clicks_total:16,clicks_unique:12}
it('keeps current-state, click-event and legacy-link counts separate without inventing a funnel or people',()=>{
 const rows=campaignActivity(counters)!
 expect(rows.map(r=>r.value)).toEqual([10,2,3,4,16,8,1])
 expect(rows.find(r=>r.value===8)?.sub).toContain('新規登録・流入は未確認')
 expect(rows.find(r=>r.value===4)?.sub).toContain('閲覧・受取は未確認')
 expect(rows.find(r=>r.value===1)?.sub).toContain('辞退とは限りません')
 expect(JSON.stringify(rows)).not.toMatch(/%|[0-9] 人|自動送信成功|連携まで完了/)
 expect(rows.every(r=>!('rate' in r))).toBe(true)
})
it.each([undefined,null,{},[],{...counters,delivered:undefined},{...counters,line_linked:'8'},{...counters,cta_sent:-1},{...counters,clicks_total:NaN},{...counters,clicks_unique:17},{...counters,triggered:0.1}])('missing or invalid analytics stays unknown, never a zero summary',input=>expect(campaignActivity(input)).toBeNull())
it('preserves real zero counters after a valid response without inventing a percentage',()=>{const rows=campaignActivity(Object.fromEntries(Object.keys(counters).map(k=>[k,0])))!;expect(rows).toHaveLength(7);expect(rows.every(r=>r.value===0)).toBe(true);expect(JSON.stringify(rows)).not.toContain('%')})
