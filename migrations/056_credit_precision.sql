-- Keep historical signs, checks, and the read-only retired-service triggers.
ALTER TABLE wallets
  ALTER balance TYPE numeric(31,12),
  ALTER held TYPE numeric(31,12);
ALTER TABLE ledger
  ALTER amount TYPE numeric(31,12),
  ALTER balance_snapshot TYPE numeric(31,12),
  ALTER held_snapshot TYPE numeric(31,12);
ALTER TABLE jobs ALTER price TYPE numeric(31,12);
ALTER TABLE chat_charges ALTER amount TYPE numeric(31,12);
ALTER TABLE budget_policies
  ALTER warn_limit TYPE numeric(31,12),
  ALTER cap_limit TYPE numeric(31,12);
ALTER TABLE budget_alerts
  ALTER projected_spend TYPE numeric(31,12),
  ALTER warn_limit TYPE numeric(31,12),
  ALTER cap_limit TYPE numeric(31,12);
ALTER TABLE canvas_precheck_tickets ALTER total_credits TYPE numeric(31,12);
ALTER TABLE canvas_proposals ALTER estimated_credits TYPE numeric(31,12);
ALTER TABLE agent_proposal_scopes ALTER approved_credits TYPE numeric(31,12);
ALTER TABLE agent_proposal_executions ALTER amount TYPE numeric(31,12);
