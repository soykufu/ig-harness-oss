'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchApi, getApiAccountId } from '@/lib/api'
import { HumanReplyController, type HumanReplyState } from '@/lib/human-reply-controller'

export function hasHumanReplyPending(accountId: string, friendId: string): boolean {
  const prefix = `ig-human-intent:${accountId}:${friendId}:`
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      if (sessionStorage.key(i)?.startsWith(prefix)) return true
    }
    return false
  } catch { return true }
}

export function HumanReplyPanel({ accountId, friendId, recipient, busy, onOpenChange, onSent }: {
  accountId: string; friendId: string; recipient: string; busy: boolean
  onOpenChange: (open: boolean) => void; onSent: () => void
}) {
  const [actor, setActor] = useState<string | null>(null)
  const [roleChecked, setRoleChecked] = useState(false)
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<HumanReplyState | null>(null)
  const controller = useRef<HumanReplyController | null>(null)
  const sentRef = useRef(onSent); sentRef.current = onSent
  useEffect(() => {
    const ac = new AbortController()
    fetchApi<{ success: boolean; data: { id: string; role: string } }>('/api/staff/me', { signal: ac.signal, cache: 'no-store' })
      .then(res => { if (!ac.signal.aborted && res.success && ['owner', 'admin'].includes(res.data.role)) setActor(res.data.id) })
      .catch(() => {}).finally(() => { if (!ac.signal.aborted) setRoleChecked(true) })
    return () => ac.abort()
  }, [])
  useEffect(() => {
    if (!actor) return
    const c = new HumanReplyController(accountId, friendId, actor, {
      storage: sessionStorage,
      request: (path, options) => fetchApi(path, options),
      current: () => getApiAccountId() === accountId,
      now: () => Date.now(), nonce: () => crypto.randomUUID(),
      digest: async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join(''),
      changed: next => { setState(next); if (next.phase === 'sent') sentRef.current() },
    })
    controller.current = c; setState(c.state)
    const timer = setInterval(() => c.expire(), 1000)
    return () => { clearInterval(timer); c.dispose(); controller.current = null }
  }, [accountId, friendId, actor])
  const changeOpen = (next: boolean) => { setOpen(next); onOpenChange(next) }
  const pending = state && !['idle', 'sent'].includes(state.phase)
  if (!roleChecked) return <p className="mt-2 text-xs text-kumo-subtle">返信権限を確認中…</p>
  if (!actor || !state) return <p className="mt-2 text-xs text-kumo-subtle">確認付きの有人返信は、認証済み管理者だけが操作できます。</p>
  return <section className="mt-3 border-t border-kumo-line pt-2">
    <button type="button" disabled={busy || !!pending} onClick={() => changeOpen(!open)} className="text-xs underline disabled:opacity-40">{open ? '通常の入力へ戻る' : '相談に一回だけ返信する'}</button>
    {(open || pending) && <div className="mt-2 space-y-2">
      <p className="text-xs font-medium">返信先：{recipient}（ID {friendId}）</p>
      <p className="text-xs text-kumo-subtle">停止・辞退の記録は維持します。自動案内は再開しません。確認後に送信ボタンを押すまで送信されません。</p>
      <textarea aria-label="確認付き返信の本文" rows={3} maxLength={2000} value={state.text}
        disabled={busy || !['idle'].includes(state.phase)} onChange={e => controller.current?.edit(e.target.value)}
        className="w-full rounded border border-kumo-line px-2 py-1 text-sm disabled:opacity-60" />
      {state.reviewedText && <div className="rounded border border-kumo-line p-2 text-sm whitespace-pre-wrap break-words" aria-label="確認済みの返信本文">{state.reviewedText}</div>}
      <div className="flex flex-wrap gap-3 text-xs">
        {state.phase === 'sent' && <button type="button" disabled={busy} onClick={() => controller.current?.newDraft()} className="underline disabled:opacity-40">別の返信を作成</button>}
        <button type="button" disabled={busy || state.phase !== 'idle' || !state.text.trim()} onClick={() => controller.current?.review()} className="rounded border px-3 py-2 disabled:opacity-40">宛先と本文を確認</button>
        <button type="button" disabled={busy || state.phase !== 'prepared'} onClick={() => controller.current?.send()} className="rounded bg-pink-600 text-white px-3 py-2 disabled:opacity-40">確認した本文で一回返信</button>
        <button type="button" disabled={busy || !pending || ['reviewing', 'sending'].includes(state.phase)} onClick={() => controller.current?.check()} className="underline disabled:opacity-40">返信結果を照合</button>
      </div>
      {state.notice && <p role="status" className="text-xs text-kumo-subtle">{state.notice}</p>}
    </div>}
  </section>
}
