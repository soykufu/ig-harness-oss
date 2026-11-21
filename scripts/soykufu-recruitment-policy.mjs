// Pure decisions only: no network, credentials, live data, or message sending.
// A tested adapter and explicit cutover are still required before production.
export function nextRecruitmentAction(s, request, now = Date.now()) {
  const hold = reason => ({ action: 'hold', reason, enroll: false });
  if (request.kind === 'question' || request.kind === 'visit' || request.kind === 'interview') {
    return { action: 'human_handoff', reason: request.kind, owner: 'ishibashi', cancelNurture: true, preserveSuppression: true, enroll: false };
  }
  if (s.blocked || s.stopped || s.withdrawn) return hold('stopped');
  if (s.deliveryUncertain) return hold('reconcile_delivery');
  if (s.humanActive) return hold('human_active');
  if (s.outboundPaused) return hold('outbound_paused');
  if (s.channel === 'instagram') {
    const hour = new Date(now + 9 * 3600000).getUTCHours();
    if (hour < 8 || hour >= 21) return hold('outside_delivery_window');
    if (s.legacyOwnership !== 'harness') return hold('legacy_owns_or_unconfirmed');
    if (!s.sharedLedgerVerified) return hold('shared_ledger_unverified');
    if (!Array.isArray(s.recentOutboundTimes)) return hold('shared_ledger_unverified');
    if (s.recentOutboundTimes.some(t => !Number.isFinite(t) || t > now)) return hold('shared_ledger_invalid');
    if (s.recentOutboundTimes.filter(t => t > now - 3600000).length >= 10) return hold('rolling_hour_limit');
    if (!Number.isFinite(s.lastInboundAt) || s.lastInboundAt > now || now - s.lastInboundAt >= 24 * 3600000) return hold('normal_dm_window_closed');
  } else if (s.channel !== 'line' || !s.lineActive) {
    return hold('channel_not_connected');
  }
  if (request.kind === 'guide') {
    if (!s.guideRequested && !s.guidePromised) return hold('guide_not_requested');
    if (s.channel !== 'line' && !s.guidePromised) return hold('new_guide_delivered_on_line');
    if (!s.guideReleaseVerified || !request.guideVersion) return hold('guide_release_unverified');
    if ((s.deliveredGuideVersions ?? []).includes(request.guideVersion)) return hold('guide_already_delivered');
    return { action: 'deliver_guide', enroll: false, guideVersion: request.guideVersion };
  }
  if (request.kind === 'nurture') {
    if (s.channel !== 'line') return hold('nurture_on_line_only');
    if (!s.nurtureOptIn) return hold('nurture_not_requested');
    if (!s.stopAndHandoffTested) return hold('stop_and_handoff_unverified');
    if (!s.quotaVerified || s.remainingMessages < 1) return hold('line_quota_unverified_or_empty');
    if (s.activeNurture || s.nurtureCompleted) return hold('nurture_already_started');
    return { action: 'start_nurture', enroll: true, maxMessages: 4 };
  }
  return hold('no_automatic_action');
}

// Event timestamps represent the actual occurrence, not data entry time.
// Registration counts require a real LINE registration event; clicks do not count.
export function recruitmentCohort(events, asOf, windowDays = 30) {
  if (!Number.isSafeInteger(asOf) || asOf<0 || !Number.isFinite(windowDays) || !(windowDays > 0)) throw new Error('Invalid observation window');
  const rows = new Map();
  const seen = new Map();
  for (const e of events) {
    if (typeof e.eventId!=='string'||!e.eventId.trim()||typeof e.candidateId!=='string'||!e.candidateId.trim()||typeof e.kind!=='string'||!e.kind||!Number.isSafeInteger(e.at)||e.at<0||e.at>asOf) throw new Error('Invalid event');
    const signature=JSON.stringify([e.candidateId,e.kind,e.at,e.evidenceId??null,e.confirmedByHuman===true,e.internal===true]);
    if(seen.has(e.eventId)){if(seen.get(e.eventId)!==signature)throw new Error('Conflicting event identity requires reconciliation');continue;}
    seen.set(e.eventId,signature);
    if (!rows.has(e.candidateId)) rows.set(e.candidateId, []);
    rows.get(e.candidateId).push(e);
  }
  let mature = 0, interviews = 0, visits = 0, immature = 0;
  for (const list of rows.values()) {
    if (list.some(e => e.internal === true)) continue;
    const registrations = list.filter(e => e.kind === 'line_registered' && typeof e.evidenceId==='string' && e.evidenceId.trim()).sort((a,b) => a.at-b.at);
    if (!registrations.length) continue;
    const registeredAt = registrations[0].at;
    const cutoff = registeredAt + windowDays * 86400000;
    if (cutoff > asOf) { immature++; continue; }
    mature++;
    const occurred = kind => list.some(e => e.kind === kind && typeof e.evidenceId==='string' && e.evidenceId.trim() && e.confirmedByHuman === true && e.at >= registeredAt && e.at <= cutoff);
    if (occurred('visit_attended')) visits++;
    if (occurred('interview_attended')) interviews++;
  }
  return { windowDays, matureRegistrations: mature, immatureRegistrations: immature, visitAttendees: visits, interviewAttendees: interviews, interviewRate: mature ? interviews / mature : null };
}
