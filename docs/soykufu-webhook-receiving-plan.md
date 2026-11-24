# SOY-KUFU stopped receiving preparation

Reviewed 2026-11-24. This is not permission to subscribe, add grants, install
credentials, change the serving backend, or release sending.

## Accepted baseline

- Registration run45323225017 saved exactly one fixed encrypted Page account;
  original provisioning USER-secret expiry is not evidence of its failure.
- Serving index SHA256 638363e607c2e642da2c5a35c342fab0ff355078e46a86855da6128b34bf4cd4;
  deployment fingerprint 66d2c1c0033633bf497964e2adaa2639ba1f02e37cc3afe91c667026f8340564.
- Stop=1, preparation lock=1, followers=0, all 41 migrations match. Existing
  DM/cycle/ledger04 and the LINE/PDF owners remain untouched.

## Concrete findings and source corrections

The old Worker app subscription check assumed active=true, parsed only named
field objects, merged Page/Instagram fields, and ignored incomplete pagination.
Regression cases reproduced 15 failures before the correction. The new check
accepts documented string fields or named objects, requires explicit activity,
keeps unknown/duplicate/incomplete states unverified, and never combines fields
from different objects to assert Instagram readiness. App credentials use a
header, redirects are refused, input is bounded, and raw errors/query-bearing
callback values are not exposed.

The old repair helper generated and stored a verify token, then posted an
Instagram subscription through /app/subscriptions. Meta explicitly says
Instagram setup belongs to the App Dashboard. The replacement observes only,
does not rotate a verify token, does not POST or overwrite any callback, and
returns manualSetupRequired for incomplete configuration. An already healthy
observation is unchanged. This source correction is not deployed yet.

Preparation lock now also holds processQueuedWebhooks before DB/drain work,
blocks background processing and scheduler arming in the ingress handler.
Verified durable queue ingestion/signature bookkeeping can still occur, but
queued events must remain pending while locked. The database pause remains an
independent stop. This correction is also source-only until a bounded backend
deployment is accepted.

## Read-only official receiving preflight

The existing workflow has a default-off receiving_preflight input. Its runner
uses existing provider/admin/app credentials only to GET runtime metadata,
the fixed registered account and app subscription observations. No provisioning
USER token is supplied. Output contains booleans and cached probe-state enums,
never credential values, raw errors, callback URLs or message contents. Native
bookmark movement is distinct from a configuration change. A cached missing
probe is not a fresh grant inspection or a demand for blanket reauthentication.

The five earlier checked grants do not establish all webhook prerequisites.
For Facebook Login Page subscription and Instagram conversations, official
documentation lists pages_manage_metadata. Comment/@mention functionality
also lists instagram_manage_comments and corresponding access-level/review
requirements. Verify the actual current grants and intended feature first;
do not claim a grant is absent merely because it was not in the five-scope
check. Do not add permissions under the earlier no-new-permission instruction.

## Bounded next execution scope for review

1. Accept the new backend artifact with old data/settings/assets/guard intact.
2. Prepare only the fixed account's encrypted App Secret and fresh verification
   credential, and resolve the fixed app ID from trustworthy metadata. No
   unrelated secret rotation, new app, worker, sender, or schedule.
3. Confirm actual permission/access-level prerequisites. Any grant expansion
   requires the owner's specific decision; never bypass Meta restrictions.
4. Configure only the correct app/Instagram object in the official Dashboard,
   using the existing worker's /webhook endpoint. Refuse a foreign callback.
   Complete handshake and observe the real fields/active state; HTTP 200 alone
   is insufficient. Do not automatically use unsupported repair endpoints.
5. Separately configure account/Page subscription only after authorization,
   using field names appropriate to that object. Do not copy the Instagram
   field list onto a Page or quietly activate comments when testing DM only.
6. Test signed internal ingress, foreign account rejection, invalid signature,
   durable one-time ingestion/retry deduplication, D1 failure non-2xx, and
   pending state with no follower creation, processing, LINE call or sending.
   Preserve stop/lock and the three disabled optional recruitment flags.

No step here establishes public production receiving, message delivery, or an
improved hiring rate. LINE real handoff, legacy identity/ownership migration,
guide delivery and actual visits remain separate acceptance conditions.

## Primary references

- https://developers.facebook.com/docs/graph-api/reference/app/subscriptions/
- https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-instagram/
- https://developers.facebook.com/docs/graph-api/reference/page/conversations/
