ALTER TABLE original_state_settings ADD COLUMN fmworker_reward_bps integer NOT NULL DEFAULT 7000
  CHECK (fmworker_reward_bps BETWEEN 0 AND 10000);

-- Provenance only. The wallet and ledger remain the financial authority.
CREATE TABLE fmworker_funds (
  workspace_id uuid PRIMARY KEY REFERENCES wallets(workspace_id),
  eligible bigint NOT NULL DEFAULT 0 CHECK (eligible >= 0),
  held bigint NOT NULL DEFAULT 0 CHECK (held BETWEEN 0 AND eligible)
);
CREATE TABLE fmworker_fund_holds (
  job_id uuid PRIMARY KEY REFERENCES jobs ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES fmworker_funds,
  amount bigint NOT NULL CHECK (amount >= 0),
  state text NOT NULL DEFAULT 'held' CHECK (state IN ('held','spent','refunded')),
  rewardable boolean NOT NULL DEFAULT true
);

-- Only the future contribution lifecycle can provision a live resource. Ordinary
-- pairing and historical node imports never create this marker.
CREATE TABLE fmworker_resources (
  node_id uuid PRIMARY KEY REFERENCES gpu_nodes,
  kind text NOT NULL CHECK (kind IN ('breeze','flow','colab')),
  enabled boolean NOT NULL DEFAULT false,
  capabilities jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE fmworker_assignments (
  job_id uuid NOT NULL REFERENCES jobs ON DELETE CASCADE,
  ticket uuid NOT NULL,
  node_id uuid NOT NULL REFERENCES fmworker_resources,
  owner_id uuid NOT NULL REFERENCES users,
  reward_bps integer NOT NULL CHECK (reward_bps BETWEEN 0 AND 10000),
  completed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (job_id,ticket)
);
CREATE UNIQUE INDEX fmworker_completed_assignment ON fmworker_assignments(job_id) WHERE completed;

CREATE TABLE fmworker_reward_remainders (
  workspace_id uuid PRIMARY KEY REFERENCES wallets(workspace_id),
  units integer NOT NULL CHECK (units BETWEEN 0 AND 9999)
);
CREATE TABLE fmworker_rewards (
  job_number bigint PRIMARY KEY CHECK (job_number BETWEEN 1 AND 9007199254740991),
  node_number bigint NOT NULL CHECK (node_number BETWEEN 1 AND 9007199254740991),
  node_id uuid REFERENCES gpu_nodes,
  archived_node_name text,
  owner_id uuid NOT NULL REFERENCES users,
  workspace_id uuid NOT NULL REFERENCES wallets(workspace_id),
  units bigint NOT NULL CHECK (units > 0),
  credited bigint NOT NULL CHECK (credited >= 0),
  created bigint NOT NULL CHECK (created >= 0)
);
CREATE INDEX fmworker_reward_history ON fmworker_rewards(owner_id,created DESC,job_number);

-- Called after the wallet has been locked and updated by the normal ledger writer.
-- available includes this reservation, matching Pure's already_reserved branch.
CREATE FUNCTION fmworker_reserve(job uuid, workspace uuid, charge bigint, available bigint, earn boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE qualified bigint;
BEGIN
  SELECT LEAST(eligible-held,GREATEST(0,charge-GREATEST(0,available-(eligible-held))))
    INTO STRICT qualified FROM fmworker_funds WHERE workspace_id=workspace;
  INSERT INTO fmworker_fund_holds(job_id,workspace_id,amount,rewardable)
    VALUES(job,workspace,qualified,earn);
  UPDATE fmworker_funds SET held=held+qualified WHERE workspace_id=workspace;
END;
$$;

CREATE FUNCTION fmworker_track_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE qualified bigint;
BEGIN
  INSERT INTO fmworker_funds(workspace_id) VALUES(NEW.workspace_id) ON CONFLICT DO NOTHING;
  IF NEW.action IN ('recharge','contribution') AND NEW.amount>0 THEN
    UPDATE fmworker_funds SET eligible=eligible+NEW.amount WHERE workspace_id=NEW.workspace_id;
  ELSIF NEW.action='adjust' AND NEW.amount<0 THEN
    UPDATE fmworker_funds SET eligible=GREATEST(held,LEAST(eligible,NEW.balance_snapshot))
      WHERE workspace_id=NEW.workspace_id;
  ELSIF NEW.action='hold' AND NEW.key='hold:'||NEW.job_id THEN
    PERFORM fmworker_reserve(NEW.job_id,NEW.workspace_id,NEW.amount,
      NEW.balance_snapshot-NEW.held_snapshot+NEW.amount,true);
  ELSIF NEW.action IN ('spend','refund') AND NEW.key='settle:'||NEW.job_id THEN
    UPDATE fmworker_fund_holds SET state=CASE WHEN NEW.action='spend' THEN 'spent' ELSE 'refunded' END
      WHERE job_id=NEW.job_id AND workspace_id=NEW.workspace_id AND state='held'
      RETURNING amount INTO qualified;
    IF FOUND THEN
      UPDATE fmworker_funds SET held=held-qualified,
        eligible=eligible-CASE WHEN NEW.action='spend' THEN qualified ELSE 0 END
        WHERE workspace_id=NEW.workspace_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fmworker_track_ledger AFTER INSERT ON ledger FOR EACH ROW
  WHEN (NEW.key NOT LIKE 'import-ledger:%' AND NEW.action IN ('recharge','contribution','adjust','hold','spend','refund'))
  EXECUTE FUNCTION fmworker_track_ledger();

-- When there is an exact SQLite snapshot, start there and replay post-import
-- activity only. For older or native wallets use Pure's conservative replay.
CREATE FUNCTION fmworker_restore_funds() RETURNS void LANGUAGE plpgsql AS $$
DECLARE account record; snapshot bigint; qualified bigint; entry record; replayed boolean;
BEGIN
  FOR account IN
    SELECT w.* FROM wallets w LEFT JOIN fmworker_funds f USING(workspace_id)
    WHERE f.workspace_id IS NULL ORDER BY w.workspace_id FOR UPDATE OF w
  LOOP
    SELECT (payload->>'eligible')::bigint INTO snapshot FROM legacy_records r
      WHERE r.collection='fm_funds' AND r.workspace_id=account.workspace_id;
    qualified := COALESCE(snapshot,0);
    replayed := false;
    FOR entry IN
      SELECT action,amount,balance_snapshot FROM ledger
      WHERE workspace_id=account.workspace_id
        AND (snapshot IS NULL OR key NOT LIKE 'import-ledger:%')
        AND action IN ('recharge','contribution','spend','adjust')
      ORDER BY public_id
    LOOP
      replayed := true;
      IF entry.action IN ('recharge','contribution') THEN
        qualified := qualified+GREATEST(0,entry.amount);
      ELSE
        qualified := LEAST(qualified,entry.balance_snapshot);
      END IF;
    END LOOP;
    IF snapshot IS NULL OR replayed THEN
      qualified := GREATEST(0,LEAST(qualified,account.balance));
    END IF;
    INSERT INTO fmworker_funds(workspace_id,eligible) VALUES(account.workspace_id,qualified);
    -- Pre-feature holds need provenance for future spend/refund, but cannot earn.
    FOR entry IN
      SELECT j.id,l.amount FROM jobs j JOIN ledger l ON l.key='hold:'||j.id
      WHERE j.workspace_id=account.workspace_id
        AND j.state NOT IN ('completed','failed','cancelled')
      ORDER BY j.public_id
    LOOP
      PERFORM fmworker_reserve(entry.id,account.workspace_id,entry.amount,
        account.balance-account.held+entry.amount,false);
    END LOOP;
  END LOOP;
END;
$$;

CREATE FUNCTION restore_original_fmworker_history(import_source text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO fmworker_rewards(job_number,node_number,node_id,archived_node_name,owner_id,workspace_id,units,credited,created)
  SELECT (r.payload->>'job')::bigint,(r.payload->>'node')::bigint,n.id,nr.payload->>'name',w.owner_id,r.workspace_id,
    (r.payload->>'units')::bigint,(r.payload->>'credited')::bigint,(r.payload->>'created')::bigint
  FROM legacy_records r
  LEFT JOIN workspaces w ON w.id=r.workspace_id AND w.kind='personal'
    AND EXISTS (SELECT 1 FROM users WHERE id=w.owner_id AND public_id=(r.payload->>'owner')::bigint)
  LEFT JOIN legacy_records nr ON nr.source=r.source AND nr.collection='nodes' AND nr.legacy_id=r.payload->>'node'
  LEFT JOIN gpu_nodes n ON n.archived AND n.public_id=(nr.payload->>'id')::bigint
  WHERE r.collection='fm_rewards' AND (import_source IS NULL OR r.source=import_source);

  -- Older exports carried reward rows but omitted the remainder. All positive
  -- units are recorded, including completions that credited zero whole points.
  INSERT INTO fmworker_reward_remainders(workspace_id,units)
  SELECT workspace_id,MOD(SUM(units),10000)::integer FROM fmworker_rewards GROUP BY workspace_id
  ON CONFLICT DO NOTHING;
  INSERT INTO fmworker_reward_remainders(workspace_id,units)
  SELECT workspace_id,(payload->>'units')::integer FROM legacy_records
  WHERE collection='fm_reward_remainders' AND (import_source IS NULL OR source=import_source)
  ON CONFLICT(workspace_id) DO UPDATE SET units=EXCLUDED.units;
  UPDATE original_state_settings SET fmworker_reward_bps=(r.payload->>'value')::integer
  FROM legacy_records r WHERE r.collection='fm_reward_settings' AND r.payload->>'key'='fmworker_reward_bps'
    AND (import_source IS NULL OR r.source=import_source);

  PERFORM fmworker_restore_funds();
END;
$$;

SELECT restore_original_fmworker_history(NULL);
-- A deleted SQLite job with a sub-point reward can exist only in reward history.
SELECT setval('jobs_public_id_seq', MAX(job_number))
FROM fmworker_rewards HAVING MAX(job_number) > (SELECT last_value FROM jobs_public_id_seq);
