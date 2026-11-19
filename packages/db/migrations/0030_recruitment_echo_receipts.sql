-- Only signature-verified webhook ingestion writes this evidence table.
-- Existing mixed-source observations intentionally remain unclassified.
CREATE TABLE IF NOT EXISTS recruitment_echo_receipts (
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sent_at_ms INTEGER NOT NULL CHECK (sent_at_ms >= 0),
  first_received_at_ms INTEGER NOT NULL CHECK (first_received_at_ms >= sent_at_ms),
  last_received_at_ms INTEGER NOT NULL CHECK (last_received_at_ms >= first_received_at_ms),
  PRIMARY KEY (account_id, message_id),
  FOREIGN KEY (account_id, message_id) REFERENCES recruitment_outbound_observations(account_id, message_id) ON DELETE CASCADE
);
