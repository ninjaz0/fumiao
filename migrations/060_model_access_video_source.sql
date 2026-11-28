-- A connection can move between gateways. A remote ID belongs to its frozen
-- canonical polling endpoint, including the base path. Hash the canonical URL
-- to bound the btree key even for long configured URLs and encoded task IDs.
DROP INDEX jobs_native_video_remote;
CREATE UNIQUE INDEX jobs_native_video_remote
  ON jobs(connection_id, sha256(native_polling_url::bytea))
  WHERE source_kind='builtin' AND kind='video' AND native_polling_url IS NOT NULL;
