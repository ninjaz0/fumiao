ALTER TABLE jobs
  ALTER COLUMN plugin_id DROP NOT NULL,
  ALTER COLUMN plugin_version DROP NOT NULL,
  ALTER COLUMN config_snapshot DROP NOT NULL,
  ADD COLUMN source_kind text NOT NULL DEFAULT 'plugin',
  ADD COLUMN route_revision_id uuid,
  ADD COLUMN price_revision_id uuid,
  ADD COLUMN native_snapshot jsonb,
  ADD COLUMN meter text,
  ADD FOREIGN KEY(catalog_id,kind,route_revision_id) REFERENCES model_access_route_revisions(catalog_id,purpose,id),
  ADD FOREIGN KEY(catalog_id,kind,price_revision_id) REFERENCES model_access_price_revisions(catalog_id,purpose,id),
  ADD CONSTRAINT jobs_execution_source CHECK (
    (source_kind='plugin' AND plugin_id IS NOT NULL AND plugin_version IS NOT NULL AND config_snapshot IS NOT NULL
     AND route_revision_id IS NULL AND price_revision_id IS NULL AND native_snapshot IS NULL AND meter IS NULL)
    OR (source_kind='builtin' AND plugin_id IS NULL AND plugin_version IS NULL AND config_snapshot IS NULL
     AND catalog_id IS NOT NULL AND route_revision_id IS NOT NULL AND price_revision_id IS NOT NULL
     AND native_snapshot IS NOT NULL AND meter IS NOT NULL AND ((kind='image' AND meter='images') OR (kind='video' AND meter='milliseconds')))
  );

-- Reserve private object identities before touching storage. A lost response
-- from storage or a restarted worker can safely overwrite the same staged key.
CREATE TABLE model_access_staging (
  job_id uuid NOT NULL REFERENCES jobs(id),
  output_index integer NOT NULL CHECK(output_index>=0),
  asset_id uuid NOT NULL UNIQUE,
  object_key text NOT NULL UNIQUE,
  metadata jsonb,
  size integer,
  PRIMARY KEY(job_id,output_index)
);
