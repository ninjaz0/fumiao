ALTER TABLE connections
  ADD COLUMN source_kind text NOT NULL DEFAULT 'plugin',
  ALTER COLUMN plugin_id DROP NOT NULL,
  ALTER COLUMN plugin_version DROP NOT NULL,
  ADD CONSTRAINT connections_source CHECK (
    (source_kind='plugin' AND plugin_id IS NOT NULL AND plugin_version IS NOT NULL) OR
    (source_kind='builtin' AND plugin_id IS NULL AND plugin_version IS NULL AND NOT fmworker_resource_driver)
  ),
  ADD UNIQUE (id, source_kind);

CREATE TABLE model_access_connection_revisions (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL,
  source_kind text NOT NULL DEFAULT 'builtin' CHECK (source_kind='builtin'),
  revision integer NOT NULL CHECK (revision > 0),
  config text NOT NULL,
  credential_scope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (connection_id, source_kind) REFERENCES connections(id, source_kind),
  UNIQUE (connection_id, revision)
);
CREATE FUNCTION model_access_immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Model access revisions are immutable';
END $$;
CREATE TRIGGER immutable_model_access_connection BEFORE UPDATE OR DELETE ON model_access_connection_revisions
  FOR EACH ROW EXECUTE FUNCTION model_access_immutable_revision();

CREATE TABLE model_access_discoveries (
  connection_revision_id uuid PRIMARY KEY REFERENCES model_access_connection_revisions,
  revision integer NOT NULL CHECK (revision > 0),
  directories jsonb NOT NULL,
  snapshots jsonb NOT NULL,
  candidates jsonb NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_access_drafts (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL,
  connection_revision integer NOT NULL,
  upstream_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  selection jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (connection_id, connection_revision) REFERENCES model_access_connection_revisions(connection_id, revision),
  UNIQUE (connection_id, upstream_id)
);
