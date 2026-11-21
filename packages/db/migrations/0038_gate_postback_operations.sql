-- Preparation only: one receipt per verified inbound event and durable gate phase.
CREATE TABLE recruitment_gate_operations (
 account_id TEXT NOT NULL,
 operation_key TEXT NOT NULL,
 event_key TEXT NOT NULL,
 delivery_id TEXT NOT NULL REFERENCES gate_deliveries(id) ON DELETE CASCADE,
 follower_id INTEGER NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
 phase TEXT NOT NULL CHECK(phase IN ('reward','reminder')),
 loop_count INTEGER NOT NULL,
 definition_version TEXT NOT NULL,
 payload_version TEXT,
 owner_epoch TEXT NOT NULL,
 claimed_at_ms INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('claimed','sent','uncertain','skipped')),
 PRIMARY KEY(account_id,operation_key),
 UNIQUE(account_id,event_key)
);
