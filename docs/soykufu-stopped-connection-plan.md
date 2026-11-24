# SOY-KUFU: stopped account registration and receiving preparation

## Current accepted production state (2026-11-24)

Owner-approved backend update run45322776381 passed full content/settings/
business-row/assets/private-route acceptance. Accepted index.js SHA256:
638363e607c2e642da2c5a35c342fab0ff355078e46a86855da6128b34bf4cd4.
Deployment fingerprint:
66d2c1c0033633bf497964e2adaa2639ba1f02e37cc3afe91c667026f8340564.

One-time server-side exchange and stopped registration run45323225017 passed:
same USER subject/app/full scopes/granular targets, longer validated lifetime,
fixed Page/IG/grants, exactly one encrypted nondefault account, unchanged old
business rows/configuration/subscriptions, stop/lock and DB integrity. The
user-token lifetime gate was more than seven and at most 61 days, not an
export of an exact expiration date. The derived Page credential is encrypted
in the designated D1; the intermediate long-lived USER value was not exported.

Both approvals are consumed. The new transport CLI and workflow choices are
retired; do not repeat either run or resurrect the retired transport.
`STOPPED_REGISTERED_PHASE=1` is an official-runner read-only observation mode,
not a production flag or release permission. It requires the exact fixed
encrypted account and still verifies stop, empty followers and all 41 schema
entries. Default installation inspection retains its original empty-only
contract for pre-registration operations.

GitHub's provisioning USER secret was not automatically rewritten. Its later
expiry does not prove the separately stored Page credential is invalid and
must not trigger blanket reauthentication. Use the stored account's own health
evidence when assessing operational token failure. No webhook subscription,
verified receiving, sending, LINE handoff, or legacy ownership migration has
been enabled. Worker app secret/verify token/app ID remain separate receiving
prerequisites. The source below records the earlier preparation contract.

This is a review plan, not execution permission. No account registration,
webhook subscription, credential installation, or message dispatch occurs.

## Read-only Meta app inspection entry

The existing `soykufu-smoke.yml` workflow has an explicit, default-off
`app_webhook_readonly` input. It reads only app `2224712165014101` identity and
its subscription list, using `IG_META_APP_SECRET` inside the official runner.
It does not receive the user token, administrator key or Cloudflare token in
that step. Headers carry the app credential, redirects are rejected, responses
are bounded, and raw values/errors/callback URLs are never printed. Missing
secret means hold, not a new authentication attempt or retry.

If needed, the owner saves the **App Secret of Meta app 2224712165014101** in
the existing repository's Actions secret `IG_META_APP_SECRET`. This is distinct
from the existing user access token and the 64-hex database backup key. Never
paste it into chat, a workflow input, command, document or public repository.
The read-only inspection does not install it into the Worker, authorize such
installation, generate a verify token, or activate either app/account webhook.

Official endpoint references (reviewed 2026-11-24):
- https://developers.facebook.com/docs/graph-api/reference/app/subscriptions/
- https://developers.facebook.com/docs/graph-api/reference/application/

Subscription `fields` may be documented strings or named objects in current
SDK responses; inspect both. Report active=false/unknown, foreign callbacks,
duplicate objects and incomplete pagination without merging them into success.

## Historical verified starting point before registration

- Production backend accepted once in run 45310176568; mutation entry retired.
- Deployment fingerprint: `693814e3519ac1d1521ab0fb40288043d18952cf32cbee232d784fa5f72ac145`.
- D1: 41 matching migrations, outbound stop=1, preparation lock=1, accounts=0,
  followers=0; independently checked in run 45310545013.
- Meta identity/grants verified in run 45201509425. A later observed expiry in
  run 45315421035 was resolved by the owner's existing-secret update. New run
  45319413768 verified the same app, validity, fixed Page/IG and five grants.
  `IG_META_USER_ACCESS_TOKEN` stays in the official runner. Do not repeat that
  completed update without new evidence of invalidation.

## Distinct phases

1. Read-only preparation: inspect deployed binding metadata and stopped schema.
   The normal smoke run now reports `Stopped connection readiness`. The report
   contains only booleans, fixed identifiers, and reason codes. Credential
   presence does not establish its validity, correct app, or successful receiving.
2. Limited account registration: requires a concrete authorized execution scope.
   Use `connectionType=facebook_login`, expected IG `17841402028638204`, username
   `soykufu`, Page `1632563283635095`, and **`subscribeWebhooks=false`** explicitly.
   The endpoint defaults to true if omitted. Do not use the browser form or a
   default POST body as a substitute for this limited scope.
3. Webhook receiving: separately requires the correct app secret/verify token,
   app callback and account subscriptions, and an internal receiving acceptance
   test. Existing app ID is `2224712165014101`; verify it against the selected
   credential before installation. Do not generate a new app or expand permissions.
4. Sending/LINE handoff: still requires real-message acceptance, identity links,
   business-state reconciliation and its own release decision. Phase 2 or 3
   cannot release outbound stop or preparation lock.

## Registration side effects to account for before execution

The accepted production backend now guards `ensureDefaultAccount` at entry while
`OUTBOUND_PREPARATION_LOCK=1`. Lazy account reads cannot seed environment
credentials, backfill legacy NULL ownership, or stamp account_backfill_done
while this lock remains. Its backend acceptance is run45322776381. Releasing the lock
would restore normal legacy behavior, so reconcile ownership before release.

Read `apps/worker/src/routes/accounts.ts`, `lib/validate-ig-account.ts`, and
`lib/account-connection.ts` at the exact reviewed commit before preparing an
executor. The POST validates the token, discovers the linked Page token, saves
an encrypted token in D1, records token validity, and runs a connection check.
Even with subscribe=false, it performs read probes (profile, subscribed fields,
conversations and media/comment permission) and persists a health report or
delivery-failure record. Do not describe this as a DB-free or external-read-free
operation. Do not log the masked token suffix returned by the API either.

- Require the fixed identity and Page match again in the official runner.
- Preserve every existing setting, UI asset, image, key, stop and lock.
- Reject unexpected existing accounts; do not PATCH, delete, or replace them.
- Compare before/after state and distinguish expected new registration/health
  rows from other business data. A successful POST alone is not acceptance.
- A network timeout after POST means outcome unknown: inspect D1/API state
  before any next action. Never retry POST or delete the row automatically.
- Account-active state is not permission to send. Enforce stop and lock.
- Do not run `/fix-app-webhook` or `/subscribe-webhooks` in this phase.
- No new backup/export, restore, migration, deployment, cron, scheduler, or UI.

## Receiving acceptance boundaries

Unsigned/invalid signatures must be rejected. A valid signed internal event
must belong to this account, persist once, and deduplicate retries. Stop must
leave it pending without processing/sending; an accepted HTTP 200 alone cannot
prove these conditions. Read the durable queue and exact event key, do not copy
private message text into reports. Keep echo and inbound-suppression feature
flags disabled under the existing instructions. No old 839-person outreach.

Read-only readiness intentionally preserves `registrationAuthorized=false`,
`webhookActivationAuthorized=false`, and `messagesAuthorized=false` even when
all metadata exists. It does not overwrite prior native-restore or encrypted
backup evidence and does not grant a broad deployment permission.

## Saved credential pairing (read-only)

After app identity inspection, use the explicit default-off `meta_pair_readonly`
input in the same workflow. It consumes both saved credentials only in that
step and calls the fixed Meta `/v25.0/debug_token` once. The documented
`input_token` query contains the inspected token only on the runner-to-Meta
request; never log the URL or transport error. The app credential remains in
the Authorization header. A matching app ID, is_valid=true, the five required
scopes, and non-expired observed timestamps are checked. Zero/missing expiry
is unknown lifetime, not permanent validity. Report only reason codes,
booleans and required missing scope names. No user ID, raw dates, token suffix,
page data or credential values leave the check. It does not recheck the target
Page/IG asset and does not install credentials or register an account.

Official reference reviewed 2026-11-24:
https://developers.facebook.com/docs/graph-api/reference/debug_token/

App Secret saving and app inspection completed in official run45314455517:
appIdentityVerified=true, listingIncomplete=false, objects=[]; no subscriptions
were activated. Do not ask for the same App Secret again. The user-token
expiry was separately resolved and verified in run 45319413768.

## Token lifecycle and prospective replacement validation

Run 45319413768 reported tokenExpiryWithin7Days=true, not permanent validity.
Meta's server-side Facebook Login exchange can produce a user token lasting
about 60 days; it requires a currently valid user token. Do not apply the
Instagram Login refresh endpoint or system-user rotation to this connection.
Reference reviewed 2026-11-24:
https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived

`assessMetaTokenLifecycle` now classifies fresh debug metadata inside the
official pair check. It returns safe lifetime bands only. Unknown/zero expiry,
non-USER token, invalid identity/scopes, expired access, and a remaining window
of 15 minutes or less hold exchange review. A token beyond seven days requires
monitoring, not an immediate exchange. No network or mutation is added.

`assessMetaTokenReplacement` is a pure pre-storage gate for a future executor.
It compares the original and prospective token's private subject internally,
exact full scopes, and exact granular target sets (order independent). Missing
target metadata is unknown, not equivalent to an empty list. It requires a
strictly improved lifetime beyond seven and at most 61 days, unchanged data
access lifetime with more than seven days remaining, and the same valid USER
app identity. Outputs never include tokens, subjects, target IDs or raw dates.
Even success keeps storageAuthorized/registrationAuthorized=false.

The future execution scope must be authorized separately: one server-side
exchange for app2224712165014101 in the existing official runner, same scopes
and fixed Page/IG, followed by validation before encrypted persistence. The
current code has **no exchange transport, storage sink, new workflow input,
credential write, account registration, subscription or release**. Do not
call the pure gate an implemented rotation service or an unattended lifetime
guarantee. Security events can invalidate a token before its expected expiry.

Before persistence, require a fresh direct metadata recheck, then re-read the
fixed Page/IG and grants using the candidate. Never pass a raw token through a
workflow input/output, artifact, chat or log. Keep the old credential intact
until acceptance; do not revoke it or retry an unknown mutation outcome.
Registration still needs the explicit subscribeWebhooks=false contract and
business-row/backfill safeguards above. A future server-side exchange must
not quietly rewrite the GitHub secret or use its own success as storage consent.
