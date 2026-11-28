-- Native admissions retain their business identity after removal. For databases
-- that already contain a deleted-and-replayed UID, the first acceptance owns it.
CREATE TABLE model_access_job_uids (
  uid text PRIMARY KEY,
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id)
);
INSERT INTO model_access_job_uids(uid,job_id)
  SELECT DISTINCT ON (original_uid) original_uid,id FROM jobs
  WHERE source_kind='builtin' AND original_uid IS NOT NULL
  ORDER BY original_uid,public_id;

CREATE TABLE model_access_submissions (
  job_id uuid PRIMARY KEY REFERENCES jobs(id),
  started_at timestamptz NOT NULL DEFAULT now()
);
-- A 060 worker may have sent an in-flight POST without preserving a receipt.
INSERT INTO model_access_submissions(job_id)
  SELECT id FROM jobs WHERE source_kind='builtin' AND state='dispatching' AND receipt IS NULL;

-- Inline bytes are spooled one image at a time. Settlement (including manual
-- refund) drops all parts atomically; live receipts contain only their indexes.
CREATE TABLE model_access_image_parts (
  job_id uuid NOT NULL REFERENCES jobs(id),
  output_index integer NOT NULL CHECK(output_index BETWEEN 0 AND 15),
  bytes bytea NOT NULL CHECK(octet_length(bytes) <= 67108864),
  PRIMARY KEY(job_id,output_index)
);
CREATE FUNCTION release_model_access_image_parts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM model_access_image_parts WHERE job_id=NEW.id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER release_image_parts AFTER UPDATE OF state ON jobs FOR EACH ROW
 WHEN (NEW.source_kind='builtin' AND NEW.state IN ('cancelled','failed','completed'))
 EXECUTE FUNCTION release_model_access_image_parts();
