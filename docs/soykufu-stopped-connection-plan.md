# SOY-KUFU: stopped account registration and receiving preparation

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

## Verified starting point

- Production backend accepted once in run 45310176568; mutation entry retired.
- Deployment fingerprint: `693814e3519ac1d1521ab0fb40288043d18952cf32cbee232d784fa5f72ac145`.
- D1: 41 matching migrations, outbound stop=1, preparation lock=1, accounts=0,
  followers=0; independently checked in run 45310545013.
- Meta identity/grants already verified in run 45201509425. Existing GitHub
  `IG_META_USER_ACCESS_TOKEN` stays in the official runner. Do not ask the owner
  to authenticate or save this token again.

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
