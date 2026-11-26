import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { inferComfyWorkflowSlots } from "@fumiao/plugin-sdk/comfy-microapp.js";
import {
  buildComfyNodeClient,
  ComfyMicroAppCompiler,
} from "@fumiao/platform/comfy-compiler.js";
import { nodePoolProgram } from "@fumiao/platform/node-pool-policy.js";
import { canvasRunsFixture } from "../helpers/canvas-runs.js";

const execFileAsync = promisify(execFile);

const SAMPLE_VIDEO_WORKFLOW = {
  "1": {
    class_type: "CheckpointLoaderSimple",
    inputs: { ckpt_name: "wan21-i2v-14b.safetensors" },
  },
  "2": {
    class_type: "LoraLoader",
    inputs: {
      model: ["1", 0],
      clip: ["1", 1],
      lora_name: "cinema_lighting_v2.safetensors",
      strength_model: 0.8,
      strength_clip: 0.8,
    },
  },
  "3": {
    class_type: "CLIPTextEncode",
    inputs: { text: "default positive", clip: ["2", 1] },
  },
  "4": {
    class_type: "ConditioningSetArea",
    inputs: { conditioning: ["3", 0], width: 1024, height: 576 },
  },
  "5": {
    class_type: "CLIPTextEncode",
    inputs: { text: "bad anatomy, blurry", clip: ["2", 1] },
  },
  "6": {
    class_type: "LoadImage",
    inputs: { image: "hero_frame.png" },
  },
  "7": {
    class_type: "EmptyLatentImage",
    inputs: { width: 1280, height: 720, batch_size: 1 },
  },
  "8": {
    class_type: "KSampler",
    inputs: {
      model: ["2", 0],
      positive: ["4", 0],
      negative: ["5", 0],
      latent_image: ["7", 0],
      seed: 123456,
      steps: 28,
      cfg: 6.5,
    },
  },
  "9": {
    class_type: "VAEDecode",
    inputs: { samples: ["8", 0], vae: ["1", 2] },
  },
  "10": {
    class_type: "VHS_VideoCombine",
    inputs: { images: ["9", 0], frame_rate: 24, format: "video/h264-mp4" },
  },
};

test("F008: inferComfyWorkflowSlots uses multi-hop reverse consumer BFS to classify prompts, media, sampler params, outputKind, and model dependencies", () => {
  const analysis = inferComfyWorkflowSlots(SAMPLE_VIDEO_WORKFLOW);
  assert.equal(analysis.outputKind, "video");
  assert.deepEqual(analysis.outputNodes, ["10"]);
  assert.equal(analysis.warnings.length, 0);
  assert.equal(analysis.suggestedModelKey, "wan21-i2v-14b");

  const byKey = Object.fromEntries(analysis.inputs.map((i) => [i.key, i]));
  // Positive went through node 3 -> node 4 (ConditioningSetArea) -> node 8 (KSampler.positive)
  assert.equal(byKey.prompt?.type, "prompt");
  assert.deepEqual(byKey.prompt?.bind, [{ nodeId: "3", inputKey: "text" }]);
  // Negative went node 5 -> node 8 (KSampler.negative)
  assert.equal(byKey.negative_prompt?.type, "negative_prompt");
  assert.deepEqual(byKey.negative_prompt?.bind, [
    { nodeId: "5", inputKey: "text" },
  ]);
  assert.equal(byKey.ref_image?.type, "image");
  assert.deepEqual(byKey.ref_image?.bind, [{ nodeId: "6", inputKey: "image" }]);
  assert.equal(byKey.seed?.default, 123456);
  assert.equal(byKey.steps?.default, 28);
  assert.equal(byKey.cfg?.default, 6.5);
  assert.equal(byKey.width?.default, 1280);
  assert.equal(byKey.height?.default, 720);

  assert.equal(analysis.modelDependencies.length, 2);
  assert.equal(analysis.modelDependencies[0].filename, "wan21-i2v-14b.safetensors");
  assert.equal(
    analysis.modelDependencies[1].filename,
    "cinema_lighting_v2.safetensors",
  );
});

test("F037 + Q4: ComfyMicroAppCompiler compiles declarative app.json (1-to-many bind + template), passes QuickJS sandbox smoke test, installs into StudioPackages, and upgrades cleanly", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const compiler = new ComfyMicroAppCompiler(f.p);
  const specV1 = {
    schemaVersion: 1 as const,
    slug: "wan-cinema-v1",
    version: "1.0.0",
    name: "Wan 电影镜头微应用",
    description: "测试声明式 app.json 编译签发为标准 .fmplugin.json",
    kind: "video" as const,
    modelKey: "wan21-i2v-14b",
    peakVramGb: 24,
    credits: 5,
    workflowApiJson: SAMPLE_VIDEO_WORKFLOW,
    inputs: [
      {
        key: "prompt",
        label: "画面描述",
        type: "prompt" as const,
        required: true,
        bind: [
          {
            nodeId: "3",
            inputKey: "text",
            template: "masterpiece, cinematic lighting, {{value}}",
          },
          {
            nodeId: "10",
            inputKey: "filename_prefix",
            template: "shot_{{value}}",
          },
        ],
      },
      {
        key: "ref_image",
        label: "首帧参考图",
        type: "image" as const,
        required: false,
        bind: [{ nodeId: "6", inputKey: "image" }],
      },
      {
        key: "steps",
        label: "采样步数",
        type: "integer" as const,
        required: false,
        default: 24,
        min: 4,
        max: 60,
        bind: [{ nodeId: "8", inputKey: "steps" }],
      },
      {
        key: "negative_prompt",
        label: "负向提示词",
        type: "negative_prompt" as const,
        required: false,
        default: "blurry",
        bind: [{ nodeId: "5", inputKey: "text" }],
      },
      {
        key: "seed",
        label: "随机种子",
        type: "seed" as const,
        required: false,
        default: 42,
        min: 0,
        max: 2_147_483_647,
        bind: [{ nodeId: "8", inputKey: "seed" }],
      },
      {
        key: "cfg",
        label: "引导系数",
        type: "number" as const,
        required: false,
        default: 6.5,
        min: 1,
        max: 20,
        bind: [{ nodeId: "8", inputKey: "cfg" }],
      },
    ],
    smokeTestCase: {
      prompt: "neon rain in cyberpunk alley",
      params: { steps: 32 },
    },
  };

  // 1. Dry-run smoke test executes QuickJS sandbox + StudioPackages.preview without persisting
  const dry = await compiler.publish(f.admin, specV1, { dryRun: true });
  assert.equal(dry.dry_run, true);
  assert.equal(dry.smoke_test_passed, true);
  assert.equal(dry.plugin_id, "comfy-wan-cinema-v1");
  assert.equal(dry.model_key, "wan21-i2v-14b");
  const smokeWf = dry.smoke_dispatch?.workflow as Record<
    string,
    { inputs: Record<string, unknown> }
  >;
  assert.equal(
    smokeWf["3"].inputs.text,
    "masterpiece, cinematic lighting, neon rain in cyberpunk alley",
  );
  assert.equal(
    smokeWf["10"].inputs.filename_prefix,
    "shot_neon rain in cyberpunk alley",
  );
  assert.equal(smokeWf["8"].inputs.steps, 32);

  // Confirm dry-run did NOT install package
  const beforeRows = await f.p.db.query(
    "SELECT id FROM studio_packages WHERE id=$1",
    [dry.plugin_id],
  );
  assert.equal(beforeRows.rows.length, 0);

  // 2. Real publish compiles & installs immutable .fmplugin.json into StudioPackages
  const published = await compiler.publish(f.admin, specV1, {
    dryRun: false,
    autoEnable: true,
  });
  assert.equal(published.dry_run, false);
  assert.equal(published.smoke_test_passed, true);

  const installedRow = await f.p.db.query(
    "SELECT id, version, enabled, installed FROM studio_packages WHERE id=$1",
    [published.plugin_id],
  );
  assert.equal(installedRow.rows.length, 1);
  assert.equal(installedRow.rows[0].version, "1.0.0");
  assert.equal(installedRow.rows[0].enabled, true);
  assert.equal(installedRow.rows[0].installed, true);

  // 3. Execute installed NodePoolProgram directly from DB via nodePoolProgram()
  const run = await nodePoolProgram(f.p.db, published.plugin_id, "1.0.0");
  const caps = run("capabilities", {
    ready: true,
    loaded_model_key: "wan21-i2v-14b",
    vram_total_mb: 24576,
    vram_free_mb: 18432,
  }) as Record<string, unknown>;
  assert.deepEqual(caps.ready_models, ["wan-cinema-v1"]);
  assert.equal(caps.loaded_model_key, "wan21-i2v-14b");
  assert.equal(caps.vram_total_mb, 24576);

  const dispatched = run("dispatch", {
    kind: "video",
    model: "wan-cinema-v1",
    view: {},
    attempts: 1,
    assets: {},
    input: {
      prompt: "dawn over snowy peak",
      params: { steps: 18 },
      references: ["asset_ref_001"],
    },
  }) as {
    modelKey: string;
    mediaUploads: { asset: string; nodeId: string; inputKey: string }[];
    workflow: Record<string, { inputs: Record<string, unknown> }>;
  };
  assert.equal(dispatched.modelKey, "wan21-i2v-14b");
  assert.equal(dispatched.workflow["8"].inputs.steps, 18);
  assert.deepEqual(dispatched.mediaUploads, [
    { asset: "asset_ref_001", nodeId: "6", inputKey: "image", kind: "image" },
  ]);

  // 4. Seamless immutable upgrade to v1.1.0
  const upgraded = await compiler.publish(
    f.admin,
    { ...specV1, version: "1.1.0", credits: 8 },
    { dryRun: false },
  );
  assert.equal(upgraded.version, "1.1.0");
  const afterRow = await f.p.db.query(
    "SELECT version, previous_version FROM studio_packages WHERE id=$1",
    [published.plugin_id],
  );
  assert.equal(afterRow.rows[0].version, "1.1.0");
  assert.equal(afterRow.rows[0].previous_version, "1.0.0");
});

test("F013: ComfyWorkerController invokes POST /free ONLY on cross-workflow modelKey switch and reports loaded_model_key in heartbeat", async (t) => {
  const events: { type: string; path: string; body?: unknown }[] = [];
  const jobsQueue = [
    {
      id: "job-1",
      ticket: "tk-1",
      model: "flux-dev",
      instruction: {
        modelKey: "flux-dev-fp8",
        prompt: "first shot",
        workflow: { "1": { class_type: "SaveImage", inputs: {} } },
      },
    },
    {
      id: "job-2",
      ticket: "tk-2",
      model: "flux-dev",
      instruction: {
        modelKey: "flux-dev-fp8",
        prompt: "second shot same model",
        workflow: { "1": { class_type: "SaveImage", inputs: {} } },
      },
    },
    {
      id: "job-3",
      ticket: "tk-3",
      model: "wan-i2v",
      instruction: {
        modelKey: "wan21-i2v-14b",
        prompt: "third shot DIFFERENT model",
        workflow: { "1": { class_type: "VHS_VideoCombine", inputs: {} } },
      },
    },
  ];
  let promptSeq = 0;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const raw = Buffer.concat(chunks);
      const parseJson = () => (raw.length ? JSON.parse(raw.toString("utf8")) : {});

      // Mock ComfyUI API
      if (url.pathname === "/comfy/free") {
        const body = parseJson();
        events.push({ type: "free", path: url.pathname, body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === "/comfy/prompt") {
        promptSeq++;
        const promptId = `pid-${promptSeq}`;
        events.push({ type: "prompt", path: url.pathname, body: { promptId } });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ prompt_id: promptId }));
        return;
      }
      if (url.pathname.startsWith("/comfy/history/")) {
        const pid = url.pathname.split("/").pop()!;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            [pid]: {
              status: { status_str: "success" },
              outputs: {
                "1": {
                  images: [{ filename: `${pid}.png`, type: "output" }],
                },
              },
            },
          }),
        );
        return;
      }
      if (url.pathname === "/comfy/view") {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(Buffer.from("FAKEPNGDATA"));
        return;
      }

      // Mock Fumiao Pull Agent API
      if (url.pathname === "/agent/test-pool/heartbeat") {
        const body = parseJson();
        events.push({ type: "heartbeat", path: url.pathname, body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ held: true, control: "active", protocol: 1 }));
        return;
      }
      if (url.pathname === "/agent/test-pool/claim") {
        const nextJob = jobsQueue.shift() ?? null;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ job: nextJob }));
        return;
      }
      if (url.pathname.endsWith("/result")) {
        events.push({ type: "result", path: url.pathname });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      res.writeHead(404);
      res.end("not found");
    });
  });

  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  t.after(() => server.close());
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const workerDir = resolve(
    process.cwd(),
    "packages/platform/src/comfy-worker",
  );

  const pyCode = `
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(workerDir)})
from worker import ComfyWorkerController

with tempfile.TemporaryDirectory() as td:
    ctrl = ComfyWorkerController(
        ${JSON.stringify(baseUrl + "/agent/test-pool")},
        ${JSON.stringify(baseUrl + "/comfy")},
        "secret-token",
        pending_path=Path(td) / "pending.json",
        poll_interval=0.0,
    )
    assert ctrl.poll_once() is True
    assert ctrl.loaded_model_key == "flux-dev-fp8"
    assert ctrl.unload_count == 0
    assert ctrl.poll_once() is True
    assert ctrl.loaded_model_key == "flux-dev-fp8"
    assert ctrl.unload_count == 0
    assert ctrl.poll_once() is True
    assert ctrl.loaded_model_key == "wan21-i2v-14b"
    assert ctrl.unload_count == 1
    assert ctrl.poll_once() is False
    print(json.dumps({"loaded": ctrl.loaded_model_key, "unloads": ctrl.unload_count}))
`;

  const { stdout } = await execFileAsync("python3", ["-c", pyCode]);
  const summary = JSON.parse(stdout.trim());
  assert.equal(summary.loaded, "wan21-i2v-14b");
  assert.equal(summary.unloads, 1);

  const freeEvents = events.filter((e) => e.type === "free");
  assert.equal(freeEvents.length, 1);
  assert.deepEqual(freeEvents[0].body, {
    unload_models: true,
    free_memory: true,
  });

  // Verify ordering: prompt(pid-1) -> prompt(pid-2) -> free -> prompt(pid-3)
  const seq = events
    .filter((e) => e.type === "free" || e.type === "prompt")
    .map((e) => e.type);
  assert.deepEqual(seq, ["prompt", "prompt", "free", "prompt"]);

  // Verify heartbeat advertised loaded_model_key after Job 1 and Job 3
  const heartbeats = events
    .filter((e) => e.type === "heartbeat")
    .map((e) => (e.body as { capabilities?: { loaded_model_key?: string } })?.capabilities?.loaded_model_key);
  assert.ok(heartbeats.includes("flux-dev-fp8"));
  assert.ok(heartbeats.includes("wan21-i2v-14b"));
});

test("Platform embeds complete ComfyUI worker.py without example-node-pool dependency and strips example-* plugins in production Dockerfile", () => {
  const repoRoot = process.cwd();
  const builtinWorkerPath = resolve(
    repoRoot,
    "packages/platform/src/comfy-worker/worker.py",
  );
  assert.equal(
    existsSync(builtinWorkerPath),
    true,
    "packages/platform/src/comfy-worker/worker.py must exist",
  );
  assert.equal(
    Buffer.compare(
      readFileSync(builtinWorkerPath),
      readFileSync(resolve(repoRoot, "plugins/example-node-pool/client/worker.py")),
    ),
    0,
    "packages/platform/src/comfy-worker/worker.py must remain byte-identical to plugins/example-node-pool/client/worker.py",
  );
  const workerSource = readFileSync(builtinWorkerPath, "utf8");
  assert.match(workerSource, /class ComfyWorkerController:/);
  assert.match(workerSource, /def poll_once\(self\)/);
  assert.match(workerSource, /def maybe_unload_vram\(/);
  assert.match(workerSource, /if __name__ == "__main__":/);

  const compilerSource = readFileSync(
    resolve(repoRoot, "packages/platform/src/comfy-compiler.ts"),
    "utf8",
  );
  assert.equal(
    compilerSource.includes("example-node-pool"),
    false,
    "comfy-compiler.ts must not reference plugins/example-node-pool",
  );
  assert.equal(
    compilerSource.includes("FALLBACK_WORKER_PY"),
    false,
    "comfy-compiler.ts must not contain broken FALLBACK_WORKER_PY stub",
  );

  // Build client from a cwd without plugins/example-node-pool to verify standalone resolution
  let client: ReturnType<typeof buildComfyNodeClient>;
  try {
    process.chdir(tmpdir());
    client = buildComfyNodeClient("comfy-wan-cinema-v1");
  } finally {
    process.chdir(repoRoot);
  }

  const tgzBytes = Buffer.from(client["agent.tgz"], "base64");
  const digestText = Buffer.from(client["agent.tgz.sha256"], "base64").toString(
    "utf8",
  );
  const expectedSha = createHash("sha256").update(tgzBytes).digest("hex");
  assert.equal(digestText, `${expectedSha}  agent.tgz\n`);

  const tarBytes = gunzipSync(tgzBytes);
  const headerName = tarBytes.subarray(0, 100).toString("utf8").replace(/\0+$/, "");
  assert.equal(headerName, "worker.py");
  const sizeOctal = tarBytes
    .subarray(124, 136)
    .toString("ascii")
    .replace(/\0+$/, "")
    .trim();
  const payloadLen = Number.parseInt(sizeOctal, 8);
  const extractedWorker = tarBytes.subarray(512, 512 + payloadLen).toString("utf8");
  assert.equal(extractedWorker, workerSource);
  assert.match(extractedWorker, /def poll_once\(self\)/);
  assert.match(extractedWorker, /if __name__ == "__main__":/);

  const dockerfile = readFileSync(resolve(repoRoot, "Dockerfile"), "utf8");
  const runtimeSection = dockerfile.split("FROM dependencies AS runtime")[1] ?? "";
  assert.match(
    runtimeSection,
    /COPY --from=build \/app\/plugins plugins\s*\nRUN rm -rf \/app\/plugins\/example-\*/,
  );
});
