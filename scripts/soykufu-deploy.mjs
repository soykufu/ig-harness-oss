import { writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const account = 'e76a3f504309ca9289d8dfa3ee504502';
const database = 'e55c3b84-ea9a-48fd-a7a3-08253089d295';
const name = 'soykufu-ig-harness-20261119';
const token = process.env.CLOUDFLARE_API_TOKEN;
const ownerKey = process.env.IG_HARNESS_API_KEY;
if (!token || !ownerKey || ownerKey.length < 20 || ownerKey === token) {
  throw new Error('Independent admin login key and Cloudflare credentials are required');
}
const privateValues = [token, ownerKey];
const safe = text => privateValues.reduce((v, secret) => v.split(secret).join('[REDACTED]'), String(text));
const cwd = fileURLToPath(new URL('../apps/worker/', import.meta.url));
const configName = 'wrangler.soykufu.json';
const configPath = `${cwd}${configName}`;
async function api(path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok || data.success !== true) throw new Error(`Cloudflare ${path}: HTTP ${response.status}, codes ${(data.errors ?? []).map(x => x.code).filter(Number.isInteger).join(',')}`);
  return data.result;
}
function wrangler(args, input) {
  const result = spawnSync('pnpm', ['exec','wrangler',...args], { cwd, env: process.env, input, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
  if (result.stdout) console.log(safe(result.stdout));
  if (result.stderr) console.error(safe(result.stderr));
  if (result.error || result.status !== 0) throw new Error(`Wrangler ${args[0]} failed; stop and inspect this run before retrying`);
}
async function verifyStopped() {
  const results = await api(`d1/database/${database}/query`, { sql: "SELECT (SELECT value FROM integration_settings WHERE key='outbound_paused') AS paused, (SELECT COUNT(*) FROM ig_accounts) AS accounts" });
  const state = results[0]?.results?.[0];
  if (state?.paused !== '1' || Number(state.accounts) !== 0) throw new Error('Expected stopped, unconnected installation; do not deploy automatically');
}
try {
  await verifyStopped();
  const databases = await api('d1/database?per_page=100');
  if (!databases.some(x => x.uuid === database && x.name === name)) throw new Error('Dedicated D1 identity mismatch');
  const buckets = await api('r2/buckets?per_page=100');
  if (!buckets.buckets?.some(x => x.name === name)) throw new Error('Dedicated R2 missing');
  const subdomain = await api('workers/subdomain');
  if (!/^[a-z0-9-]+$/.test(subdomain.subdomain ?? '')) throw new Error('Workers subdomain requires operator setup');
  const workerUrl = `https://${name}.${subdomain.subdomain}.workers.dev`;
  const scripts = await api('workers/scripts');
  const exists = scripts.some(x => x.id === name);
  const existingSecrets = exists ? await api(`workers/scripts/${name}/secrets`) : [];
  const secrets = { API_KEY: ownerKey };
  if (!existingSecrets.some(x => x.name === 'TOKEN_ENCRYPTION_KEY')) {
    secrets.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    privateValues.push(secrets.TOKEN_ENCRYPTION_KEY);
  }
  // One origin for UI and API avoids cross-site cookie trouble on iPhone.
  // No cron or scheduler binding until Meta and all delivery guards are tested.
  await writeFile(configPath, JSON.stringify({
    name, main: 'src/index.ts', compatibility_date: '2024-12-01', account_id: account,
    workers_dev: true, preview_urls: false,
    assets: { directory: '../web/out', binding: 'ASSETS', run_worker_first: true },
    d1_databases: [{ binding: 'DB', database_name: name, database_id: database }],
    r2_buckets: [{ binding: 'IMAGES', bucket_name: name }],
    vars: { WORKER_URL: workerUrl, ADMIN_ORIGIN: workerUrl, MESSAGES_RETENTION_DAYS: '0' },
    observability: { enabled: true },
  }), { mode: 0o600 });
  wrangler(['deploy','--keep-vars','--config',configName]);
  wrangler(['secret','bulk','--config',configName], JSON.stringify(secrets));
  const ui = await fetch(`${workerUrl}/login/`, { signal: AbortSignal.timeout(20000) });
  if (!ui.ok || !(ui.headers.get('content-type') ?? '').includes('text/html')) throw new Error('Login page verification failed');
  const unauthorized = await fetch(`${workerUrl}/api/health`, { signal: AbortSignal.timeout(20000) });
  if (unauthorized.status !== 401) throw new Error('Unauthenticated API access was not rejected');
  const health = await fetch(`${workerUrl}/api/health`, { headers: { Authorization: `Bearer ${ownerKey}` }, signal: AbortSignal.timeout(20000) });
  const healthBody = await health.json();
  if (!health.ok || healthBody.success !== true) throw new Error('Authenticated API health verification failed');
  await verifyStopped();
  console.log(`Admin URL: ${workerUrl}/login/`);
  console.log('Verified HTML login, API authentication, and stopped state. Meta is unconnected; cron disabled; no messages sent.');
} catch (error) {
  console.error(safe(error instanceof Error ? error.message : 'Deployment failed'));
  process.exitCode = 1;
} finally {
  await rm(configPath, { force: true });
}
