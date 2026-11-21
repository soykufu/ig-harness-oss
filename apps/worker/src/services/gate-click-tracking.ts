import {issueTrackingToken,type TrackingEnv} from '../lib/tracking-token.js';

/**
 * Build a click-tracking URL that records the tap in gate_clicks before
 * 302'ing to the real destination. `workerBaseUrl` is the public origin
 * of this worker (e.g. `https://ig-harness.noda-c40.workers.dev`); we get
 * it from env.WORKER_URL so the link works off the correct deployment.
 */
export async function wrapClickTracking(
  workerBaseUrl: string,
  gateId: string,
  destinationUrl: string,
  igsid?: string,
  env: TrackingEnv = {},
): Promise<string> {
  if (!destinationUrl || !/^https?:\/\//.test(destinationUrl)) return destinationUrl;
  // base64url encode the destination so it survives in a query param
  const b64 = btoa(encodeURIComponent(destinationUrl).replace(/%([0-9A-F]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  ))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const base = workerBaseUrl.replace(/\/$/, '');
  const token = igsid ? await issueTrackingToken(env, { purpose: 'gate', linkId: gateId, igsid, destination: destinationUrl }) : null;
  const igPart = token ? `&t=${encodeURIComponent(token)}` : '';
  return `${base}/click/${gateId}?u=${b64}${igPart}`;
}

