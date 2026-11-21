-- Add fields already referenced by the step editor and delivery code.
-- Existing steps keep NULL conditions and their current execution order.
ALTER TABLE scenario_steps ADD COLUMN condition_type TEXT;
ALTER TABLE scenario_steps ADD COLUMN condition_value TEXT;
ALTER TABLE scenario_steps ADD COLUMN next_step_on_false INTEGER;
