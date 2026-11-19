-- The shared document title and body remain compatible with existing rows and
-- JSONB consumers. Pack text containing NUL is stored as a whole JSON value.
ALTER TABLE documents ADD COLUMN pack_text json CHECK (pack_text IS NULL OR kind = 'pack');
