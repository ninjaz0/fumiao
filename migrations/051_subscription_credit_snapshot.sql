ALTER TABLE workspace_subscriptions
  ADD COLUMN period_credits BIGINT CHECK (period_credits > 0);

-- Settled periods retain the amount recorded at grant time. Older pending
-- periods had no stored quote, so snapshot their current plan amount on upgrade.
UPDATE workspace_subscriptions s
SET period_credits = COALESCE(
  (SELECT g.credits FROM subscription_grants g
   WHERE g.subscription_id = s.id AND g.period_start = s.current_period_start),
  p.period_credits
)
FROM subscription_plans p
WHERE p.id = s.plan_id;

ALTER TABLE workspace_subscriptions
  ALTER COLUMN period_credits SET NOT NULL;
