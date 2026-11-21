-- Suppression only: inbound never grants consent or resumes delivery.
CREATE TABLE IF NOT EXISTS recruitment_inbound_holds (
  account_id TEXT NOT NULL REFERENCES ig_accounts(id),
  event_key TEXT NOT NULL,
  subject_hash TEXT,
  state TEXT NOT NULL CHECK(state IN ('consulting','stopped','declined','hold')),
  occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms>=0),
  recorded_at_ms INTEGER NOT NULL CHECK(recorded_at_ms>=occurred_at_ms),
  PRIMARY KEY(account_id,event_key)
);
CREATE INDEX IF NOT EXISTS idx_recruitment_inbound_subject ON recruitment_inbound_holds(account_id,subject_hash);
