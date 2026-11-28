import {readStoppedRuntimeSnapshot,isStoppedRuntimeReadPath} from './stopped-runtime-snapshot.mjs';
import {readStoppedInstallationSnapshot,migrationLedgerFingerprint} from './stopped-installation-snapshot.mjs';
import {assessStoppedConnectionReadiness} from './stopped-connection-readiness.mjs';
const origin = 'https://soykufu-ig-harness-20261119.soykufu.workers.dev';
const key = process.env.IG_HARNESS_API_KEY;
const cfToken = process.env.CLOUDFLARE_API_TOKEN;
// Enabled only in the official workflow after the accepted one-time registration.
const registeredAccount = process.env.STOPPED_REGISTERED_PHASE === '1';
const expectedAccounts = registeredAccount ? 1 : 0;
if (!key || !cfToken) throw new Error('Verification credentials missing');
try {
  const response = await fetch(`${origin}/login/`, { signal: AbortSignal.timeout(20000) });
  const html = await response.text();
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || !html.includes('<html lang="ja"')) throw new Error('Japanese HTML login not available');
  const chunk = html.match(/src="(\/_next\/static\/[^"?]+\.js)"/)?.[1];
  if (!chunk || !(await fetch(origin+chunk, { signal: AbortSignal.timeout(20000) })).ok) throw new Error('Login JavaScript asset unavailable');
  const unauth = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(20000) });
  if (unauth.status !== 401) throw new Error('Unauthenticated API request must be rejected');
  const auth = await fetch(`${origin}/api/health`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
  const health = await auth.json();
  if (!auth.ok || health.success !== true || health.data?.db_ok !== true) throw new Error('Authenticated API/database health failed');
  const d1 = await fetch('https://api.cloudflare.com/client/v4/accounts/e76a3f504309ca9289d8dfa3ee504502/d1/database/e55c3b84-ea9a-48fd-a7a3-08253089d295/query', {
    method: 'POST', headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: "SELECT (SELECT value FROM integration_settings WHERE key='outbound_paused') AS paused, (SELECT COUNT(*) FROM ig_accounts) AS accounts, (SELECT COUNT(*) FROM followers) AS followers" }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await d1.json();
  const state = data.result?.[0]?.results?.[0];
  // Publish only bounded operational aggregates on failure, never provider
  // messages, credentials, row bodies or inferred authorisation to resume.
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  console.log('Stopped state observation (not permission to send): '+JSON.stringify({
    providerReadOk: d1.ok && data.success === true,
    paused: state?.paused === '1' ? true : state?.paused === '0' ? false : null,
    accounts: count(state?.accounts), followers: count(state?.followers), expectedAccounts,
  }));
  if (!d1.ok || data.success !== true || state?.paused !== '1' || Number(state.accounts) !== expectedAccounts || Number(state.followers) !== 0) throw new Error('Stopped empty installation verification failed');
  const query=async sql=>{
    if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)||/;/.test(sql))throw Error('Read-only snapshot rejected');
    const r=await fetch('https://api.cloudflare.com/client/v4/accounts/e76a3f504309ca9289d8dfa3ee504502/d1/database/e55c3b84-ea9a-48fd-a7a3-08253089d295/query',{
      method:'POST',headers:{Authorization:`Bearer ${cfToken}`,'Content-Type':'application/json'},body:JSON.stringify({sql}),signal:AbortSignal.timeout(20000),
    });
    const body=await r.json();
    if(!r.ok||body.success!==true||!Array.isArray(body.result?.[0]?.results))throw Error('Read-only snapshot failed');
    return body.result[0].results;
  };
  const snapshot=await readStoppedInstallationSnapshot({repoDir:process.cwd(),query,registeredAccount});
  const runtime=await readStoppedRuntimeSnapshot({sourceSha:process.env.GITHUB_SHA,migrationInventoryHash:snapshot.migrationLedgerSha256,recoveryKey:key,read:async path=>{
    if(!isStoppedRuntimeReadPath(path))throw new Error('Unexpected runtime read');
    const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method:'GET',headers:{Authorization:`Bearer ${cfToken}`},signal:AbortSignal.timeout(15000)});
    const data=await r.json();if(!r.ok||data.success!==true)throw new Error('Runtime metadata unavailable');return data.result;
  }});
  // Recheck stop after metadata reads. The checks do not authorize deployment.
  const final=(await query("SELECT (SELECT value FROM integration_settings WHERE key='outbound_paused') AS paused,(SELECT COUNT(*) FROM ig_accounts) AS accounts,(SELECT COUNT(*) FROM followers) AS followers"))[0];
  if(final?.paused!=='1'||final.accounts!==expectedAccounts||final.followers!==0)throw new Error('Stopped empty installation verification failed');
  const finalLedger=await query('SELECT name,sha256 FROM ig_schema_migrations');
  if(migrationLedgerFingerprint(finalLedger)!==snapshot.migrationLedgerSha256)throw new Error('Migration ledger changed during runtime verification');
  console.log('Stopped preparation snapshot (read only): '+JSON.stringify({...snapshot,...runtime}));
  console.log('Stopped connection readiness (metadata only): '+JSON.stringify(registeredAccount?{state:'stopped_registered_account_observed',registeredAccountVerified:snapshot.registeredAccountVerified===true,registrationAuthorized:false,webhookActivationAuthorized:false,messagesAuthorized:false,receivingVerified:false}:assessStoppedConnectionReadiness({...snapshot,...runtime})));
  console.log(`Verified Japanese login HTML/JavaScript: ${origin}/login/`);
  console.log(`Verified unauthenticated API=401, authenticated API=200, database healthy, outbound paused, accounts=${expectedAccounts}, followers=0.`);
  console.log('Read-only smoke check: no message, Meta authentication, deployment or content change.');
} catch(error) {
  // Never include transport errors that could contain request headers.
  const message = error instanceof Error ? error.message : '';
  const allowed = ['Japanese HTML login not available','Login JavaScript asset unavailable','Unauthenticated API request must be rejected','Authenticated API/database health failed','Stopped empty installation verification failed'];
  console.error(allowed.includes(message) ? message : 'Verification could not complete; credentials remain hidden.');
  process.exitCode = 1;
}

