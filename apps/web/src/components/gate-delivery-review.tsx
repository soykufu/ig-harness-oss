'use client'
import {useEffect,useRef,useState} from 'react'
import {fetchApi,getApiAccountId} from '@/lib/api'
import {useAccount} from '@/contexts/account-context'
type Item={id:string;phase:string;state:string;recordedAt:string|null;expectedMessages:number|null;recordedMessages:number;apiAcknowledged:number;recordedSuccess:boolean;needsReview:boolean;mayRetry:false;recipientReceipt:'unknown';echoEvidence:string;deliveryState:string;endReason:string|null}
type Review={followupHistoryScope?:'latest_claim_only';items:Item[];moreMayExist:boolean;mayRetry:false;recipientReceipt:'unknown'}
/** Read-only. A missing/failed history request never enables any send button. */
export default function GateDeliveryReview({gateId}:{gateId:string}){
 const {selectedAccountId}=useAccount()
 const scope=JSON.stringify([selectedAccountId,gateId])
 const [ownerScope,setOwnerScope]=useState<string|null>(null)
 const [data,setData]=useState<{scope:string;review:Review}|null>(null)
 const [error,setError]=useState(''),[busy,setBusy]=useState(false)
 const abort=useRef<AbortController|null>(null)
 useEffect(()=>{
  const ac=new AbortController();abort.current=ac;setOwnerScope(null);setData(null);setError('');setBusy(false)
  if(selectedAccountId)fetchApi<{success:boolean;data:{role:string}}>('/api/staff/me',{signal:ac.signal,cache:'no-store'}).then(r=>{if(!ac.signal.aborted&&getApiAccountId()===selectedAccountId&&r.success&&['owner','admin'].includes(r.data.role))setOwnerScope(scope)}).catch(()=>{})
  return()=>ac.abort()
 },[selectedAccountId,gateId,scope])
 if(!selectedAccountId||ownerScope!==scope)return null
 const check=async()=>{
  const ac=abort.current;if(!ac||ac.signal.aborted||busy||getApiAccountId()!==selectedAccountId)return
  setBusy(true);setData(null);setError('')
  try{
   const r=await fetchApi<{success:boolean;data?:Review}>(`/api/engagement-gates/${encodeURIComponent(gateId)}/delivery-review`,{signal:ac.signal,cache:'no-store'})
   if(ac.signal.aborted||getApiAccountId()!==selectedAccountId)return
   if(!r.success||!r.data||r.data.mayRetry!==false||r.data.recipientReceipt!=='unknown')throw Error('Unverified review')
   setData({scope,review:r.data})
  }catch{if(!ac.signal.aborted&&getApiAccountId()===selectedAccountId)setError('記録を確認できませんでした。再送せず、後で再確認してください。')}
  finally{if(!ac.signal.aborted&&getApiAccountId()===selectedAccountId)setBusy(false)}
 }
 const review=data?.scope===scope?data.review:null
 return <section className="mt-8 rounded-xl border border-kumo-line bg-kumo-base p-5">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">配信記録と照合待ち</h2><button type="button" disabled={busy} onClick={()=>void check()} className="rounded-lg border border-kumo-line px-3 py-2 text-sm disabled:opacity-50">{busy?'確認中…':'記録を確認'}</button></div>
  <p className="mt-2 text-xs text-kumo-subtle">APIの受付記録と、業務側の照合待ちを表示します。閲覧・LINE登録の確認は別途必要です。停止や送信設定を保ったまま確認できます。</p>
  {error&&<p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
  {review&&review.items.length===0&&<p className="mt-3 text-sm">対象の記録はありません。未送信と判断せず、再送前に照合してください。</p>}
  {review&&review.items.length>0&&<ul className="mt-3 divide-y divide-kumo-line">{review.items.map(row=><li key={row.id} className="py-3 text-sm">
   <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{row.phase==='cta'?'入口案内':row.phase==='public_reply'?'コメントへの返信':row.phase==='reward'?'特典案内':row.phase==='reminder'?'フォロー確認':row.phase==='followup'?'後続メッセージ':'案内の照合'}</span><span className={row.needsReview?'text-amber-700':'text-kumo-subtle'}>{row.needsReview?'照合待ち':row.state==='skipped'?'送信せず終了':row.recordedSuccess?'API受付の記録あり':'記録の確認が必要'}</span></div>
   <p className="mt-1 text-xs text-kumo-subtle">{row.recordedAt?new Date(row.recordedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'日時不明'} ／ API受付の記録 {row.apiAcknowledged}件{row.expectedMessages!==null?`・予定 ${row.expectedMessages}件`: '・予定件数は未確認'} ／ 閲覧状況は不明</p>
  </li>)}</ul>}
  {review?.followupHistoryScope==='latest_claim_only'&&<p className="mt-2 text-xs text-kumo-subtle">後続メッセージは最新の処理記録のみ表示しています。過去の全配信や、記録のない配信が未送信だったことを示すものではありません。</p>}
  {review?.moreMayExist&&<p className="mt-2 text-xs text-kumo-subtle">照合待ちを優先して最大50件を表示しています。ほかにも記録があります。</p>}
 </section>
}
