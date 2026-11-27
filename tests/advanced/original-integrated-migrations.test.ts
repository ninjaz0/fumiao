import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { OriginalNodes } from "@fumiao/original-api/nodes.js";
import { migrate, one } from "@fumiao/platform/db.js";
import { GpuGateway } from "@fumiao/platform/gpu.js";
import { Executor } from "@fumiao/platform/executor.js";
import { Operations } from "@fumiao/platform/operations.js";
import { hash, secret } from "@fumiao/platform/security.js";
import {
  importLegacy,
  legacyId,
  type LegacyExport,
} from "@fumiao/platform/importer.js";
import { databaseFixture, financialRows } from "../helpers/database.js";

const nodes = "027_original_node_management.sql";
const recharge = "027_original_recharge.sql";
const source = "combined-migration";
const owner = legacyId(source, "user", 7);
const workspace = legacyId(source, "workspace", 23);
const connection = legacyId(source, "connection", "legacy");
const order = {
  id: "FM" + "a".repeat(26),
  uid: "00000000-0000-4000-8000-000000000001",
  owner: 7,
  workspace: 23,
  method: "alipay",
  merchant: "fixture-merchant",
  amount: 500,
  credits: 50,
  trade_id: "fixture-trade",
  state: "paid",
  created: 100,
  expires: 200,
  paid: 110,
};

for (const prior of [undefined, nodes, recharge]) {
  test(
    "integrated PostgreSQL migrations after " + (prior ?? "an empty schema"),
    async () => {
      const f = await databaseFixture(
        prior && "026_storyboard_object_cleanup.sql",
      );
      try {
        if (prior) {
          const sql = await readFile("migrations/" + prior, "utf8");
          await f.db.transaction(async (tx) => {
            await tx.query(sql);
            await tx.query(
              "INSERT INTO schema_migrations(version,applied_at) VALUES($1,'2000-01-01T00:00:00Z')",
              [prior],
            );
          });
        }
        const snapshot: LegacyExport = {
          version: 1,
          source,
          tables: {
            users: [{ id: 7, role: "admin", name: "admin", active: 1 }],
            workspaces: [{ id: 23, kind: "personal", owner: 7, name: "个人" }],
            credit_accounts: [{ workspace: 23, balance: 50, reserved: 0 }],
            recharge_orders: prior === nodes ? [] : [order],
            // Older archives can have reserved pairing names without settings.
            ...(prior !== recharge && {
              node_pair_names: [{ label: "弗淼004" }],
            }),
          },
        };
        await importLegacy(f.p, snapshot, f.directory);
        if (prior === nodes) {
          // The node-only importer archives recharge history without projecting it.
          await f.db.query(
            "INSERT INTO legacy_records(source,collection,legacy_id,workspace_id,payload) VALUES($1,'recharge_orders',$2,$3,$4)",
            [source, order.id, workspace, order],
          );
          const node = await new GpuGateway(f.p).addNode(
            f.db,
            connection,
            owner,
            "弗淼005",
            ["MiniMax H3"],
            "fixture-node-hash",
          );
          await f.db.query(
            "INSERT INTO gpu_pairings(token,connection_id,expires_at,claimed,owner_id,label,models,claimed_node_id) VALUES('fixture-pair',$1,now(),true,$2,'弗淼005','[\"MiniMax H3\"]',$3)",
            [connection, owner, node],
          );
          await f.db.query(
            "UPDATE original_state_settings SET node_name_sequence=8",
          );
        } else if (prior === recharge) {
          await f.db.query(
            "INSERT INTO gpu_pairings(token,connection_id,expires_at,owner_id) VALUES('fixture-pair',$1,now(),$2)",
            [connection, owner],
          );
        }
        await f.db.query(
          "INSERT INTO payment_channels(method,config,enabled) VALUES('alipay',$1,true)",
          [f.p.vault.seal({ pid: "fixture" })],
        );
        const rows = async (table: string) =>
          financialRows(table, (await f.db.query("SELECT * FROM " + table)).rows);
        const wallets = await rows("wallets");
        const ledger = await rows("ledger");
        const channels = await rows("payment_channels");
        const pairings = await rows("gpu_pairings");
        const ordersBefore =
          prior === nodes ? undefined : await rows("original_recharge_orders");
        await migrate(f.db);
        const migrations = await rows("schema_migrations");
        assert.deepEqual(
          migrations
            .map((row) => row.version)
            .filter((version) => version.startsWith("027_"))
            .sort(),
          [nodes, recharge],
        );
        if (prior)
          assert.equal(
            migrations
              .find((row) => row.version === prior)
              ?.applied_at.getUTCFullYear(),
            2000,
          );

        const orders = await rows("original_recharge_orders");
        assert.equal(orders.length, 1);
        assert.deepEqual(
          [
            orders[0].id,
            orders[0].uid,
            orders[0].owner_id,
            orders[0].workspace_id,
            orders[0].state,
            orders[0].trade_id,
          ],
          [order.id, order.uid, owner, workspace, order.state, order.trade_id],
        );
        if (ordersBefore)
          assert.deepEqual(
            orders,
            ordersBefore.map((row) => ({
              plugin_id: "payments",
              plugin_version: "1.0.0",
              config_snapshot: null,
              ...row,
            })),
          );
        assert.deepEqual(await new OriginalNodes(f.p).suggestedName(), {
          name:
            prior === nodes
              ? "弗淼009"
              : prior === recharge
                ? "弗淼001"
                : "弗淼005",
        });
        const upgradedPairings =
          prior === recharge
            ? pairings.map((pair) => ({
                ...pair,
                label: null,
                models: null,
                claimed_node_id: null,
              }))
            : pairings;
        const upgradedChannels = await rows("payment_channels");
        assert.equal(Number(upgradedChannels[0].position), 1);
        assert.deepEqual(
          upgradedChannels,
          channels.map((channel) => ({
            ...channel,
            plugin_id: "payments",
            ...(prior === nodes
              ? { position: upgradedChannels[0].position }
              : {}),
          })),
        );

        await migrate(f.db);
        assert.deepEqual(await importLegacy(f.p, snapshot, f.directory), {
          alreadyImported: true,
        });
        assert.deepEqual(await rows("schema_migrations"), migrations);
        assert.deepEqual(await rows("original_recharge_orders"), orders);
        assert.deepEqual(await rows("gpu_pairings"), upgradedPairings);
        assert.deepEqual(await rows("payment_channels"), upgradedChannels);
        assert.deepEqual(await rows("wallets"), wallets);
        assert.deepEqual(await rows("ledger"), ledger);
      } finally {
        await f.cleanup();
      }
    },
  );
}

const pairedAgent = "028_original_paired_agent.sql";
const fmworkerRewards = "028_original_fmworker_rewards.sql";

for (const prior of [undefined, pairedAgent, fmworkerRewards]) {
  test("028 migrations after " + (prior ?? "an empty schema"), async () => {
    const f = await databaseFixture(prior && recharge);
    try {
      if (prior) {
        const statement = await readFile("migrations/" + prior, "utf8");
        await f.db.transaction(async (sql) => {
          await sql.query(statement);
          await sql.query(
            "INSERT INTO schema_migrations(version,applied_at) VALUES($1,'2000-01-01T00:00:00Z')",
            [prior],
          );
        });
      }
      const snapshot: LegacyExport = {
        version: 1,
        source,
        tables: {
          users: [{ id: 7, role: "admin", name: "admin", active: 1 }],
          workspaces: [{ id: 23, kind: "personal", owner: 7, name: "个人" }],
          credit_accounts: [{ workspace: 23, balance: 51, reserved: 0 }],
          recharge_orders: [order],
          jobs: [
            {
              id: 42,
              owner: 7,
              workspace: 23,
              kind: "audio",
              model: "breeze-tts-2",
              status: "done",
              created: 110,
            },
          ],
          credit_ledger: [
            {
              id: 1,
              workspace: 23,
              action: "recharge",
              note: "Imported recharge",
              amount: 50,
              balance: 50,
              reserved: 0,
              created: 110,
            },
            {
              id: 2,
              workspace: 23,
              action: "contribution",
              note: "Imported reward",
              amount: 1,
              balance: 51,
              reserved: 0,
              created: 120,
            },
          ],
          fm_funds: [{ workspace: 23, eligible: 51, held: 0 }],
          fm_rewards: [
            {
              job: 42,
              node: 8,
              owner: 7,
              workspace: 23,
              units: 12500,
              credited: 1,
              created: 120,
            },
          ],
          fm_reward_remainders: [{ workspace: 23, units: 2500 }],
          fm_reward_settings: [{ key: "fmworker_reward_bps", value: 6250 }],
        },
      };
      await importLegacy(f.p, snapshot, f.directory);
      const ticket = "f".repeat(64);
      if (prior === pairedAgent) {
        await f.db.query("UPDATE jobs SET original_gpu_ticket=$1", [ticket]);
      }
      if (prior === fmworkerRewards) {
        // Recreate the behavior of the importer released with migration 028.
        await f.db.query("SELECT restore_original_fmworker_history($1)", [
          source,
        ]);
        await f.db.query(
          "UPDATE original_state_settings SET fmworker_reward_bps=5000",
        );
      }
      const rechargeOnce = () =>
        f.db.transaction((sql) =>
          f.p.credit(
            sql,
            workspace,
            5,
            "fixture:post-import-recharge",
            "recharge",
          ),
        );
      await rechargeOnce();
      const rows = async (table: string) =>
        financialRows(table, (await f.db.query("SELECT * FROM " + table + " ORDER BY 1")).rows);
      const wallet = await rows("wallets");
      const ledger = await rows("ledger");
      const paidOrders = await rows("original_recharge_orders");
      assert.equal(Number(wallet[0].balance), 56);
      assert.equal(ledger.length, 3);
      assert.deepEqual(
        paidOrders.map(({ id, state }) => [id, state]),
        [[order.id, "paid"]],
      );
      const rewardBefore =
        prior === fmworkerRewards ? await rows("fmworker_rewards") : undefined;

      await migrate(f.db);
      const versions = (
        await f.db.query(
          "SELECT * FROM schema_migrations WHERE version LIKE '028_%' ORDER BY version",
        )
      ).rows;
      assert.deepEqual(
        versions.map(({ version }) => version),
        [fmworkerRewards, pairedAgent],
      );
      if (prior) {
        assert.equal(
          versions
            .find(({ version }) => version === prior)
            ?.applied_at.getUTCFullYear(),
          2000,
        );
      }
      assert.equal(
        (
          await one(
            f.db,
            "SELECT original_gpu_ticket FROM jobs WHERE public_id=42",
          )
        ).original_gpu_ticket,
        prior === pairedAgent ? ticket : null,
      );
      assert.equal(
        (
          await one(
            f.db,
            "SELECT fmworker_reward_bps FROM original_state_settings",
          )
        ).fmworker_reward_bps,
        prior === fmworkerRewards ? 5000 : prior === pairedAgent ? 6250 : 7000,
      );
      const rewards = await rows("fmworker_rewards");
      assert.deepEqual(
        rewards.map((row) => [
          Number(row.job_number),
          Number(row.units),
          Number(row.credited),
        ]),
        prior ? [[42, 12500, 1]] : [],
      );
      if (rewardBefore) assert.deepEqual(rewards, rewardBefore);
      const funds = await rows("fmworker_funds");
      assert.deepEqual(
        funds.map((row) => [Number(row.eligible), Number(row.held)]),
        prior ? [[56, 0]] : [],
      );
      assert.equal(
        (await rows("fmworker_reward_remainders"))[0]?.units,
        prior ? 2500 : undefined,
      );
      assert.equal(
        (
          await one(
            f.db,
            "SELECT payload FROM legacy_records WHERE collection='fm_rewards'",
          )
        ).payload.credited,
        1,
      );

      await migrate(f.db);
      await rechargeOnce();
      assert.deepEqual(await importLegacy(f.p, snapshot, f.directory), {
        alreadyImported: true,
      });
      assert.deepEqual(
        (await rows("schema_migrations")).filter(({ version }) =>
          version.startsWith("028_"),
        ),
        versions,
      );
      assert.deepEqual(await rows("wallets"), wallet);
      assert.deepEqual(await rows("ledger"), ledger);
      assert.deepEqual(
        await rows("original_recharge_orders"),
        paidOrders.map((row) => ({
          plugin_id: "payments",
          plugin_version: "1.0.0",
          config_snapshot: null,
          ...row,
        })),
      );
      assert.deepEqual(await rows("fmworker_rewards"), rewards);
      assert.deepEqual(await rows("fmworker_funds"), funds);
    } finally {
      await f.cleanup();
    }
  });
}

const lastContributionMigration = "030_original_fmworker_jobs.sql";
const retiredSql = "031_retire_fmworker.sql";

test("PostgreSQL contribution cutover preserves settled history and quarantines claimed jobs", async () => {
  const f = await databaseFixture(lastContributionMigration);
  try {
    const snapshot: LegacyExport = {
      version: 1,
      source,
      tables: {
        users: [
          { id: 7, name: "admin", role: "admin", active: 1 },
          { id: 8, name: "contributor", role: "member", active: 1 },
        ],
        workspaces: [
          { id: 23, kind: "personal", owner: 7, name: "买家" },
          { id: 24, kind: "personal", owner: 8, name: "贡献者" },
        ],
        credit_accounts: [
          { workspace: 23, balance: 100, reserved: 0 },
          { workspace: 24, balance: 9, reserved: 0 },
        ],
        credit_ledger: [
          {
            id: 1,
            workspace: 23,
            action: "recharge",
            amount: 104,
            balance: 104,
            reserved: 0,
            created: 100,
            note: "Synthetic ledger history",
          },
          {
            id: 2,
            workspace: 23,
            action: "spend",
            job: 42,
            amount: 4,
            balance: 100,
            reserved: 0,
            created: 101,
            note: "Synthetic ledger history",
          },
          {
            id: 3,
            workspace: 24,
            action: "contribution",
            job: 42,
            amount: 2,
            balance: 9,
            reserved: 0,
            created: 101,
            note: "Synthetic ledger history",
          },
        ],
        jobs: [
          {
            id: 42,
            owner: 7,
            workspace: 23,
            status: "done",
            model: "breeze-tts-2",
            kind: "audio",
            created: 100,
            note: "Synthetic ledger history",
          },
        ],
      },
    };
    await importLegacy(f.p, snapshot, f.directory);
    const worker = legacyId(source, "user", 8);
    const contributorWorkspace = legacyId(source, "workspace", 24);
    const settled = legacyId(source, "job", 42);
    const leased = randomUUID(),
      retried = randomUUID(),
      untouched = randomUUID(),
      boundFlow = randomUUID();
    const oldSecret = secret(),
      oldPair = secret(),
      regularSecret = secret();
    const leases = [randomUUID(), randomUUID()];
    const resourceConnection = randomUUID();
    const gpu = new GpuGateway(f.p);
    const actor = {
      id: owner,
      role: "admin" as const,
      name: "admin",
      nickname: "admin",
    };
    const nodes = new OriginalNodes(f.p);
    const { resource, paired, code } = await f.db.transaction(async (sql) => {
      await sql.query(
        `INSERT INTO connections(id,name,plugin_id,plugin_version,config,fmworker_resource_driver)
         SELECT $1,'legacy worker',plugin_id,plugin_version,config,true FROM connections WHERE id=$2`,
        [resourceConnection, connection],
      );
      const resource = await gpu.addNode(
        sql,
        resourceConnection,
        worker,
        "historic fmWorker",
        ["breeze-tts-2"],
        hash(oldSecret),
      );
      const paired = await gpu.addNode(
        sql,
        connection,
        owner,
        "ordinary GPU",
        ["breeze-tts-2"],
        hash(regularSecret),
      );
      await sql.query(
        "INSERT INTO fmworker_resources(node_id,kind,enabled) VALUES($1,'breeze',true)",
        [resource],
      );
      await sql.query(
        "INSERT INTO fmworker_usage(node_id,uid,units,created) VALUES($1,decode('610062','hex'),2.5,150)",
        [resource],
      );
      // Model both historical pairing shapes: an invitation associated with a
      // resource driver and a legacy receipt attached to a contribution node.
      await sql.query(
        `INSERT INTO gpu_pairings(token,connection_id,expires_at,claimed,owner_id,label,models,claimed_node_id)
         VALUES($1,$2,now()+interval '1 day',true,$3,'弗淼007','["breeze-tts-2"]',$4)`,
        [hash(oldPair), connection, worker, resource],
      );
      await gpu.createPairing(sql, worker, resourceConnection);
      const { code } = await gpu.createPairing(sql, owner, connection, {
        label: "Synthetic fresh pair",
        models: ["breeze-tts-2"],
      });
      const { public_id: nodeNumber } = (await one(
        sql,
        "SELECT public_id FROM gpu_nodes WHERE id=$1",
        [resource],
      ))!;
      await sql.query(
        `INSERT INTO fmworker_rewards(job_number,node_number,node_id,owner_id,workspace_id,units,credited,created)
         VALUES(42,$1,$2,$3,$4,22500,2,101)`,
        [nodeNumber, resource, worker, contributorWorkspace],
      );
      await sql.query(
        "INSERT INTO fmworker_reward_remainders VALUES($1,2500)",
        [contributorWorkspace],
      );
      // Fixture for an older deployment with an independent earnings account.
      await sql.query(
        "CREATE TABLE fmworker_accounts(owner_id uuid PRIMARY KEY REFERENCES users, balance bigint NOT NULL)",
      );
      await sql.query("INSERT INTO fmworker_accounts VALUES($1,39)", [worker]);
      await sql.query("SELECT fmworker_restore_funds()");
      await sql.query("UPDATE wallets SET held=16 WHERE workspace_id=$1", [
        workspace,
      ]);
      for (const [index, job] of [
        leased,
        retried,
        untouched,
        boundFlow,
      ].entries()) {
        await sql.query(
          `INSERT INTO jobs(id,workspace_id,owner_id,model_id,connection_id,plugin_id,plugin_version,
             config_snapshot,provider_model,kind,input,idempotency_key,request_hash,price,state,
             remote_id,original_node,original_gpu_ticket,receipt,lease_token,lease_until,original_view)
           SELECT $1::uuid,workspace_id,owner_id,model_id,connection_id,COALESCE($9,plugin_id),plugin_version,
             config_snapshot,provider_model,kind,input,$1::uuid::text,$1::uuid::text,4,$2,
             $3,$4,$5,$6,$7::uuid,CASE WHEN $7::uuid IS NULL THEN NULL ELSE now()+interval '1 day' END,$10::json
           FROM jobs WHERE id=$8`,
          [
            job,
            index === 0 ? "running" : "queued",
            index === 0 ? resource : null,
            index === 0 ? nodeNumber : null,
            index === 0 ? "retired-ticket" : null,
            index === 0
              ? JSON.stringify({ fixture: "provider receipt" })
              : null,
            index === 0 ? leases[0] : null,
            settled,
            job === boundFlow || job === untouched ? "flow" : null,
            job === boundFlow
              ? JSON.stringify({
                  unrelated: { flow_source_job: 13 },
                  actual: { flow_source_job: 42 },
                  note: "old\0draft\ud800",
                })
              : JSON.stringify({ unrelated: { flow_source_job: 42 } }),
          ],
        );
        await sql.query("INSERT INTO outbox(job_id) VALUES($1)", [job]);
        await sql.query(
          `INSERT INTO ledger(id,workspace_id,job_id,key,action,amount,balance_snapshot,held_snapshot)
           VALUES(gen_random_uuid(),$1,$2::uuid,'hold:'||$2::uuid,'hold',4,100,$3)`,
          [workspace, job, (index + 1) * 4],
        );
        if (index < 2) {
          await sql.query(
            "INSERT INTO fmworker_assignments(job_id,ticket,node_id,owner_id,reward_bps,protocol_ticket) VALUES($1,$2,$3,$4,7000,$5)",
            [job, leases[index], resource, worker, secret()],
          );
        }
      }
      await sql.query(
        `INSERT INTO job_runs(job,run_key,attempt,node,plugin_id,plugin_version,kind,model,features,created,status,phase)
         SELECT id,'fmworker:run',1,remote_id,plugin_id,plugin_version,kind,provider_model,'{}',100,'running','generating'
         FROM jobs WHERE id=$1`,
        [leased],
      );
      return { resource, paired, code };
    });
    const rows = async (table: string) =>
      financialRows(table, (await f.db.query("SELECT * FROM " + table + " ORDER BY 1")).rows);
    const before = {
      wallets: await rows("wallets"),
      ledger: await rows("ledger"),
      fmworker_rewards: await rows("fmworker_rewards"),
      fmworker_reward_remainders: await rows("fmworker_reward_remainders"),
      fmworker_accounts: await rows("fmworker_accounts"),
      fmworker_funds: await rows("fmworker_funds"),
      fmworker_fund_holds: await rows("fmworker_fund_holds"),
      fmworker_usage: await rows("fmworker_usage"),
    };
    const ordinaryBefore = await one(
      f.db,
      "SELECT * FROM gpu_nodes WHERE id=$1",
      [paired],
    );
    const settledBefore = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [
      settled,
    ]);
    if (process.env.TEST_DATABASE_URL) {
      // An open writer must fail before any credentials, jobs or funds change.
      await f.db.transaction(async (sql) => {
        await sql.query("LOCK ledger IN ROW EXCLUSIVE MODE");
        await assert.rejects(
          migrate(f.db),
          /stop API, workers and other database writers\/readers/,
        );
      });
      assert.equal(
        await one(
          f.db,
          "SELECT version FROM schema_migrations WHERE version=$1",
          [retiredSql],
        ),
        undefined,
      );
      assert.deepEqual(await rows("wallets"), before.wallets);
      assert.equal(
        (await one(f.db, "SELECT enabled FROM fmworker_resources")).enabled,
        true,
      );
    }
    await migrate(f.db);
    for (const [table, value] of Object.entries(before))
      assert.deepEqual(await rows(table), value, table);
    assert.deepEqual(
      financialRows("jobs", [
        await one(f.db, "SELECT * FROM jobs WHERE id=$1", [settled]),
      ])[0],
      {
        ...financialRows("jobs", [settledBefore])[0],
        package_version: null,
        studio_client_uid: null,
        source_kind: "plugin",
        route_revision_id: null,
        price_revision_id: null,
        native_snapshot: null,
        meter: null,
      },
    );
    const ordinary = await one(f.db, "SELECT * FROM gpu_nodes WHERE id=$1", [
      paired,
    ]);
    assert.deepEqual(ordinary, { ...ordinaryBefore, fmworker_retired: false });
    assert.equal((await gpu.node(regularSecret)).id, paired);
    await assert.rejects(gpu.node(oldSecret), /节点凭据失效/);
    await assert.rejects(
      nodes.registration("Bearer " + oldSecret),
      /实例凭据已撤销/,
    );
    await assert.rejects(
      nodes.enroll({ code: oldPair, secret: oldSecret }),
      /配对码已过期或无效/,
    );
    await assert.rejects(
      nodes.enroll({ code, secret: oldSecret }),
      /fmWorker credential or connection has retired/,
    );
    const freshKey = secret();
    assert.deepEqual(await nodes.enroll({ code, secret: freshKey }), {
      ok: true,
      models: ["breeze-tts-2"],
    });
    assert.equal(
      (await nodes.registration("Bearer " + freshKey)).control,
      "active",
    );
    assert.notEqual(
      (
        await one(f.db, "SELECT token_hash FROM gpu_nodes WHERE id=$1", [
          resource,
        ])
      ).token_hash,
      hash(oldSecret),
    );
    await f.db.query(
      "UPDATE gpu_pairings SET expires_at=to_timestamp(0) WHERE owner_id=$1",
      [worker],
    );
    await assert.rejects(
      f.db.query(
        "UPDATE gpu_pairings SET expires_at=now()+interval '1 day' WHERE owner_id=$1",
        [worker],
      ),
      /fmWorker pairing has retired/,
    );
    assert.deepEqual(
      (await rows("outbox")).map(({ job_id }) => job_id),
      [untouched],
    );
    const pending = await rows("retired_fmworker_jobs");
    assert.equal(pending.length, 3);
    const liveEvidence = pending.find((row) => row.job_id === leased)!;
    assert.deepEqual(liveEvidence.previous_receipt, {
      fixture: "provider receipt",
    });
    assert.equal(liveEvidence.previous_remote_id, resource);
    assert.equal(liveEvidence.previous_state, "running");
    assert.equal(
      pending.find((row) => row.job_id === retried)?.previous_state,
      "queued",
    );
    assert.deepEqual(
      await one(f.db, "SELECT status,valid FROM job_runs WHERE job=$1", [
        leased,
      ]),
      { status: "interrupted", valid: false },
    );
    const executor = new Executor(f.p);
    await executor.recover();
    for (const job of [leased, retried, boundFlow]) {
      assert.equal(await executor.claim(job), undefined);
      const state = await one(
        f.db,
        "SELECT state,lease_token,lease_until,original_gpu_ticket FROM jobs WHERE id=$1",
        [job],
      );
      assert.deepEqual(state, {
        state: "uncertain",
        lease_token: null,
        lease_until: null,
        original_gpu_ticket: null,
      });
      await assert.rejects(
        f.db.query("UPDATE jobs SET state='queued' WHERE id=$1", [job]),
        /cannot be resumed/,
      );
    }
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [untouched]))
        .state,
      "queued",
    );
    assert.ok(
      (await rows("fmworker_assignments")).every(
        ({ protocol_ticket }) => protocol_ticket === null,
      ),
    );
    const procedures = await one(
      f.db,
      `SELECT count(*)::int AS count FROM pg_proc
      WHERE pronamespace=current_schema()::regnamespace AND proname IN
      ('fmworker_track_ledger','fmworker_reserve','fmworker_restore_funds','restore_original_fmworker_history','restore_original_fmworker_resources')`,
    );
    assert.equal(procedures.count, 0);
    assert.equal(
      await one(
        f.db,
        "SELECT 1 FROM pg_trigger WHERE tgrelid='ledger'::regclass AND tgname='fmworker_track_ledger'",
      ),
      undefined,
    );
    await assert.rejects(
      f.db.query("UPDATE fmworker_rewards SET credited=7"),
      /contribution history is read-only/,
    );
    await assert.rejects(
      f.db.query("UPDATE fmworker_assignments SET completed=true"),
      /contribution history is read-only/,
    );
    await assert.rejects(
      f.db.query(
        "INSERT INTO fmworker_usage(node_id,uid,units,created) VALUES($1,decode('ff','hex'),1,155)",
        [resource],
      ),
      /contribution history is read-only/,
    );
    await assert.rejects(
      f.db.query("TRUNCATE fmworker_rewards"),
      /contribution history is read-only/,
    );
    await assert.rejects(
      f.db.transaction((sql) =>
        f.p.credit(
          sql,
          contributorWorkspace,
          7,
          "fmworker:late-reward",
          "contribution",
        ),
      ),
      /contribution history is read-only/,
    );
    assert.deepEqual(await rows("wallets"), before.wallets);
    assert.deepEqual(await rows("ledger"), before.ledger);
    assert.deepEqual(await importLegacy(f.p, snapshot, f.directory), {
      alreadyImported: true,
    });
    await migrate(f.db);
    assert.deepEqual(await rows("retired_fmworker_jobs"), pending);

    // An operator records a concrete upstream finding. Ordinary wallet
    // refund and recharge remain idempotent and never touch earnings.
    const operations = new Operations(f.p);
    const evidence = {
      action: "refund",
      reason: "Synthetic upstream delivery log confirms the job failed.",
    };
    await operations.resolve(actor, leased, evidence);
    await assert.rejects(
      operations.resolve(actor, leased, evidence),
      /只允许核对未确认任务/,
    );
    const topUp = () =>
      f.db.transaction((sql) =>
        f.p.credit(
          sql,
          workspace,
          5,
          "fixture:recharge-after-cutover",
          "recharge",
        ),
      );
    await topUp();
    await topUp();
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT action,amount FROM ledger WHERE key IN ($1,$2) ORDER BY public_id",
          ["settle:" + leased, "fixture:recharge-after-cutover"],
        )
      ).rows.map((row) => [row.action, Number(row.amount)]),
      [
        ["refund", 4],
        ["recharge", 5],
      ],
    );
    const after = await one(
      f.db,
      "SELECT balance,held FROM wallets WHERE workspace_id=$1",
      [workspace],
    );
    assert.deepEqual([Number(after.balance), Number(after.held)], [105, 12]);
    assert.deepEqual(
      (await rows("wallets")).find((w) => w.workspace_id === contributorWorkspace),
      before.wallets.find((w) => w.workspace_id === contributorWorkspace),
    );
    for (const [table, value] of Object.entries(before).filter(([table]) =>
      table.startsWith("fmworker_"),
    ))
      assert.deepEqual(await rows(table), value, table);
    assert.deepEqual(await rows("retired_fmworker_jobs"), pending);
  } finally {
    await f.cleanup();
  }
});

test("upgrade after 031 repairs only missed Flow quarantines and preserves prior evidence", async () => {
  const f = await databaseFixture(lastContributionMigration);
  try {
    const flowModel = "flow:veo-3.1-quality-4s-landscape";
    const oldSources = [13, 42, 43, 44, 45];
    await importLegacy(
      f.p,
      {
        version: 1,
        source,
        tables: {
          users: [
            { id: 7, name: "admin", role: "admin", active: 1 },
            { id: 8, name: "contributor", role: "member", active: 1 },
          ],
          workspaces: [
            { id: 23, kind: "personal", owner: 7, name: "jobs" },
            { id: 24, kind: "personal", owner: 8, name: "rewards" },
          ],
          credit_accounts: [
            { workspace: 23, balance: 100, reserved: 0 },
            { workspace: 24, balance: 20, reserved: 0 },
          ],
          jobs: oldSources.map((id) => ({
            id,
            owner: id === 45 ? 8 : 7,
            workspace: id === 45 ? 24 : 23,
            status: "done",
            model: flowModel,
            kind: "video",
            created: 100,
          })),
        },
      },
      f.directory,
    );
    const retiredNode = await new GpuGateway(f.p).addNode(
      f.db,
      connection,
      owner,
      "Historical contribution node",
      [flowModel],
      hash(secret()),
    );
    const ordinaryNode = await new GpuGateway(f.p).addNode(
      f.db,
      connection,
      owner,
      "Ordinary node",
      [flowModel],
      hash(secret()),
    );
    await f.db.query(
      "INSERT INTO fmworker_resources(node_id,kind,enabled) VALUES($1,'flow',true)",
      [retiredNode],
    );
    await f.db.query(
      "UPDATE jobs SET original_node=(SELECT public_id FROM gpu_nodes WHERE id=$1) WHERE public_id=ANY($2::bigint[])",
      [retiredNode, [44, 45]],
    );
    await f.db.query(
      "UPDATE jobs SET original_node=(SELECT public_id FROM gpu_nodes WHERE id=$1) WHERE public_id=13",
      [ordinaryNode],
    );
    await f.db.query(
      `INSERT INTO fmworker_assignments(job_id,ticket,node_id,owner_id,reward_bps,completed)
       SELECT id,gen_random_uuid(),$1,$2,5000,public_id=43 FROM jobs WHERE public_id IN (13,43)`,
      [retiredNode, owner],
    );
    await f.db.query(
      `INSERT INTO fmworker_rewards(job_number,node_number,owner_id,workspace_id,units,credited,created)
       SELECT 42,public_id,$2,$3,25000,2,101 FROM gpu_nodes WHERE id=$1`,
      [
        retiredNode,
        legacyId(source, "user", 8),
        legacyId(source, "workspace", 24),
      ],
    );
    const pending = [
      {
        unrelated: { flow_source_job: 13 },
        actual: { flow_source_job: 42 },
        note: "a\0b\ud800",
      },
      { unrelated: { flow_source_job: 13 }, actual: { flow_source_job: 43 } },
      { actual: { flow_source_job: 44 } },
    ];
    const ordinary = [
      { unrelated: { flow_source_job: 42 }, actual: { flow_source_job: 13 } },
      {
        actual: { unrelated: { flow_source_job: 42 } },
        note: '{"actual":{"flow_source_job":42}} \\u0000',
      },
      { actual: { flow_source_job: 45 } },
      { actual: { flow_source_job: "42" } },
    ];
    const add = async (view: object, plugin = "flow", state = "queued") => {
      const id = randomUUID();
      await f.db.query(
        `INSERT INTO jobs(id,workspace_id,owner_id,model_id,connection_id,plugin_id,plugin_version,
           config_snapshot,provider_model,kind,input,idempotency_key,request_hash,price,state,original_view,receipt)
         SELECT $1,workspace_id,owner_id,model_id,connection_id,$2,plugin_version,
           config_snapshot,provider_model,kind,'{"params":{"source_media_id":"42"}}',
           $1::uuid::text,$1::uuid::text,price,$3,$4,'{"fixture":"previous receipt"}'
         FROM jobs WHERE public_id=13`,
        [id, plugin, state, JSON.stringify(view)],
      );
      await f.db.query("INSERT INTO outbox(job_id) VALUES($1)", [id]);
      return id;
    };
    const quarantined: string[] = [];
    for (const [index, view] of pending.entries())
      quarantined.push(
        await add(view, "flow", index === 2 ? "running" : "queued"),
      );
    const untouched: string[] = [];
    for (const view of ordinary) untouched.push(await add(view));
    untouched.push(
      await add({ actual: { flow_source_job: 42 } }, "legacy-archive"),
    );
    const previous = await add(ordinary[0]);
    // Reproduce the durable state a false match left on a database at old 031.
    const migration = await readFile("migrations/" + retiredSql, "utf8");
    await f.db.transaction(async (sql) => {
      await sql.query(migration);
      await sql.query(
        "INSERT INTO schema_migrations(version,applied_at) VALUES($1,'2000-01-01+00')",
        [retiredSql],
      );
      await sql.query(
        `INSERT INTO retired_fmworker_jobs(job_id,previous_state,previous_receipt)
         SELECT id,state,receipt FROM jobs WHERE id=$1`,
        [previous],
      );
      await sql.query(
        "UPDATE jobs SET state='uncertain',request_uncertain=true WHERE id=$1",
        [previous],
      );
      await sql.query(
        `INSERT INTO job_events(job_id,state,detail)
         VALUES($1,'uncertain','{"reason":"fmworker_retired"}')`,
        [previous],
      );
      await sql.query("DELETE FROM outbox WHERE job_id=$1", [previous]);
    });
    const archive = () =>
      f.db.query("SELECT * FROM retired_fmworker_jobs ORDER BY job_id");
    const untouchedJobs = () =>
      f.db.query(
        "SELECT id,state,original_view::text FROM jobs WHERE id=ANY($1::uuid[]) ORDER BY id",
        [untouched],
      );
    const balances = () =>
      f.db.query("SELECT * FROM wallets ORDER BY workspace_id");
    const ledger = () => f.db.query("SELECT * FROM ledger ORDER BY id");
    const historical = () =>
      f.db.query(
        "SELECT state,original_view::text,receipt::text FROM jobs WHERE id=$1",
        [previous],
      );
    const before = {
      archive: (await archive()).rows[0],
      untouched: (await untouchedJobs()).rows,
      balances: (await balances()).rows,
      ledger: (await ledger()).rows,
      historical: (await historical()).rows,
    };
    await migrate(f.db);
    const { rows } = await archive();
    assert.deepEqual(
      rows.find(({ job_id }) => job_id === previous),
      before.archive,
    );
    assert.deepEqual(
      rows
        .filter(({ job_id }) => job_id !== previous)
        .map(({ job_id }) => job_id)
        .sort(),
      [...quarantined].sort(),
    );
    assert.equal(
      rows.find(({ job_id }) => job_id === quarantined[2])?.previous_state,
      "running",
    );
    assert.deepEqual((await untouchedJobs()).rows, before.untouched);
    assert.deepEqual(financialRows("wallets", (await balances()).rows), financialRows("wallets", before.balances));
    assert.deepEqual(financialRows("ledger", (await ledger()).rows), financialRows("ledger", before.ledger));
    assert.deepEqual((await historical()).rows, before.historical);
    assert.deepEqual(
      (await f.db.query("SELECT job_id FROM outbox ORDER BY job_id")).rows.map(
        ({ job_id }) => job_id,
      ),
      [...untouched].sort(),
    );
    const executor = new Executor(f.p);
    const operations = new Operations(f.p);
    const actor = {
      id: owner,
      role: "admin" as const,
      name: "admin",
      nickname: "admin",
    };
    for (const id of [...quarantined, previous]) {
      assert.equal(await executor.claim(id), undefined);
      await assert.rejects(
        operations.resolve(actor, id, {
          action: "resume",
          reason: "Check archived Flow provenance",
          remoteId: "synthetic",
        }),
        { status: 409, message: "退役任务只能人工核对退款" },
      );
    }
    await migrate(f.db);
    assert.deepEqual((await archive()).rows, rows);
  } finally {
    await f.cleanup();
  }
});

test("Pure cutover archives independent earnings and rejects an unresolved claim before export", async () => {
  const f = await databaseFixture();
  try {
    const python = process.env.STUDIO_PYTHON || "python3";
    const database = join(f.directory, "pure.sqlite");
    const output = join(f.directory, "pure.json");
    const oldKey = secret(),
      oldTicket = secret(),
      oldPair = secret();
    const run = (statement: string) =>
      execFileSync(python, [
        "-c",
        "import sqlite3,sys; sqlite3.connect(sys.argv[1]).executescript(sys.argv[2])",
        database,
        statement,
      ]);
    run(`
      CREATE TABLE users(id INTEGER, name TEXT, role TEXT, active INTEGER);
      INSERT INTO users VALUES(7,'admin','admin',1),(8,'earner','member',1);
      CREATE TABLE workspaces(id INTEGER, name TEXT, owner INTEGER, kind TEXT);
      INSERT INTO workspaces VALUES(23,'买家',7,'personal'),(24,'旧贡献者',8,'personal');
      CREATE TABLE settings(key TEXT,value TEXT);
      INSERT INTO settings VALUES('workspaces_migrated_v1','23'),('fmworker_reward_bps','7000');
      CREATE TABLE credit_accounts(workspace INTEGER,balance INTEGER,reserved INTEGER);
      INSERT INTO credit_accounts VALUES(23,50,6),(24,12,0);
      CREATE TABLE credit_ledger(id INTEGER,workspace INTEGER,job INTEGER,action TEXT,amount INTEGER,balance INTEGER,reserved INTEGER,note TEXT,created INTEGER);
      INSERT INTO credit_ledger VALUES
        (1,23,NULL,'recharge',55,55,0,'历史充值',1),
        (2,23,42,'spend',5,50,0,'已完成消费',2),
        (3,24,42,'contribution',2,12,0,'已入消费钱包',2),
        (4,23,43,'hold',6,50,6,'旧冻结',3);
      CREATE TABLE jobs(id INTEGER,workspace INTEGER,owner INTEGER,kind TEXT,model TEXT,status TEXT,
        node INTEGER,attempts INTEGER,created INTEGER,ticket TEXT,lease INTEGER,note TEXT,output_metadata TEXT);
      INSERT INTO jobs VALUES
        (42,23,7,'video','flow:fixture','done',41,1,1,'${oldTicket}',2,'已完成','{"flow_media_id":"private-flow-id","width":1280}'),
        (43,23,7,'audio','breeze-tts-2','queued',NULL,1,3,'${oldTicket}',4,'旧调度曾经重新入队','{}');
      CREATE TABLE credit_charges(job INTEGER,amount INTEGER,state TEXT);
      INSERT INTO credit_charges VALUES(42,5,'spent'),(43,6,'held');
      CREATE TABLE nodes(id INTEGER,owner INTEGER,name TEXT,stage TEXT,lastseen INTEGER,control TEXT,models TEXT,ready_models TEXT,profile TEXT,key TEXT);
      INSERT INTO nodes VALUES(41,8,'Pure contributor','ready',3,'active','["breeze-tts-2"]','["breeze-tts-2"]','{}','${hash(oldKey)}');
      CREATE TABLE pairs(label TEXT,key TEXT);
      INSERT INTO pairs VALUES('弗淼006','${hash(oldPair)}');
      CREATE TABLE fm_resources(node INTEGER,kind TEXT,enabled INTEGER,capabilities TEXT,created INTEGER);
      INSERT INTO fm_resources VALUES(41,'breeze',1,'{"models":["breeze-tts-2"]}',1);
      CREATE TABLE fm_assignments(job INTEGER,ticket TEXT,node INTEGER,owner INTEGER,reward_bps INTEGER,created INTEGER);
      INSERT INTO fm_assignments VALUES(42,'${oldTicket}',41,8,7000,1),(43,'${oldTicket}',41,8,7000,3);
      CREATE TABLE fm_fund_holds(job INTEGER,workspace INTEGER,amount INTEGER,state TEXT);
      INSERT INTO fm_fund_holds VALUES(42,23,5,'spent'),(43,23,6,'held');
      CREATE TABLE fm_funds(workspace INTEGER,eligible INTEGER,held INTEGER);
      INSERT INTO fm_funds VALUES(23,50,6),(24,2,0);
      CREATE TABLE fm_rewards(job INTEGER,node INTEGER,owner INTEGER,workspace INTEGER,units INTEGER,credited INTEGER,created INTEGER);
      INSERT INTO fm_rewards VALUES(42,41,8,24,22000,2,2),(102,41,8,24,500,0,2);
      CREATE TABLE fm_reward_remainders(workspace INTEGER,units INTEGER);
      INSERT INTO fm_reward_remainders VALUES(24,2500);
      CREATE TABLE fm_usage(node INTEGER,uid TEXT,units REAL,created INTEGER);
      INSERT INTO fm_usage VALUES(41,'历史'||char(0)||'用量',2.5,1);
      CREATE TABLE fm_accounts(id INTEGER,owner INTEGER,balance INTEGER,earned INTEGER,api_key TEXT);
      INSERT INTO fm_accounts VALUES(11,8,39,41,'independent-secret');
      CREATE TABLE fm_account_ledger(id INTEGER,account INTEGER,job INTEGER,action TEXT,amount INTEGER,balance INTEGER,created INTEGER);
      INSERT INTO fm_account_ledger VALUES(18,11,42,'earn',39,39,2);
    `);
    const exportArgs = [
      "scripts/export-legacy.py",
      "--database",
      database,
      "--source",
      source,
      "--output",
      output,
    ];
    const activeDatabase = await readFile(database);
    assert.throws(
      () => execFileSync(python, exportArgs, { stdio: "pipe" }),
      /旧贡献任务需人工核对（任务编号：43）/,
    );
    assert.deepEqual(await readFile(database), activeDatabase);
    await assert.rejects(readFile(output), { code: "ENOENT" });

    // The fixture operator verified upstream failure and settled only the
    // consumption refund before creating a new snapshot.
    run(`
      UPDATE jobs SET status='failed',note='Synthetic provider log confirms failure' WHERE id=43;
      UPDATE credit_charges SET state='refunded' WHERE job=43;
      UPDATE credit_accounts SET reserved=0 WHERE workspace=23;
      INSERT INTO credit_ledger VALUES(5,23,43,'refund',6,50,0,'核对后退款',4);
      UPDATE fm_fund_holds SET state='refunded' WHERE job=43;
      UPDATE fm_funds SET held=0 WHERE workspace=23;
    `);
    const settledDatabase = await readFile(database);
    execFileSync(python, exportArgs, { stdio: "pipe" });
    const content = await readFile(output, "utf8");
    assert.deepEqual(await readFile(database), settledDatabase);
    for (const credential of [
      oldKey,
      hash(oldKey),
      oldPair,
      hash(oldPair),
      oldTicket,
      "independent-secret",
    ])
      assert.ok(!content.includes(credential));
    const snapshot: LegacyExport = JSON.parse(content);
    const early = structuredClone(snapshot);
    delete early.tables.fm_retired_node_credentials;
    await assert.rejects(
      importLegacy(f.p, early, f.directory),
      /缺少旧贡献凭据的撤销摘要/,
    );
    assert.deepEqual(
      (
        await Promise.all([
          importLegacy(f.p, snapshot, f.directory),
          importLegacy(f.p, snapshot, f.directory),
        ])
      ).map((entry) => "alreadyImported" in entry && entry.alreadyImported),
      [false, true],
    );
    const modified = structuredClone(snapshot);
    modified.tables.fm_accounts[0].balance++;
    await assert.rejects(
      importLegacy(f.p, modified, f.directory),
      /相同迁移来源的内容已变化/,
    );
    await migrate(f.db);
    assert.deepEqual(await importLegacy(f.p, snapshot, f.directory), {
      alreadyImported: true,
    });

    assert.deepEqual(
      (
        await f.db.query(
          "SELECT balance,held FROM wallets JOIN workspaces ON workspaces.id=wallets.workspace_id ORDER BY public_id",
        )
      ).rows.map((row) => [Number(row.balance), Number(row.held)]),
      [
        [50, 0],
        [12, 0],
      ],
    );
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT action,amount,original_job_id FROM ledger ORDER BY public_id",
        )
      ).rows.map((row) => [
        row.action,
        Number(row.amount),
        row.original_job_id === null ? null : Number(row.original_job_id),
      ]),
      [
        ["recharge", 55, null],
        ["spend", 5, 42],
        ["contribution", 2, 42],
        ["hold", 6, 43],
        ["refund", 6, 43],
      ],
    );
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT collection,payload FROM legacy_records WHERE collection IN ('fm_accounts','fm_account_ledger') ORDER BY collection",
        )
      ).rows,
      [
        {
          collection: "fm_account_ledger",
          payload: {
            id: 18,
            account: 11,
            job: 42,
            action: "earn",
            amount: 39,
            balance: 39,
            created: 2,
          },
        },
        {
          collection: "fm_accounts",
          payload: { id: 11, owner: 8, balance: 39, earned: 41 },
        },
      ],
    );
    const archive = async (collection: string) =>
      (
        await f.db.query(
          "SELECT payload FROM legacy_records WHERE collection=$1 ORDER BY legacy_id",
          [collection],
        )
      ).rows.map(({ payload }) => payload);
    for (const collection of [
      "fm_rewards",
      "fm_assignments",
      "fm_fund_holds",
      "fm_reward_remainders",
      "fm_funds",
    ])
      assert.deepEqual(await archive(collection), snapshot.tables[collection]);
    assert.deepEqual(
      (await one(f.db, "SELECT original_view FROM jobs WHERE public_id=42"))
        .original_view.actual,
      { width: 1280 },
    );
    assert.equal(
      JSON.parse((await archive("jobs"))[0].output_metadata).flow_media_id,
      "private-flow-id",
    );
    assert.deepEqual(await archive("fm_usage"), [
      {
        node: 41,
        uid_hex: Buffer.from("历史\0用量").toString("hex"),
        units: 2.5,
        created: 1,
      },
    ]);
    assert.equal(
      (await one(f.db, "SELECT nextval('jobs_public_id_seq') > 102 AS safe"))
        .safe,
      true,
    );
    const node = await one(
      f.db,
      "SELECT fmworker_retired,token_hash,archived,enabled,control FROM gpu_nodes",
    );
    assert.deepEqual(
      [node.fmworker_retired, node.archived, node.enabled, node.control],
      [true, true, false, "removed"],
    );
    assert.notEqual(node.token_hash, hash(oldKey));
    assert.deepEqual(
      await one(f.db, "SELECT digest FROM retired_fmworker_credentials"),
      { digest: hash("fmworker-retired:" + hash(oldKey)) },
    );
    const gpu = new GpuGateway(f.p);
    await assert.rejects(gpu.node(oldKey), /节点凭据失效/);
    const { code } = await f.db.transaction((sql) =>
      gpu.createPairing(sql, owner, connection, {
        label: "Pure new pair",
        models: ["breeze-tts-2"],
      }),
    );
    const nodes = new OriginalNodes(f.p);
    await assert.rejects(
      nodes.enroll({ code, secret: oldKey }),
      /credential or connection has retired/,
    );
    const newKey = secret();
    assert.equal((await nodes.enroll({ code, secret: newKey })).ok, true);
    assert.equal(
      (await nodes.registration("Bearer " + newKey)).control,
      "active",
    );
    for (const table of [
      "fmworker_resources",
      "fmworker_assignments",
      "fmworker_usage",
      "fmworker_rewards",
      "fmworker_funds",
      "outbox",
    ])
      assert.equal((await f.db.query("SELECT * FROM " + table)).rows.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("055 integer wallet, active fixed-price hold and ledger upgrade and settle exactly", async (t) => {
  const f = await databaseFixture("055_workspace_script_documents.sql");
  t.after(() => f.cleanup());
  const snapshot: LegacyExport = { version: 1, source, tables: {
    users: [{ id: 7, role: "admin", name: "admin", active: 1 }],
    workspaces: [{ id: 23, kind: "personal", owner: 7, name: "个人" }],
    credit_accounts: [{ workspace: 23, balance: 100, reserved: 0 }],
    jobs: [{ id: 5, workspace: 23, owner: 7, kind: "video", model: "test", status: "done", created: 7 }],
    credit_charges: [{ job: 5, amount: 5, state: "spent" }],
    credit_ledger: [{ id: 1, workspace: 23, job: 5, action: "spend", amount: 5, balance: 100, reserved: 0, note: "旧流水", created: 7 }],
  }};
  await importLegacy(f.p, snapshot, f.directory);
  await f.db.query("UPDATE jobs SET state='queued' WHERE public_id=5");
  await f.db.query("UPDATE wallets SET held=5 WHERE workspace_id=$1", [workspace]);
  await f.db.query("UPDATE ledger SET action='hold',held_snapshot=5 WHERE workspace_id=$1", [workspace]);
  await migrate(f.db);
  const column = await one(f.db, "SELECT numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='wallets' AND column_name='balance'");
  assert.deepEqual([column.numeric_precision, column.numeric_scale], [31,12]);
  await f.db.transaction(async (sql) => {
    const job = await one(sql, "SELECT * FROM jobs WHERE public_id=5 FOR UPDATE");
    await f.p.settle(sql, job, "completed", undefined, undefined, undefined, { preserveTiming: true });
  });
  const { OriginalCredits } = await import("@fumiao/original-api/credits.js");
  const credits = new OriginalCredits(f.p);
  assert.deepEqual((await credits.wallet(f.db, 23)).exact, { balance: "95", reserved: "0", available: "95" });
  assert.deepEqual((await credits.history(f.db, 23)).map((r) => r.exact), [
    { amount: "5", balance: "95", reserved: "0" }, { amount: "5", balance: "100", reserved: "5" },
  ]);
});
