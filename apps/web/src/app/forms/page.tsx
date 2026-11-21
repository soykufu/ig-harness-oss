'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Header from '@/components/layout/header'
import { fetchApi,getApiAccountId,formsApi, type FormApi, type FormField, type FormSubmissionApi } from '@/lib/api'
import { formatDateTime } from '@/lib/meta-errors'

import {useAccount} from '@/contexts/account-context'
type ReadResult<T>={success:boolean;data?:T;error?:string}

const ACCENT = '#E1306C'

const FIELD_TYPES: Array<{ value: FormField['type']; label: string }> = [
  { value: 'text', label: '1行テキスト' },
  { value: 'textarea', label: '複数行テキスト' },
  { value: 'email', label: 'メールアドレス' },
  { value: 'tel', label: '電話番号' },
]

type DraftField = { label: string; type: FormField['type']; required: boolean }

const EMPTY_FIELD: DraftField = { label: '', type: 'text', required: false }

function Submissions({ form }: { form: FormApi }) {
  const [rows, setRows] = useState<FormSubmissionApi[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const ac=new AbortController();setRows(null);setError('')
    fetchApi<ReadResult<FormSubmissionApi[]>>(`/api/forms/${encodeURIComponent(form.id)}/submissions`,{signal:ac.signal,cache:'no-store'})
      .then(r=>{if(ac.signal.aborted)return;if(!r.success||!Array.isArray(r.data))throw Error('回答の確認が必要です');setRows(r.data)})
      .catch(()=>{if(!ac.signal.aborted)setError('回答を取得できませんでした。回答なしとは判断せず、再度確認してください。')})
    return()=>ac.abort()
  }, [form.id])
  const labelOf = (key: string) => form.fields.find((f) => f.name === key)?.label ?? key
  if (error) return <p className="text-xs text-red-600">{error}</p>
  if (!rows) return <p className="text-xs text-kumo-subtle">読み込み中...</p>
  if (rows.length === 0) return <p className="text-xs text-kumo-subtle">まだ回答はありません</p>
  return (
    <ul className="space-y-2">
      {rows.map((s) => (
        <li key={s.id} className="rounded-lg border border-kumo-line bg-kumo-canvas px-3 py-2">
          <div className="text-[11px] text-kumo-subtle mb-1">
            {formatDateTime(s.createdAt)}{s.friendName ? ` ／ ${s.friendName}` : ''}
          </div>
          {s.sideEffectsStatus === 'held' && <p className="mb-2 text-xs text-amber-800" role="status">本人確認待ちの受付です。プロフィール更新・タグ・自動案内は実行していません。</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {Object.entries(s.data).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-kumo-subtle">{labelOf(k)}</dt>
                <dd className="text-kumo-default break-words">{Array.isArray(v) ? v.join(', ') : String(v ?? '')}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  )
}

export default function FormsPage() {
  const {selectedAccountId}=useAccount()
  const selectedRef=useRef(selectedAccountId);selectedRef.current=selectedAccountId
  const readVersion=useRef(0),readAbort=useRef<AbortController|null>(null),mutationBusy=useRef(false)
  const [formsScope,setFormsScope]=useState<string|null>(null)
  const [forms, setForms] = useState<FormApi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<DraftField[]>([{ label: 'お名前', type: 'text', required: true }])
  const [saving, setSaving] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const scopeCurrent=(account:string|null)=>!!account&&selectedRef.current===account&&getApiAccountId()===account
  const dataReady=!!selectedAccountId&&formsScope===selectedAccountId
  const visibleForms=dataReady?forms:[]
  const load = useCallback(async () => {
    const account=selectedAccountId,version=++readVersion.current
    readAbort.current?.abort();const ac=new AbortController();readAbort.current=ac
    setForms([]);setFormsScope(null);setLoading(true);setError('')
    if(!account||getApiAccountId()!==account){setLoading(false);return}
    const current=()=>!ac.signal.aborted&&readVersion.current===version&&selectedRef.current===account&&getApiAccountId()===account
    try {
      const response=await fetchApi<ReadResult<FormApi[]>>('/api/forms',{signal:ac.signal,cache:'no-store'})
      if(!current())return
      if(!response.success||!Array.isArray(response.data))throw Error('フォーム一覧の確認が必要です')
      setForms(response.data);setFormsScope(account)
    } catch (err) {
      if(current())setError(err instanceof Error?err.message:'フォームの読み込みに失敗しました')
    } finally {if(current())setLoading(false)}
  }, [selectedAccountId])

  useEffect(()=>{setOpenId(null);setName('');setDescription('');setFields([{...EMPTY_FIELD,label:'お名前',required:true}]);void load();return()=>{readAbort.current?.abort();readVersion.current++}},[load])

  const updateField = (i: number, patch: Partial<DraftField>) =>
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))

  const handleCreate = async () => {
    const account=selectedAccountId;if(!dataReady||!scopeCurrent(account)||mutationBusy.current)return
    const filled = fields.filter((f) => f.label.trim())
    if (!name.trim()) { setError('フォーム名を入力してください'); return }
    if (filled.length === 0) { setError('項目を1つ以上入力してください'); return }
    mutationBusy.current=true;setSaving(true)
    setError('')
    try {
      await formsApi.create({
        name: name.trim(),
        description: description.trim() || null,
        fields: filled.map((f, i) => ({ name: `field_${i + 1}`, label: f.label.trim(), type: f.type, required: f.required })),
      })
      if(!scopeCurrent(account))return
      setName('')
      setDescription('')
      setFields([{ label: 'お名前', type: 'text', required: true }])
      await load()
    } catch (err) {
      if(scopeCurrent(account))setError(err instanceof Error ? err.message : 'フォームの作成に失敗しました')
    } finally {
      mutationBusy.current=false;setSaving(false)
    }
  }

  const handleToggle = async (f: FormApi) => {
    const account=selectedAccountId;if(!dataReady||!scopeCurrent(account)||mutationBusy.current)return
    mutationBusy.current=true;setSaving(true);setError('')
    try {await formsApi.update(f.id,{isActive:!f.isActive});if(scopeCurrent(account))await load()}
    catch(err){if(scopeCurrent(account))setError(err instanceof Error?err.message:'更新に失敗しました')}
    finally{mutationBusy.current=false;setSaving(false)}
  }

  const handleDelete = async (f: FormApi) => {
    const account=selectedAccountId;if(!dataReady||!scopeCurrent(account)||mutationBusy.current)return
    if(!confirm(`フォーム「${f.name}」を削除しますか？\n回答データも参照できなくなります。`))return
    mutationBusy.current=true;setSaving(true);setError('')
    try {await formsApi.remove(f.id);if(scopeCurrent(account))await load()}
    catch(err){if(scopeCurrent(account))setError(err instanceof Error?err.message:'削除に失敗しました')}
    finally{mutationBusy.current=false;setSaving(false)}
  }

  return (
    <div>
      <Header title="フォーム" description="アンケート・申込フォームを作成し、回答を確認します" />
      <p className="text-xs text-kumo-subtle mb-4">※ 回答の受付は API（POST /api/forms/:id/submit）経由です。回答者向けの公開ページは未提供のため、この画面は作成と回答の閲覧用です。</p>
      {error && <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

      <section className="mb-6 bg-kumo-base rounded-xl border border-kumo-line p-5">
        <h2 className="text-sm font-semibold text-kumo-default mb-3">フォームを作成</h2>
        <div className="space-y-3 max-w-xl">
          <div>
            <label htmlFor="form-name" className="block text-xs font-medium text-kumo-subtle mb-1">フォーム名</label>
            <input id="form-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 無料相談の申込"
              className="w-full px-3 py-2 border border-kumo-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]" />
          </div>
          <div>
            <label htmlFor="form-desc" className="block text-xs font-medium text-kumo-subtle mb-1">説明（任意）</label>
            <input id="form-desc" value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-kumo-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E1306C]" />
          </div>
          <div>
            <span className="block text-xs font-medium text-kumo-subtle mb-1">項目</span>
            <div className="space-y-2">
              {fields.map((f, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input aria-label={`項目${i + 1}の名前`} value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder="項目名"
                    className="flex-1 min-w-[140px] px-3 py-1.5 border border-kumo-line rounded-lg text-sm" />
                  <select aria-label={`項目${i + 1}の種類`} value={f.type} onChange={(e) => updateField(i, { type: e.target.value as FormField['type'] })}
                    className="px-2 py-1.5 border border-kumo-line rounded-lg text-sm bg-kumo-base">
                    {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-kumo-default">
                    <input type="checkbox" checked={f.required} onChange={(e) => updateField(i, { required: e.target.checked })} />必須
                  </label>
                  {fields.length > 1 && (
                    <button type="button" onClick={() => setFields((prev) => prev.filter((_, idx) => idx !== i))}
                      className="px-2 py-1 text-xs text-red-500" aria-label={`項目${i + 1}を削除`}>×</button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setFields((prev) => [...prev, { ...EMPTY_FIELD }])}
              className="mt-2 text-xs underline text-kumo-subtle">+ 項目を追加</button>
          </div>
          <button type="button" onClick={handleCreate} disabled={saving||!dataReady}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
            {saving ? '作成中...' : 'フォームを作成'}
          </button>
        </div>
      </section>

      <section className="bg-kumo-base rounded-xl border border-kumo-line p-5">
        <h2 className="text-sm font-semibold text-kumo-default mb-3">フォーム一覧</h2>
        {!selectedAccountId ? (<p className="text-sm text-kumo-subtle">Instagramアカウントを選択してください。</p>) : loading ? (
          <p className="text-sm text-kumo-subtle">読み込み中...</p>
        ) : !dataReady ? (<p className="text-sm text-red-600">一覧を確認できていません。<button type="button" onClick={()=>void load()} className="ml-2 underline">再度確認</button></p>) : visibleForms.length === 0 ? (
          <p className="text-sm text-kumo-subtle">フォームがありません</p>
        ) : (
          <ul className="divide-y divide-kumo-line">
            {visibleForms.map((f) => (
              <li key={f.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-kumo-default">{f.name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${f.isActive ? 'bg-green-100 text-green-700' : 'bg-kumo-tint text-kumo-subtle'}`}>
                        {f.isActive ? '受付中' : '停止中'}
                      </span>
                    </div>
                    {f.description && <p className="text-xs text-kumo-subtle mt-0.5">{f.description}</p>}
                    <p className="text-[11px] text-kumo-subtle mt-1">
                      項目: {f.fields.map((x) => x.label).join('、') || '—'} ／ 回答 {f.submitCount}件 ／ 作成 {formatDateTime(f.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" onClick={() => setOpenId(openId === f.id ? null : f.id)}
                      className="px-2 py-1 text-xs border border-kumo-line rounded hover:bg-kumo-tint">
                      {openId === f.id ? '回答を閉じる' : `回答を見る（${f.submitCount}）`}
                    </button>
                    <button type="button" disabled={saving} onClick={() => handleToggle(f)} className="px-2 py-1 text-xs border border-kumo-line rounded hover:bg-kumo-tint">
                      {f.isActive ? '受付停止' : '受付再開'}
                    </button>
                    <button type="button" disabled={saving} onClick={() => handleDelete(f)} className="px-2 py-1 text-xs text-red-500 border border-red-200 rounded hover:bg-red-50">
                      削除
                    </button>
                  </div>
                </div>
                {openId === f.id && <div className="mt-3"><Submissions form={f} /></div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
