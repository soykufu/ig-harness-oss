-- New immutable follow-up evidence only; never infer or backfill legacy sends.
CREATE TABLE recruitment_gate_followup_operations (
 account_id TEXT NOT NULL,
 operation_key TEXT NOT NULL,
 delivery_id TEXT NOT NULL REFERENCES gate_deliveries(id) ON DELETE CASCADE,
 follower_id INTEGER NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
 step_index INTEGER NOT NULL CHECK(step_index>=0),
 definition_version TEXT NOT NULL,
 payload_version TEXT,
 expected_messages INTEGER CHECK(expected_messages BETWEEN 1 AND 2),
 owner_epoch TEXT NOT NULL,
 claimed_at_ms INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('claimed','sent','uncertain')),
 PRIMARY KEY(account_id,operation_key),
 UNIQUE(account_id,delivery_id,step_index)
);
