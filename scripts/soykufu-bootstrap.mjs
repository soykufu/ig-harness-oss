import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { applyMigrations } from './migration-runner.mjs';

// Dedicated, new installation only. Never adopt existing resources implicitly.
const accountId = 'e76a3f504309ca9289d8dfa3ee504502';
const name = 'soykufu-ig-harness-20261119';
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token || process.env.SOYKUFU_BOOTSTRAP_APPROVED !== 'true') {
  throw new Error('Explicit bootstrap execution and Cloudflare credentials required');
}
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error(`Cloudflare non-JSON response: HTTP ${response.status}`); }
  if (!response.ok || data.success !== true) {
    const codes = (data.errors ?? []).map(e => e.code).filter(Number.isInteger).join(',');
    throw new Error(`Cloudflare ${method} ${path}: HTTP ${response.status}, codes ${codes}`);
  }
  return data.result;
}

try {
  const databases = await api('d1/database?per_page=100');
  const buckets = await api('r2/buckets?per_page=100');
  if (!Array.isArray(databases) || !Array.isArray(buckets.buckets)) throw new Error('Unexpected resource-list response');
  if (databases.some(x => x.name === name) || buckets.buckets.some(x => x.name === name)) {
    throw new Error('Dedicated resource name already exists; inspect prior run before continuing. No changes made.');
  }
  const database = await api('d1/database', 'POST', { name });
  if (!/^[a-f0-9-]{36}$/.test(database.uuid ?? '')) throw new Error('Unexpected D1 identifier; inspect creation result');
  console.log(`Created dedicated D1: ${name}; ID: ${database.uuid}`);
  await api('r2/buckets', 'POST', { name });
  console.log(`Created private R2 bucket: ${name}. Public access was not enabled.`);
  const query = async sql => {
    const results = await api(`d1/database/${database.uuid}/query`, 'POST', { sql });
    if (!Array.isArray(results) || results.some(x => x.success === false)) throw new Error('D1 SQL execution failed');
    return results.flatMap(x => x.results ?? []);
  };
  const repoDir = fileURLToPath(new URL('../', import.meta.url));
  await applyMigrations({ repoDir, query, execute: query });
  await query(await readFile(new URL('./soykufu-initial-safety.sql', import.meta.url), 'utf8'));
  const settings = await query("SELECT key,value FROM integration_settings WHERE key IN ('outbound_paused','delivery_window_start_jst','delivery_window_end_jst')");
  const expected = { outbound_paused: '1', delivery_window_start_jst: '8', delivery_window_end_jst: '21' };
  if (Object.entries(expected).some(([key,value]) => !settings.some(x => x.key === key && x.value === value))) throw new Error('Safety settings verification failed');
  const counts = await query('SELECT (SELECT COUNT(*) FROM ig_accounts) AS accounts, (SELECT COUNT(*) FROM followers) AS followers');
  if (Number(counts[0]?.accounts) !== 0 || Number(counts[0]?.followers) !== 0) throw new Error('Expected empty new installation');
  console.log('Verified: schema current; outbound paused; window 08:00–21:00 JST; zero accounts and followers.');
  console.log('No Worker deployment, Meta credentials, webhook changes, or messages were performed.');
} catch (error) {
  // Never print request headers, tokens, API bodies, or exception causes.
  console.error(error instanceof Error && !String(error.message).includes(token) ? error.message : 'Bootstrap failed; inspect safe operation logs.');
  process.exitCode = 1;
}
