-- Opt-in recruitment receipts: a replay never reruns profile/enrollment/send
-- effects. Unverified public identity hints only create a held receipt.
ALTER TABLE form_submissions ADD COLUMN request_key TEXT;
ALTER TABLE form_submissions ADD COLUMN request_hash TEXT;
ALTER TABLE form_submissions ADD COLUMN side_effect_state TEXT NOT NULL DEFAULT 'legacy' CHECK(side_effect_state IN ('legacy','held'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_form_submission_request ON form_submissions(form_id,request_key);
