import { pathToFileURL } from 'node:url';

export const REQUIRED = Object.freeze(['business_management', 'instagram_basic', 'instagram_manage_messages', 'pages_read_engagement', 'pages_show_list']);
const PAGE = '1632563283635095';
const IG = '17841402028638204';
const ENDPOINTS = Object.freeze([
  `${PAGE}?fields=id,instagram_business_account{id,username}`,
  'me/permissions',
]);

// No raw response/error/URL/credential ever leaves this function. No token
// exchange, conversations, publishing, subscription, or persistence endpoint.
export async function verifyMeta(env, fetchImpl = fetch) {
  if (env.GITHUB_REPOSITORY !== 'soykufu/ig-harness-oss' || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch')
    return { ok: false, state: 'runtime_not_authorized' };
  const token = env.IG_META_USER_ACCESS_TOKEN;
  if (typeof token !== 'string' || !token.trim()) return { ok: false, state: 'secret_missing' };
  if (token !== token.trim() || /[\r\n]/.test(token)) return { ok: false, state: 'secret_invalid_format' };
  const bodies = [];
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetchImpl(`https://graph.facebook.com/v25.0/${endpoint}`, {
        method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return { ok: false, state: 'meta_http_error' };
      // Bound consumption before JSON decoding, including chunked responses.
      if (!response.body) return { ok: false, state: 'meta_invalid_response' };
      const reader = response.body.getReader();
      const chunks = []; let bytes = 0;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 65536) { await reader.cancel(); return { ok: false, state: 'meta_response_too_large' }; }
        chunks.push(value);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object' || data.error) return { ok: false, state: 'meta_invalid_response' };
      bodies.push(data);
    } catch { return { ok: false, state: 'meta_request_failed' }; }
  }
  const [page, permissions] = bodies;
  if (page.id !== PAGE || page.instagram_business_account?.id !== IG || page.instagram_business_account?.username !== 'soykufu')
    return { ok: false, state: 'account_mismatch' };
  if (!Array.isArray(permissions.data)) return { ok: false, state: 'permissions_invalid' };
  const missing = REQUIRED.filter(permission => {
    const rows = permissions.data.filter(row => row?.permission === permission);
    return rows.length !== 1 || rows[0].status !== 'granted';
  });
  return { ok: missing.length === 0, state: missing.length ? 'permissions_missing' : 'identity_and_grants_verified', missing, productionConnected: false, messagesSent: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let report;
  try { report = await verifyMeta(process.env); } catch { report = { ok: false, state: 'verification_failed' }; }
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
}
