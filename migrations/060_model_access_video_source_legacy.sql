-- The original OpenRouter worker could retain an ID but discard an invalid
-- polling URL. Claims check the sealed, immutable revision of these owners.
CREATE INDEX jobs_native_video_legacy_remote ON jobs(connection_id, remote_id)
  WHERE source_kind='builtin' AND kind='video' AND native_polling_url IS NULL AND remote_id IS NOT NULL;
