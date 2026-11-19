-- Preparation only: no transport, scheduler or ownership cutover is enabled.
-- Reconciliation must be attested separately after legacy/manual coverage tests.
CREATE TABLE IF NOT EXISTS recruitment_outbound_control (
  account_id TEXT PRIMARY KEY REFERENCES ig_accounts(id),
  owner_epoch TEXT NOT NULL,
  owner TEXT NOT NULL CHECK (owner IN ('legacy','harness')),
  reconciled_at_ms INTEGER NOT NULL CHECK (reconciled_at_ms >= 0)
);
CREATE TABLE IF NOT EXISTS recruitment_outbound_operations (
  account_id TEXT NOT NULL REFERENCES ig_accounts(id),
  operation_key TEXT NOT NULL,
  owner_epoch TEXT NOT NULL,
  reserved_at_ms INTEGER NOT NULL CHECK (reserved_at_ms >= 0),
  state TEXT NOT NULL CHECK (state IN ('reserved','uncertain','sent')),
  message_id TEXT,
  PRIMARY KEY (account_id, operation_key),
  UNIQUE (account_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_recruitment_outbound_operations_time
  ON recruitment_outbound_operations(account_id, reserved_at_ms);
CREATE TABLE IF NOT EXISTS recruitment_outbound_observations (
  account_id TEXT NOT NULL REFERENCES ig_accounts(id),
  message_id TEXT NOT NULL,
  sent_at_ms INTEGER NOT NULL CHECK (sent_at_ms >= 0),
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= sent_at_ms),
  PRIMARY KEY (account_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_recruitment_outbound_observations_time
  ON recruitment_outbound_observations(account_id, sent_at_ms);
