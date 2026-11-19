CREATE TABLE legacy_records (
 source text NOT NULL, collection text NOT NULL, legacy_id text NOT NULL, workspace_id uuid REFERENCES workspaces,
 payload jsonb NOT NULL, PRIMARY KEY(source,collection,legacy_id)
);
CREATE TABLE legacy_imports (source text PRIMARY KEY, fingerprint text NOT NULL, completed_at timestamptz NOT NULL DEFAULT now());
