-- Stop API and workers before upgrading, including on databases already at 031.
LOCK TABLE jobs,job_runs,outbox,retired_fmworker_jobs IN ACCESS EXCLUSIVE MODE NOWAIT;

-- Preserve previous quarantines, even if their original provenance is now
-- unknown. A missing or corrected source does not establish upstream outcome.
CREATE TEMP TABLE retiring_flow_jobs ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO retired_fmworker_jobs(job_id,previous_state,previous_error,previous_note,
    previous_lease_until,previous_receipt,previous_remote_id,previous_node)
  SELECT j.id,j.state,j.error,j.request_note,j.lease_until,j.receipt,j.remote_id,j.original_node
  FROM jobs j
  WHERE j.plugin_id='flow' AND j.state NOT IN ('completed','failed','cancelled')
    AND retired_flow_source(j.workspace_id,j.original_view)
  ON CONFLICT (job_id) DO NOTHING
  RETURNING job_id,previous_state
)
SELECT * FROM inserted;

UPDATE jobs j SET state='uncertain',lease_token=NULL,lease_until=NULL,original_gpu_ticket=NULL,
  request_uncertain=true,request_retry_at=NULL,request_note=NULL,
  error='贡献服务已退役，需人工核对上游结果和冻结积分',updated_at=now()
FROM retiring_flow_jobs r WHERE r.job_id=j.id;
UPDATE job_runs r SET status='interrupted',valid=false,finished=extract(epoch FROM transaction_timestamp())
WHERE r.status='running' AND EXISTS (SELECT 1 FROM retiring_flow_jobs j WHERE j.job_id=r.job);
INSERT INTO job_events(job_id,state,detail)
SELECT job_id,'uncertain',jsonb_build_object('reason','fmworker_retired','previous_state',previous_state)
FROM retiring_flow_jobs;
DELETE FROM outbox o USING retiring_flow_jobs r WHERE r.job_id=o.job_id;
