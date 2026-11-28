ALTER TABLE studio_catalog
  ALTER COLUMN plugin_id DROP NOT NULL,
  ALTER COLUMN plugin_version DROP NOT NULL,
  ADD COLUMN source_kind text NOT NULL DEFAULT 'plugin',
  ADD COLUMN adopted_from_plugin text,
  ADD CONSTRAINT studio_catalog_source CHECK (
    (source_kind='plugin' AND plugin_id IS NOT NULL AND plugin_version IS NOT NULL AND adopted_from_plugin IS NULL) OR
    (source_kind='builtin' AND plugin_id IS NULL AND plugin_version IS NULL)
  );
ALTER TABLE model_access_connection_revisions ADD UNIQUE(id,connection_id);
ALTER TABLE models ADD UNIQUE(id,connection_id,provider_model,catalog_id);
CREATE TABLE model_access_reused_connections (
  connection_id uuid PRIMARY KEY REFERENCES connections,
  original_id uuid NOT NULL REFERENCES connections,
  original_revision integer NOT NULL CHECK(original_revision>0),
  original_models jsonb NOT NULL
);
CREATE TABLE model_access_route_revisions (
  id uuid PRIMARY KEY,
  catalog_id text NOT NULL REFERENCES studio_catalog,
  model_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  upstream_id text NOT NULL,
  connection_revision_id uuid NOT NULL,
  draft_id uuid NOT NULL REFERENCES model_access_drafts,
  draft_revision integer NOT NULL CHECK(draft_revision>0),
  purpose text NOT NULL CHECK(purpose IN ('chat','image','video')),
  protocol text NOT NULL CHECK(
    (purpose='chat' AND protocol='openai-chat') OR
    (purpose='image' AND protocol IN ('openai-images','openrouter-images')) OR
    (purpose='video' AND protocol IN ('new-api-videos','openrouter-videos'))
  ),
  executor_version integer NOT NULL CHECK(executor_version=1),
  capabilities jsonb NOT NULL,
  FOREIGN KEY(connection_revision_id,connection_id) REFERENCES model_access_connection_revisions(id,connection_id),
  FOREIGN KEY(model_id,connection_id,upstream_id,catalog_id) REFERENCES models(id,connection_id,provider_model,catalog_id),
  UNIQUE(draft_id,draft_revision),
  UNIQUE(catalog_id,purpose,id)
);
CREATE TABLE model_access_price_revisions (
  id uuid PRIMARY KEY,
  catalog_id text NOT NULL REFERENCES studio_catalog,
  purpose text NOT NULL CHECK(purpose IN ('chat','image','video')),
  unit numeric(25,6) CHECK(unit>=0),
  input numeric(25,6) CHECK(input>=0),
  output numeric(25,6) CHECK(output>=0),
  cache_read numeric(25,6) CHECK(cache_read>=0),
  cache_write numeric(25,6) CHECK(cache_write>=0),
  CHECK((purpose='chat' AND input IS NOT NULL AND output IS NOT NULL AND unit IS NULL)
     OR (purpose<>'chat' AND unit IS NOT NULL AND input IS NULL AND output IS NULL AND cache_read IS NULL AND cache_write IS NULL)),
  UNIQUE(catalog_id,purpose,id)
);
CREATE TABLE model_access_publications (
  catalog_id text PRIMARY KEY REFERENCES studio_catalog,
  revision integer NOT NULL CHECK(revision>0),
  purpose text NOT NULL,
  route_revision_id uuid NOT NULL,
  price_revision_id uuid NOT NULL,
  FOREIGN KEY(catalog_id,purpose,route_revision_id) REFERENCES model_access_route_revisions(catalog_id,purpose,id),
  FOREIGN KEY(catalog_id,purpose,price_revision_id) REFERENCES model_access_price_revisions(catalog_id,purpose,id)
);
CREATE TABLE model_access_publication_receipts (
  uid uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users,
  request jsonb NOT NULL,
  result jsonb NOT NULL
);
CREATE TRIGGER immutable_model_access_route BEFORE UPDATE OR DELETE ON model_access_route_revisions
  FOR EACH ROW EXECUTE FUNCTION model_access_immutable_revision();
CREATE TRIGGER immutable_model_access_price BEFORE UPDATE OR DELETE ON model_access_price_revisions
  FOR EACH ROW EXECUTE FUNCTION model_access_immutable_revision();
