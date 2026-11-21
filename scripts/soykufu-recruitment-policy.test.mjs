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
  for(const kind of ['question','visit','interview']) assert.deepEqual(decide({...line,outboundPaused:true},{kind},now),{action:'human_handoff',reason:kind,owner:'ishibashi',cancelNurture:true,preserveSuppression:true,enroll:false});
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
  assert.deepEqual(recruitmentCohort([...events,events[1]],now),{windowDays:30,matureRegistrations:2,immatureRegistrations:1,visitAttendees:0,interviewAttendees:1,confirmedHires:0,visitRate:0,interviewRate:0.5,hireRate:0,interviewToHireRate:0});
  assert.equal(recruitmentCohort([],now).interviewRate,null);
});
test('new questions after stop/decline or an unknown send reach the human queue without resuming automation',()=>{
 for(const patch of [{stopped:true},{withdrawn:true},{blocked:true},{deliveryUncertain:true}]){
  const state={...line,...patch};const before=JSON.stringify(state);
  assert.deepEqual(decide(state,{kind:'question'},now),{action:'human_handoff',reason:'question',owner:'ishibashi',cancelNurture:true,preserveSuppression:true,enroll:false});assert.equal(JSON.stringify(state),before);
  assert.equal(decide(state,guide,now).action,'hold');
 }
});
test('conflicting event IDs never silently change the cohort by input order',()=>{
 const event={eventId:'one',candidateId:'a',kind:'line_registered',at:now-40*86400000,evidenceId:'follow-a'};
 for(const patch of [{candidateId:'b'},{kind:'visit_attended'},{at:event.at+1},{evidenceId:'other'},{confirmedByHuman:true},{internal:true}]){
  assert.throws(()=>recruitmentCohort([event,{...event,...patch}],now),/Conflicting event/);assert.throws(()=>recruitmentCohort([{...event,...patch},event],now),/Conflicting event/);
 }
 assert.equal(recruitmentCohort([event,{...event}],now).matureRegistrations,1);
});
test('invalid timestamps/windows and whitespace-only evidence cannot inflate measured results',()=>{
 const e={eventId:'one',candidateId:'a',kind:'line_registered',at:now-40*86400000,evidenceId:'   '};
 assert.equal(recruitmentCohort([e],now).matureRegistrations,0);
 assert.throws(()=>recruitmentCohort([{...e,at:-1}],now),/Invalid event/);assert.throws(()=>recruitmentCohort([],now,Infinity),/Invalid observation/);
});

test('uses mature registration denominators for actual visit, interview and confirmed-hire rates',()=>{const start=now-40*86400000;const e=(eventId,candidateId,kind,days,extra={})=>({eventId,candidateId,kind,at:start+days*86400000,evidenceId:eventId,confirmedByHuman:true,...extra});const events=[e('a-reg','a','line_registered',0),e('a-visit','a','visit_attended',2),e('a-int','a','interview_attended',4),e('a-hire','a','hire_confirmed',6),e('b-reg','b','line_registered',0),e('b-booked','b','interview_confirmed',2),e('b-offer','b','offer_sent',5),e('b-hire','b','hire_confirmed',8,{confirmedByHuman:false}),e('c-reg','c','line_registered',0),e('c-hire','c','hire_confirmed',3),e('c-late-int','c','interview_attended',6)];const result=recruitmentCohort([...events,events[1],{...events[3],eventId:'duplicate-receipt'}],now);assert.equal(result.matureRegistrations,3);assert.equal(result.visitAttendees,1);assert.equal(result.interviewAttendees,2);assert.equal(result.confirmedHires,2);assert.equal(result.visitRate,1/3);assert.equal(result.interviewRate,2/3);assert.equal(result.hireRate,2/3);assert.equal(result.interviewToHireRate,1/2);});
test('never infers hire from an offer, booking, guide click, empty evidence or unconfirmed record',()=>{const at=now-40*86400000,reg={eventId:'reg',candidateId:'a',kind:'line_registered',at,evidenceId:'actual-registration'};for(const extra of [{kind:'offer_sent',evidenceId:'offer'},{kind:'offer_accepted',evidenceId:'accept'},{kind:'hire_confirmed',evidenceId:''},{kind:'hire_confirmed',evidenceId:'hire',confirmedByHuman:false}]){const r=recruitmentCohort([reg,{eventId:'other',candidateId:'a',at:at+1000,confirmedByHuman:true,...extra}],now);assert.equal(r.confirmedHires,0);assert.equal(r.hireRate,0);assert.equal(r.interviewToHireRate,null);}});
test('excludes premature, out-of-window and internal hire outcomes without inventing earlier stages',()=>{const at=now-40*86400000;const reg={eventId:'reg',candidateId:'a',kind:'line_registered',at,evidenceId:'registration'};for(const [time,expected] of [[at-1,0],[at,1],[at+30*86400000,1],[at+30*86400000+1,0]]){const r=recruitmentCohort([reg,{eventId:'hire',candidateId:'a',kind:'hire_confirmed',at:time,evidenceId:'hiring-record',confirmedByHuman:true}],now);assert.equal(r.confirmedHires,expected);assert.equal(r.interviewAttendees,0);assert.equal(r.interviewToHireRate,null);}const r=recruitmentCohort([{...reg,at:now-1000},{eventId:'hire',candidateId:'a',kind:'hire_confirmed',at:now,evidenceId:'hire',confirmedByHuman:true}],now);assert.equal(r.matureRegistrations,0);assert.equal(r.hireRate,null);assert.equal(r.immatureRegistrations,1);assert.equal(recruitmentCohort([{...reg,internal:true}],now).confirmedHires,0);});
test('rejects a reused evidence ID that maps to different people, occurrence times or confirmations',()=>{const e={eventId:'one',candidateId:'a',kind:'line_registered',at:now-40*86400000,evidenceId:'same-proof'};for(const patch of [{candidateId:'b'},{at:e.at+1},{confirmedByHuman:true},{internal:true}]){assert.throws(()=>recruitmentCohort([e,{...e,...patch,eventId:'two'}],now),/Conflicting evidence/);assert.throws(()=>recruitmentCohort([{...e,...patch,eventId:'two'},e],now),/Conflicting evidence/);}assert.equal(recruitmentCohort([e,{...e,eventId:'two'}],now).matureRegistrations,1);});
