ALTER TABLE payment_channels ADD COLUMN position bigint GENERATED ALWAYS AS IDENTITY;

-- The original protocol has public FM order IDs and globally scoped request UIDs.
-- The Advanced protocol keeps its UUID orders and per-owner request keys.
CREATE TABLE original_recharge_orders (
  id text COLLATE "C" PRIMARY KEY CHECK (id ~ '^FM[0-9a-f]{26}$'),
  uid uuid NOT NULL UNIQUE,
  owner_id uuid NOT NULL REFERENCES users,
  workspace_id uuid NOT NULL REFERENCES wallets(workspace_id),
  method text NOT NULL CHECK (method IN ('alipay', 'usdt_plasma')),
  merchant text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  credits bigint NOT NULL CHECK (credits > 0),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'unconfirmed', 'paid', 'expired')),
  trade_id text,
  checkout text NOT NULL DEFAULT '',
  created bigint NOT NULL,
  expires bigint NOT NULL,
  paid bigint,
  checked bigint NOT NULL DEFAULT 0,
  UNIQUE (method, trade_id)
);
CREATE INDEX original_recharge_history ON original_recharge_orders(owner_id, workspace_id, id DESC);
CREATE INDEX original_recharge_reconciliation ON original_recharge_orders(checked) WHERE state <> 'paid';

-- Earlier imports already copied the wallet and ledger. Project the archived
-- orders using their original IDs and timestamps without modifying either.
CREATE FUNCTION restore_original_recharge_orders(import_source text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO original_recharge_orders(
    id,uid,owner_id,workspace_id,method,merchant,amount,credits,state,trade_id,checkout,created,expires,paid,checked
  )
  SELECT r.legacy_id,(r.payload->>'uid')::uuid,
    (SELECT id FROM users WHERE public_id=(r.payload->>'owner')::bigint),
    r.workspace_id,r.payload->>'method',r.payload->>'merchant',
    (r.payload->>'amount')::integer,(r.payload->>'credits')::bigint,r.payload->>'state',
    r.payload->>'trade_id',COALESCE(r.payload->>'checkout',''),
    (r.payload->>'created')::bigint,(r.payload->>'expires')::bigint,
    (r.payload->>'paid')::bigint,COALESCE((r.payload->>'checked')::bigint,0)
  FROM legacy_records r
  WHERE r.collection='recharge_orders' AND (import_source IS NULL OR r.source=import_source);
$$;

SELECT restore_original_recharge_orders(NULL);
