-- Preserve existing IDs, names, triggers and active states.
ALTER TABLE scenarios ADD COLUMN description TEXT;
ALTER TABLE scenarios ADD COLUMN trigger_tag_id TEXT;
