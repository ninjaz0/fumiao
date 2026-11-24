-- Wave 3: Asset derivatives (F038, excluded from 20 GiB user quota per Q2),
-- AssetPack lock & scope controls (F022), Series/Episodes tree (F026),
-- and job_projects sidecar (preserves core jobs table snapshot compatibility).

CREATE TABLE IF NOT EXISTS asset_derivatives (
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  variant TEXT NOT NULL CHECK (variant IN ('thumb', 'poster')),
  object_key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  width INT NOT NULL CHECK (width > 0),
  height INT NOT NULL CHECK (height > 0),
  size BIGINT NOT NULL CHECK (size >= 0),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, variant)
);
CREATE INDEX IF NOT EXISTS idx_asset_derivatives_pending
  ON asset_derivatives (state, created_at) WHERE state = 'pending';

ALTER TABLE asset_pack_meta
  ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'workspace' CHECK (scope IN ('workspace', 'global'));
CREATE INDEX IF NOT EXISTS idx_asset_pack_meta_scope
  ON asset_pack_meta (scope) WHERE scope = 'global';

CREATE TABLE IF NOT EXISTS series (
  id UUID PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  synopsis TEXT NOT NULL DEFAULT '',
  bible JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision INT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_series_workspace
  ON series (workspace_id, updated_at DESC) WHERE NOT deleted;

CREATE TABLE IF NOT EXISTS series_episodes (
  id UUID PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  season_no INT NOT NULL DEFAULT 1 CHECK (season_no >= 1),
  episode_no INT NOT NULL CHECK (episode_no >= 1),
  title TEXT NOT NULL,
  canvas_project_id UUID UNIQUE REFERENCES documents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'producing', 'review', 'done')),
  revision INT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (series_id, season_no, episode_no)
);
CREATE INDEX IF NOT EXISTS idx_series_episodes_series
  ON series_episodes (series_id, season_no, episode_no);

CREATE TABLE IF NOT EXISTS job_projects (
  job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_projects_project
  ON job_projects (project_id);
