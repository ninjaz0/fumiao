-- Wave 7: Workspace Script & Production Markdown Documents for Canvas × Script Fusion.
-- Strictly additive sidecar table; zero ALTER on core baseline tables.

CREATE TABLE IF NOT EXISTS workspace_script_documents (
  id UUID PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id),
  last_editor UUID REFERENCES users(id) ON DELETE SET NULL,
  series_id UUID REFERENCES series(id) ON DELETE SET NULL,
  canvas_project_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'file'
    CHECK (entry_type IN ('file', 'directory')),
  doc_kind TEXT NOT NULL DEFAULT 'script'
    CHECK (doc_kind IN ('outline', 'script', 'assets', 'shotlist', 'notes')),
  body_md TEXT NOT NULL DEFAULT '',
  revision INT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_script_docs_path
  ON workspace_script_documents (workspace_id, lower(path))
  WHERE NOT deleted;

CREATE INDEX IF NOT EXISTS idx_workspace_script_docs_ws
  ON workspace_script_documents (workspace_id, updated_at DESC)
  WHERE NOT deleted;
