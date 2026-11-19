-- Existing markers and inserts from older workers may already have a PUT in flight.
ALTER TABLE storyboard_export_objects
 ADD COLUMN write_state text NOT NULL DEFAULT 'uncertain'
   CHECK (write_state IN ('unstarted','uncertain','settled')),
 ADD COLUMN cleanup_after timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN cleanup_token uuid,
 ADD COLUMN cleanup_attempts integer NOT NULL DEFAULT 0;

CREATE INDEX storyboard_export_objects_due
 ON storyboard_export_objects(cleanup_after, export_id);
