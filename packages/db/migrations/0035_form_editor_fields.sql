-- Add missing editor fields without changing existing form/submission IDs,
-- respondent foreign keys, answer JSON or the original submission timestamp.
ALTER TABLE forms ADD COLUMN description TEXT;
ALTER TABLE forms ADD COLUMN on_submit_tag_id INTEGER REFERENCES tags(id);
ALTER TABLE forms ADD COLUMN on_submit_scenario_id INTEGER REFERENCES scenarios(id);
ALTER TABLE forms ADD COLUMN on_submit_message_type TEXT;
ALTER TABLE forms ADD COLUMN on_submit_message_content TEXT;
ALTER TABLE forms ADD COLUMN save_to_metadata INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forms ADD COLUMN submit_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forms ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE forms SET submit_count=(SELECT COUNT(*) FROM form_submissions s WHERE s.form_id=forms.id);
