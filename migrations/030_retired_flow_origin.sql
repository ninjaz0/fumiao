-- The fixed Flow adapter stores the public job number under actual. The
-- account-bound source_media_id in the input is an opaque provider identifier.
CREATE FUNCTION flow_source_job_number(view_json json) RETURNS bigint
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  -- The json column preserves escapes that PostgreSQL cannot decode, even
  -- when they occur outside the requested path. Replace NUL and surrogate
  -- escapes in this lookup copy only. Consume pairs of backslashes so a
  -- literal "\\u0000" stays literal. '?' cannot form either path key.
  SELECT substring(
    (regexp_replace(
      view_json::text,
      $re$(?<!\\)((?:\\\\)*)\\u(?:0000|[dD][89a-fA-F][0-9a-fA-F]{2})$re$,
      $replace$\1?$replace$,
      'g'
    )::json -> 'actual' -> 'flow_source_job')::text
    FROM '^[1-9][0-9]{0,15}$'
  )::bigint;
$$;

CREATE FUNCTION fmworker_completed_origin(source_job jobs) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (source_job).state='completed' AND (
    EXISTS (SELECT 1 FROM fmworker_assignments a WHERE a.job_id=(source_job).id AND a.completed)
    OR EXISTS (SELECT 1 FROM fmworker_rewards r WHERE r.job_number=(source_job).public_id)
    OR EXISTS (
      SELECT 1 FROM gpu_nodes n
      WHERE n.public_id=(source_job).original_node AND (
        to_jsonb(n) @> '{"fmworker_retired":true}'
        OR EXISTS (SELECT 1 FROM fmworker_resources r WHERE r.node_id=n.id)
      )
    )
  );
$$;

CREATE FUNCTION retired_flow_source(job_workspace uuid, view_json json) RETURNS boolean
LANGUAGE sql STABLE STRICT AS $$
  SELECT EXISTS (
    SELECT 1 FROM jobs source_job
    WHERE source_job.public_id=flow_source_job_number(view_json)
      AND source_job.workspace_id=job_workspace
      AND fmworker_completed_origin(source_job)
  );
$$;
