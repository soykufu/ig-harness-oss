-- Preserve old receipts as unverified; never infer historical block counts.
ALTER TABLE recruitment_gate_operations ADD COLUMN expected_messages INTEGER;
