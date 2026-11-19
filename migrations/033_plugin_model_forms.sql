-- UI contracts can be added to historical adapters without rewriting accepted
-- job snapshots or changing their immutable execution manifests.
CREATE TABLE plugin_model_forms (
  plugin_id text NOT NULL,
  plugin_version text NOT NULL,
  forms jsonb NOT NULL,
  PRIMARY KEY (plugin_id, plugin_version),
  FOREIGN KEY (plugin_id, plugin_version) REFERENCES plugin_versions(id, version)
);
