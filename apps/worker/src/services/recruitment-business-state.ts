/** Suppression evidence only; never grants consent, a DM window or quota.
 * Missing/stale/unrecognised state is held. A verified state synchronizer must
 * supply this namespace; importing a follower is not permission to send.
 */
export function assertRecruitmentBusinessState(metadata: string, ownerEpoch: string, nowMs: number): void {
  let state: any;
  try { state = JSON.parse(metadata)?.recruitment_delivery; } catch { /* deny below */ }
  if (!state || state.state !== 'active' || state.owner_epoch !== ownerEpoch
    || !Number.isSafeInteger(state.observed_at_ms) || !Number.isSafeInteger(state.valid_until_ms)
    || state.observed_at_ms > nowMs || state.observed_at_ms < nowMs - 300_000
    || state.valid_until_ms <= nowMs || state.valid_until_ms > state.observed_at_ms + 300_000) {
    throw new Error('Recruitment business state requires reconciliation');
  }
}
