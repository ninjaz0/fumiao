import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { databaseFixture } from "../helpers/database.js";
import { migrate, one } from "@fumiao/platform/db.js";
import {
  importLegacy,
  legacyId,
  type LegacyExport,
} from "@fumiao/platform/importer.js";
import { OriginalStateRecords } from "@fumiao/original-api/state-records.js";
import {
  OriginalIdentity,
  type OriginalActor,
} from "@fumiao/original-api/identity.js";
import { validateStateImport } from "@fumiao/platform/import-state.js";
import { GpuGateway } from "@fumiao/platform/gpu.js";
import { Executor } from "@fumiao/platform/executor.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import { hash } from "@fumiao/platform/security.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";

function archive(): LegacyExport {
  return {
    version: 1,
    stateVersion: 1,
    source: "state-fixture",
    tables: {
      users: [
        {
          id: 7,
          name: "admin",
          nickname: "管理员",
          role: "admin",
          active: 1,
          salt: "fixture",
          pw: "fixture",
        },
        {
          id: 15,
          name: "member",
          nickname: "",
          role: "member",
          active: 1,
          salt: "fixture",
          pw: "fixture",
        },
      ],
      workspaces: [
        { id: 4, owner: 7, name: "团队", kind: "team" },
        { id: 9, owner: 15, name: "个人空间", kind: "personal" },
      ],
      workspace_members: [{ workspace: 4, user: 15 }],
      state_settings: [
        { key: "workspaces_migrated_v1", value: 4 },
        { key: "image_enabled", value: false },
      ],
      nodes: [
        {
          id: 49,
          owner: 15,
          name: "旧节点",
          stage: "ready",
          lastseen: 1000,
          control: "active",
          detail: "旧详情",
          models: '["MiniMax H3"]',
          ready_models: '["MiniMax H3"]',
          profile: "{}",
          key: "must-not-import",
          deadline: 9000,
        },
        {
          id: 51,
          owner: 7,
          name: "管理员节点",
          stage: "failed",
          lastseen: 1000,
          control: "paused",
          detail: "详情",
          models: [],
          ready_models: [],
          profile: {},
        },
        {
          id: 53,
          owner: 7,
          name: "已删除",
          stage: "failed",
          lastseen: 1000,
          control: "removed",
          models: [],
          ready_models: [],
          profile: {},
        },
      ],
      media: [],
      jobs: [
        {
          id: 42,
          workspace: 4,
          owner: 15,
          model: "MiniMax H3",
          kind: "video",
          prompt: "历史任务",
          refs: '["eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]',
          ratio: "16:9",
          quality: 480,
          seconds: 5,
          sampling_steps: 4,
          seed: 17,
          width: 864,
          height: 480,
          parent: 19,
          status: "failed",
          created: 950,
          updated: 1000,
          attempts: 2,
          node: 49,
          result: null,
          note: "实例连续中断，请重新生成",
          image_quality: "standard",
          audio_settings: "{}",
          h3_inputs: "{}",
          output_metadata: "{}",
          ticket: "old-ticket-do-not-copy",
          lease: 9000,
        },
      ],
    },
  };
}

test("state archive preserves original IDs, ownership, ordering and attempts without reusable node credentials", async () => {
  const f = await databaseFixture();
  try {
    const data = archive(),
      png = await sharp({
        create: { width: 16, height: 20, channels: 3, background: "blue" },
      })
        .png()
        .toBuffer();
    for (const [id, order, workspace] of [
      ["a".repeat(32), 9, 4],
      ["f".repeat(32), 2, 4],
      ["b".repeat(32), 12, 9],
    ] as const) {
      await writeFile(join(f.directory, id), png);
      data.tables.media.push({
        id,
        original_order: order,
        workspace,
        owner: 15,
        kind: "ref",
        mime: "image/png",
        size: png.length,
        w: 16,
        h: 20,
      });
    }
    await importLegacy(f.p, data, f.directory);
    assert.equal(
      (await importLegacy(f.p, data, f.directory)).alreadyImported,
      true,
    );
    const admin = (await one(
      f.db,
      "SELECT * FROM users WHERE public_id=7",
    )) as OriginalActor;
    const member = (await one(
      f.db,
      "SELECT * FROM users WHERE public_id=15",
    )) as OriginalActor;
    const records = new OriginalStateRecords(),
      wid = legacyId(data.source, "workspace", 4);
    assert.deepEqual(
      (await records.nodes(f.db, admin, 1080)).map((n) => [
        n.id,
        n.owner,
        n.stage,
        n.control,
      ]),
      [
        [51, 7, "offline", "paused"],
        [49, 15, "offline", "active"],
      ],
    );
    const mine = await records.nodes(f.db, member, 1075);
    assert.deepEqual(
      mine.map((n) => [n.id, n.stage, n.contributor, n.detail]),
      [],
    );
    assert.deepEqual(
      (await records.assets(f.db, wid)).map((a) => a.id),
      ["a".repeat(32), "f".repeat(32)],
    );
    const historical = (await records.archivedJobs(f.db, wid, 1080))[0];
    assert.equal(historical.attempts, 2);
    assert.equal(historical.node, 49);
    assert.equal(historical.parent, 19);
    assert.equal(historical.note, "实例连续中断，请重新生成");
    assert.deepEqual(historical.refs, ["e".repeat(32)]);
    assert.equal(historical.timing, null);
    assert.equal(historical.author, "member");
    await f.db.query("UPDATE jobs SET result=$1 WHERE public_id=42", [
      JSON.stringify({
        assets: [legacyId(data.source, "asset", "a".repeat(32))],
        text: "historical\0result",
      }),
    ]);
    assert.deepEqual(
      (await records.archivedJobs(f.db, wid, 1080))[0],
      historical,
    );
    assert.deepEqual(
      await records.archivedJobs(
        f.db,
        legacyId(data.source, "workspace", 9),
        1080,
      ),
      [],
    );
    const stored = (await f.db.query("SELECT * FROM gpu_nodes")).rows;
    assert.ok(
      stored.every(
        (n) =>
          !n.enabled && n.archived && n.token_hash !== hash("must-not-import"),
      ),
    );
    await assert.rejects(new GpuGateway(f.p).node("must-not-import"), {
      status: 401,
    });
    await assert.rejects(
      f.db.query("UPDATE gpu_nodes SET enabled=true WHERE public_id=49"),
    );
    const archived = JSON.stringify(
      (await f.db.query("SELECT payload FROM legacy_records")).rows,
    );
    assert.ok(!archived.includes("must-not-import"));
    assert.ok(!archived.includes("old-ticket-do-not-copy"));
    const settings = await one(f.db, "SELECT * FROM original_state_settings");
    assert.equal(settings.legacy_workspace_id, wid);
    assert.equal(settings.image_enabled, false);
    const uploaded = await f.p.upload(member, wid, png, "image/png");
    assert.equal(
      Number(
        (
          await one(f.db, "SELECT original_order FROM assets WHERE id=$1", [
            uploaded.id,
          ])
        ).original_order,
      ),
      13,
    );
    assert.equal(
      (await records.assets(f.db, wid))[0].id,
      (
        await one(f.db, "SELECT public_id FROM assets WHERE id=$1", [
          uploaded.id,
        ])
      ).public_id,
    );
  } finally {
    await f.cleanup();
  }
});

test("incomplete or forged state exports fail before copying media or changing PostgreSQL", async () => {
  const source = archive();
  for (const mutate of [
    (d: LegacyExport) => {
      delete d.tables.nodes;
    },
    (d: LegacyExport) => {
      delete d.tables.jobs[0].attempts;
    },
    (d: LegacyExport) => {
      d.tables.jobs[0].attempts = -1;
    },
    (d: LegacyExport) => {
      d.tables.nodes[0].owner = 99;
    },
    (d: LegacyExport) => {
      d.tables.nodes.push(d.tables.nodes[0]);
    },
    (d: LegacyExport) => {
      d.tables.nodes[0].profile = '{"apiKey":"forbidden"}';
    },
    (d: LegacyExport) => {
      d.tables.media = [{ id: "a".repeat(32) }];
    },
    (d: LegacyExport) => {
      d.tables.media = [{ original_order: 1 }, { original_order: 1 }];
    },
    (d: LegacyExport) => {
      d.tables.state_settings[0].value = 999;
    },
    (d: LegacyExport) => {
      d.tables.state_settings[1].value = "false";
    },
    (d: LegacyExport) => {
      d.tables.state_settings.push({ key: "apiKey", value: "forbidden" });
    },
  ]) {
    const data = structuredClone(source);
    mutate(data);
    assert.throws(() => validateStateImport(data.tables, data.stateVersion));
  }
  const f = await databaseFixture();
  try {
    source.tables.media = [{ id: "a".repeat(32) }];
    await assert.rejects(importLegacy(f.p, source, "nonexistent-objects"), {
      status: 400,
    });
    assert.equal((await f.db.query("SELECT * FROM users")).rows.length, 0);
    assert.equal(
      (await f.db.query("SELECT * FROM legacy_imports")).rows.length,
      0,
    );
  } finally {
    await f.cleanup();
  }
});

const plugin: ProviderPlugin = {
  manifest: {
    id: "attempt-fixture",
    version: "1.0.0",
    contractVersion: 1,
    label: "fixture",
    mode: "request",
    configSchema: { type: "object" },
    models: [
      {
        id: "fixture-chat",
        label: "fixture",
        kind: "chat",
        inputSchema: { type: "object" },
      },
    ],
  },
  health: async () => true,
  submit: async () => ({ state: "pending", remoteId: "local-fixture" }),
};
async function runtime(
  f: Awaited<ReturnType<typeof databaseFixture>>,
  mode: "request" | "pull" = "request",
) {
  const identity = new OriginalIdentity(f.p),
    password = "state-fixture-password";
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const admin = await identity.actor(
    await identity.login({ name: "admin", password }, "fixture"),
  );
  f.p.registry = new PluginRegistry([
    { ...plugin, manifest: { ...plugin.manifest, mode } },
  ]);
  await f.p.registry.installBuiltins(f.db);
  const connection = await f.p.createConnection(admin, {
    name: "fixture",
    pluginId: plugin.manifest.id,
    version: "1.0.0",
    config: {},
  });
  await f.p.updateConnection(admin, connection.id, {
    revision: 1,
    enabled: true,
    concurrency: 1,
  });
  const model = await one(f.db, "SELECT * FROM models WHERE connection_id=$1", [
    connection.id,
  ]);
  await f.p.setModel(admin, model.id, { price: 1, enabled: true });
  const workspace = await one(
    f.db,
    "SELECT * FROM workspaces WHERE kind='team'",
  );
  await f.db.transaction((sql) =>
    f.p.credit(sql, workspace.id, 100, randomUUID(), "adjust"),
  );
  const job = await f.p.submit(admin, workspace.id, {
    modelId: model.id,
    key: randomUUID(),
    prompt: "fixture",
    params: {},
  });
  return { admin, connection, job, workspace, model };
}

test("attempts count executions, not polling leases; enrolled nodes keep their actual owner", async () => {
  const f = await databaseFixture();
  try {
    const r = await runtime(f),
      executor = new Executor(f.p);
    await Promise.all([executor.execute(r.job.id), executor.execute(r.job.id)]);
    assert.equal(
      (await one(f.db, "SELECT attempts FROM jobs WHERE id=$1", [r.job.id]))
        .attempts,
      1,
    );
    await f.db.query(
      "UPDATE jobs SET lease_token=NULL,lease_until=NULL WHERE id=$1",
      [r.job.id],
    );
    assert.ok(await executor.claim(r.job.id));
    assert.equal(
      (await one(f.db, "SELECT attempts FROM jobs WHERE id=$1", [r.job.id]))
        .attempts,
      1,
    );
  } finally {
    await f.cleanup();
  }
  const g = await databaseFixture();
  try {
    const r = await runtime(g, "pull"),
      gpu = new GpuGateway(g.p),
      pair = await gpu.pair(r.admin, { connectionId: r.connection.id });
    const node = await gpu.enroll({
      code: pair.code,
      name: "GPU fixture",
      models: ["fixture-chat"],
    });
    assert.equal(
      (await one(g.db, "SELECT owner_id FROM gpu_nodes WHERE id=$1", [node.id]))
        .owner_id,
      r.admin.id,
    );
    const claims = await Promise.all([
      gpu.claim(node.token),
      gpu.claim(node.token),
    ]);
    assert.equal(claims.filter((c) => c.job).length, 1);
    assert.equal(
      (await one(g.db, "SELECT attempts FROM jobs WHERE id=$1", [r.job.id]))
        .attempts,
      1,
    );
    await gpu.heartbeat(node.token, { detail: "正在准备运行环境" });
    await gpu.heartbeat(node.token, {});
    assert.equal(
      (
        await new OriginalStateRecords().nodes(g.db, r.admin, Date.now() / 1000)
      )[0].detail,
      "正在准备运行环境",
    );
    await gpu.heartbeat(node.token, { detail: "" });
    assert.equal(
      (await one(g.db, "SELECT detail FROM gpu_nodes WHERE id=$1", [node.id]))
        .detail,
      "",
    );
  } finally {
    await g.cleanup();
  }
});

test("schema upgrade recovers known historical facts and keeps unknown facts explicit", async () => {
  const f = await databaseFixture("016_original_generation.sql");
  try {
    const r = await runtime(f),
      jid = legacyId("upgrade-state", "job", 42),
      aid = legacyId("upgrade-state", "asset", "b".repeat(32));
    await f.db.query(
      `INSERT INTO jobs(id,workspace_id,owner_id,model_id,connection_id,plugin_id,plugin_version,config_snapshot,provider_model,kind,input,idempotency_key,request_hash,price,state,public_id)
      VALUES($1,$2,$3,$4,$5,'legacy-archive','1.0.0','unused','MiniMax H3','video','{}','legacy','legacy',1,'failed',42)`,
      [jid, r.workspace.id, r.admin.id, r.model.id, r.connection.id],
    );
    await f.db.query(
      "INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state) VALUES($1,$2,$3,'fixture','image/png',1,'ready')",
      [aid, r.workspace.id, r.admin.id],
    );
    for (const [collection, key, payload] of [
      [
        "jobs",
        "42",
        {
          attempts: 2,
          node: 17,
          refs: '["cccccccccccccccccccccccccccccccc"]',
          ticket: "expired-upgrade-ticket",
          lease: 9000,
        },
      ],
      ["media", "b".repeat(32), { original_order: 25 }],
    ] as const)
      await f.db.query(
        "INSERT INTO legacy_records(source,collection,legacy_id,payload) VALUES('upgrade-state',$1,$2,$3)",
        [collection, key, JSON.stringify(payload)],
      );
    const oldNode = randomUUID();
    await f.db.query(
      "INSERT INTO gpu_nodes(id,connection_id,name,token_hash,models) VALUES($1,$2,'old node','fixture-hash','[]')",
      [oldNode, r.connection.id],
    );
    await migrate(f.db);
    await migrate(f.db);
    const historical = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [jid]);
    assert.equal(historical.attempts, 2);
    assert.equal(Number(historical.original_node), 17);
    assert.deepEqual(historical.original_view.refs, ["c".repeat(32)]);
    assert.equal(
      Number(
        (
          await one(f.db, "SELECT original_order FROM assets WHERE id=$1", [
            aid,
          ])
        ).original_order,
      ),
      25,
    );
    assert.equal(
      (await one(f.db, "SELECT attempts FROM jobs WHERE id=$1", [r.job.id]))
        .attempts,
      0,
    );
    assert.equal(
      (await one(f.db, "SELECT owner_id FROM gpu_nodes WHERE id=$1", [oldNode]))
        .owner_id,
      null,
    );
    await assert.rejects(
      new OriginalStateRecords().nodes(f.db, r.admin, Date.now() / 1000),
      { status: 503 },
    );
    const payload = (
      await one(
        f.db,
        "SELECT payload FROM legacy_records WHERE collection='jobs'",
      )
    ).payload;
    assert.ok(!Object.hasOwn(payload, "ticket"));
    assert.ok(!Object.hasOwn(payload, "lease"));
    await f.db.query("UPDATE assets SET original_order=NULL");
    await assert.rejects(
      new OriginalStateRecords().assets(f.db, r.workspace.id),
      { status: 503 },
    );
  } finally {
    await f.cleanup();
  }
});
