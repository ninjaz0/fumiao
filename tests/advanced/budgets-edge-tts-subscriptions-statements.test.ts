import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Duplex } from "node:stream";
import test from "node:test";
import { computeScopeSpend } from "@fumiao/platform/budgets.js";
import { Executor } from "@fumiao/platform/executor.js";
import { ProviderError, type ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import { grantDueSubscriptions } from "@fumiao/platform/subscriptions.js";
import { ensureBuiltinEdgeTts } from "@fumiao/platform/tts/edge-plugin.js";
import { OriginalBatchPrecheck } from "@fumiao/original-api/batch-precheck.js";
import { OriginalBillingExtras } from "@fumiao/original-api/billing-extras.js";
import { OriginalBudgets } from "@fumiao/original-api/budgets-api.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalStoryboardExports } from "@fumiao/original-api/storyboard-exports.js";
import { canvasRunsFixture } from "../helpers/canvas-runs.js";

function encodeWsFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function generateValidMp3Bytes(): Buffer {
  return execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.4",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "48k",
      "-f",
      "mp3",
      "pipe:1",
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
}

function generateValidMp4Bytes(): Buffer {
  return execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=navy:s=320x180:d=0.6:r=24",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=24000:cl=mono",
      "-t",
      "0.6",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "frag_keyframe+empty_moov",
      "-f",
      "mp4",
      "pipe:1",
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
}

/** Lightweight RFC-6455 loopback mock Edge ReadAloud WebSocket server returning valid MP3 bytes. */
async function startMockEdgeTtsServer(mp3Bytes: Buffer): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server: Server = createServer();
  const sockets = new Set<Duplex>();
  server.on("upgrade", (req, socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const key = req.headers["sec-websocket-key"];
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let sent = false;
    socket.on("data", (chunk: Buffer) => {
      if (sent || chunk.length < 2) return;
      // Wait for SSML frame (after speech.config) or trigger once enough bytes arrive
      if (chunk.length > 20) {
        sent = true;
        const headerStr = "X-RequestId:mock\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n";
        const headerBuf = Buffer.from(headerStr, "utf8");
        const prefix = Buffer.alloc(2);
        prefix.writeUInt16BE(headerBuf.length, 0);
        const audioPayload = Buffer.concat([prefix, headerBuf, mp3Bytes]);
        socket.write(encodeWsFrame(0x2, audioPayload));
        socket.write(encodeWsFrame(0x1, Buffer.from("X-RequestId:mock\r\nPath:turn.end\r\n\r\n", "utf8")));
      }
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const addr = server.address() as { port: number };
  return {
    url: `ws://127.0.0.1:${addr.port}/edge/v1`,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

test("#2 F015: project budget blocks precheck/single/batch/narration/dialogue, tracks legacy & cross-month holds, releases failed holds, and enforces workspace management permissions", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const budgets = new OriginalBudgets(f.p);
  const precheck = new OriginalBatchPrecheck(f.p);
  const identity = new OriginalIdentity(f.p);
  const wsPublicId = String(f.workspace.public_id);

  // Give workspace abundant credits (500) so only project budget constrains admission
  await f.p.db.query("UPDATE wallets SET balance = 500 WHERE workspace_id = $1", [f.workspace.id]);

  // Create a 2-shot canvas (image model priced at 2 credits in fixture)
  const canvasPublicId = await f.project(
    [
      {
        id: "img1",
        type: "image",
        title: "镜头1",
        x: 0,
        y: 0,
        width: 300,
        height: 220,
        prompt: "mountain cabin in morning fog",
        params: {
          model: "gpt-image-2.6-sunburst",
          ratio: "16:9",
          resolution: "1K",
          image_quality: "medium",
        },
      },
      {
        id: "img2",
        type: "image",
        title: "镜头2",
        x: 340,
        y: 0,
        width: 300,
        height: 220,
        prompt: "forest river at golden hour",
        params: {
          model: "gpt-image-2.6-sunburst",
          ratio: "16:9",
          resolution: "1K",
          image_quality: "medium",
        },
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );
  const docRow = (
    await f.p.db.query("SELECT id FROM documents WHERE public_id = $1", [canvasPublicId])
  ).rows[0];
  const projectUuid = String(docRow.id);

  // 1. Set project monthly hard cap = 1 credit (passed by public_id -> canonicalized to UUID!)
  const savedCap = await budgets.upsertPolicy(
    f.admin,
    {
      scope_type: "project",
      scope_id: canvasPublicId,
      period: "monthly",
      warn_limit: 1,
      cap_limit: 1,
      mode: "cap",
      enabled: true,
    },
    wsPublicId,
  );
  assert.equal(savedCap.policy.scope_id, projectUuid);

  // Precheck on img1 MUST flag budget_blocked = true!
  const pre = await precheck.precheckCanvas(f.admin, canvasPublicId, {
    expected_revision: 2,
    node_ids: ["img1"],
    stages: ["image"],
  });
  assert.ok(pre.summary.total_credits > 1);
  assert.equal(pre.summary.budget_blocked, true);
  assert.ok(pre.summary.budget_blocks.length > 0);

  // Ordinary single-shot generation MUST be rejected with 402!
  await assert.rejects(
    f.runs.generate(f.admin, canvasPublicId, "img1", {
      expected_revision: 2,
      uid: randomUUID(),
    }),
    (err: unknown) => (err as { status?: number })?.status === 402,
  );

  // Batch run MUST skip/reject due to 402 with 0 submitted!
  const batchBlocked = await f.runs.batchRun(f.admin, canvasPublicId, {
    expected_revision: 2,
    uid: randomUUID(),
    node_ids: ["img1"],
    stages: ["image"],
  });
  assert.equal(batchBlocked.submitted.length, 0);
  assert.equal(batchBlocked.skipped.length, 1);

  // 2. Raise project cap to exact price of 1 image shot -> allows 1, blocks 2nd (and concurrent!)
  const unitPrice = pre.summary.total_credits;
  await budgets.upsertPolicy(
    f.admin,
    {
      scope_type: "project",
      scope_id: canvasPublicId,
      period: "monthly",
      warn_limit: unitPrice,
      cap_limit: unitPrice,
      mode: "cap",
      enabled: true,
    },
    wsPublicId,
  );

  // Concurrent admission race: 2 parallel runs against a 1-shot cap -> strictly 1 succeeds, 1 fails 402!
  const concurrent = await Promise.allSettled([
    f.runs.generate(f.admin, canvasPublicId, "img1", {
      expected_revision: 2,
      uid: randomUUID(),
    }),
    f.runs.generate(f.admin, canvasPublicId, "img2", {
      expected_revision: 2,
      uid: randomUUID(),
    }),
  ]);
  const fulfilled = concurrent.filter((r) => r.status === "fulfilled");
  const rejected = concurrent.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal((rejected[0] as PromiseRejectedResult).reason?.status, 402);

  const acceptedJobPublicId = (
    fulfilled[0] as PromiseFulfilledResult<{ id: number }>
  ).value.id;

  // budgets.list() MUST report held === unitPrice and projects list includes our canvas!
  const listMid = await budgets.list(f.admin, wsPublicId);
  const projPolicy = listMid.policies.find(
    (p) => p.scope_type === "project" && p.scope_id === projectUuid,
  );
  assert.ok(projPolicy);
  assert.equal(projPolicy.held, unitPrice);
  assert.equal(projPolicy.total_committed, unitPrice);
  assert.ok(listMid.projects.some((p) => p.public_id === canvasPublicId));

  // 3. Cross-month in-flight hold: move accepted job's created_at back 40 days while still running ->
  // monthly committed MUST STILL include it and block the other shot!
  await f.p.db.query(
    "UPDATE jobs SET state = 'running', created_at = now() - interval '40 days' WHERE public_id = $1",
    [acceptedJobPublicId],
  );
  const crossMonthUsage = await computeScopeSpend(f.p.db, "project", projectUuid, "monthly");
  assert.equal(crossMonthUsage.held, unitPrice);

  const otherNode = (await f.p.db.query("SELECT node FROM canvas_job_links WHERE project_id=$1", [projectUuid])).rows[0].node === "img1" ? "img2" : "img1";
  await assert.rejects(
    f.runs.generate(f.admin, canvasPublicId, otherNode, {
      expected_revision: 2,
      uid: randomUUID(),
    }),
    (err: unknown) => (err as { status?: number })?.status === 402,
  );

  // 4. Legacy project attribution: remove from job_projects (leaving ONLY canvas_job_links) ->
  // computeScopeSpend MUST still attribute it via canvas_job_links!
  const jobRow = (
    await f.p.db.query("SELECT * FROM jobs WHERE public_id = $1", [acceptedJobPublicId])
  ).rows[0];
  await f.p.db.query("DELETE FROM job_projects WHERE job_id = $1", [jobRow.id]);
  const legacyUsage = await computeScopeSpend(f.p.db, "project", projectUuid, "monthly");
  assert.equal(legacyUsage.held, unitPrice);

  // 5. Failed job settlement releases committed budget back to 0 -> otherNode can now submit!
  await f.p.db.transaction(async (sql) => {
    await f.p.settle(sql, jobRow, "failed", undefined, "simulated failure");
  });
  const afterFail = await computeScopeSpend(f.p.db, "project", projectUuid, "monthly");
  assert.equal(afterFail.held, 0);
  assert.equal(afterFail.spent, 0);

  const retryRun = await f.runs.generate(f.admin, canvasPublicId, otherNode, {
    expected_revision: 2,
    uid: randomUUID(),
  });
  assert.ok(retryRun.id);

  // 6. Workspace management permission: non-owner team member CANNOT modify budget or moderation policies (403)!
  const createdMember = (await identity.createMember(f.admin, {
    name: "budget_member",
    nickname: "普通成员",
    password: "MemberPassword123!",
  })) as { id: number };
  const member = (
    await f.p.db.query("SELECT * FROM users WHERE public_id = $1", [createdMember.id])
  ).rows[0] as any;
  const team = (await identity.createWorkspace(f.admin, {
    name: "预算权限隔离团队",
    members: [Number(member.public_id)],
  })) as { id: number };
  await assert.rejects(
    budgets.upsertPolicy(
      member,
      { scope_type: "workspace", period: "monthly", warn_limit: 10, cap_limit: 20, mode: "cap", enabled: true },
      String(team.id),
    ),
    (err: unknown) => (err as { status?: number })?.status === 403,
  );
  await assert.rejects(
    budgets.updateModeration(member, { auto_rewrite: true, max_attempts: 2 }, String(team.id)),
    (err: unknown) => (err as { status?: number })?.status === 403,
  );
});

test("#3 F029: built-in Edge TTS works out-of-the-box with zero commercial keys, honest precheck, storyboard composition, and real commercial failure fallback", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const precheck = new OriginalBatchPrecheck(f.p);
  const exportsSvc = new OriginalStoryboardExports(f.p);
  const wsPublicId = String(f.workspace.public_id);

  // Create a video shot with narration text
  const canvasId = await f.project(
    [
      {
        id: "shot1",
        type: "video",
        title: "开场镜头",
        x: 0,
        y: 0,
        width: 300,
        height: 220,
        prompt: "city sunrise timelapse",
        narration_text: "清晨的阳光洒在城市的屋顶上，新的一天开始了。",
        narration_instruction: "温暖叙事",
        params: {},
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );

  // 1. Disable any existing audio connections (e.g., breeze-tts-2) and verify precheck HONESTLY blocks!
  await f.p.db.query(
    `UPDATE connections SET enabled = FALSE
      WHERE id IN (SELECT connection_id FROM models WHERE kind = 'audio')`,
  );
  const preBlocked = await precheck.precheckCanvas(f.admin, canvasId, {
    expected_revision: 2,
    node_ids: ["shot1"],
    stages: ["narration"],
  });
  assert.equal(preBlocked.items[0].status, "blocked");

  // 2. Start local mock Edge TTS WebSocket returning real FFmpeg MP3 & run startup ensureBuiltinEdgeTts!
  const mp3Bytes = generateValidMp3Bytes();
  const mockEdge = await startMockEdgeTtsServer(mp3Bytes);
  t.after(() => mockEdge.close());

  await ensureBuiltinEdgeTts(f.p, { endpoint: mockEdge.url });

  // Precheck now genuinely sees enabled Edge TTS at 0 credits (warning = free fallback, runnable!)
  const preReady = await precheck.precheckCanvas(f.admin, canvasId, {
    expected_revision: 2,
    node_ids: ["shot1"],
    stages: ["narration"],
  });
  assert.equal(preReady.items[0].model, "edge-tts");
  assert.equal(preReady.items[0].credits, 0);
  assert.equal(preReady.items[0].status, "warning");
  assert.equal(preReady.summary.runnable, 1);

  // Submit narration with ZERO commercial keys -> execute via real Executor -> completes with real MP3 asset!
  const narrSubmitted = await f.runs.narrate(f.admin, canvasId, "shot1", {
    expected_revision: 2,
    uid: randomUUID(),
  });
  const narrRow = (
    await f.p.db.query("SELECT id, provider_model, price FROM jobs WHERE public_id = $1", [narrSubmitted.id])
  ).rows[0];
  assert.equal(narrRow.provider_model, "edge-tts");
  assert.equal(Number(narrRow.price), 0);

  const executor = new Executor(f.p);
  await executor.execute(narrRow.id);

  const doneNarr = (
    await f.p.db.query(
      `SELECT j.state, a.id AS asset_id, a.public_id AS asset_pub, a.mime
         FROM jobs j
         JOIN job_assets ja ON ja.job_id = j.id AND ja.role = 'output'
         JOIN assets a ON a.id = ja.asset_id
        WHERE j.id = $1`,
      [narrRow.id],
    )
  ).rows[0];
  assert.equal(doneNarr.state, "completed");
  assert.equal(doneNarr.mime, "audio/mpeg");

  // Enable built-in storyboard/mp4 exporter package & attach a real MP4 clip + generated Edge TTS narration
  await f.p.db.query(
    "INSERT INTO studio_packages(id,version,enabled) VALUES('storyboard','1.0.0',true) ON CONFLICT DO NOTHING",
  );
  const mp4Bytes = generateValidMp4Bytes();
  const vidAssetId = randomUUID();
  const vidPubId = randomUUID().replaceAll("-", "");
  const vidKey = vidAssetId;
  await f.p.storage.put(vidKey, mp4Bytes, "video/mp4");
  await f.p.db.query(
    `INSERT INTO assets(id, public_id, workspace_id, owner_id, object_key, mime, size, state, original_kind, metadata)
     VALUES ($1, $2, $3, $4, $5, 'video/mp4', $6, 'ready', 'video', '{"width":320,"height":180,"duration":0.6}'::jsonb)`,
    [vidAssetId, vidPubId, f.workspace.id, f.admin.id, vidKey, mp4Bytes.length],
  );
  // Create a synthetic completed video job linked to shot1 so storyboard export sees shot1 video + Edge TTS narration
  const vidJobId = randomUUID();
  const anyModel = (await f.p.db.query("SELECT m.id, m.connection_id, c.plugin_id, c.plugin_version, m.provider_model FROM models m JOIN connections c ON c.id=m.connection_id WHERE m.kind='video' LIMIT 1")).rows[0];
  const vidJobIns = (
    await f.p.db.query(
      `INSERT INTO jobs(id, workspace_id, owner_id, model_id, connection_id, plugin_id, plugin_version, config_snapshot, provider_model, kind, input, idempotency_key, request_hash, price, state, original_view, attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'video','{"prompt":"clip"}'::jsonb,$10,'h',0,'completed','{}'::jsonb,1)
       RETURNING public_id`,
      [vidJobId, f.workspace.id, f.admin.id, anyModel.id, anyModel.connection_id, anyModel.plugin_id, anyModel.plugin_version, f.p.vault.seal({}), anyModel.provider_model, randomUUID()],
    )
  ).rows[0];
  await f.p.db.query("INSERT INTO job_assets(job_id, asset_id, role) VALUES ($1,$2,'output')", [vidJobId, vidAssetId]);

  const savedCanvas = await f.canvases.save(f.admin, canvasId, {
    expected_revision: 2,
    title: "Edge TTS 成片测试",
    document: {
      schemaVersion: 1,
      nodes: [
        {
          id: "shot1",
          type: "video",
          title: "开场镜头",
          x: 0,
          y: 0,
          width: 300,
          height: 220,
          prompt: "city sunrise timelapse",
          narration_text: "清晨的阳光洒在城市的屋顶上，新的一天开始了。",
          narration_instruction: "温暖叙事",
          narration_job: narrSubmitted.id,
          use_media: true,
          media_id: vidPubId,
          params: {},
        },
      ],
      edges: [],
      shots: ["shot1"],
    },
  });
  assert.ok(vidJobIns.public_id);
  const exp = await exportsSvc.create(f.admin, canvasId, {
    expected_revision: savedCanvas.revision,
    exporter: "storyboard/mp4",
    uid: randomUUID(),
  });
  const expRow = (
    await f.p.db.query("SELECT id FROM storyboard_exports WHERE public_id = $1", [exp.id])
  ).rows[0];
  await exportsSvc.execute(expRow.id);
  const expList = await exportsSvc.list(f.admin, canvasId);
  const doneExp = expList.exports.find((e) => e.id === exp.id);
  assert.ok(doneExp);
  assert.equal(doneExp.state, "done", `Storyboard composition failed: ${doneExp.error}`);
  assert.ok(doneExp.result, "Composed MP4 storyboard must produce a real output asset");

  // 3. Configurable commercial TTS selection + REAL runtime failure fallback to Edge TTS (releasing held credits!)
  const failingCommercialTts: ProviderPlugin = {
    manifest: {
      id: "mock-commercial-tts",
      label: "Mock Commercial TTS",
      version: "1.0.0",
      contractVersion: 1,
      mode: "request",
      configSchema: { type: "object", properties: {} },
      models: [
        {
          id: "tts-1",
          label: "Commercial TTS-1",
          kind: "audio",
          inputSchema: { type: "object", properties: { instruction: { type: "string" } } },
        },
      ],
      canvasSubmission: {
        version: 1,
        models: [{ model: "tts-1", kind: "audio", defaultForKind: false }],
      },
      originalSubmission: { version: 1 },
      originalState: { version: 1, fields: [], queueLane: "kind" },
    },
    health: async () => true,
    originalSubmission: {
      validate: () => {},
      namespace: () => "-tts1",
      plan: () => ({ namespace: "-tts1", parentKind: "any", refs: [], roles: [], missing: { status: 400, message: "" } }),
      prepare: async (d) => ({
        params: { instruction: d.instruction || "" },
        references: [],
        view: {
          ratio: "", quality: null, seconds: null, sampling_steps: null, seed: null,
          width: null, height: null, image_quality: null,
          audio_settings: { instruction: d.instruction || "" }, h3_inputs: null, refs: [],
        },
      }),
    },
    originalState: { configured: () => true, configuration: () => ({}), project: () => ({}) },
    submit: async () => {
      throw new ProviderError("商业语音余额耗尽", "rejected");
    },
  };
  f.p.registry.registerBuiltin(failingCommercialTts);
  await f.p.db.query(
    `INSERT INTO plugin_versions(id, version, manifest) VALUES ('mock-commercial-tts', '1.0.0', $1::jsonb)`,
    [JSON.stringify(failingCommercialTts.manifest)],
  );
  await f.p.db.query(
    `INSERT INTO studio_catalog(id, plugin_id, plugin_version, descriptor, runtime, position, price_position, hidden)
     VALUES ('tts-1', 'mock-commercial-tts', '1.0.0', '{"kind":"audio","label":"Commercial TTS-1"}'::jsonb, '{}'::jsonb, 80, 800, FALSE)`,
  );
  await f.p.db.query(
    `INSERT INTO studio_prices(key, model_id, tier, label, position, matcher, amount)
     VALUES ('tts-1|std', 'tts-1', 'std', '标准', 800, '{"type":"object","properties":{}}'::jsonb, 5)`,
  );
  await f.p.db.query(
    `UPDATE studio_policy SET flags = flags || '{"tts-1":true}'::jsonb WHERE singleton`,
  );
  const cConn = randomUUID();
  await f.p.db.query(
    `INSERT INTO connections(id, name, plugin_id, plugin_version, config, enabled) VALUES ($1, 'Commercial TTS', 'mock-commercial-tts', '1.0.0', $2, TRUE)`,
    [cConn, f.p.vault.seal({})],
  );
  await f.p.db.query(
    `INSERT INTO models(id, connection_id, catalog_id, provider_model, label, kind, schema, enabled)
     VALUES ($1, $2, 'tts-1', 'tts-1', 'Commercial TTS-1', 'audio', '{"type":"object"}'::jsonb, TRUE)`,
    [randomUUID(), cConn],
  );

  // Give workspace 100 credits, select narration_model="tts-1" on shot1, submit narration!
  await f.p.db.query("UPDATE wallets SET balance = 100, held = 0 WHERE workspace_id = $1", [f.workspace.id]);
  const updatedCanvas = await f.canvases.save(f.admin, canvasId, {
    expected_revision: savedCanvas.revision,
    title: "Commercial TTS Fallback Test",
    document: {
      schemaVersion: 1,
      nodes: [
        {
          id: "shot1",
          type: "video",
          title: "开场镜头",
          x: 0,
          y: 0,
          width: 300,
          height: 220,
          prompt: "city sunrise timelapse",
          narration_text: "测试商业语音失败自动切换免费 Edge TTS 兜底。",
          narration_model: "tts-1",
          params: {},
        },
      ],
      edges: [],
      shots: ["shot1"],
    },
  });

  const fbSubmitted = await f.runs.narrate(f.admin, canvasId, "shot1", {
    expected_revision: updatedCanvas.revision,
    uid: randomUUID(),
  });
  const fbJobBefore = (
    await f.p.db.query("SELECT id, provider_model, price FROM jobs WHERE public_id = $1", [fbSubmitted.id])
  ).rows[0];
  assert.equal(fbJobBefore.provider_model, "tts-1");
  assert.equal(Number(fbJobBefore.price), 5);
  const walletHeld = (
    await f.p.db.query("SELECT balance, held FROM wallets WHERE workspace_id = $1", [f.workspace.id])
  ).rows[0];
  assert.equal(Number(walletHeld.held), 5);

  // 1st execute hits failing commercial TTS -> releases 5-credit hold & switches job to edge-tts (price=0)!
  await executor.execute(fbJobBefore.id);
  const fbJobMid = (
    await f.p.db.query("SELECT state, provider_model, price FROM jobs WHERE id = $1", [fbJobBefore.id])
  ).rows[0];
  assert.equal(fbJobMid.state, "queued");
  assert.equal(fbJobMid.provider_model, "edge-tts");
  assert.equal(Number(fbJobMid.price), 0);

  // 2nd execute runs free Edge TTS -> completes with real MP3 asset and ZERO net credits charged!
  await executor.execute(fbJobBefore.id);
  const fbJobAfter = (
    await f.p.db.query("SELECT state FROM jobs WHERE id = $1", [fbJobBefore.id])
  ).rows[0];
  assert.equal(fbJobAfter.state, "completed");
  const walletAfter = (
    await f.p.db.query("SELECT balance, held FROM wallets WHERE workspace_id = $1", [f.workspace.id])
  ).rows[0];
  assert.equal(Number(walletAfter.balance), 100);
  assert.equal(Number(walletAfter.held), 0);
});

test("#4 + #8 F034: subscription zero double-counting, single-use order_id, idempotency, concurrency, renewal chaining, and Chinese multi-page PDF / date-range CSV statements", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const billing = new OriginalBillingExtras(f.p);
  const wsPublicId = String(f.workspace.public_id);

  // Start from clean 0 wallet balance to prove exact single-settlement accounting
  await f.p.db.query("UPDATE wallets SET balance = 0, held = 0 WHERE workspace_id = $1", [f.workspace.id]);

  // 1. Simulate a synthetic paid ¥29 recharge order in real original_recharge_orders (+290 credits into wallet)
  const paidOrderId = `FM${randomUUID().replaceAll("-", "").slice(0, 26)}`;
  const nowSec = Math.floor(Date.now() / 1000);
  await f.p.db.transaction(async (sql) => {
    await sql.query(
      `INSERT INTO original_recharge_orders(id, uid, owner_id, workspace_id, method, merchant, amount, credits, state, created, expires, paid, checked)
       VALUES ($1, $2, $3, $4, 'alipay', 'mock-merchant', 2900, 290, 'paid', $5, $6, $5, $5)`,
      [paidOrderId, randomUUID(), f.admin.id, f.workspace.id, nowSec, nowSec + 3600],
    );
    await f.p.credit(sql, f.workspace.id, 290, `recharge:${paidOrderId}`, "recharge", {
      actorId: f.admin.id,
      note: "支付宝模拟充值 ¥29.00",
    });
  });

  // Activate starter-monthly (¥29 / 350 credits) bound to paidOrderId -> MUST debit 290 and grant 350 = net 350!
  const uid1 = randomUUID();
  const act1 = await billing.subscribe(
    f.admin,
    { plan_code: "starter-monthly", order_id: paidOrderId, uid: uid1 },
    wsPublicId,
  );
  assert.equal(act1.idempotent_replay, false);
  assert.equal(act1.renewed, false);
  assert.equal(act1.cost_credits, 290);
  const w1 = (await f.p.db.query("SELECT balance, held FROM wallets WHERE workspace_id=$1", [f.workspace.id])).rows[0];
  assert.equal(Number(w1.balance), 350, "¥29 recharge + starter-monthly activation MUST net exactly 350 credits (zero double-counting!)");
  assert.equal(Number(w1.held), 0);

  // 2. Idempotent replay with same uid1 returns exact same subscription, zero extra debit/grant!
  const replay = await billing.subscribe(
    f.admin,
    { plan_code: "starter-monthly", order_id: paidOrderId, uid: uid1 },
    wsPublicId,
  );
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.subscription.id, act1.subscription.id);
  const wReplay = (await f.p.db.query("SELECT balance FROM wallets WHERE workspace_id=$1", [f.workspace.id])).rows[0];
  assert.equal(Number(wReplay.balance), 350);

  // 3. Reusing the same paidOrderId with a DIFFERENT uid MUST fail 409!
  await assert.rejects(
    billing.subscribe(
      f.admin,
      { plan_code: "starter-monthly", order_id: paidOrderId, uid: randomUUID() },
      wsPublicId,
    ),
    (err: unknown) => (err as { status?: number })?.status === 409,
  );

  // 4. Concurrent double-renewal race with 350 balance (enough for strictly ONE 290-credit renewal!)
  const race = await Promise.allSettled([
    billing.subscribe(f.admin, { plan_code: "starter-monthly", uid: randomUUID() }, wsPublicId),
    billing.subscribe(f.admin, { plan_code: "starter-monthly", uid: randomUUID() }, wsPublicId),
  ]);
  const raceOk = race.filter((r) => r.status === "fulfilled");
  const raceErr = race.filter((r) => r.status === "rejected");
  assert.equal(raceOk.length, 1);
  assert.equal(raceErr.length, 1);
  assert.equal((raceErr[0] as PromiseRejectedResult).reason?.status, 402);

  const renewed = (raceOk[0] as PromiseFulfilledResult<any>).value;
  assert.equal(renewed.renewed, true);
  assert.equal(renewed.grant_timing, "at_period_start");
  assert.equal(renewed.subscription.current_period_start, act1.subscription.current_period_end);

  // Balance immediately after renewal purchase = 350 - 290 = 60 (next period's 350 waits for period_start!)
  const wRenewed = (await f.p.db.query("SELECT balance FROM wallets WHERE workspace_id=$1", [f.workspace.id])).rows[0];
  assert.equal(Number(wRenewed.balance), 60);
  // Running sweep early grants 0
  assert.equal(await grantDueSubscriptions(f.p), 0);

  // When next billing cycle arrives -> grantDueSubscriptions drops +350 ONCE (balance -> 410)
  await f.p.db.query(
    "UPDATE workspace_subscriptions SET current_period_start = now() - interval '1 minute' WHERE id = $1",
    [renewed.subscription.id],
  );
  assert.equal(await grantDueSubscriptions(f.p), 1);
  assert.equal(await grantDueSubscriptions(f.p), 0);
  const wAfterCycle = (await f.p.db.query("SELECT balance FROM wallets WHERE workspace_id=$1", [f.workspace.id])).rows[0];
  assert.equal(Number(wAfterCycle.balance), 410);

  // 5. #8 Chinese Multi-Page PDF + Explicit Date-Range CSV Reconciliation
  await f.p.db.query("UPDATE workspaces SET name = '测试中文制片空间' WHERE id = $1", [f.workspace.id]);
  for (let i = 1; i <= 55; i++) {
    const dt = i <= 25 ? "2026-01-10T08:00:00Z" : "2026-02-15T12:30:00Z";
    await f.p.db.query(
      `INSERT INTO ledger(id, workspace_id, key, action, amount, actor_id, balance_snapshot, held_snapshot, note, created_at)
       VALUES ($1, $2, $3, 'grant', 10, $4, $5, 0, $6, $7::timestamptz)`,
      [
        randomUUID(),
        f.workspace.id,
        `stmt-row-${i}`,
        f.admin.id,
        410 + i * 10,
        `中文财务对账明细第${i}条 · 包含较长说明文字用于验证自动换行不截断`,
        dt,
      ],
    );
  }

  const fullPdf = await billing.exportStatement(f.admin, "pdf", wsPublicId);
  assert.equal(fullPdf.truncated, false);
  assert.ok(fullPdf.exportedCount >= 55);
  assert.equal(fullPdf.exportedCount, fullPdf.totalCount);
  const pdfText = fullPdf.bytes.toString("latin1");
  assert.ok(pdfText.startsWith("%PDF-1.4"));
  assert.ok(pdfText.includes("/BaseFont /STSong-Light"), "PDF must embed CJK Type0 CIDFont");
  assert.ok(pdfText.includes("/Encoding /UniGB-UCS2-H"), "PDF must use UniGB-UCS2-H encoding");
  // Check UTF-16BE hex for "弗淼工作台" = 5F17 6DFC 5DE5 4F5C 53F0 & "测试中文制片空间"
  assert.ok(pdfText.includes("5F176DFC5DE54F5C53F0"), "PDF must encode Chinese title in UTF-16BE hex");
  assert.ok(pdfText.includes("6D4B8BD54E2D6587523672477A7A95F4"), "PDF must encode Chinese workspace name without '?' fallback");
  const countMatch = /\/Count\s+(\d+)/.exec(pdfText);
  assert.ok(countMatch && Number(countMatch[1]) >= 2, `Expected multi-page PDF (>=2 pages), got ${countMatch?.[1]}`);

  // Date-range CSV export strictly filters February rows and reconciles row count 1-to-1!
  const febCsv = await billing.exportStatement(f.admin, "csv", wsPublicId, {
    from: "2026-02-01",
    to: "2026-02-28",
  });
  assert.equal(febCsv.totalCount, 30);
  assert.equal(febCsv.exportedCount, 30);
  assert.equal(febCsv.truncated, false);
  const csvStr = febCsv.bytes.toString("utf8");
  const csvRows = csvStr.trim().split(/\r?\n/);
  assert.equal(csvRows.length, 31, "1 header + 30 February ledger rows");
  assert.ok(csvStr.includes("中文财务对账明细第26条"));
  assert.ok(!csvStr.includes("中文财务对账明细第25条"));
});
