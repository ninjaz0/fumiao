-- json preserves valid JSON strings containing U+0000. JSONB cannot represent them.
-- No application encoding or sentinel: existing values and literal escapes retain
-- their meaning. These columns are consumed as whole JS values, not indexed JSONB.
ALTER TABLE jobs ALTER COLUMN input TYPE json USING input::json;
ALTER TABLE jobs ALTER COLUMN original_view TYPE json USING original_view::json;
ALTER TABLE jobs ALTER COLUMN reference_packs TYPE json USING reference_packs::json;
ALTER TABLE jobs ALTER COLUMN result TYPE json USING result::json;
ALTER TABLE jobs ALTER COLUMN receipt TYPE json USING receipt::json;
ALTER TABLE jobs ALTER COLUMN submission_forecast TYPE json USING submission_forecast::json;
ALTER TABLE legacy_records ALTER COLUMN payload TYPE json USING payload::json;
