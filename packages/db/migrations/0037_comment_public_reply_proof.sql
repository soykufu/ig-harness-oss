-- Additive local preparation only. Legacy public outcomes remain unverified.
ALTER TABLE comment_rule_jobs ADD COLUMN public_reply_plan_hash TEXT;
ALTER TABLE comment_rule_jobs ADD COLUMN public_reply_owner_epoch TEXT;
ALTER TABLE comment_rule_jobs ADD COLUMN public_reply_claimed_at TEXT;
