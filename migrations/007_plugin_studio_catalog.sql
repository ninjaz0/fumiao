CREATE TABLE studio_catalog(
 id text PRIMARY KEY, plugin_id text NOT NULL, plugin_version text NOT NULL,
 descriptor jsonb NOT NULL, runtime jsonb NOT NULL DEFAULT '{}', position integer NOT NULL,
 price_position integer NOT NULL, hidden boolean NOT NULL DEFAULT false, hidden_override boolean NOT NULL DEFAULT false,
 FOREIGN KEY(plugin_id,plugin_version) REFERENCES plugin_versions
);
CREATE TABLE studio_prices(
 key text PRIMARY KEY, model_id text NOT NULL REFERENCES studio_catalog, tier text NOT NULL,
 label text NOT NULL, position integer NOT NULL, matcher jsonb NOT NULL,
 amount bigint CHECK(amount BETWEEN 1 AND 1000000000), UNIQUE(model_id,tier)
);
CREATE TABLE studio_policy(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),revision integer NOT NULL DEFAULT 1,flags jsonb NOT NULL DEFAULT '{}',price_revision integer NOT NULL DEFAULT 1);
INSERT INTO studio_policy DEFAULT VALUES;
CREATE TABLE studio_workspace_policy(workspace_id uuid PRIMARY KEY REFERENCES workspaces,revision integer NOT NULL,flags jsonb NOT NULL);
ALTER TABLE models ADD COLUMN catalog_id text REFERENCES studio_catalog;
ALTER TABLE jobs ADD COLUMN catalog_id text REFERENCES studio_catalog;
ALTER TABLE jobs ADD COLUMN price_key text;
ALTER TABLE jobs ADD COLUMN price_revision integer;
-- Applicable to both push and pull workers. NULL keeps existing standalone plugin connections intact.
CREATE FUNCTION studio_model_allowed(catalog text,workspace uuid) RETURNS boolean LANGUAGE SQL STABLE AS $$
 SELECT catalog IS NULL OR EXISTS(
   SELECT 1 FROM studio_catalog c CROSS JOIN studio_policy g LEFT JOIN studio_workspace_policy p ON p.workspace_id=workspace
   WHERE c.id=catalog AND NOT c.hidden AND COALESCE((g.flags->>c.id)::boolean,false)
   AND CASE WHEN p.workspace_id IS NULL THEN true ELSE COALESCE((p.flags->>c.id)::boolean,false) END
 );
$$;
