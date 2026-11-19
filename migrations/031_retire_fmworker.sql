-- Stop old API, workers and imports before upgrading. Fail fast if a writer
-- still holds any of the contribution, scheduling or accounting relations.
DO $$
BEGIN
  LOCK TABLE connections,gpu_nodes,gpu_pairings,jobs,job_runs,outbox,ledger,wallets,
    fmworker_resources,fmworker_assignments,fmworker_usage,fmworker_verifications,
    fmworker_rewards,fmworker_reward_remainders,fmworker_funds,fmworker_fund_holds,
    original_state_settings,legacy_records
    IN ACCESS EXCLUSIVE MODE NOWAIT;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION 'fmWorker retirement: stop API, workers and other database writers/readers, then retry'
    USING ERRCODE='55P03';
END;
$$;

CREATE TABLE retired_fmworker_credentials (
  digest text PRIMARY KEY CHECK(digest ~ '^[0-9a-f]{64}$')
);
CREATE TEMP TABLE retiring_imported_credentials ON COMMIT DROP AS
WITH credentials AS MATERIALIZED (
  SELECT payload FROM legacy_records WHERE collection='fm_retired_node_credentials'
)
SELECT payload->>'node' AS public_number,payload->>'digest' AS digest FROM credentials;

CREATE TEMP TABLE retiring_fmworker_nodes ON COMMIT DROP AS
SELECT n.id,n.public_id,n.token_hash
FROM gpu_nodes n JOIN connections c ON c.id=n.connection_id
WHERE c.fmworker_resource_driver
   OR EXISTS (SELECT 1 FROM fmworker_resources r WHERE r.node_id=n.id)
   OR EXISTS (SELECT 1 FROM fmworker_usage u WHERE u.node_id=n.id)
   OR EXISTS (SELECT 1 FROM fmworker_rewards r WHERE r.node_id=n.id)
   OR EXISTS (
     SELECT 1 FROM retiring_imported_credentials r
     WHERE n.archived AND n.public_id::text=r.public_number
   );
CREATE UNIQUE INDEX ON retiring_fmworker_nodes(id);
CREATE UNIQUE INDEX ON retiring_fmworker_nodes(public_id);

-- Keep evidence apart from current dispatch state. No wallet or ledger change
-- is made when an upstream outcome is unresolved, including requeued claims.
CREATE TABLE retired_fmworker_jobs (
  job_id uuid PRIMARY KEY REFERENCES jobs,
  retired_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  previous_state text NOT NULL,
  previous_error text,
  previous_note text,
  previous_lease_until timestamptz,
  previous_receipt json,
  previous_remote_id text,
  previous_node bigint
);

INSERT INTO retired_fmworker_jobs(job_id,previous_state,previous_error,previous_note,
  previous_lease_until,previous_receipt,previous_remote_id,previous_node)
SELECT j.id,j.state,j.error,j.request_note,j.lease_until,j.receipt,j.remote_id,j.original_node
FROM jobs j JOIN connections c ON c.id=j.connection_id
WHERE j.state NOT IN ('completed','failed','cancelled') AND (
  c.fmworker_resource_driver
  OR EXISTS (SELECT 1 FROM fmworker_assignments a WHERE a.job_id=j.id)
  OR EXISTS (SELECT 1 FROM retiring_fmworker_nodes n WHERE n.id::text=j.remote_id OR n.public_id=j.original_node)
  OR EXISTS (
    SELECT 1 FROM job_runs r JOIN retiring_fmworker_nodes n ON r.node=n.id::text OR r.node=n.public_id::text
    WHERE r.job=j.id
  )
);
-- 032 uses the archived node markers to quarantine dependent Flow jobs on
-- both new upgrades and databases that already ran the original 031.

UPDATE jobs j SET state='uncertain',lease_token=NULL,lease_until=NULL,original_gpu_ticket=NULL,
  request_uncertain=true,request_retry_at=NULL,request_note=NULL,
  error='贡献服务已退役，需人工核对上游结果和冻结积分',updated_at=now()
FROM retired_fmworker_jobs r WHERE r.job_id=j.id;
UPDATE job_runs r SET status='interrupted',valid=false,finished=extract(epoch FROM transaction_timestamp())
WHERE r.status='running' AND EXISTS (SELECT 1 FROM retired_fmworker_jobs j WHERE j.job_id=r.job);
INSERT INTO job_events(job_id,state,detail)
SELECT job_id,'uncertain',jsonb_build_object('reason','fmworker_retired','previous_state',previous_state)
FROM retired_fmworker_jobs;
DELETE FROM outbox o USING retired_fmworker_jobs r WHERE r.job_id=o.job_id;

INSERT INTO retired_fmworker_credentials(digest)
SELECT encode(sha256(convert_to('fmworker-retired:'||token_hash,'UTF8')),'hex')
FROM retiring_fmworker_nodes WHERE token_hash ~ '^[0-9a-f]{64}$'
ON CONFLICT DO NOTHING;
INSERT INTO retired_fmworker_credentials(digest)
SELECT digest FROM retiring_imported_credentials WHERE digest IS NOT NULL
ON CONFLICT DO NOTHING;
UPDATE gpu_nodes n SET enabled=false,archived=true,control='removed',
  token_hash=encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex')
FROM retiring_fmworker_nodes r WHERE r.id=n.id;
-- Keep the pairing and its label for audit/name allocation, with an unusable code.
UPDATE gpu_pairings p SET expires_at=to_timestamp(0),token=encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex')
WHERE EXISTS (SELECT 1 FROM retiring_fmworker_nodes r WHERE r.id=p.claimed_node_id)
   OR EXISTS (SELECT 1 FROM connections c WHERE c.id=p.connection_id AND c.fmworker_resource_driver);

ALTER TABLE gpu_nodes ADD COLUMN fmworker_retired boolean NOT NULL DEFAULT false
  CHECK (NOT fmworker_retired OR (archived AND NOT enabled AND control='removed'));
UPDATE gpu_nodes n SET fmworker_retired=true FROM retiring_fmworker_nodes r WHERE r.id=n.id;
UPDATE fmworker_resources SET enabled=false WHERE enabled;
UPDATE fmworker_assignments SET protocol_ticket=NULL WHERE protocol_ticket IS NOT NULL;

DROP TRIGGER fmworker_track_ledger ON ledger;
DROP FUNCTION fmworker_track_ledger();
DROP FUNCTION restore_original_fmworker_history(text);
DROP FUNCTION restore_original_fmworker_resources(text);
DROP FUNCTION fmworker_restore_funds();
DROP FUNCTION fmworker_reserve(uuid,uuid,bigint,bigint,boolean);

-- Historical rows stay readable. An older writer cannot post rewards, register
-- an assignment, or record usage. Normal consumption never touches these tables.
CREATE FUNCTION reject_retired_fmworker_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE has_history boolean;
BEGIN
  IF TG_OP='TRUNCATE' THEN
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I)', TG_TABLE_SCHEMA, TG_TABLE_NAME) INTO has_history;
    IF NOT has_history THEN RETURN NULL; END IF;
  END IF;
  RAISE EXCEPTION 'fmWorker has retired; contribution history is read-only' USING ERRCODE='23514';
END;
$$;
DO $$
DECLARE archive_table text;
BEGIN
  FOREACH archive_table IN ARRAY ARRAY[
    'fmworker_resources','fmworker_assignments','fmworker_usage','fmworker_verifications',
    'fmworker_rewards','fmworker_reward_remainders','fmworker_funds','fmworker_fund_holds'
  ] LOOP
    EXECUTE format('CREATE TRIGGER retired_fmworker_read_only'
      ' BEFORE INSERT OR UPDATE OR DELETE ON %I'
      ' FOR EACH ROW EXECUTE FUNCTION reject_retired_fmworker_write()', archive_table);
    EXECUTE format('CREATE TRIGGER retired_fmworker_no_truncate'
      ' BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_retired_fmworker_write()', archive_table);
  END LOOP;
END;
$$;
CREATE TRIGGER retired_fmworker_rate BEFORE UPDATE OF fmworker_reward_bps ON original_state_settings
  FOR EACH STATEMENT EXECUTE FUNCTION reject_retired_fmworker_write();
CREATE TRIGGER retired_fmworker_ledger BEFORE INSERT OR UPDATE ON ledger
  FOR EACH ROW WHEN (NEW.action='contribution' AND NEW.key NOT LIKE 'import-ledger:%')
  EXECUTE FUNCTION reject_retired_fmworker_write();
CREATE TRIGGER retired_fmworker_driver_insert BEFORE INSERT ON connections
  FOR EACH ROW WHEN (NEW.fmworker_resource_driver) EXECUTE FUNCTION reject_retired_fmworker_write();
CREATE TRIGGER retired_fmworker_driver_change BEFORE UPDATE OF fmworker_resource_driver ON connections
  FOR EACH ROW WHEN (NEW.fmworker_resource_driver IS DISTINCT FROM OLD.fmworker_resource_driver)
  EXECUTE FUNCTION reject_retired_fmworker_write();

CREATE FUNCTION reject_retired_fmworker_credential() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM retired_fmworker_credentials
    WHERE digest=encode(sha256(convert_to('fmworker-retired:'||NEW.token_hash,'UTF8')),'hex'))
    OR EXISTS (SELECT 1 FROM connections c WHERE c.id=NEW.connection_id AND c.fmworker_resource_driver)
  THEN
    RAISE EXCEPTION 'fmWorker credential or connection has retired; use a fresh pairing and credential'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retired_fmworker_node BEFORE INSERT OR UPDATE OF token_hash,connection_id ON gpu_nodes
  FOR EACH ROW EXECUTE FUNCTION reject_retired_fmworker_credential();
CREATE TRIGGER retired_fmworker_node_archive BEFORE UPDATE OF fmworker_retired ON gpu_nodes
  FOR EACH ROW WHEN (OLD.fmworker_retired AND NOT NEW.fmworker_retired)
  EXECUTE FUNCTION reject_retired_fmworker_write();

CREATE FUNCTION reject_retired_fmworker_pairing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.expires_at=to_timestamp(0) AND to_jsonb(NEW)-'expires_at'=to_jsonb(OLD)-'expires_at' THEN
      RETURN NEW; -- Ordinary member removal can always expire an old pairing.
    END IF;
    IF EXISTS (SELECT 1 FROM connections c WHERE c.id=OLD.connection_id AND c.fmworker_resource_driver)
      OR EXISTS (SELECT 1 FROM gpu_nodes n WHERE n.id=OLD.claimed_node_id AND n.fmworker_retired)
    THEN
      RAISE EXCEPTION 'fmWorker pairing has retired; use a fresh pairing' USING ERRCODE='23514';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM connections c WHERE c.id=NEW.connection_id AND c.fmworker_resource_driver)
    OR EXISTS (SELECT 1 FROM gpu_nodes n WHERE n.id=NEW.claimed_node_id AND n.fmworker_retired)
  THEN
    RAISE EXCEPTION 'fmWorker pairing has retired; use a fresh pairing' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retired_fmworker_pairing BEFORE INSERT OR UPDATE ON gpu_pairings
  FOR EACH ROW EXECUTE FUNCTION reject_retired_fmworker_pairing();

CREATE FUNCTION reject_retired_fmworker_retry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM retired_fmworker_jobs WHERE job_id=NEW.id) THEN
    RAISE EXCEPTION 'fmWorker job requires manual reconciliation and cannot be resumed'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retired_fmworker_retry BEFORE UPDATE OF state ON jobs
  FOR EACH ROW WHEN (NEW.state NOT IN ('uncertain','failed'))
  EXECUTE FUNCTION reject_retired_fmworker_retry();
