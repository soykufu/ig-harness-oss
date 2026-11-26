# Fixed Page subscription observation

The existing SOY-KUFU stopped-admin workflow has a default-off `page_subscription_readonly` input. It uses the already saved USER/app credentials exclusively inside the official runner. It first rechecks the fixed app and permission metadata, obtains the fixed Page's existing token through a bounded GET, and reads only that Page's subscribed-app list. It never exchanges, persists or rotates credentials, subscribes, sends, or changes the serving Worker. The stored long-lived Page account remains untouched; an expired diagnostic USER does not imply that the stored Page token failed.

The accepted deployed fingerprint, preparation lock and fixed registered account are checked before and after observation. Complete listing, matching app ID, distinct Page field names and exact account ownership are required; unrelated apps cannot supply missing fields. Incomplete pagination and raw provider errors remain unverified, with no automatic retry or returned URL follow-up. A missing `pages_manage_metadata` grant is an observation for the owner, never permission to expand access. Only fixed boolean/status fields leave the runner; Page token values, incoming messages, recipients and response bodies never do.

Run with only this input plus the existing read-only receiving audit/preflight as needed. A successful observation is not an actual receiving test or permission to activate sending. Preserve stop/lock, old CRM/ledger04, LINE and guide owners. Never re-run consumed mutation operations.

Sources: https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/ ; https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-instagram/ .

