import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { OriginalCanvasRuns } from "@fumiao/original-api/canvas-runs.js";
import { OriginalCanvases } from "@fumiao/original-api/canvases.js";
import { OriginalEstimates } from "@fumiao/original-api/estimate.js";
import { OriginalGeneration } from "@fumiao/original-api/generation.js";
import {
  OriginalIdentity,
  type OriginalActor,
} from "@fumiao/original-api/identity.js";
import { OriginalState } from "@fumiao/original-api/state.js";
import { CanvasSubmissionModels } from "@fumiao/platform/canvas-submission.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { one } from "@fumiao/platform/db.js";
import { tryModerationEquivalentFallback } from "@fumiao/platform/moderation-rewrite.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import { QueueHealthPoller } from "@fumiao/platform/queue-health.js";
import {
  StudioPackages,
  type PackageFile,
} from "@fumiao/platform/studio-packages.js";
import { chatHttp } from "@fumiao/plugin-sdk/chat-transport.js";
import { summarizeModelSections } from "../../apps/web/studio/settings-models-helpers.js";
import { databaseFixture } from "../helpers/database.js";

async function museFixture() {
  const f = await databaseFixture();
  let healthProbes = 0;
  const server = createServer((req, res) => {
    if (req.url === "/readyz") {
      healthProbes++;
      res.end('{"status":"ready","accounts":[1]}');
      return;
    }
    if (req.url === "/v1/models") {
      res.end(
        JSON.stringify({
          data: [{ id: "muse-image" }, { id: "muse-video" }],
        }),
      );
      return;
    }
    if (req.url === "/v1/queue") {
      res.end('{"capacity":2,"maintenance":0,"tasks":[]}');
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const sandboxSend: typeof chatHttp = (url, options) => {
    assert.equal(url.origin, "https://1.1.1.1");
    return chatHttp(new URL(url.pathname, base), {
      ...options,
      lookup: undefined,
    });
  };
  f.p.registry = new PluginRegistry(undefined, [], sandboxSend);
  await f.p.registry.initializeStudio(f.db, false);
  const identity = new OriginalIdentity(f.p);
  const password = randomUUID();
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const admin = await identity.actor(
    await identity.login({ name: "admin", password }, "fixture"),
  );
  const createdMember = await f.db.transaction((sql) =>
    f.p.createUser(sql, "member", "成员", randomUUID(), "member"),
  );
  const member = (await one(f.db, "SELECT * FROM users WHERE id=$1", [
    createdMember.id,
  ])) as OriginalActor;
  const team = await one(f.db, "SELECT * FROM workspaces WHERE kind='team'");
  await f.db.query(
    "INSERT INTO members(workspace_id,user_id) VALUES($1,$2)",
    [team.id, member.id],
  );
  await f.db.transaction((sql) =>
    f.p.credit(sql, team.id, 1000, randomUUID(), "adjust"),
  );
  const packages = new StudioPackages(f.p);
  const museFile: PackageFile = JSON.parse(
    await readFile("plugins/muse/muse.fmplugin.json", "utf8"),
  );
  await packages.install(admin, museFile);
  const connection = await f.p.createConnection(
    admin,
    {
      name: "Muse 主服务",
      pluginId: museFile.id,
      version: museFile.adapterVersion,
      config: { baseUrl: "https://1.1.1.1", apiKey: "muse-test-key" },
    },
    true,
  );
  const catalog = new StudioCatalog(f.db);
  const prices = await catalog.prices();
  await f.db.transaction((sql) =>
    catalog.savePrices(
      sql,
      Object.fromEntries(prices.items.map((item) => [item.key, 5])),
      prices.revision,
    ),
  );
  const currentPkg = async () =>
    (await packages.list(admin)).find((p) => p.id === "muse")!;
  const setMuseState = async (action: "enable" | "disable") =>
    packages.change(admin, "muse", (await currentPkg()).revision, action);

  return {
    ...f,
    admin,
    member,
    team,
    packages,
    connection,
    setMuseState,
    probes: () => healthProbes,
    resetProbes: () => {
      healthProbes = 0;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await f.cleanup();
    },
  };
}

test("disabled plugin fails fast with '插件已停用' across studio submission, canvas runs, and direct platform submit", async () => {
  const f = await museFixture();
  try {
    const generation = new OriginalGeneration(f.p);
    const canvases = new OriginalCanvases(f.p);
    const canvasRuns = new OriginalCanvasRuns(f.p);
    const space = String(f.team.public_id);

    await f.setMuseState("enable");
    const accepted = await generation.submit(
      f.admin,
      await generation.parse("video", {
        uid: randomUUID(),
        prompt: "enable check",
        model: "muse-video",
        ratio: "16:9",
        seconds: 5,
      }),
      space,
    );
    assert.ok(accepted.id > 0);

    await f.setMuseState("disable");

    // Direct video and image submission must report 插件已停用, not version mismatch
    await assert.rejects(
      async () =>
        generation.submit(
          f.admin,
          await generation.parse("video", {
            uid: randomUUID(),
            prompt: "disabled video",
            model: "muse-video",
            ratio: "16:9",
            seconds: 5,
          }),
          space,
        ),
      { status: 409, message: "插件已停用" },
    );

    // Must fail before loading/validating references (so a missing ref does not mask plugin disable as 404)
    await assert.rejects(
      async () =>
        generation.submit(
          f.admin,
          await generation.parse("image", {
            uid: randomUUID(),
            prompt: "disabled image with missing ref",
            model: "muse-image",
            ratio: "16:9",
            refs: ["0".repeat(32)],
          }),
          space,
        ),
      { status: 409, message: "插件已停用" },
    );

    // Direct Platform.submit (via StudioCatalog.quote) must also report 插件已停用
    const modelRow = await one(
      f.db,
      "SELECT id FROM models WHERE connection_id=$1 AND catalog_id='muse-video'",
      [f.connection.id],
    );
    await assert.rejects(
      () =>
        f.p.submit(f.admin, f.team.id, {
          modelId: modelRow.id,
          key: randomUUID(),
          prompt: "platform direct disabled",
          params: { ratio: "16:9", seconds: 5 },
          references: [],
        }),
      { status: 409, message: "插件已停用" },
    );

    // Canvas node run using muse-video must also reject with 插件已停用
    const created = await canvases.create(f.admin, { title: "Muse 画布" }, space);
    const saved = await canvases.save(f.admin, created.id, {
      expected_revision: created.revision,
      title: "Muse 画布",
      document: {
        nodes: [
          {
            id: "v1",
            type: "video",
            x: 0,
            y: 0,
            title: "镜头 1",
            prompt: "disabled canvas video",
            params: { model: "muse-video", ratio: "16:9", seconds: 5 },
          },
        ],
        edges: [],
      },
    });
    await assert.rejects(
      () =>
        canvasRuns.generate(f.admin, created.id, "v1", {
          uid: randomUUID(),
          expected_revision: saved.revision,
        }),
      { status: 409, message: "插件已停用" },
    );
  } finally {
    await f.close();
  }
});

test("estimates report model_paused when the owning plugin is disabled", async () => {
  const f = await museFixture();
  try {
    const estimates = new OriginalEstimates(f.p);
    const space = String(f.team.public_id);

    await f.setMuseState("enable");
    await new QueueHealthPoller(f.p).refreshEnabled();

    const enabledEstimate = await estimates.read(
      f.admin,
      { kind: "video", model: "muse-video", ratio: "16:9", seconds: 5 },
      space,
    );
    assert.notEqual(enabledEstimate.queue?.reason, "model_paused");

    await f.setMuseState("disable");

    const disabledVideo = await estimates.read(
      f.admin,
      { kind: "video", model: "muse-video", ratio: "16:9", seconds: 5 },
      space,
    );
    assert.deepEqual(disabledVideo.queue, {
      source: "none",
      reason: "model_paused",
      ahead: 0,
    });

    const disabledImage = await estimates.read(
      f.admin,
      { kind: "image", model: "muse-image", ratio: "16:9" },
      space,
    );
    assert.deepEqual(disabledImage.queue, {
      source: "none",
      reason: "model_paused",
      ahead: 0,
    });
  } finally {
    await f.close();
  }
});

test("disabled plugin stops idle queue health polling, keeps polling while draining accepted jobs, and reports unconfigured/not-ready in state", async () => {
  const f = await museFixture();
  try {
    const poller = new QueueHealthPoller(f.p);
    const stateReader = new OriginalState(f.p);
    const generation = new OriginalGeneration(f.p);
    const space = String(f.team.public_id);

    // 1. Enabled plugin: polls upstream and exposes configured/ready + plugin access
    await f.setMuseState("enable");
    await poller.refreshEnabled();
    assert.equal(f.probes(), 1);

    const enabledAdminState = await stateReader.read(f.admin, space);
    assert.equal(enabledAdminState.muse.configured, true);
    assert.equal(enabledAdminState.muse.ready, true);
    assert.equal(enabledAdminState.model_access["muse-video"], true);
    assert.equal(enabledAdminState.model_plugin_access["muse-video"], true);
    assert.equal(enabledAdminState.model_plugin_access["muse-image"], true);

    // 2. Disabled plugin with NO active/queued jobs: stops polling and hides configured/ready
    await f.setMuseState("disable");
    await f.db.query(
      "UPDATE connections SET queue_refresh_until=NULL WHERE id=$1",
      [f.connection.id],
    );
    f.resetProbes();
    await poller.refreshEnabled();
    await poller.refresh(f.connection.id);
    assert.equal(f.probes(), 0);

    const disabledAdminState = await stateReader.read(f.admin, space);
    assert.equal(disabledAdminState.muse.configured, false);
    assert.equal(disabledAdminState.muse.ready, false);
    assert.equal(disabledAdminState.model_access["muse-video"], false);
    assert.equal(disabledAdminState.model_plugin_access["muse-video"], false);
    assert.equal(disabledAdminState.model_plugin_access["muse-image"], false);

    const disabledMemberState = await stateReader.read(f.member, space);
    assert.equal(disabledMemberState.muse.configured, false);
    assert.equal(disabledMemberState.muse.ready, false);
    assert.equal(disabledMemberState.model_access["muse-video"], false);
    assert.equal(
      Object.hasOwn(disabledMemberState, "model_plugin_access"),
      false,
    );

    // 3. Disabled plugin WITH an already-accepted queued job: continues health polling so draining succeeds
    await f.setMuseState("enable");
    const draining = await generation.submit(
      f.admin,
      await generation.parse("video", {
        uid: randomUUID(),
        prompt: "accepted before disable",
        model: "muse-video",
        ratio: "16:9",
        seconds: 5,
      }),
      space,
    );
    await f.setMuseState("disable");
    await f.db.query(
      "UPDATE connections SET queue_refresh_until=NULL WHERE id=$1",
      [f.connection.id],
    );
    f.resetProbes();
    await poller.refreshEnabled();
    assert.equal(f.probes(), 1);

    const drainingState = await stateReader.read(f.admin, space);
    assert.equal(drainingState.muse.configured, false);
    assert.equal(drainingState.muse.ready, false);
    assert.ok(
      drainingState.jobs.some((j: { id: number }) => j.id === draining.id),
    );
  } finally {
    await f.close();
  }
});

test("summarizeModelSections surfaces disabled plugins in model management without hiding policy state", () => {
  const base = {
    model_groups: {
      "muse-video": { kind: "video" as const, label: "Muse", models: ["muse-video"] },
      "MiniMax H3": { kind: "video" as const, label: "MiniMax H3", models: ["MiniMax H3"] },
      "muse-image": { kind: "image" as const, label: "Muse", models: ["muse-image"] },
      "gpt-image-2.6-sunburst": {
        kind: "image" as const,
        label: "gpt-image-2.6",
        models: ["gpt-image-2.6-sunburst"],
      },
    },
    model_catalog: {
      "muse-video": { provider: "muse" },
      "MiniMax H3": { provider: "gpu" },
      "muse-image": { provider: "muse" },
      "gpt-image-2.6-sunburst": { provider: "openai" },
    },
    model_policy: {
      enabled: {
        "muse-video": true,
        "MiniMax H3": true,
        "muse-image": true,
        "gpt-image-2.6-sunburst": true,
      },
    },
    team_model_policies: {
      "2": {
        enabled: {
          "muse-video": true,
          "MiniMax H3": false,
          "muse-image": true,
          "gpt-image-2.6-sunburst": true,
        },
      },
    },
    model_plugin_access: {
      "muse-video": false,
      "MiniMax H3": true,
      "muse-image": false,
      "gpt-image-2.6-sunburst": false,
    },
    images: { configured: false },
  };

  const globalSections = summarizeModelSections(base, "global", "");
  const video = globalSections.find((s) => s.kind === "video")!;
  const museVideo = video.rows.find((r) => r.id === "muse-video")!;
  const h3 = video.rows.find((r) => r.id === "MiniMax H3")!;

  assert.equal(museVideo.pluginDisabled, true);
  assert.equal(museVideo.open, 1);
  assert.match(museVideo.notes, /插件已停用/);
  assert.equal(h3.pluginDisabled, false);
  assert.equal(h3.notes, "");
  assert.equal(video.openCount, 1);

  const image = globalSections.find((s) => s.kind === "image")!;
  const gptImage = image.rows.find((r) => r.id === "gpt-image-2.6-sunburst")!;
  assert.equal(gptImage.pluginDisabled, true);
  assert.equal(gptImage.notes, "插件已停用");
  assert.equal(image.openCount, 0);

  // Search matches the disabled-plugin note
  const searched = summarizeModelSections(base, "global", "插件已停用");
  assert.deepEqual(
    searched.find((s) => s.kind === "video")!.visibleRows.map((r) => r.id),
    ["muse-video"],
  );

  // Team scope shows plugin disabled while preserving global/team policy context
  const teamSections = summarizeModelSections(
    {
      ...base,
      model_policy: {
        enabled: { ...base.model_policy.enabled, "muse-video": false },
      },
    },
    "2",
    "",
  );
  const teamMuseVideo = teamSections
    .find((s) => s.kind === "video")!
    .rows.find((r) => r.id === "muse-video")!;
  assert.equal(teamMuseVideo.notes, "插件已停用 · 全站已关闭");
});

test("disabled plugin is excluded from quoteReadOnly, CanvasSubmissionModels, and moderation fallback", async () => {
  const f = await museFixture();
  try {
    const catalog = new StudioCatalog(f.db);
    await f.setMuseState("enable");
    // Sanity check while Muse is enabled
    const enabledQuote = await catalog.quoteReadOnly(
      f.db,
      "muse-video",
      f.team.id,
      { ratio: "16:9", seconds: 5, quality: "std" },
    );
    assert.equal(enabledQuote.allowed, true);
    const enabledCanvas = await CanvasSubmissionModels.read(f.db, {
      strict: false,
    });
    assert.equal(enabledCanvas.enabledConnections.has("muse-video"), true);

    await f.setMuseState("disable");

    // 1. quoteReadOnly rejects disabled plugin with 插件已停用 (both with and without requireConnection)
    for (const requireConnection of [true, false]) {
      const q = await catalog.quoteReadOnly(
        f.db,
        "muse-video",
        f.team.id,
        { ratio: "16:9", seconds: 5, quality: "std" },
        { requireConnection },
      );
      assert.equal(q.allowed, false);
      assert.equal(q.priced, false);
      assert.equal(q.reason, "插件已停用");
    }

    // 2. CanvasSubmissionModels excludes connections whose plugin is disabled
    const disabledCanvas = await CanvasSubmissionModels.read(f.db, {
      strict: false,
    });
    assert.equal(disabledCanvas.enabledConnections.has("muse-video"), false);
    assert.equal(disabledCanvas.enabledConnections.has("muse-image"), false);

    // 3. tryModerationEquivalentFallback never switches a rejected job onto a disabled plugin,
    //    but succeeds once the plugin is re-enabled.
    const museImageRow = await one(
      f.db,
      "SELECT id FROM models WHERE catalog_id='muse-image' LIMIT 1",
    );
    const h3Row = await one(
      f.db,
      "SELECT m.id, m.connection_id, c.plugin_id, c.plugin_version, c.config FROM models m JOIN connections c ON c.id=m.connection_id WHERE m.catalog_id='muse-video' LIMIT 1",
    );
    assert.ok(museImageRow?.id);
    assert.ok(h3Row?.id);
    await f.db.query(
      "UPDATE models SET enabled = TRUE WHERE catalog_id = 'muse-image'",
    );
    await f.db.query(
      "INSERT INTO workspace_moderation_settings(workspace_id, auto_rewrite, max_attempts) VALUES ($1, TRUE, 2) ON CONFLICT (workspace_id) DO UPDATE SET auto_rewrite = TRUE",
      [f.team.id],
    );
    await f.db.query(
      "UPDATE wallets SET balance = balance + 1000, held = held + 1000 WHERE workspace_id = $1",
      [f.team.id],
    );
    const jobId = randomUUID();
    await f.db.query(
      `INSERT INTO jobs(id, workspace_id, owner_id, model_id, connection_id, plugin_id, plugin_version, kind, provider_model, catalog_id, config_snapshot, input, idempotency_key, request_hash, state, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'image', 'other-image', NULL, $8, '{"prompt":"test"}'::jsonb, $9, $9, 'running', 1000)`,
      [
        jobId,
        f.team.id,
        f.admin.id,
        h3Row.id,
        h3Row.connection_id,
        h3Row.plugin_id,
        h3Row.plugin_version,
        h3Row.config,
        `fp-${jobId}`,
      ],
    );
    const moderationOutcome = {
      action: "fail" as const,
      note: "content_policy_violation",
      reason: "moderation_blocked" as const,
      certainty: "rejected" as const,
      billable: false,
    };
    const jobRow = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [jobId]);
    assert.ok(jobRow);
    const job: Parameters<typeof tryModerationEquivalentFallback>[1] = {
      id: String(jobRow.id),
      workspace_id: String(jobRow.workspace_id),
      owner_id: String(jobRow.owner_id),
      kind: String(jobRow.kind),
      catalog_id: jobRow.catalog_id ?? null,
      provider_model: jobRow.provider_model ?? null,
      price: jobRow.price,
      remote_id: jobRow.remote_id ?? null,
      receipt: jobRow.receipt,
      input: jobRow.input,
    };
    const switchedWhileDisabled = await tryModerationEquivalentFallback(
      f.db,
      job,
      moderationOutcome,
      "muse-image",
    );
    assert.equal(switchedWhileDisabled, false);
    const afterDisabled = await one(
      f.db,
      "SELECT model_id, catalog_id, provider_model FROM jobs WHERE id=$1",
      [jobId],
    );
    assert.equal(afterDisabled.provider_model, "other-image");
    assert.equal(afterDisabled.catalog_id, null);

    await f.setMuseState("enable");
    const switchedWhenEnabled = await tryModerationEquivalentFallback(
      f.db,
      job,
      moderationOutcome,
      "muse-image",
    );
    assert.equal(switchedWhenEnabled, true);
    const afterEnabled = await one(
      f.db,
      "SELECT model_id, catalog_id FROM jobs WHERE id=$1",
      [jobId],
    );
    assert.equal(afterEnabled.catalog_id, "muse-image");
  } finally {
    await f.close();
  }
});
