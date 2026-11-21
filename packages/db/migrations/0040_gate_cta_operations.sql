-- Prepared CTA contracts only; no backfill or activation of legacy deliveries.
CREATE TABLE recruitment_gate_cta_operations (
 account_id TEXT NOT NULL,
 operation_key TEXT NOT NULL,
 event_key TEXT NOT NULL,
 delivery_id TEXT NOT NULL REFERENCES gate_deliveries(id) ON DELETE CASCADE,
 follower_id INTEGER NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
 mode TEXT NOT NULL CHECK(mode IN ('keyword','story','comment_resume')),
 definition_version TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 payload_version TEXT NOT NULL,
 expected_messages INTEGER NOT NULL,
 owner_epoch TEXT NOT NULL,
 claimed_at_ms INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('claimed','sent','uncertain')),
 PRIMARY KEY(account_id,operation_key),
 UNIQUE(account_id,delivery_id),
 UNIQUE(account_id,event_key)
);
