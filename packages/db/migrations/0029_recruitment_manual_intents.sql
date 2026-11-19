CREATE TABLE IF NOT EXISTS recruitment_manual_intents (
  account_id TEXT NOT NULL REFERENCES ig_accounts(id),
  operation_key TEXT NOT NULL,
  follower_id INTEGER NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
  body_hash TEXT NOT NULL,
  owner_epoch TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed','sent','uncertain')),
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(account_id,operation_key)
);
