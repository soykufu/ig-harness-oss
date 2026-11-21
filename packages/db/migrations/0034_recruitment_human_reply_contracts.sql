-- One reviewed reply only; never a subscription or automatic-send grant.
CREATE TABLE IF NOT EXISTS recruitment_human_reply_contracts (
 account_id TEXT NOT NULL REFERENCES ig_accounts(id),
 operation_key TEXT NOT NULL,
 follower_id INTEGER NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL REFERENCES staff_members(id),
 body_hash TEXT NOT NULL,
 inbound_hash TEXT NOT NULL,
 owner_epoch TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('prepared','claimed','sent','uncertain')),
 created_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 PRIMARY KEY(account_id,operation_key)
);
