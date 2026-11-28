-- Only canonical, same-job polling locations are retained here. Download
-- pointers live in the short-lived finalizing receipt cleared at settlement.
ALTER TABLE jobs ADD COLUMN native_polling_url text;
CREATE UNIQUE INDEX jobs_native_video_remote ON jobs(connection_id, remote_id)
  WHERE source_kind='builtin' AND kind='video' AND remote_id IS NOT NULL;
