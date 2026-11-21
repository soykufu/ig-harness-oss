// This state machine never retries a mutation. Only an exact API acknowledgement
// may retire the opaque pending action; refresh, timeout and edits fail closed.
export type HumanReplyState = {
  phase: 'idle' | 'reviewing' | 'prepared' | 'sending' | 'held' | 'sent'
  text: string
  reviewedText: string | null
  notice: string
}
type Pending = { nonce: string; digest: string }
type ReplyResponse = { success: boolean; data?: { prepared?: boolean; maySend?: boolean; expiresInSeconds?: number; sent?: boolean; automaticDeliveryResumed?: boolean; apiAcknowledged?: boolean; status?: string } }
export interface HumanReplyDependencies {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  request: (path: string, options: RequestInit) => Promise<ReplyResponse>
  current: () => boolean
  nonce: () => string
  digest: (text: string) => Promise<string>
  now: () => number
  changed: (state: HumanReplyState) => void
}
export class HumanReplyController {
  state: HumanReplyState = { phase: 'idle', text: '', reviewedText: null, notice: '' }
  readonly storageKey: string
  private busy = false
  private expiresAt = 0
  private pending: Pending | null = null
  private disposed = false
  constructor(readonly accountId: string, readonly friendId: string, readonly actorId: string, private deps: HumanReplyDependencies) {
    this.storageKey = `ig-human-intent:${accountId}:${friendId}:${actorId}`
    try {
      const raw = deps.storage.getItem(this.storageKey)
      if (raw) {
        const p = JSON.parse(raw) as Pending
        if (!/^[a-zA-Z0-9_-]{16,100}$/.test(p.nonce) || !/^[a-f0-9]{64}$/.test(p.digest)) throw new Error('Invalid intent')
        this.pending = p
        this.state = { ...this.state, phase: 'held', notice: '確認待ちの返信があります。再送せず結果を照合してください。' }
      }
    } catch { this.state = { ...this.state, phase: 'held', notice: '端末の確認記録を読めません。返信を保留します。' } }
  }
  dispose() { this.disposed = true }
  private current() { return !this.disposed && this.deps.current() }
  private update(patch: Partial<HumanReplyState>) {
    if (!this.current()) return
    this.state = { ...this.state, ...patch }; this.deps.changed(this.state)
  }
  edit(text: string) {
    if (this.busy) return
    this.update({ text, reviewedText: null, ...(this.pending ? { phase: 'held' as const, notice: '本文を変更したため確認は無効です。前の返信を再送せず照合してください。' } : {}) })
  }
  newDraft() {
    if (this.busy || this.state.phase !== 'sent' || this.pending || !this.current()) return
    this.update({ phase: 'idle', text: '', reviewedText: null, notice: '別の返信は、新しい本文と受信状態を確認してから一回だけ送信します。' })
  }
  private ordinaryPending() { return !!this.deps.storage.getItem(`ig-manual-intent:${this.friendId}`) }
  private path(kind: string) { return `/api/friends/${encodeURIComponent(this.friendId)}/${kind}` }
  async review() {
    if (this.busy || this.state.phase !== 'idle' || !this.current() || !this.state.text.trim() || this.state.text.trim().length > 2000) return
    this.busy = true
    const text = this.state.text.trim(), start = this.deps.now()
    this.update({ phase: 'reviewing', reviewedText: null, notice: '宛先・本文・受信状態を照合中…' })
    try {
      if (this.ordinaryPending() || this.deps.storage.getItem(this.storageKey)) throw new Error('Pending action')
      const digest = await this.deps.digest(text)
      if (!this.current()) return
      const pending = { nonce: this.deps.nonce(), digest }
      // Persist BEFORE the first mutation. Store neither draft text nor secrets.
      this.deps.storage.setItem(this.storageKey, JSON.stringify(pending)); this.pending = pending
      const res = await this.deps.request(this.path('human-reply-review'), { method: 'POST', headers: { 'Idempotency-Key': pending.nonce }, body: JSON.stringify({ text }) })
      if (!this.current()) return
      if (!res.success || res.data?.prepared !== true || res.data.maySend !== false || res.data.expiresInSeconds !== 60 || this.deps.now() >= start + 60000) throw new Error('Review unavailable')
      this.expiresAt = start + 60000
      this.update({ phase: 'prepared', reviewedText: text, notice: '宛先と本文を確認しました。送信はまだ行っていません。60秒以内に下のボタンで一回だけ返信できます。' })
    } catch { this.update({ phase: 'held', reviewedText: null, notice: '確認できないため保留しました。送信せず、結果を照合してください。' }) }
    finally { this.busy = false }
  }
  expire() {
    if (this.state.phase === 'prepared' && this.deps.now() >= this.expiresAt) this.update({ phase: 'held', reviewedText: null, notice: '確認の有効時間を過ぎました。送信せず、記録を照合してください。' })
  }
  async send() {
    this.expire()
    if (this.busy || !this.current() || this.state.phase !== 'prepared' || !this.pending || this.state.text.trim() !== this.state.reviewedText) return
    this.busy = true
    const text = this.state.reviewedText
    this.update({ phase: 'sending', notice: '確認済みの本文を一回送信中…' })
    try {
      if (this.ordinaryPending()) throw new Error('Pending ordinary action')
      // Reload may inspect this same key, but may never reconstruct permission.
      this.deps.storage.setItem(this.storageKey, JSON.stringify(this.pending))
      const res = await this.deps.request(this.path('human-replies'), { method: 'POST', headers: { 'Idempotency-Key': this.pending.nonce }, body: JSON.stringify({ text }) })
      if (!res.success || res.data?.sent !== true || res.data.automaticDeliveryResumed !== false) throw new Error('Unknown outcome')
      this.complete()
    } catch { this.update({ phase: 'held', reviewedText: null, notice: '送信結果が確認できません。再送せず「返信結果を照合」を押してください。' }) }
    finally { this.busy = false }
  }
  private complete() {
    if (!this.current()) return
    this.deps.storage.removeItem(this.storageKey); this.pending = null
    this.update({ phase: 'sent', text: '', reviewedText: null, notice: '送信APIの応答と処理完了を確認しました。到着・既読は未確認です。自動案内は再開していません。' })
  }
  async check() {
    if (this.busy || !this.current() || !this.pending) return
    this.busy = true
    try {
      const res = await this.deps.request(this.path('human-reply-status'), { method: 'GET', cache: 'no-store', headers: { 'Idempotency-Key': this.pending.nonce } })
      if (res.success && res.data?.status === 'sent' && res.data.apiAcknowledged === true && res.data.automaticDeliveryResumed === false) this.complete()
      else this.update({ phase: 'held', reviewedText: null, notice: '処理完了の証拠は未確認です。確認だけの記録・記録なしの場合も、新しい送信は行いません。' })
    } catch { this.update({ phase: 'held', reviewedText: null, notice: '記録を照合できません。未送信とは判断せず、返信を保留します。' }) }
    finally { this.busy = false }
  }
}
