-- Plugin contribution contract v1: plugin-scoped settings and page action audit.
-- See docs/PLUGIN_EXTENSIBILITY.md.
CREATE TABLE studio_plugin_settings (
  plugin_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('global','workspace')),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  "values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  -- Package release whose schema validated "values".
  package_version text NOT NULL,
  -- Values before the last upgrade migration, restored by rollback.
  previous_values jsonb,
  previous_version text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'global') = (workspace_id IS NULL))
);
CREATE UNIQUE INDEX studio_plugin_settings_global
  ON studio_plugin_settings(plugin_id) WHERE scope = 'global';
CREATE UNIQUE INDEX studio_plugin_settings_workspace
  ON studio_plugin_settings(plugin_id, workspace_id) WHERE scope = 'workspace';

CREATE TABLE studio_plugin_audit (
  id bigserial PRIMARY KEY,
  plugin_id text NOT NULL,
  package_version text NOT NULL,
  page_id text NOT NULL,
  action_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('host','settings','program')),
  actor_id uuid NOT NULL REFERENCES users(id),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  target text,
  outcome text NOT NULL CHECK (outcome IN ('succeeded','rejected','failed')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_plugin_audit_plugin ON studio_plugin_audit(plugin_id, created_at DESC);
