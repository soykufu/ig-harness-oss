export type CampaignActivity = {label:string;sub:string;value:number;emoji:string}
const fields=['triggered','cta_sent','pending_follow','delivered','dropped','line_linked','clicks_total','clicks_unique'] as const
/** Snapshot counters use different units, not a registration/attendance cohort. */
export function campaignActivity(input:unknown):CampaignActivity[]|null {
 if(!input||typeof input!=='object'||Array.isArray(input))return null
 const a=input as Record<string,unknown>
 if(fields.some(k=>!Number.isSafeInteger(a[k])||Number(a[k])<0)||Number(a.clicks_unique)>Number(a.clicks_total))return null
 const n=(key:typeof fields[number])=>a[key] as number
 return [
  {label:'受付の記録',sub:'配信行の現在状態の合計',value:n('triggered'),emoji:'👋'},
  {label:'入口案内の記録',sub:'現在この段階にある件数',value:n('cta_sent'),emoji:'📨'},
  {label:'フォロー確認待ち',sub:'現在確認を待つ件数',value:n('pending_follow'),emoji:'👆'},
  {label:'特典案内済みの記録',sub:'閲覧・受取は未確認',value:n('delivered'),emoji:'🎁'},
  {label:'URLクリック',sub:`識別子・匿名記録別 ${n('clicks_unique')} 件`,value:n('clicks_total'),emoji:'🔗'},
  {label:'LINE紐付けの記録',sub:'新規登録・流入は未確認',value:n('line_linked'),emoji:'🟢'},
  {label:'終了の記録',sub:'本人の辞退とは限りません',value:n('dropped'),emoji:'📋'},
 ]
}
