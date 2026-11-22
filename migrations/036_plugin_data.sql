-- Host capability `data`: a key-value store owned by one plugin.
-- Plugins never create tables; removal deletes their rows.
CREATE TABLE studio_plugin_data (
  plugin_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('global','workspace')),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
  value jsonb NOT NULL,
  bytes integer NOT NULL CHECK (bytes >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'global') = (workspace_id IS NULL))
);
CREATE UNIQUE INDEX studio_plugin_data_global
  ON studio_plugin_data(plugin_id, key) WHERE scope = 'global';
CREATE UNIQUE INDEX studio_plugin_data_workspace
  ON studio_plugin_data(plugin_id, workspace_id, key) WHERE scope = 'workspace';
