# Recovery namespace protection candidate

Status: protection applied and accepted in official run 45303824595, followed
by the approved encrypted DB copy in run 45304780947. Both one-time approvals
are consumed. Current CLI/workflow write entrypoints are retired.

Original module and existing settings/DB were preserved. Private GET/HEAD/Range/
encoded paths and gallery checks passed; normal media and Range passed; test
objects were removed. New deployment fingerprint:
`f7e412a0dbb7360d2cf7db15c74908a039472c14bc34217cb06ce1cb2d4e9112`.

The encrypted copy was read back, authenticated/decrypted and restored into an
isolated SQLite DB with all 37 tables and complete row contents matched. This
is not a production D1 restore, migration, connection or sending authorization.

The candidate and preconditions below document the executed scope; they are not
a fresh permission to repeat it.

## Observed baseline

Official preflight run 45301346095 inspected the stopped deployed Worker:

- Script: `soykufu-ig-harness-20261119` in account `e76a3f504309ca9289d8dfa3ee504502`.
- Deployment fingerprint: `483673d06f50743aae1b8e966d00e1bedc1f192472ea577efd234eb9d0ef2de1`.
- Single module/entrypoint: `index.js`, MIME `application/javascript+module`.
- Original module SHA256: `6624a33372e212b3d8a796b9eb77fd7183456651517d802cce10fdb434cab685`.
- Canonical bundle SHA256: `3398f41a1ba366e90f88366242c746157bfc090728d345c1dd42d12be4cca94f`.
- Direct R2 public access disabled. Worker proxy privacy not yet demonstrated.
- Dedicated backup key present and format valid. No value printed or read out.

## Exact intended code change

Keep the observed `index.js` bytes unchanged; add the repository's
`scripts/recovery-bucket-guard.mjs` as an ES module and use the following new
entrypoint `backup-guard.js`:

```js
import original from './index.js';
import {wrapRecoveryGuard} from './recovery-bucket-guard.mjs';
export * from './index.js';
export default wrapRecoveryGuard(original);
```

The wrapper replaces only the IMAGES binding presented to the original fetch
handler. It hides reserved reads/head/list entries, and refuses reserved
put/delete/multipart operations before accessing R2. Reserved keys include the
root `__private_recovery__`, its descendants and percent-encoded variants.
Normal media operations retain their receiver, options and return values.
All other environment bindings and the original handler/context are retained.
Non-fetch handlers are preserved, not newly enabled. This is not evidence about
unobserved alternative storage access or an assertion that live privacy passed.

## Preconditions for a separately authorized protection-only change

1. Read and reconcile the current deployment, exact module bytes, metadata and
   settings. Require this fingerprint and original module hash. Any change holds
   execution for review; no blind overwrite. Reject unrecognized metadata or
   unsupported entrypoint/exports instead of guessing upload fields.
2. Build the candidate in the official runner without emitting the original
   module, secrets or bindings. Preserve bindings, secrets, assets, compatibility
   settings, routes and trigger settings exactly. Do not run the repository's
   broader Worker build/deploy or any migration.
3. Retain the current version identifier and original module bytes as rollback
   evidence. A rollback is an additional production mutation, not an automatic
   retry or use of the consumed D1 restore permission.
4. Explicitly authorize only this existing Worker's protection change. The DB
   copy approval alone does not authorize the change. No DB mutation, new Worker,
   public-domain change, secret replacement, webhook subscription or sending.
5. Reconcile the actual deployment response and version before any retry. If the
   result is unknown, stop mutations and inspect the current version.
6. Re-read the deployed modules/settings and stopped runtime. Require unchanged
   original module, exact guard modules, send stop=1, preparation lock=1,
   no connection, and unchanged DB schema/business counts/migration ledger.

## Live acceptance before any real DB copy

Synthetic unit tests are necessary but insufficient. First verify with a
non-sensitive canary that the reserved storage key is absent through ordinary
GET/HEAD, encoded paths and gallery/list APIs; separately verify ordinary media
still works and cannot overwrite/delete a reserved key. A canary write/removal
must be explicitly included in the protection verification scope and must not
touch any existing object. Readback of the deployed code alone is not acceptance.

If privacy or normal-media acceptance fails or is unknown, keep export and R2 DB
write blocked. After acceptance, resume the already approved single encrypted
copy workflow, bind its receipt to the observed protected version and compare
the isolated restore's complete row contents. Backup verification never grants
migration, connection, sending or broader deployment permission.
