import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRecruitmentAction as decide, recruitmentCohort } from './soykufu-recruitment-policy.mjs';
const now = Date.parse('2026-11-20T03:00:00Z');
const ig = { channel: 'instagram', legacyOwnership: 'harness', sharedLedgerVerified: true, recentOutboundTimes: [], lastInboundAt: now - 1000, guidePromised: true, guideReleaseVerified: true };
const line = { channel: 'line', lineActive: true, guideRequested: true, guideReleaseVerified: true };
const guide = { kind: 'guide', guideVersion: 'release-15' };
test('stop and uncertain delivery suppress automatic material delivery', () => {
  assert.equal(decide({...line,stopped:true},guide,now).reason,'stopped');
  assert.equal(decide({...line,deliveryUncertain:true},guide,now).reason,'reconcile_delivery');
});
test('questions and interview requests hand off and cancel nurture without requiring a form', () => {
  for(const kind of ['question','visit','interview']) assert.deepEqual(decide({...line,outboundPaused:true},{kind},now),{action:'human_handoff',reason:kind,owner:'ishibashi',cancelNurture:true,enroll:false});
});
test('08:00 inclusive and 21:00 exclusive apply to normal IG delivery', () => {
  for(const [time,allowed] of [['2026-11-19T22:59:00Z',false],['2026-11-19T23:00:00Z',true],['2026-11-20T11:59:00Z',true],['2026-11-20T12:00:00Z',false]]) {
    const t=Date.parse(time); assert.equal(decide({...ig,lastInboundAt:t-1},guide,t).action==='deliver_guide',allowed);
  }
});
test('all shared manual and automatic IG sends count, with exact 60-minute boundary', () => {
  assert.equal(decide({...ig,recentOutboundTimes:Array(10).fill(now-1)},guide,now).reason,'rolling_hour_limit');
  assert.equal(decide({...ig,recentOutboundTimes:Array(10).fill(now-3600000)},guide,now).action,'deliver_guide');
  assert.equal(decide({...ig,sharedLedgerVerified:false},guide,now).reason,'shared_ledger_unverified');
  assert.equal(decide({...ig,recentOutboundTimes:[now+1]},guide,now).reason,'shared_ledger_invalid');
});
test('legacy ownership and normal API window must be verified', () => {
  assert.equal(decide({...ig,legacyOwnership:'legacy'},guide,now).reason,'legacy_owns_or_unconfirmed');
  assert.equal(decide({...ig,lastInboundAt:now-24*3600000},guide,now).reason,'normal_dm_window_closed');
});
test('guide does not imply subscription; repeated version never sends automatically', () => {
  assert.equal(decide(line,guide,now).enroll,false);
  assert.equal(decide({...line,deliveredGuideVersions:['release-15']},guide,now).reason,'guide_already_delivered');
  assert.equal(decide({...line,guideRequested:false},guide,now).reason,'guide_not_requested');
  assert.equal(decide({...line,guideReleaseVerified:false},guide,now).reason,'guide_release_unverified');
});
test('LINE nurture needs separate opt in, tested stop/handoff, quota, and single enrollment', () => {
  const s={...line,nurtureOptIn:true,stopAndHandoffTested:true,quotaVerified:true,remainingMessages:5};
  assert.equal(decide(s,{kind:'nurture'},now).action,'start_nurture');
  for(const patch of [{nurtureOptIn:false},{stopAndHandoffTested:false},{quotaVerified:false},{remainingMessages:0},{activeNurture:true},{nurtureCompleted:true}]) assert.equal(decide({...s,...patch},{kind:'nurture'},now).action,'hold');
});
test('cohorts exclude internal users and immature registrations; require real attendance evidence', () => {
  const old=now-40*86400000;
  const events=[
    {eventId:'1',candidateId:'a',kind:'line_registered',at:old,evidenceId:'follow-a'},
    {eventId:'2',candidateId:'a',kind:'interview_attended',at:old+10*86400000,evidenceId:'interview-a',confirmedByHuman:true},
    {eventId:'3',candidateId:'b',kind:'line_registered',at:old,evidenceId:'follow-b'},
    {eventId:'4',candidateId:'b',kind:'interview_confirmed',at:old+1000,evidenceId:'booking'},
    {eventId:'5',candidateId:'new',kind:'line_registered',at:now-86400000,evidenceId:'follow-new'},
    {eventId:'6',candidateId:'staff',kind:'line_registered',at:old,internal:true,evidenceId:'test'},
    {eventId:'7',candidateId:'click',kind:'line_link_clicked',at:old,evidenceId:'click'},
  ];
  assert.deepEqual(recruitmentCohort([...events,events[1]],now),{windowDays:30,matureRegistrations:2,immatureRegistrations:1,visitAttendees:0,interviewAttendees:1,interviewRate:0.5});
  assert.equal(recruitmentCohort([],now).interviewRate,null);
});
