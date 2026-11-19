// Historical assignments and node links establish provenance, never authorization.
// The node marker is absent in pre-cutover snapshots and present on imported
// Pure archives that have no live resource row.
const ordinaryJobOrigin = `NOT EXISTS (SELECT 1 FROM fmworker_assignments a WHERE a.job_id=j.id)
    AND NOT EXISTS (
      SELECT 1 FROM gpu_nodes n
      WHERE n.public_id=j.original_node AND (
        to_jsonb(n) @> '{"fmworker_retired":true}'
        OR EXISTS (SELECT 1 FROM fmworker_resources r WHERE r.node_id=n.id)
      )
    )`;
export const ordinaryFlowSource = "NOT fmworker_completed_origin(j)";

// Reconciliation must not repeat a generation or send an account-bound Flow
// media ID to a different provider account. Use the same source lookup as
// the cutover and leave historical quarantines in place for reconciliation.
export const executableJob = `(${ordinaryJobOrigin}) AND (
  CASE WHEN j.state='uncertain' AND j.request_uncertain THEN NOT EXISTS (
    SELECT 1 FROM job_events e WHERE e.job_id=j.id AND e.state='uncertain'
      AND e.detail->>'reason'='fmworker_retired'
  ) ELSE true END
) AND CASE WHEN j.plugin_id='flow' THEN NOT retired_flow_source(j.workspace_id,j.original_view) ELSE true END`;
