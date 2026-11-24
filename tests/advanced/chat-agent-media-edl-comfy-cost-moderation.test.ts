import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import {
  ProviderError,
  type ChatChunk,
  type ChatRequest,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
import { evaluateFormConstraints } from "@fumiao/plugin-sdk/model-form.js";
import { packageFile } from "@fumiao/plugin-sdk/package-file.js";
import {
  ComfyMicroAppCompiler,
  packComfyMicroAppDirectory,
} from "@fumiao/platform/comfy-compiler.js";
import { Executor } from "@fumiao/platform/executor.js";
import { loadProgram } from "@fumiao/platform/plugin-program.js";
import { StudioPackages } from "@fumiao/platform/studio-packages.js";
import { OriginalObservability } from "@fumiao/original-api/admin-observability.js";
import { OriginalBudgets } from "@fumiao/original-api/budgets-api.js";
import { ChatExecution } from "@fumiao/original-api/chat-execution.js";
import { ChatRuntime } from "@fumiao/original-api/chat-runtime.js";
import { OriginalChats } from "@fumiao/original-api/chats.js";
import { OriginalNodes } from "@fumiao/original-api/nodes.js";
import { OriginalCanvasProposals } from "@fumiao/original-api/proposals.js";
import { OriginalSkills } from "@fumiao/original-api/skills.js";
import { OriginalStoryboardExports } from "@fumiao/original-api/storyboard-exports.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { canvasRunsFixture } from "../helpers/canvas-runs.js";

function generateValidMp4Bytes(color = "#225599", secs = 0.8): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "fm-d-mp4-"));
  try {
    const out = join(dir, "clip.mp4");
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=320x180:d=${secs}:r=30`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        out,
      ],
      { stdio: "ignore" },
    );
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function generateValidWavBytes(secs = 0.6): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "fm-d-wav-"));
  try {
    const out = join(dir, "voice.wav");
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=440:duration=${secs}`,
        "-ac",
        "1",
        "-ar",
        "24000",
        out,
      ],
      { stdio: "ignore" },
    );
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function listZipEntries(buf: Buffer): Map<string, Buffer> {
  // Parse ZIP local file headers cleanly (STORE / DEFLATE inspection via python3 zipfile)
  const dir = mkdtempSync(join(tmpdir(), "fm-d-zip-"));
  try {
    const zpath = join(dir, "bundle.zip");
    writeFileSync(zpath, buf);
    const out = execFileSync(
      "python3",
      [
        "-c",
        `import json, base64, sys, zipfile
res = {}
with zipfile.ZipFile(sys.argv[1], "r") as z:
    for info in z.infolist():
        res[info.filename] = base64.b64encode(z.read(info.filename)).decode("ascii")
print(json.dumps(res))`,
        zpath,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const parsed = JSON.parse(out) as Record<string, string>;
    const map = new Map<string, Buffer>();
    for (const [k, v] of Object.entries(parsed)) {
      map.set(k, Buffer.from(v, "base64"));
    }
    return map;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("#13 F018/F017: internal canvas Chat Agent reads workspace skills + graph via tool calls, rejects stale revision 409, creates pending proposal with credits, and human approval applies to canvas", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const wsPublicId = String(f.workspace.public_id);
  const skills = new OriginalSkills(f.p);
  const proposals = new OriginalCanvasProposals(f.p);
  const chats = new OriginalChats(f.p);
  const chatExec = new ChatExecution(chats);
  const chatRuntime = new ChatRuntime(chatExec);
  t.after(() => chatRuntime.close());

  // 1. Seed a workspace SKILL.md skill
  await skills.create(
    f.admin,
    {
      name: "悬疑分镜镜头法则",
      slug: "suspense-framing",
      description: "悬疑短剧分镜构图规范",
      raw_md:
        "---\nname: 悬疑分镜镜头法则\n---\n所有雨夜镜头必须使用低角度推镜并附带旁白钩子。",
      enabled: true,
    },
    wsPublicId,
  );

  // 2. Create a canvas with a text node
  const canvasId = await f.project(
    [
      {
        id: "txt1",
        type: "text",
        title: "剧本梗概",
        x: 40,
        y: 60,
        width: 300,
        height: 180,
        text: "雨夜侦探林墨在废弃码头发现一只发光怀表。",
        params: {},
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );
  const initialCanvas = await f.canvases.get(f.admin, canvasId);
  assert.equal(initialCanvas.revision, 2);

  // 3. Register a mock tool-capable chat plugin verifying skills injection + driving built-in canvas Agent tools
  const seenRequests: ChatRequest[] = [];
  let round = 0;
  let staleToolResult: Record<string, unknown> | null = null;
  let validToolResult: Record<string, unknown> | null = null;

  const mockAgentChatPlugin: ProviderPlugin = {
    manifest: {
      id: "mock-canvas-agent-chat",
      label: "Mock Canvas Agent Chat",
      version: "1.0.0",
      contractVersion: 1,
      mode: "request",
      configSchema: { type: "object", properties: {} },
      models: [
        {
          id: "mock-agent-llm",
          label: "Mock Agent LLM",
          kind: "chat",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      chat: {
        version: 1,
        providers: [
          {
            id: "mock-agent",
            label: "Mock Agent",
            models: ["mock-agent-llm"],
            defaultConfig: {},
          },
        ],
      },
    },
    health: async () => true,
    submit: async () => ({ state: "failed", error: "chat only" }),
    chatProvider: () => "mock-agent",
    chatConfigured: () => true,
    chatConfigure: (cfg) => cfg,
    chatTitle: async () => "雨夜分镜提案",
    chatProbe: async () => {},
    async *chatStream(req: ChatRequest): AsyncGenerator<ChatChunk> {
      seenRequests.push(req);
      round++;
      if (round === 1) {
        // Call built-in fm_read_canvas_graph first
        yield {
          text: "",
          toolCalls: [
            {
              index: 0,
              id: "call_read_1",
              type: "function",
              function: { name: "fm_read_canvas_graph", arguments: "{}" },
            },
          ],
          reason: "tool_calls",
        };
        return;
      }
      if (round === 2) {
        // Attempt stale base_revision=1 (must be rejected with 409!)
        yield {
          text: "",
          toolCalls: [
            {
              index: 0,
              id: "call_stale_2",
              type: "function",
              function: {
                name: "fm_propose_canvas_changes",
                arguments: JSON.stringify({
                  title: "过时版本提案",
                  summary: "应该被 409 拒绝",
                  base_revision: 1,
                  operations_json: JSON.stringify([
                    {
                      op: "add_node",
                      temp_id: "stale_vid",
                      type: "video",
                      title: "过时镜头",
                      x: 420,
                      y: 60,
                      prompt: "rainy harbor",
                    },
                  ]),
                }),
              },
            },
          ],
          reason: "tool_calls",
        };
        return;
      }
      if (round === 3) {
        const lastToolMsg = req.messages.filter((m) => m.role === "tool").pop();
        staleToolResult = JSON.parse(String(lastToolMsg?.content || "{}"));
        // Now submit with the exact live revision=2 -> succeeds with real pending proposal + credit estimate!
        yield {
          text: "",
          toolCalls: [
            {
              index: 0,
              id: "call_valid_3",
              type: "function",
              function: {
                name: "fm_propose_canvas_changes",
                arguments: JSON.stringify({
                  title: "新增雨夜码头推镜分镜",
                  summary: "遵循悬疑分镜镜头法则新增低角度推镜并连线文案",
                  base_revision: initialCanvas.revision,
                  operations_json: JSON.stringify([
                    {
                      op: "add_node",
                      temp_id: "shot_rain",
                      type: "video",
                      title: "雨夜码头低角度推镜",
                      x: 420,
                      y: 60,
                      prompt: "low angle push-in shot on glowing pocket watch at rainy pier",
                      narration_text: "那块怀表，竟然还在逆时针走动。",
                    },
                    {
                      op: "add_edge",
                      source: "txt1",
                      target: "shot_rain",
                    },
                  ]),
                }),
              },
            },
          ],
          reason: "tool_calls",
        };
        return;
      }
      const lastToolMsg = req.messages.filter((m) => m.role === "tool").pop();
      validToolResult = JSON.parse(String(lastToolMsg?.content || "{}"));
      yield {
        text: "已为你生成画布变更提案，请在右侧「画布 Agent 提案箱」审核 Diff 与积分预估后点击批准落图。",
        reason: "stop",
      };
    },
  };

  f.p.registry.registerBuiltin(mockAgentChatPlugin);
  await f.p.db.query(
    `INSERT INTO plugin_versions(id, version, manifest) VALUES ('mock-canvas-agent-chat', '1.0.0', $1::jsonb)`,
    [JSON.stringify(mockAgentChatPlugin.manifest)],
  );
  await f.p.db.query(
    `INSERT INTO studio_catalog(id, plugin_id, plugin_version, descriptor, runtime, position, price_position, hidden)
     VALUES ('mock-agent-llm', 'mock-canvas-agent-chat', '1.0.0', '{"kind":"chat","label":"Mock Agent LLM","provider":"mock-agent"}'::jsonb, '{}'::jsonb, 10, 100, FALSE)`,
  );
  await f.p.db.query(
    `INSERT INTO studio_prices(key, model_id, tier, label, position, matcher, amount)
     VALUES ('mock-agent-llm|reply', 'mock-agent-llm', 'reply', '对话', 100, '{"type":"object"}'::jsonb, 0)`,
  );
  await f.p.db.query(
    `UPDATE studio_policy SET flags = flags || '{"mock-agent-llm":true}'::jsonb WHERE singleton`,
  );
  const chatConnId = randomUUID();
  await f.p.db.query(
    `INSERT INTO connections(id, name, plugin_id, plugin_version, config, enabled)
     VALUES ($1, 'Mock Agent Chat', 'mock-canvas-agent-chat', '1.0.0', $2, TRUE)`,
    [chatConnId, f.p.vault.seal({})],
  );
  await f.p.db.query(
    `INSERT INTO models(id, connection_id, catalog_id, provider_model, label, kind, schema, enabled)
     VALUES ($1, $2, 'mock-agent-llm', 'mock-agent-llm', 'Mock Agent LLM', 'chat', '{"type":"object"}'::jsonb, TRUE)`,
    [randomUUID(), chatConnId],
  );

  // 4. Create canvas-bound conversation & send message -> execute ChatRuntime
  const conv = await chats.create(f.admin, { model: "mock-agent-llm" }, wsPublicId);
  const policyRow = (await f.p.db.query("SELECT price_revision FROM studio_policy WHERE singleton")).rows[0];
  const sent = await chats.send(f.admin, conv.conversation.id, {
    uid: randomUUID(),
    model: "mock-agent-llm",
    text: "请根据当前画布梗概和工作区技能包，帮我提案一个雨夜镜头",
    expected_revision: conv.conversation.revision,
    price_revision: Number(policyRow.price_revision),
    context: {
      project: canvasId,
      node: "txt1",
      expected_revision: initialCanvas.revision,
      writeback: false,
    },
  });
  const turnRow = (
    await f.p.db.query(
      `SELECT t.id FROM chat_turns t
       JOIN chat_conversations c ON c.id = t.conversation_id
       WHERE c.public_id = $1
       ORDER BY t.created DESC LIMIT 1`,
      [conv.conversation.id],
    )
  ).rows[0];
  assert.ok(sent && turnRow?.id);
  await chatRuntime.execute(turnRow.id);

  // 5. Verify workspace skill was injected into system context AND built-in tools were provided!
  assert.ok(seenRequests.length === 4, `Expected 4 rounds, got ${seenRequests.length}`);
  const sysText = seenRequests[0].messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  assert.ok(sysText.includes("悬疑分镜镜头法则"), "Workspace SKILL.md must be injected into Agent chat context");
  assert.ok(sysText.includes("低角度推镜"));
  const toolNames = (seenRequests[0].tools ?? []).map((tl) => tl.function.name);
  assert.ok(toolNames.includes("fm_read_canvas_graph"));
  assert.ok(toolNames.includes("fm_propose_canvas_changes"));

  // 6. Verify stale base_revision=1 was rejected 409, and valid proposal is pending with credit estimate!
  const staleRes = staleToolResult as Record<string, unknown> | null;
  const validRes = validToolResult as Record<string, unknown> | null;
  assert.equal(staleRes?.ok, false);
  assert.equal(staleRes?.status, 409);
  assert.equal(validRes?.ok, true);
  assert.equal(validRes?.status, "pending");
  assert.ok(Number(validRes?.estimated_credits ?? 0) > 0);
  const proposalId = String(validRes?.proposal_id);

  // Canvas is STILL untouched before human approval!
  const beforeApply = await f.canvases.get(f.admin, canvasId);
  assert.equal(beforeApply.document.nodes.length, 1);

  // 7. Human approves proposal -> atomically lands node + edge onto canvas!
  const applied = await proposals.apply(f.admin, canvasId, proposalId, {
    expected_revision: beforeApply.revision,
  });
  assert.equal(applied.proposal.status, "applied");
  const afterApply = await f.canvases.get(f.admin, canvasId);
  assert.equal(afterApply.document.nodes.length, 2);
  assert.equal(afterApply.document.edges.length, 1);
  assert.ok(
    afterApply.document.nodes.some((n: { title?: string }) => n.title === "雨夜码头低角度推镜"),
  );
});

test("#14 F006/F025: OpenRouter/New API unified gateway ships chat + image/video media models, conditional reference slots & custom canvas extra_params reach backend intact", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const pkgPath = resolve(
    process.cwd(),
    "plugins/openrouter-gateway/openrouter-gateway.fmplugin.json",
  );
  const rawPkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const parsedPkg = packageFile.parse(rawPkg);
  assert.equal(parsedPkg.id, "openrouter-gateway");
  assert.ok(parsedPkg.studioProgram, "openrouter-gateway must include studioProgram for media generation");
  assert.ok((parsedPkg.manifest as any)?.chat?.sandbox?.program, "openrouter-gateway must keep chat sandbox");

  const pkgs = new StudioPackages(f.p);
  await pkgs.install(f.admin, parsedPkg);
  // Configure OpenRouter connection BEFORE enabling the unified package (matches real admin workflow)
  const connId = randomUUID();
  await f.p.db.query(
    `INSERT INTO connections(id, name, plugin_id, plugin_version, config, enabled)
     VALUES ($1, 'OpenRouter Gateway', 'openrouter-gateway', $2, $3, TRUE)`,
    [connId, parsedPkg.version, f.p.vault.seal({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1/", apiKey: "sk-test" })],
  );
  await f.p.db.query(
    `INSERT INTO models(id, connection_id, catalog_id, provider_model, label, kind, schema, enabled)
     VALUES ($1, $2, 'openrouter/flux-1.1-pro', 'openrouter/flux-1.1-pro', 'Flux 1.1 Pro', 'image', '{"type":"object","additionalProperties":true}'::jsonb, TRUE)`,
    [randomUUID(), connId],
  );
  await f.p.db.query(
    `UPDATE studio_policy SET flags = flags || '{"openrouter/flux-1.1-pro":true}'::jsonb WHERE singleton`,
  );
  const pkgRow = (
    await f.p.db.query("SELECT revision FROM studio_packages WHERE id='openrouter-gateway'")
  ).rows[0];
  await pkgs.change(f.admin, "openrouter-gateway", Number(pkgRow.revision), "enable");

  // Verify modelForm for openrouter/flux-1.1-pro evaluates conditional reference limits dynamically!
  const invoke = await loadProgram(parsedPkg.studioProgram!);
  const fluxForm = invoke("modelForm", { id: "openrouter/flux-1.1-pro" }) as any;
  assert.ok(fluxForm.fields.style_preset);
  assert.ok(fluxForm.fields.guidance_scale);
  const withoutBlend = evaluateFormConstraints(fluxForm, {
    ratio: "16:9",
    resolution: "1K",
    style_preset: "anime",
    guidance_scale: 7.5,
    use_reference_blend: false,
  });
  const withBlend = evaluateFormConstraints(fluxForm, {
    ratio: "16:9",
    resolution: "1K",
    style_preset: "anime",
    guidance_scale: 7.5,
    use_reference_blend: true,
  });
  assert.equal(withoutBlend.references.min, 0);
  assert.equal(withBlend.references.min, 1);

  // Verify sandbox request() + result() for image generation AND moderation rejection!
  const imgReq = invoke("request", {
    kind: "image",
    model: "openrouter/flux-1.1-pro",
    prompt: "cyberpunk skyline",
    params: { style_preset: "anime", guidance_scale: 7.5, resolution: "2K" },
    references: ["https://cdn.example/ref1.png"],
  }) as { path: string; body: Record<string, unknown> };
  assert.equal(imgReq.path, "/images/generations");
  assert.equal(imgReq.body.style_preset, "anime");
  assert.equal(imgReq.body.guidance_scale, 7.5);
  assert.deepEqual(imgReq.body.references, ["https://cdn.example/ref1.png"]);

  const okRes = invoke("result", { status: 200, text: JSON.stringify({ data: [{ b64_json: "AAAA" }] }) }, null, { kind: "image" }) as any;
  assert.equal(okRes.receipt?.state, "completed");
  const modRes = invoke("result", { status: 400, text: JSON.stringify({ error: { code: "content_policy_violation" } }) }, null, { kind: "image" }) as any;
  assert.equal(modRes.disposition?.reason, "moderation_blocked");
  assert.equal(modRes.disposition?.billable, false);

  const wsPublicId = String(f.workspace.public_id);
  const canvasId = await f.project(
    [
      {
        id: "img_or",
        type: "image",
        title: "OpenRouter 自定义参数节点",
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        prompt: "rainy Tokyo neon street",
        extra_params: {
          style_preset: "anime",
          guidance_scale: 8.5,
          use_reference_blend: false,
        },
        params: { model: "openrouter/flux-1.1-pro", ratio: "16:9", resolution: "2K" },
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );
  const submitted = await f.runs.generate(f.admin, canvasId, "img_or", {
    expected_revision: 2,
    uid: randomUUID(),
  });
  const job = (
    await f.p.db.query("SELECT input FROM jobs WHERE public_id=$1", [submitted.id])
  ).rows[0];
  assert.equal(job.input?.params?.style_preset, "anime");
  assert.equal(job.input?.params?.guidance_scale, 8.5);
});

test("#15 F021/F033: real FFmpeg MP4 + WAV assets export cleanly to Jianying ZIP, FCPXML 1.11 ZIP, and CMX 3600 EDL with verifiable media bytes & SMPTE timecodes", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const pkgs = new StudioPackages(f.p);
  for (const relPath of [
    "plugins/jianying-exporter/jianying-exporter.fmplugin.json",
    "plugins/fcpxml-exporter/fcpxml-exporter.fmplugin.json",
  ]) {
    const pkg = packageFile.parse(JSON.parse(readFileSync(resolve(process.cwd(), relPath), "utf8")));
    await pkgs.install(f.admin, pkg);
    const row = (await f.p.db.query("SELECT revision FROM studio_packages WHERE id=$1", [pkg.id])).rows[0];
    await pkgs.change(f.admin, pkg.id, Number(row.revision), "enable");
  }

  // Seed 2 real FFmpeg MP4 clips + 1 real FFmpeg WAV voice track
  const mp4A = generateValidMp4Bytes("#224488", 1.0);
  const mp4B = generateValidMp4Bytes("#884422", 1.0);
  const wavA = generateValidWavBytes(0.8);

  const seedAsset = async (bytes: Buffer, mime: string, kind: string, meta: Record<string, unknown>) => {
    const id = randomUUID();
    const pub = randomUUID().replaceAll("-", "");
    await f.p.storage.put(id, bytes, mime);
    await f.p.db.query(
      `INSERT INTO assets(id, public_id, workspace_id, owner_id, object_key, mime, size, state, original_kind, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ready',$8,$9::jsonb)`,
      [id, pub, f.workspace.id, f.admin.id, id, mime, bytes.length, kind, JSON.stringify(meta)],
    );
    return { id, pub };
  };
  const v1 = await seedAsset(mp4A, "video/mp4", "video", { width: 320, height: 180, duration: 1.0 });
  const v2 = await seedAsset(mp4B, "video/mp4", "video", { width: 320, height: 180, duration: 1.0 });
  const a1 = await seedAsset(wavA, "audio/wav", "audio", { duration: 0.8 });

  // Create synthetic completed audio job for shot1 narration
  const anyModel = (await f.p.db.query("SELECT m.id, m.connection_id, c.plugin_id, c.plugin_version, m.provider_model FROM models m JOIN connections c ON c.id=m.connection_id LIMIT 1")).rows[0];
  const voiceJobId = randomUUID();
  const voiceJobPub = (
    await f.p.db.query(
      `INSERT INTO jobs(id, workspace_id, owner_id, model_id, connection_id, plugin_id, plugin_version, config_snapshot, provider_model, kind, input, idempotency_key, request_hash, price, state, original_view, attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'audio','{"prompt":"开场旁白"}'::jsonb,$10,'h',0,'completed','{}'::jsonb,1)
       RETURNING public_id`,
      [voiceJobId, f.workspace.id, f.admin.id, anyModel.id, anyModel.connection_id, anyModel.plugin_id, anyModel.plugin_version, f.p.vault.seal({}), anyModel.provider_model, randomUUID()],
    )
  ).rows[0].public_id;
  await f.p.db.query("INSERT INTO job_assets(job_id, asset_id, role) VALUES ($1,$2,'output')", [voiceJobId, a1.id]);

  const wsPublicId = String(f.workspace.public_id);
  const canvasId = await f.project(
    [
      {
        id: "s1",
        type: "video",
        title: "镜头一_开场",
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        prompt: "opening",
        use_media: true,
        media_id: v1.pub,
        narration_text: "开场旁白",
        params: {},
      },
      {
        id: "s2",
        type: "video",
        title: "镜头二_反转",
        x: 360,
        y: 0,
        width: 320,
        height: 220,
        prompt: "twist",
        use_media: true,
        media_id: v2.pub,
        params: {},
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );
  const docRow = (await f.p.db.query("SELECT id FROM documents WHERE public_id=$1", [canvasId])).rows[0];
  await f.p.db.query(
    `INSERT INTO canvas_job_links(project_id, node, job_id, owner_id, uid, inputs, created)
     VALUES ($1, 'voice:s1', $2, $3, $4, '{}'::bytea, 1800000000)`,
    [docRow.id, voiceJobId, f.admin.id, randomUUID()],
  );
  const docGet = await f.canvases.get(f.admin, canvasId);
  const saved = await f.canvases.save(f.admin, canvasId, {
    title: "NLE真媒体导出验收",
    expected_revision: docGet.revision,
    document: {
      ...docGet.document,
      nodes: docGet.document.nodes.map((n: any) =>
        n.id === "s1" ? { ...n, narration_job: Number(voiceJobPub) } : n,
      ),
      shots: ["s1", "s2"],
    },
  });

  const exportsSvc = new OriginalStoryboardExports(f.p);
  const runExport = async (exporterKey: string) => {
    const created = await exportsSvc.create(f.admin, canvasId, {
      expected_revision: saved.revision,
      exporter: exporterKey,
      uid: randomUUID(),
    });
    const row = (await f.p.db.query("SELECT id FROM storyboard_exports WHERE public_id=$1", [created.id])).rows[0];
    await exportsSvc.execute(row.id);
    const done = (await f.p.db.query(
      `SELECT e.state, e.error, a.object_key, a.mime
         FROM storyboard_exports e
         LEFT JOIN assets a ON a.id = e.result_id
        WHERE e.id = $1`,
      [row.id],
    )).rows[0];
    assert.equal(done.state, "done", `${exporterKey} failed: ${done.error}`);
    const chunks: Buffer[] = [];
    const rs = await f.p.storage.stream(done.object_key);
    for await (const ch of rs) chunks.push(Buffer.from(ch));
    return Buffer.concat(chunks);
  };

  // 1. Jianying ZIP with real embedded MP4 + WAV + valid draft_content.json
  const jyZip = listZipEntries(await runExport("jianying-exporter/draft-zip"));
  const jyDraftKey = [...jyZip.keys()].find((k) => k.endsWith("draft_content.json"));
  assert.ok(jyDraftKey, "Jianying ZIP must contain draft_content.json");
  const jyDraft = JSON.parse(jyZip.get(jyDraftKey!)!.toString("utf8"));
  assert.ok(Array.isArray(jyDraft.tracks) && jyDraft.tracks.length >= 2);
  const jyMedia = [...jyZip.entries()].filter(([k]) => /\.(mp4|wav|mp3|mov)$/i.test(k));
  assert.ok(jyMedia.length >= 3, `Expected 2 MP4 + 1 WAV embedded, got ${[...jyZip.keys()].join(", ")}`);
  assert.ok(jyMedia.every(([, b]) => b.length > 500));

  // 2. FCPXML 1.11 ZIP with real embedded MP4 + WAV
  const fcpZip = listZipEntries(await runExport("fcpxml-exporter/bundle-zip"));
  const fcpXmlKey = [...fcpZip.keys()].find((k) => k.endsWith(".fcpxml"));
  assert.ok(fcpXmlKey);
  const fcpXml = fcpZip.get(fcpXmlKey!)!.toString("utf8");
  assert.ok(fcpXml.includes('<fcpxml version="1.11">'));
  assert.ok(fcpXml.includes("shot_001_"));
  assert.ok(fcpXml.includes("shot_002_"));
  const fcpMedia = [...fcpZip.entries()].filter(([k]) => k.startsWith("media/"));
  assert.ok(fcpMedia.length >= 3);

  // 3. CMX 3600 EDL with exact SMPTE timecodes & clip comments
  const edlText = (await runExport("fcpxml-exporter/edl")).toString("utf8");
  assert.ok(edlText.includes("TITLE: NLE真媒体导出验收"));
  assert.ok(edlText.includes("FCM: NON-DROP FRAME"));
  assert.ok(edlText.includes("01:00:00:00"));
  assert.ok(edlText.includes("* FROM CLIP NAME: shot_001_"));
  assert.ok(edlText.includes("* FROM CLIP NAME: shot_002_"));
  assert.ok(edlText.includes("VOICE_TRACK"));
});

test("#16 F008/F037: one-folder micro-app packs cleanly, live mock ComfyUI executes input media upload + artifact upload + POST /free on model switch, and in-flight job retains frozen v1.0.0 snapshot across v1.1.0 upgrade", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const dir = mkdtempSync(join(tmpdir(), "fm-comfy-dir-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const workflowV1 = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "flux-v10.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "default", clip: ["1", 1] } },
    "3": { class_type: "LoadImage", inputs: { image: "placeholder.png" } },
    "4": { class_type: "SaveImage", inputs: { images: ["3", 0], filename_prefix: "out_v10" } },
  };
  const appJsonV1 = {
    schemaVersion: 1,
    slug: "folder-flux-demo",
    version: "1.0.0",
    name: "文件夹微应用 Flux",
    description: "一文件夹一微应用端到端验证",
    kind: "image",
    modelKey: "flux-v10",
    peakVramGb: 16,
    credits: 2,
    workflowFile: "workflow.json",
    inputs: [
      { key: "prompt", label: "提示词", type: "prompt", required: true, bind: [{ nodeId: "2", inputKey: "text" }] },
      { key: "ref_image", label: "参考图", type: "image", required: false, bind: [{ nodeId: "3", inputKey: "image" }] },
    ],
    smokeTestCase: { prompt: "smoke test v1" },
  };
  writeFileSync(join(dir, "workflow.json"), JSON.stringify(workflowV1, null, 2));
  writeFileSync(join(dir, "app.json"), JSON.stringify(appJsonV1, null, 2));

  // 1. Pack one-folder-one-microapp directory & verify compiled package
  const packedV1 = await packComfyMicroAppDirectory(dir);
  assert.equal(packedV1.package_file.id, "comfy-folder-flux-demo");
  assert.equal(packedV1.package_file.version, "1.0.0");

  // 2. Publish & enable v1.0.0 via ComfyMicroAppCompiler
  const compiler = new ComfyMicroAppCompiler(f.p);
  await compiler.publish(f.admin, packedV1.spec, { dryRun: false, autoEnable: true });
  await f.p.db.query(
    `UPDATE studio_policy SET flags = flags || '{"folder-flux-demo":true}'::jsonb WHERE singleton`,
  );

  // 3. Pair a pull worker node via OriginalNodes
  const nodes = new OriginalNodes(f.p, "comfy-folder-flux-demo");
  const pair = await nodes.pair(f.admin, {
    name: "Mock GPU Node",
    models: ["folder-flux-demo"],
  });
  const pairCode = pair.command.trim().split(/\s+/).at(-1)!;
  const nodeSecret = "comfy-node-secret-" + randomUUID();
  await nodes.enroll({ secret: nodeSecret, code: pairCode });

  // 4. Start live local mock ComfyUI server (recording /upload/image, /prompt, /view, /free)
  const sampleOutPng = await sharp({
    create: { width: 128, height: 128, channels: 3, background: "#33aa77" },
  }).png().toBuffer();
  const comfyLog = {
    uploads: [] as string[],
    prompts: [] as Record<string, any>[],
    frees: 0,
  };
  const comfyServer = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = req.url || "/";
      if (req.method === "POST" && url === "/upload/image") {
        comfyLog.uploads.push(body.toString("latin1").slice(0, 200));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name: "uploaded_ref.png" }));
        return;
      }
      if (req.method === "POST" && url === "/free") {
        comfyLog.frees++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
        return;
      }
      if (req.method === "POST" && url === "/prompt") {
        const parsed = JSON.parse(body.toString("utf8"));
        comfyLog.prompts.push(parsed.prompt);
        const pid = `pid_${comfyLog.prompts.length}`;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ prompt_id: pid }));
        return;
      }
      if (req.method === "GET" && url.startsWith("/history/")) {
        const pid = url.slice("/history/".length);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            [pid]: {
              status: { status_str: "success" },
              outputs: { "4": { images: [{ filename: `${pid}.png`, type: "output" }] } },
            },
          }),
        );
        return;
      }
      if (req.method === "GET" && url.startsWith("/view")) {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(sampleOutPng);
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  await new Promise<void>((ok) => comfyServer.listen(0, "127.0.0.1", () => ok()));
  t.after(() => new Promise<void>((ok) => comfyServer.close(() => ok())));
  const comfyPort = (comfyServer.address() as { port: number }).port;

  // 5. Start live Fumiao NestJS app serving /agent/comfy-folder-flux-demo/*
  const app = await createOriginalApp(f.p);
  await app.init();
  const httpServer = app.getHttpServer();
  await new Promise<void>((ok) => httpServer.listen(0, "127.0.0.1", () => ok()));
  t.after(async () => {
    await new Promise<void>((ok) => httpServer.close(() => ok()));
    await app.close();
  });
  const sitePort = (httpServer.address() as { port: number }).port;

  // 6. Seed an input reference image & submit Job A on v1.0.0!
  const refPng = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#aa3344" } }).png().toBuffer();
  const refAssetId = randomUUID();
  const refPubId = randomUUID().replaceAll("-", "");
  await f.p.storage.put(refAssetId, refPng, "image/png");
  await f.p.db.query(
    `INSERT INTO assets(id, public_id, workspace_id, owner_id, object_key, mime, size, state, original_kind, metadata)
     VALUES ($1,$2,$3,$4,$5,'image/png',$6,'ready','ref','{"width":64,"height":64}'::jsonb)`,
    [refAssetId, refPubId, f.workspace.id, f.admin.id, refAssetId, refPng.length],
  );
  const wsPublicId = String(f.workspace.public_id);
  const canvasA = await f.project(
    [
      {
        id: "ref_n",
        type: "image",
        title: "输入参考图",
        x: 0,
        y: 0,
        width: 240,
        height: 180,
        media_id: refPubId,
        use_media: true,
        params: {},
      },
      {
        id: "comfy_a",
        type: "image",
        title: "Comfy V1 任务",
        x: 320,
        y: 0,
        width: 280,
        height: 200,
        prompt: "job A prompt on v1",
        params: { model: "folder-flux-demo", ratio: "16:9", resolution: "1K" },
      },
    ],
    [{ id: "e1", source: "ref_n", target: "comfy_a" }],
    wsPublicId,
    f.admin,
  );
  const jobA = await f.runs.generate(f.admin, canvasA, "comfy_a", {
    expected_revision: 2,
    uid: randomUUID(),
  });
  const jobARowBefore = (
    await f.p.db.query("SELECT id, plugin_version FROM jobs WHERE public_id=$1", [jobA.id])
  ).rows[0];
  assert.equal(jobARowBefore.plugin_version, "1.0.0");

  // 7. UPGRADE micro-app to v1.1.0 (new modelKey: flux-v11, new filename_prefix: out_v11) WHILE Job A is still queued!
  const workflowV2 = {
    ...workflowV1,
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "flux-v11.safetensors" } },
    "4": { class_type: "SaveImage", inputs: { images: ["3", 0], filename_prefix: "out_v11" } },
  };
  const { workflowFile: _wf, ...appV2Base } = appJsonV1;
  await compiler.publish(
    f.admin,
    { ...appV2Base, version: "1.1.0", modelKey: "flux-v11", workflowApiJson: workflowV2 },
    { dryRun: false, autoEnable: true },
  );

  // Submit Job B on the newly upgraded v1.1.0!
  const canvasB = await f.project(
    [
      {
        id: "comfy_b",
        type: "image",
        title: "Comfy V1.1 任务",
        x: 0,
        y: 0,
        width: 280,
        height: 200,
        prompt: "job B prompt on v1.1",
        params: { model: "folder-flux-demo", ratio: "16:9", resolution: "1K" },
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );
  const jobB = await f.runs.generate(f.admin, canvasB, "comfy_b", {
    expected_revision: 2,
    uid: randomUUID(),
  });
  const jobBRowBefore = (
    await f.p.db.query("SELECT id, plugin_version FROM jobs WHERE public_id=$1", [jobB.id])
  ).rows[0];
  assert.equal(jobBRowBefore.plugin_version, "1.1.0");

  // 8. Run real Python ComfyWorkerController.poll_once() TWICE against live Fumiao + live mock ComfyUI!
  const execFileAsync = promisify(execFile);
  const { stdout: pyOut } = await execFileAsync(
    "python3",
    [
      "-c",
      `import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from worker import ComfyWorkerController
ctrl = ComfyWorkerController(
    sys.argv[2], sys.argv[3], sys.argv[4],
    pending_path=Path(sys.argv[5]),
    poll_interval=0.0,
)
ok1 = ctrl.poll_once()
k1 = ctrl.loaded_model_key
u1 = ctrl.unload_count
ok2 = ctrl.poll_once()
k2 = ctrl.loaded_model_key
u2 = ctrl.unload_count
print(json.dumps({"ok1": ok1, "k1": k1, "u1": u1, "ok2": ok2, "k2": k2, "u2": u2}))`,
      resolve(process.cwd(), "plugins/example-node-pool/client"),
      `http://127.0.0.1:${sitePort}/agent/comfy-folder-flux-demo`,
      `http://127.0.0.1:${comfyPort}`,
      nodeSecret,
      join(dir, "pending.json"),
    ],
    { encoding: "utf8" },
  );
  const pyRes = JSON.parse(pyOut);
  assert.equal(pyRes.ok1, true);
  assert.equal(pyRes.ok2, true);
  // Job A ran on FROZEN v1.0.0 (modelKey=flux-v10), Job B ran on v1.1.0 (modelKey=flux-v11) triggering POST /free!
  assert.equal(pyRes.k1, "flux-v10");
  assert.equal(pyRes.u1, 0);
  assert.equal(pyRes.k2, "flux-v11");
  assert.equal(pyRes.u2, 1);
  assert.equal(comfyLog.frees, 1, "Model switch flux-v10 -> flux-v11 must invoke POST /free exactly once");
  assert.equal(comfyLog.uploads.length, 1, "Input reference image must be uploaded to ComfyUI /upload/image");
  assert.equal(comfyLog.prompts[0]["4"].inputs.filename_prefix, "out_v10", "In-flight Job A must keep frozen v1.0.0 workflow!");
  assert.equal(comfyLog.prompts[0]["3"].inputs.image, "uploaded_ref.png");
  assert.equal(comfyLog.prompts[1]["4"].inputs.filename_prefix, "out_v11", "New Job B must use upgraded v1.1.0 workflow!");

  // Verify BOTH jobs settled completed with real output PNG artifacts!
  for (const pubId of [jobA.id, jobB.id]) {
    const done = (
      await f.p.db.query(
        `SELECT j.state, a.mime, a.size FROM jobs j
         JOIN job_assets ja ON ja.job_id=j.id AND ja.role='output'
         JOIN assets a ON a.id=ja.asset_id
         WHERE j.public_id=$1`,
        [pubId],
      )
    ).rows[0];
    assert.equal(done.state, "completed");
    assert.equal(done.mime, "image/png");
    assert.ok(Number(done.size) > 100);
  }
});

test("#17 F005/F024: observability distinguishes unknown vs configured real upstream costs, and moderation rejection rewrites then falls back to equivalent model with single-settlement accuracy", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const wsPublicId = String(f.workspace.public_id);
  const obs = new OriginalObservability(f.p);
  const budgets = new OriginalBudgets(f.p);
  const executor = new Executor(f.p);
  const pngB64 = (
    await sharp({ create: { width: 64, height: 64, channels: 3, background: "#3355cc" } })
      .png()
      .toBuffer()
  ).toString("base64");

  // Register Primary (always moderation-blocks) + Equivalent Fallback (succeeds, costs 15 fen, priced 3 credits) + Unknown-Cost model (succeeds, no cost config)
  const makeImagePlugin = (
    id: string,
    modelId: string,
    behavior: "moderate" | "ok",
  ): ProviderPlugin => ({
    manifest: {
      id,
      label: id,
      version: "1.0.0",
      contractVersion: 1,
      mode: "request",
      configSchema: { type: "object", properties: {} },
      models: [{ id: modelId, label: modelId, kind: "image", inputSchema: { type: "object", properties: {} } }],
      canvas: { version: 1, models: [{ model: modelId, kind: "image", defaultForKind: false }] },
      canvasSubmission: { version: 1, models: [{ model: modelId, kind: "image", defaultForKind: false }] },
      originalSubmission: { version: 1 },
      originalState: { version: 1, fields: [], queueLane: "kind" },
    },
    health: async () => true,
    originalSubmission: {
      validate: () => {},
      namespace: () => `-${id}`,
      plan: () => ({ namespace: `-${id}`, parentKind: "any", refs: [], roles: [], missing: { status: 400, message: "" } }),
      prepare: async () => ({
        params: {},
        references: [],
        view: {
          ratio: "16:9", quality: null, seconds: null, sampling_steps: null, seed: null,
          width: 64, height: 64, image_quality: "medium", audio_settings: null, h3_inputs: null, refs: [],
        },
      }),
    },
    originalState: { configured: () => true, configuration: () => ({}), project: () => ({}) },
    submit: async () => {
      if (behavior === "moderate") {
        throw new ProviderError("content_policy_violation: blocked by safety filter", "rejected");
      }
      return {
        state: "completed",
        artifacts: [{ mime: "image/png", url: `data:image/png;base64,${pngB64}` }],
      };
    },
  });

  const registerModel = async (
    plugin: ProviderPlugin,
    modelId: string,
    price: number,
    configObj: Record<string, unknown>,
  ) => {
    f.p.registry.registerBuiltin(plugin);
    await f.p.db.query(
      `INSERT INTO plugin_versions(id, version, manifest) VALUES ($1, '1.0.0', $2::jsonb)`,
      [plugin.manifest.id, JSON.stringify(plugin.manifest)],
    );
    await f.p.db.query(
      `INSERT INTO studio_catalog(id, plugin_id, plugin_version, descriptor, runtime, position, price_position, hidden)
       VALUES ($1, $2, '1.0.0', $3::jsonb, '{}'::jsonb, 50, 500, FALSE)`,
      [modelId, plugin.manifest.id, JSON.stringify({ kind: "image", label: modelId })],
    );
    await f.p.db.query(
      `INSERT INTO studio_prices(key, model_id, tier, label, position, matcher, amount)
       VALUES ($1, $2, 'std', '标准', 500, '{"type":"object","properties":{}}'::jsonb, $3)`,
      [`${modelId}|std`, modelId, price],
    );
    await f.p.db.query(
      `UPDATE studio_policy SET flags = flags || $1::jsonb WHERE singleton`,
      [JSON.stringify({ [modelId]: true })],
    );
    const cid = randomUUID();
    await f.p.db.query(
      `INSERT INTO connections(id, name, plugin_id, plugin_version, config, enabled) VALUES ($1, $2, $3, '1.0.0', $4, TRUE)`,
      [cid, modelId, plugin.manifest.id, f.p.vault.seal(configObj)],
    );
    await f.p.db.query(
      `INSERT INTO models(id, connection_id, catalog_id, provider_model, label, kind, schema, enabled)
       VALUES ($1, $2, $3, $3, $3, 'image', '{"type":"object"}'::jsonb, TRUE)`,
      [randomUUID(), cid, modelId],
    );
  };

  await registerModel(makeImagePlugin("mock-unknown-cost", "img-unknown-cost", "ok"), "img-unknown-cost", 4, {});
  await registerModel(makeImagePlugin("mock-mod-fallback", "img-mod-fallback", "ok"), "img-mod-fallback", 3, {
    upstreamCostFen: 15,
  });
  await registerModel(makeImagePlugin("mock-mod-primary", "img-mod-primary", "moderate"), "img-mod-primary", 5, {
    fallbackModel: "img-mod-fallback",
  });

  await f.p.db.query("UPDATE wallets SET balance = 100, held = 0 WHERE workspace_id = $1", [f.workspace.id]);
  await budgets.updateModeration(f.admin, { auto_rewrite: true, max_attempts: 1 }, wsPublicId);

  // 1. Complete a job whose connection has NO cost config -> observability MUST report cost_status="unknown", gross_margin_fen=null!
  const canvas1 = await f.project(
    [
      {
        id: "u1",
        type: "image",
        title: "无成本配置任务",
        x: 0,
        y: 0,
        width: 280,
        height: 200,
        prompt: "mountain sunrise",
        params: { model: "img-unknown-cost", ratio: "16:9", resolution: "1K" },
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );
  const sub1 = await f.runs.generate(f.admin, canvas1, "u1", { expected_revision: 2, uid: randomUUID() });
  const j1Id = (await f.p.db.query("SELECT id FROM jobs WHERE public_id=$1", [sub1.id])).rows[0].id;
  await executor.execute(j1Id);

  const summaryUnknown = await obs.summary(f.admin, 7);
  assert.equal(summaryUnknown.totals.cost_status, "unknown");
  assert.equal(summaryUnknown.totals.upstream_cost_fen, null);
  assert.equal(summaryUnknown.totals.gross_margin_fen, null);
  assert.equal(summaryUnknown.totals.cost_unknown_jobs, 1);

  // 2. Submit a job on Primary (5 credits) with sensitive prompt ->
  //    Exec 1: rejected moderation -> neutralizes prompt & re-queues (attempt 1/1)
  //    Exec 2: rejected again -> rewrite exhausted -> equivalent-model fallback to img-mod-fallback (3 credits, refunds 2-credit delta!)
  //    Exec 3: completes on fallback & records real upstreamCostFen=15!
  const canvas2 = await f.project(
    [
      {
        id: "m1",
        type: "image",
        title: "审核改写加等价降级任务",
        x: 0,
        y: 0,
        width: 280,
        height: 200,
        prompt: "bloody battle scene with explosions",
        params: { model: "img-mod-primary", ratio: "16:9", resolution: "1K" },
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );
  const sub2 = await f.runs.generate(f.admin, canvas2, "m1", { expected_revision: 2, uid: randomUUID() });
  const j2Id = (await f.p.db.query("SELECT id FROM jobs WHERE public_id=$1", [sub2.id])).rows[0].id;

  // Exec 1 -> moderation rewrite
  await executor.execute(j2Id);
  await f.p.db.query("UPDATE jobs SET request_retry_at = NULL WHERE id=$1", [j2Id]);
  const j2AfterRewrite = (await f.p.db.query("SELECT state, input, catalog_id, price FROM jobs WHERE id=$1", [j2Id])).rows[0];
  assert.equal(j2AfterRewrite.state, "queued");
  assert.equal(j2AfterRewrite.catalog_id, "img-mod-primary");
  assert.ok(!String(j2AfterRewrite.input?.prompt).includes("bloody"));

  // Exec 2 -> rewrite exhausted -> equivalent model fallback (price 5 -> 3, refunding 2-credit delta!)
  await executor.execute(j2Id);
  await f.p.db.query("UPDATE jobs SET request_retry_at = NULL WHERE id=$1", [j2Id]);
  const j2AfterFallback = (await f.p.db.query("SELECT state, catalog_id, price FROM jobs WHERE id=$1", [j2Id])).rows[0];
  assert.equal(j2AfterFallback.state, "queued");
  assert.equal(j2AfterFallback.catalog_id, "img-mod-fallback");
  assert.equal(Number(j2AfterFallback.price), 3);

  // Exec 3 -> completes cleanly on equivalent fallback model & records real upstream cost (15 fen)!
  await executor.execute(j2Id);
  const j2Final = (await f.p.db.query("SELECT state FROM jobs WHERE id=$1", [j2Id])).rows[0];
  assert.equal(j2Final.state, "completed");

  // Wallet: started at 100, spent 4 (u1) + 3 (m1 after 2-credit fallback delta refund) = 93 remaining, 0 held!
  const wallet = (await f.p.db.query("SELECT balance, held FROM wallets WHERE workspace_id=$1", [f.workspace.id])).rows[0];
  assert.equal(Number(wallet.balance), 93);
  assert.equal(Number(wallet.held), 0);

  // Observability now reports partial cost coverage (1 known / 2 completed = 50%), real cost 15 fen,
  // and gross margin strictly over cost-known revenue (3 credits * 10 = 30 fen - 15 fen = 15 fen)!
  const summaryPartial = await obs.summary(f.admin, 7);
  assert.equal(summaryPartial.totals.cost_status, "partial");
  assert.equal(summaryPartial.totals.cost_known_jobs, 1);
  assert.equal(summaryPartial.totals.cost_unknown_jobs, 1);
  assert.equal(summaryPartial.totals.cost_coverage_pct, 50);
  assert.equal(summaryPartial.totals.upstream_cost_fen, 15);
  assert.equal(summaryPartial.totals.gross_margin_fen, 15);
  assert.equal(summaryPartial.totals.rewritten_jobs, 1);

  // 3. Reconcile endpoint ID validation boundary: invalid format -> 400 (NOT 500 ZodError!),
  //    unknown numeric/UUID -> 404, valid numeric public_id & UUID both reconcile cleanly 200!
  await assert.rejects(
    obs.reconcileJob(f.admin, "not-a-valid-id", {
      action: "refund",
      reason: "format validation check",
    }),
    (err: any) => err?.status === 400,
  );
  await assert.rejects(
    obs.reconcileJob(f.admin, "0", {
      action: "refund",
      reason: "zero id validation check",
    }),
    (err: any) => err?.status === 400,
  );
  await assert.rejects(
    obs.reconcileJob(f.admin, "999999999", {
      action: "refund",
      reason: "missing numeric id check",
    }),
    (err: any) => err?.status === 404,
  );
  await assert.rejects(
    obs.reconcileJob(f.admin, randomUUID(), {
      action: "refund",
      reason: "missing uuid check",
    }),
    (err: any) => err?.status === 404,
  );

  // Create a synthetic uncertain job with 4 held credits and reconcile it using its numeric public_id!
  const canvasUnc = await f.project(
    [
      {
        id: "unc1",
        type: "image",
        title: "待核对任务",
        x: 0,
        y: 0,
        width: 280,
        height: 200,
        prompt: "sunset cliff",
        params: { model: "img-unknown-cost", ratio: "16:9", resolution: "1K" },
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );
  const uncSub = await f.runs.generate(f.admin, canvasUnc, "unc1", {
    expected_revision: 2,
    uid: randomUUID(),
  });
  await f.p.db.query("UPDATE jobs SET state = 'uncertain' WHERE public_id = $1", [
    uncSub.id,
  ]);
  const uncReconciled = await obs.reconcileJob(f.admin, String(uncSub.id), {
    action: "refund",
    reason: "reconcile via numeric public_id",
  });
  assert.equal(uncReconciled.ok, true);
  const walletAfterReconcile = (
    await f.p.db.query("SELECT balance, held FROM wallets WHERE workspace_id=$1", [
      f.workspace.id,
    ])
  ).rows[0];
  assert.equal(Number(walletAfterReconcile.balance), 93);
  assert.equal(Number(walletAfterReconcile.held), 0);
});

test("#16 example-node-pool release immutability & upgrade: installing legacy 1.1.0 rejects mutated 1.1.0 (409), upgrades cleanly to shipped 1.2.0 artifact matching update.json, and keeps 1.1.0 release & in-flight job snapshot intact", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const pkgPath = resolve(
    process.cwd(),
    "plugins/example-node-pool/example-node-pool.fmplugin.json",
  );
  const updatePath = resolve(
    process.cwd(),
    "plugins/example-node-pool/update.json",
  );
  const rawPkgText = readFileSync(pkgPath, "utf8");
  const updateMeta = JSON.parse(readFileSync(updatePath, "utf8")) as {
    id: string;
    version: string;
    package: string;
    sha256: string;
  };
  const newPkg = packageFile.parse(JSON.parse(rawPkgText));

  // Verify shipped artifact and update.json match byte-for-byte with bumped version 1.2.0
  assert.equal(updateMeta.id, "example-node-pool");
  assert.equal(updateMeta.version, "1.2.0");
  assert.equal(newPkg.version, "1.2.0");
  assert.equal(
    createHash("sha256").update(rawPkgText).digest("hex"),
    updateMeta.sha256,
    "update.json sha256 must match shipped example-node-pool.fmplugin.json",
  );

  // Build an immutable legacy 1.1.0 package with distinct historical agent.tgz bytes
  const legacyTgz = gzipSync(Buffer.from("legacy-worker-1.1.0-payload", "utf8"));
  const legacySha = createHash("sha256").update(legacyTgz).digest("hex");
  const legacyPkg = packageFile.parse({
    ...structuredClone(newPkg),
    version: "1.1.0",
    nodeClient: {
      ...newPkg.nodeClient!,
      "agent.tgz": legacyTgz.toString("base64"),
      "agent.tgz.sha256": Buffer.from(`${legacySha}  agent.tgz\n`, "utf8").toString(
        "base64",
      ),
    },
  });

  const pkgs = new StudioPackages(f.p);
  // 1. Install and enable legacy 1.1.0
  await pkgs.install(f.admin, legacyPkg);
  const initialRow = (
    await f.p.db.query(
      "SELECT version, revision FROM studio_packages WHERE id='example-node-pool'",
    )
  ).rows[0];
  assert.equal(initialRow.version, "1.1.0");
  await pkgs.change(
    f.admin,
    "example-node-pool",
    Number(initialRow.revision),
    "enable",
  );

  // Seed an in-flight queued job pinned to frozen package_version='1.1.0'
  const poolModel = (
    await f.p.db.query(
      `SELECT m.id, m.connection_id, c.plugin_id, c.plugin_version, m.provider_model
         FROM models m
         JOIN connections c ON c.id = m.connection_id
        WHERE c.plugin_id = 'example-node-pool'
        LIMIT 1`,
    )
  ).rows[0];
  assert.ok(poolModel, "example-node-pool model must be registered on install");
  const inFlightJobId = randomUUID();
  await f.p.db.query(
    `INSERT INTO jobs(
       id, workspace_id, owner_id, model_id, connection_id,
       plugin_id, plugin_version, package_version, config_snapshot,
       provider_model, kind, input, idempotency_key, request_hash,
       price, state, original_view, attempts
     )
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,'1.1.0',$8,$9,'image',
       '{"prompt":"in-flight v1.1.0","params":{},"references":[]}'::jsonb,
       $10,'h',1,'queued','{}'::jsonb,0
     )`,
    [
      inFlightJobId,
      f.workspace.id,
      f.admin.id,
      poolModel.id,
      poolModel.connection_id,
      poolModel.plugin_id,
      poolModel.plugin_version,
      f.p.vault.seal({}),
      poolModel.provider_model,
      randomUUID(),
    ],
  );

  // 2. Re-importing mutated bytes under the SAME 1.1.0 version MUST fail with 409!
  const mutatedSameVersion = packageFile.parse({
    ...structuredClone(newPkg),
    version: "1.1.0",
  });
  await assert.rejects(
    pkgs.install(f.admin, mutatedSameVersion),
    (err: any) => err?.status === 409,
  );

  // 3. Upgrade cleanly from 1.1.0 -> shipped 1.2.0 artifact with optimistic revision check!
  const beforeUpgrade = (
    await f.p.db.query(
      "SELECT revision FROM studio_packages WHERE id='example-node-pool'",
    )
  ).rows[0];
  await pkgs.install(f.admin, newPkg, Number(beforeUpgrade.revision));
  const upgradedRow = (
    await f.p.db.query(
      "SELECT version, installed, enabled FROM studio_packages WHERE id='example-node-pool'",
    )
  ).rows[0];
  assert.equal(upgradedRow.version, "1.2.0");
  assert.equal(upgradedRow.installed, true);
  assert.equal(upgradedRow.enabled, true);

  // 4. Both historical 1.1.0 and new 1.2.0 releases remain intact, and the in-flight job retains frozen 1.1.0!
  const releases = (
    await f.p.db.query(
      "SELECT version, package->'nodeClient'->>'agent.tgz' AS tgz FROM studio_package_releases WHERE id='example-node-pool' ORDER BY version",
    )
  ).rows;
  assert.deepEqual(
    releases.map((r) => String(r.version)),
    ["1.1.0", "1.2.0"],
  );
  const v11Tar = gunzipSync(Buffer.from(String(releases[0].tgz), "base64")).toString("utf8");
  const v12Tar = gunzipSync(Buffer.from(String(releases[1].tgz), "base64")).toString("utf8");
  assert.ok(v11Tar.includes("legacy-worker-1.1.0-payload"));
  assert.ok(v12Tar.includes("/jobs/{job_id}/ref/{asset_key}"));

  const inFlightAfter = (
    await f.p.db.query("SELECT state, package_version FROM jobs WHERE id=$1", [
      inFlightJobId,
    ])
  ).rows[0];
  assert.equal(inFlightAfter.state, "queued");
  assert.equal(inFlightAfter.package_version, "1.1.0");
});
