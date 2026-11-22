-- Rename the relations in place so node IDs, sequences, foreign keys, and
-- retirement triggers keep their identity. Frozen packages still use the old
-- names, including in-flight jobs accepted before this migration.
ALTER TABLE gpu_nodes RENAME TO nodes;
ALTER TABLE gpu_pairings RENAME TO node_pairings;
CREATE VIEW gpu_nodes AS SELECT * FROM nodes;
CREATE VIEW gpu_pairings AS SELECT * FROM node_pairings;

-- A pool is the pull provider's connection. Its plugin/version and lifecycle
-- already live on connections; derive ownership there for old and new rows.
CREATE VIEW node_pools AS
SELECT c.id, c.plugin_id, c.plugin_version, c.enabled, c.removed
FROM connections c JOIN plugin_versions v
  ON (v.id,v.version)=(c.plugin_id,c.plugin_version)
WHERE v.manifest->>'mode'='pull' AND NOT c.fmworker_resource_driver;
