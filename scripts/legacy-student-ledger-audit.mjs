// Aggregate-only, read-only audit. No migration, identity linking or send grant.
export const LEGACY_STUDENT_HEADERS = Object.freeze(['No','Instagram IDまたはURL','名前','学校名','学年','担当スタッフ','イベント日','イベント名','最新状態','最終接触日時','見込み度','送付資料','メモ','サロン見学','面接','内定','メモ','次の接点','次回対応日','次にすること','個別DM停止・理由']);
const fields = ['sourceRow','rowNo','instagram','status','lastContact','visit','interview','offer','dmStop'];
const usernamePattern = /^[A-Za-z0-9_][A-Za-z0-9_.]{0,29}$/;
const reservedPaths = new Set(['p','reel','reels','stories','explore','accounts','direct','tv','about','developer','legal','web']);
function username(value) {
  let name = value.trim();
  if (/^https?:\/\//i.test(name)) {
    // Match the literal profile path, not URL-normalized ../ or backslashes.
    const profile=/^https:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_][A-Za-z0-9_.]{0,29})\/?(?:\?[^#\s]*)?$/i.exec(name);
    if (!profile) return null;
    name = profile[1];
  } else if (name.startsWith('@')) name = name.slice(1);
  if (!usernamePattern.test(name) || name.endsWith('.') || name.includes('..') || reservedPaths.has(name.toLowerCase())) return null;
  // A grouping key is not a person identifier or an authenticated IGSID.
  return name.toLowerCase();
}
function contactTime(value) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) {
    const time = Date.parse(value);
    if (Number.isFinite(time) && new Date(time).toISOString().replace('.000Z','Z') === value.replace('.000Z','Z')) return time;
  }
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})(?::(\d{2}))? JST$/.exec(value);
  if (!m) return null;
  const expected = `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? '00'}.000Z`, naive = Date.parse(expected);
  return Number.isFinite(naive) && new Date(naive).toISOString() === expected ? naive - 9 * 3600000 : null;
}
export function auditLegacyStudentLedger({headers, entries, firstRow, lastRow, asOf}) {
  const fail = () => { throw new Error('Legacy ledger requires read-only reconciliation'); };
  if (!Array.isArray(headers) || headers.length !== LEGACY_STUDENT_HEADERS.length || headers.some((h,i) => h !== LEGACY_STUDENT_HEADERS[i])) fail();
  if (!Number.isSafeInteger(asOf) || asOf < 0 || asOf > 8640000000000000 || !Number.isSafeInteger(firstRow) || firstRow < 5 || !Number.isSafeInteger(lastRow) || lastRow < firstRow || lastRow-firstRow >= 50000 || !Array.isArray(entries) || entries.length !== lastRow-firstRow+1) fail();
  const groups = new Map(), rowNumbers = new Map();
  const counts = {scannedRows:entries.length, populatedRows:0, missingInstagram:0, unrecognizedInstagram:0, directThreadLinks:0, duplicateUsernameGroups:0, rowsInDuplicateUsernameGroups:0, duplicateRowNumberGroups:0, statusRecorded:0, stopReasonRecorded:0, lastContactMissing:0, lastContactUnparseable:0, lastContactFuture:0, visitTextRecorded:0, interviewTextRecorded:0, offerTextRecorded:0};
  for (let i=0; i<entries.length; i++) {
    const e=entries[i];
    if (!e || Array.isArray(e) || Object.keys(e).sort().join(',') !== [...fields].sort().join(',') || e.sourceRow !== firstRow+i || fields.slice(1).some(k => e[k] !== null && (typeof e[k] !== 'string' || e[k].length > 20000))) fail();
    const values=Object.fromEntries(fields.slice(1).map(k=>[k,e[k]?.trim() ?? '']));
    if (!Object.values(values).some(Boolean)) continue;
    counts.populatedRows++;
    if (values.rowNo) rowNumbers.set(values.rowNo,(rowNumbers.get(values.rowNo)??0)+1);
    if (!values.instagram) counts.missingInstagram++;
    else { const key=username(values.instagram); if (!key) {counts.unrecognizedInstagram++;if(/^https:\/\/(?:www\.)?instagram\.com\/direct\/t\/[0-9]+\/?$/i.test(values.instagram))counts.directThreadLinks++;} else groups.set(key,(groups.get(key)??0)+1); }
    if (values.status) counts.statusRecorded++;
    if (values.dmStop) counts.stopReasonRecorded++;
    if (!values.lastContact) counts.lastContactMissing++;
    else { const at=contactTime(values.lastContact); if(at===null) counts.lastContactUnparseable++; else if(at>asOf) counts.lastContactFuture++; }
    for (const [field,count] of [['visit','visitTextRecorded'],['interview','interviewTextRecorded'],['offer','offerTextRecorded']]) if(values[field]) counts[count]++;
  }
  for(const count of groups.values()) if(count>1){counts.duplicateUsernameGroups++;counts.rowsInDuplicateUsernameGroups+=count;}
  counts.duplicateRowNumberGroups=[...rowNumbers.values()].filter(n=>n>1).length;
  // Free-text, row numbers, username matches and contact dates never establish
  // consent, identity, ownership, actual attendance, a LINE event or a hire.
  return {scope:'legacy_student_ledger_readonly', observedAt:new Date(asOf).toISOString(), firstRow,lastRow,headerMappingVerified:true,counts,maySend:false,mayImport:false,mayChangeOwner:false,metricsEligible:false,outcomeEvidence:'unverified',identityEvidence:'unverified',suppressionEvidence:'unverified'};
}
