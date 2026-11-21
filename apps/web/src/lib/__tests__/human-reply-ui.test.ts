import { it, expect, vi } from 'vitest'
import { HumanReplyController, type HumanReplyDependencies } from '../human-reply-controller'

function fixture(overrides: Partial<HumanReplyDependencies> = {}) {
  let time = 100000, current = true
  const records = new Map<string, string>()
  const storage = { getItem: (k: string) => records.get(k) ?? null, setItem: (k: string, v: string) => { records.set(k, v) }, removeItem: (k: string) => { records.delete(k) } }
  const request = vi.fn<HumanReplyDependencies['request']>(async path => path.endsWith('human-reply-review')
    ? { success: true, data: { prepared: true, maySend: false, expiresInSeconds: 60 } }
    : path.endsWith('human-reply-status') ? { success: true, data: { status: 'sent', apiAcknowledged: true, automaticDeliveryResumed: false } }
    : { success: true, data: { sent: true, automaticDeliveryResumed: false } })
  const deps: HumanReplyDependencies = { storage, request, current: () => current, nonce: vi.fn(() => 'one-nonce-000000000001'), digest: vi.fn(async () => 'a'.repeat(64)), now: () => time, changed: vi.fn(), ...overrides }
  const create = (account = 'a', friend = '1', actor = 'owner') => new HumanReplyController(account, friend, actor, deps)
  const c = create(); c.edit('  相談への回答です  ')
  return { c, deps, create, records, request, setTime: (n: number) => { time = n }, changeScope: () => { current = false } }
}
it('requires separate review then explicit send, with the same nonce and exact trimmed body', async () => {
  const f = fixture(); await f.c.send(); expect(f.request).not.toHaveBeenCalled()
  await f.c.review(); expect(f.c.state.phase).toBe('prepared'); expect(f.request).toHaveBeenCalledTimes(1)
  expect([...f.records.values()].join('')).not.toContain('相談')
  await f.c.send(); await f.c.send()
  expect(f.request).toHaveBeenCalledTimes(2)
  expect(f.request.mock.calls[0][1].headers).toEqual(f.request.mock.calls[1][1].headers)
  expect(f.request.mock.calls[1][1].body).toBe(JSON.stringify({ text: '相談への回答です' }))
  expect(f.c.state.phase).toBe('sent'); expect(f.records.size).toBe(0)
})
it('blocks double clicks while hashing and while sending', async () => {
  let resolve!: (value: string) => void
  const f = fixture({ digest: () => new Promise(r => { resolve = r }) })
  const review = f.c.review(); await f.c.review(); expect(f.request).not.toHaveBeenCalled()
  resolve('a'.repeat(64)); await review
  const send = f.c.send(); await f.c.send(); await send
  expect(f.request).toHaveBeenCalledTimes(2)
})
it.each(['review', 'send'])('retains the same opaque key after %s timeout and only checks status after reload', async stage => {
  const f = fixture()
  if (stage === 'review') f.request.mockRejectedValueOnce(new Error('timeout'))
  await f.c.review()
  if (stage === 'send') { f.request.mockRejectedValueOnce(new Error('timeout')); await f.c.send() }
  expect(f.c.state.phase).toBe('held'); const raw = f.records.get(f.c.storageKey)
  const reloaded = f.create(); expect(reloaded.state.phase).toBe('held'); expect(reloaded.state.text).toBe('')
  reloaded.edit('別の回答'); await reloaded.review(); await reloaded.send()
  expect(f.records.get(f.c.storageKey)).toBe(raw)
  await reloaded.check()
  expect(f.request.mock.calls.at(-1)?.[1].method).toBe('GET'); expect(reloaded.state.phase).toBe('sent')
})
it('invalidates confirmation after any edit without acquiring a new nonce', async () => {
  const f = fixture(); await f.c.review(); f.c.edit('変更'); await f.c.send(); await f.c.review()
  expect(f.c.state.phase).toBe('held'); expect(f.request).toHaveBeenCalledTimes(1); expect(f.deps.nonce).toHaveBeenCalledTimes(1)
})
it('expires from review request start, including network latency', async () => {
  const f = fixture(); await f.c.review(); f.setTime(160000); await f.c.send()
  expect(f.c.state.phase).toBe('held'); expect(f.request).toHaveBeenCalledTimes(1)
  const g = fixture(); g.request.mockImplementationOnce(async () => { g.setTime(160001); return { success: true, data: { prepared: true, maySend: false, expiresInSeconds: 60 } } })
  await g.c.review(); expect(g.c.state.phase).toBe('held')
})
it.each(['switch', 'unmount'])('does not post or restore stale approval after %s during hashing', async how => {
  let resolve!: (value: string) => void
  const f = fixture({ digest: () => new Promise(r => { resolve = r }) }); const p = f.c.review()
  if (how === 'switch') f.changeScope(); else f.c.dispose()
  resolve('a'.repeat(64)); await p; await f.c.send()
  expect(f.request).not.toHaveBeenCalled(); expect(f.records.size).toBe(0)
})
it('ignores an old review response after account switch', async () => {
  const f = fixture(); f.request.mockImplementationOnce(async () => { f.changeScope(); return { success: true, data: { prepared: true, maySend: false, expiresInSeconds: 60 } } })
  await f.c.review(); await f.c.send(); expect(f.request).toHaveBeenCalledTimes(1); expect(f.c.state.phase).not.toBe('prepared')
})
it.each(['normal-before-review', 'normal-before-send'])('does not overlap ordinary pending sends: %s', async mode => {
  const f = fixture()
  if (mode === 'normal-before-send') await f.c.review()
  f.records.set('ig-manual-intent:1', '{}')
  if (mode === 'normal-before-send') await f.c.send(); else await f.c.review()
  expect(f.c.state.phase).toBe('held'); expect(f.request).toHaveBeenCalledTimes(mode === 'normal-before-send' ? 1 : 0)
})
it.each(['read', 'write', 'corrupt'])('fails closed when persistent intent storage is unavailable: %s', async kind => {
  const f = fixture()
  if (kind === 'read') f.deps.storage.getItem = () => { throw new Error('unavailable') }
  if (kind === 'write') f.deps.storage.setItem = () => { throw new Error('quota') }
  if (kind === 'corrupt') f.records.set(f.c.storageKey, 'invalid')
  const c = f.create(); c.edit('本文'); await c.review(); expect(c.state.phase).toBe('held'); expect(f.request).not.toHaveBeenCalled()
})
it('keeps confirmation for reconciliation if storage removal fails after API acknowledgement', async () => {
  const f = fixture(); await f.c.review(); f.deps.storage.removeItem = () => { throw new Error('unavailable') }; await f.c.send()
  expect(f.c.state.phase).toBe('held'); expect(f.records.size).toBe(1); await f.c.send(); expect(f.request).toHaveBeenCalledTimes(2)
})
it.each(['missing', 'uncertain', 'prepared', 'wrong-epoch', 'sent-no-ack'])('never treats %s status as safe to resend', async status => {
  const f = fixture(); await f.c.review()
  f.request.mockImplementationOnce(async () => { if (status === 'missing') throw new Error('404'); return { success: true, data: { status: status === 'sent-no-ack' ? 'sent' : status, apiAcknowledged: false, automaticDeliveryResumed: false } } })
  await f.c.check(); await f.c.review(); await f.c.send()
  expect(f.c.state.phase).toBe('held'); expect(f.records.size).toBe(1); expect(f.request).toHaveBeenCalledTimes(2)
})
it('scopes pending actions by account, follower and verified actor', async () => {
  const f = fixture(); await f.c.review()
  expect(f.create('b').state.phase).toBe('idle'); expect(f.create('a', '2').state.phase).toBe('idle'); expect(f.create('a', '1', 'other').state.phase).toBe('idle')
})
it('starts another draft only after confirmed completion and explicit operator action', async () => {
  const f = fixture(); await f.c.review(); f.c.newDraft(); expect(f.c.state.phase).toBe('prepared')
  await f.c.send(); f.c.newDraft(); expect(f.c.state.phase).toBe('idle'); expect(f.c.state.text).toBe('')
})
it('cannot discard an uncertain reply by starting another draft', async () => {
  const f = fixture(); await f.c.review(); f.request.mockRejectedValueOnce(new Error('timeout')); await f.c.send()
  f.c.newDraft(); expect(f.c.state.phase).toBe('held'); expect(f.records.size).toBe(1)
})
it.each(['bad-response', 'auto-resumed'])('does not clear intent for invalid send acknowledgement: %s', async mode => {
  const f = fixture(); await f.c.review(); f.request.mockResolvedValueOnce({ success: true, data: { sent: mode === 'auto-resumed', automaticDeliveryResumed: mode === 'auto-resumed' } })
  await f.c.send(); expect(f.c.state.phase).toBe('held'); expect(f.records.size).toBe(1)
})
