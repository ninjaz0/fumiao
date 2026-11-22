CREATE TABLE canvas_plugin_runs (
  project_id uuid NOT NULL REFERENCES canvas_documents ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users,
  uid uuid NOT NULL,
  node text NOT NULL,
  expected_revision integer NOT NULL,
  plugin_id text NOT NULL,
  package_version text NOT NULL,
  inputs bytea NOT NULL,
  parameters bytea NOT NULL,
  outputs bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id,owner_id,uid)
);
