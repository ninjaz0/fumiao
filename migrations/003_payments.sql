CREATE TABLE payment_channels(method text PRIMARY KEY, config text NOT NULL, enabled boolean NOT NULL DEFAULT false);
CREATE TABLE payment_orders(
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces, owner_id uuid NOT NULL REFERENCES users,
 request_key uuid NOT NULL, method text NOT NULL REFERENCES payment_channels, config_snapshot text NOT NULL,
 amount integer NOT NULL CHECK(amount>0), credits bigint NOT NULL CHECK(credits>0), state text NOT NULL DEFAULT 'creating' CHECK(state IN ('creating','pending','unconfirmed','paid')),
 checkout text, trade_id text, merchant text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes', paid_at timestamptz,
 UNIQUE(owner_id,request_key), UNIQUE(merchant,trade_id)
);
