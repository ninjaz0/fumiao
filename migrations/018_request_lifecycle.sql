ALTER TABLE jobs ADD COLUMN request_note text;
ALTER TABLE jobs ADD COLUMN request_retry_at timestamptz;
ALTER TABLE jobs ADD COLUMN request_uncertain boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD CONSTRAINT request_note_length CHECK (request_note IS NULL OR length(request_note)<=500);
CREATE INDEX jobs_request_retry ON jobs(request_retry_at) WHERE state='queued' AND request_retry_at IS NOT NULL;
