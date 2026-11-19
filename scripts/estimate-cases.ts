import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gpuEstimate } from "../plugins/gpu/src/estimate.js";
import { museEstimate } from "../plugins/muse/src/estimate.js";
import { imagesEstimate } from "../plugins/images/src/estimate.js";
import { flowEstimate } from "../plugins/flow/src/estimate.js";
import {
  timingFeaturesSchema,
  type EstimateInput,
  type ProviderPlugin,
} from "../packages/plugin-sdk/src/index.js";
import type { databaseFixture } from "../tests/helpers/database.js";
import { GpuGateway } from "../packages/platform/src/gpu.js";
import { one } from "../packages/platform/src/db.js";
import type { OriginalActor } from "../packages/original-api/src/identity.js";

export async function verifyEstimates({
  f,
  python,
  pair,
  source,
  checks,
  visuals,
  nativeRefs,
  admin,
}: {
  f: Awaited<ReturnType<typeof databaseFixture>>;
  python: string;
  pair: (
    label: string,
    path: string,
    body: unknown,
    status?: number,
    options?: any,
  ) => Promise<any>;
  source: (sql: string, params?: unknown[]) => any[];
  checks: string[];
  visuals: string[];
  nativeRefs: string[];
  admin: OriginalActor;
}) {
  const plugins = [gpuEstimate, museEstimate, imagesEstimate, flowEstimate];
  let captured: { input: EstimateInput; plugin: ProviderPlugin } | undefined;
  const restore = plugins.map((plugin) => {
    const original = plugin.originalEstimate!.prepare;
    plugin.originalEstimate!.prepare = async (d, r) => {
      const input = await original(d, r);
      captured = { input, plugin };
      return input;
    };
    return () => {
      plugin.originalEstimate!.prepare = original;
    };
  });
  const features: { label: string; body: any; actual: any }[] = [];
  const tables = [
    "jobs",
    "ledger",
    "wallets",
    "outbox",
    "job_runs",
    "storage_capacity",
    "storage_holds",
  ];
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async (table) => [
          table,
          (await f.db.query(`SELECT * FROM ${table}`)).rows,
        ]),
      ),
    );
  const before = await snapshot(),
    oldBefore = source("SELECT count(*) AS count FROM jobs");
  const valid = async (
    label: string,
    body: Record<string, unknown>,
    options?: any,
  ) => {
    captured = undefined;
    const result = await pair(label, "/api/estimate", body, 200, options);
    assert.ok(captured, label);
    const { input, plugin } = captured as {
      input: EstimateInput;
      plugin: ProviderPlugin;
    };
    const assets = (
      await f.db.query(
        "SELECT id,metadata FROM assets WHERE id=ANY($1::uuid[])",
        [input.references],
      )
    ).rows;
    const actual = timingFeaturesSchema.parse(
      plugin.timingFeatures!({
        model: input.model,
        kind: input.kind,
        input: {
          prompt: "",
          params: input.params,
          references: input.references.map((id) => {
            const a = assets.find((a) => a.id === id)!;
            return { id, width: a.metadata.width, height: a.metadata.height };
          }),
        },
      }),
    );
    features.push({ label, body, actual });
    return result;
  };
  try {
    for (const body of [
      undefined,
      null,
      [],
      1,
      "x",
      { kind: null },
      { model: 7 },
      { refs: [1] },
      { refs: Array(13).fill(visuals[0]) },
      { text_chars: 0 },
      { text_chars: 301 },
      { text_chars: 1.1 },
      { sampling_steps: "4" },
      { audio_instruction: "x".repeat(301) },
      { h3: { mode: "bad" } },
      { h3: { mode: "reference", extra: 1 } },
    ])
      await pair(
        "estimate validation " + JSON.stringify(body),
        "/api/estimate",
        body,
        422,
        { cookie: "" },
      );
    for (const body of [
      {},
      { kind: "image" },
      { kind: "audio", model: "breeze-tts-2" },
      {
        kind: "audio",
        model: "breeze-tts-2",
        text_chars: 300,
        language: "en",
        audio_instruction: " soft ",
      },
      {
        kind: "audio",
        model: "breeze-tts-2",
        refs: ["missing"],
        ratio: "ignored",
        quality: -4,
      },
      { refs: Array(12).fill(visuals[0]) },
      {
        kind: "image",
        refs: Array(12).fill(visuals[0]),
        ratio: "21:9",
        resolution: "2K",
        image_quality: "high",
      },
      {
        model: "muse-image",
        kind: "image",
        resolution: "4K",
        image_quality: "ignored",
        quality: -10,
        refs: [visuals[0], visuals[0]],
        ratio: "3:4",
      },
      { model: "muse-video", seconds: 6, quality: -3, refs: [visuals[0]] },
      {
        h3: { mode: "frames", first_frame: visuals[0], last_frame: visuals[0] },
        ratio: "auto",
        quality: 768,
        sampling_steps: 4,
      },
      {
        h3: { mode: "reference", video_audio: [nativeRefs[0]] },
        refs: [...visuals, ...nativeRefs],
        seconds: 15,
      },
    ])
      await valid("estimate valid " + JSON.stringify(body), body);
    for (const model of flowEstimate.manifest.models)
      await valid("estimate Flow catalog " + model.id, {
        model: model.id,
        kind: model.kind,
        quality: -1,
        ratio: "ignored",
        seconds: -1,
        image_quality: "ignored",
      });
    const errors: [any, number][] = [
      [{ kind: "audio" }, 400],
      [{ kind: "audio", model: "muse-video" }, 400],
      [{ kind: "audio", model: "breeze-tts-2", language: "other" }, 400],
      [{ kind: "bad" }, 400],
      [{ model: "bad" }, 400],
      [{ ratio: "auto" }, 400],
      [{ model: "bad", ratio: "bad" }, 400],
      [{ model: "gpt-image-2.6-sunburst" }, 400],
      [{ kind: "image", model: "MiniMax H3" }, 400],
      [{ quality: 720 }, 400],
      [{ seconds: 6 }, 400],
      [{ kind: "image", resolution: "4K" }, 400],
      [{ kind: "image", image_quality: "auto" }, 400],
      [{ model: "muse-video", kind: "image" }, 400],
      [{ model: "muse-image", kind: "image", sampling_steps: 4 }, 400],
      [{ model: "muse-image", kind: "image", ratio: "21:9" }, 400],
      [{ model: "muse-video", seconds: 15 }, 400],
      [{ model: flowEstimate.manifest.models[0].id, kind: "bad" }, 400],
      [{ refs: ["missing"] }, 404],
      [{ refs: [nativeRefs[0]] }, 404],
      [{ refs: [visuals[0].toUpperCase()] }, 404],
      [{ h3: { mode: "reference" }, model: "muse-video" }, 400],
      [
        { h3: { mode: "reference" }, kind: "audio", model: "breeze-tts-2" },
        400,
      ],
      [
        { h3: { mode: "frames", first_frame: "0".repeat(32) }, quality: -1 },
        400,
      ],
      [{ h3: { mode: "reference" }, refs: [visuals[0], visuals[0]] }, 400],
      [{ h3: { mode: "frames" }, refs: [visuals[0]] }, 400],
      [{ h3: { mode: "reference" }, refs: [visuals[0].toUpperCase()] }, 400],
      [{ h3: { mode: "reference" }, refs: [nativeRefs[0]], seconds: 1 }, 400],
      [{ h3: { mode: "reference" }, ratio: "auto" }, 400],
    ];
    for (const [body, status] of errors)
      await pair(
        "estimate error " + JSON.stringify(body),
        "/api/estimate",
        body,
        status,
      );
    await pair(
      "estimate workspace isolation",
      "/api/estimate",
      { refs: [visuals[0]] },
      404,
      { workspace: "2" },
    );
    await pair("estimate bad workspace", "/api/estimate", {}, 400, {
      workspace: "bad",
    });
    await pair(
      "estimate validation before workspace",
      "/api/estimate",
      { ratio: "bad" },
      400,
      { workspace: "bad" },
    );
    await pair(
      "estimate native workspace before native validation",
      "/api/estimate",
      { h3: { mode: "frames" }, refs: [visuals[0]] },
      400,
      { workspace: "bad" },
    );
    const gpuConnection = await one(
      f.db,
      "SELECT id FROM connections WHERE plugin_id='gpu' AND plugin_version=$1",
      [gpuEstimate.manifest.version],
    );
    const gateway = new GpuGateway(f.p),
      pairing = await gateway.pair(admin, { connectionId: gpuConnection.id });
    const node = await gateway.enroll({
      code: pairing.code,
      name: "estimate-only-node",
      models: ["MiniMax H3", "breeze-tts-2"],
    });
    source(
      "INSERT INTO nodes(id,owner,name,key,deadline,lastseen,stage) VALUES(1,1,'estimate-only-node','fixture-unused',9999999999,0,'offline')",
    );
    for (const [label, stage, control, workflow, ready, ago] of [
      [
        "ready",
        "ready",
        "active",
        "h3-v6-native-inputs-turbo4",
        ["MiniMax H3", "breeze-tts-2"],
        0,
      ],
      [
        "busy",
        "busy",
        "active",
        "h3-v6-native-inputs-turbo4",
        ["MiniMax H3", "breeze-tts-2"],
        0,
      ],
      [
        "paused",
        "ready",
        "paused",
        "h3-v6-native-inputs-turbo4",
        ["MiniMax H3", "breeze-tts-2"],
        0,
      ],
      [
        "expired",
        "ready",
        "active",
        "h3-v6-native-inputs-turbo4",
        ["MiniMax H3", "breeze-tts-2"],
        100,
      ],
      [
        "preparing",
        "preparing",
        "active",
        "h3-v6-native-inputs-turbo4",
        ["MiniMax H3", "breeze-tts-2"],
        0,
      ],
      [
        "worker update",
        "ready",
        "active",
        "h3-v3-rocm-qkv-safe-standard20",
        ["MiniMax H3"],
        0,
      ],
      [
        "different loaded model",
        "ready",
        "active",
        "breeze-tts-2-eager-v1",
        ["breeze-tts-2"],
        0,
      ],
    ] as [string, string, string, string, string[], number][]) {
      const stamp = Math.floor(Date.now() / 1000) - ago,
        steps =
          workflow === "h3-v3-rocm-qkv-safe-standard20"
            ? [20]
            : [4, 16, 20, 32, 50];
      source(
        "UPDATE nodes SET stage=?,control=?,lastseen=?,workflow=?,runtime_id='estimate-boot',ready_models=?,models=?,video_steps=? WHERE id=1",
        [
          stage,
          control,
          stamp,
          workflow,
          JSON.stringify(ready),
          JSON.stringify(["MiniMax H3", "breeze-tts-2"]),
          JSON.stringify(steps),
        ],
      );
      await f.db.query(
        "UPDATE gpu_nodes SET control=$2,last_seen=to_timestamp($3),timing_context=$4,queue_state=$5 WHERE id=$1",
        [
          node.id,
          control,
          stamp,
          JSON.stringify({ workflow, runtime_id: "estimate-boot" }),
          JSON.stringify({
            stage,
            ready_models: ready,
            video_steps: steps,
            can_accept: true,
          }),
        ],
      );
      for (const body of [
        {},
        { sampling_steps: 4 },
        { kind: "audio", model: "breeze-tts-2" },
        { h3: { mode: "frames", first_frame: visuals[0] }, sampling_steps: 4 },
      ])
        await valid(
          "estimate node " + label + " " + JSON.stringify(body),
          body,
        );
    }
    const flowModel = flowEstimate.manifest.models.find(
      (m) => !m.hidden && m.kind === "video",
    )!;
    for (const [plugin, name, body, health] of [
      [
        museEstimate,
        "muse",
        { model: "muse-video" },
        { ready: true, capacity: 2, maintenance: 0, tasks: [] },
      ],
      [flowEstimate, "flow", { model: flowModel.id }, { ready: true }],
    ] as const) {
      for (const age of [0, 100]) {
        const value = {
          ...health,
          checked: Math.floor(Date.now() / 1000) - age,
        };
        source(
          "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          [name + "_health", JSON.stringify(value)],
        );
        await f.db.query(
          "UPDATE connections SET queue_health=$2,queue_health_revision=revision WHERE plugin_id=$1",
          [plugin.manifest.id, JSON.stringify(value)],
        );
        await valid(`estimate ${name} health age ${age}`, body);
      }
    }
    source(
      "INSERT INTO settings(key,value) VALUES('openai_images','{\"enabled\":false}') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    );
    await f.db.query(
      "UPDATE connections SET enabled=false WHERE plugin_id=$1",
      [imagesEstimate.manifest.id],
    );
    await valid("estimate disabled image service", { kind: "image" });
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("FUMIAO_") && key !== "OPENAI_API_KEY",
      ),
    );
    const expected = JSON.parse(
      execFileSync(
        python,
        [
          "-c",
          `import sys,json
sys.path.insert(0,sys.argv[1])
import server,timing,core
from starlette.requests import Request
with core.db() as con: user=dict(con.execute('SELECT * FROM users WHERE id=1').fetchone())
server.actor=lambda request:user
timing.submission_forecast=lambda con,job:timing.features(job,con)
request=Request({'type':'http','headers':[(b'x-workspace-id',b'1')]})
print(json.dumps([server.estimate(server.EstimateRequest(**body),request)['duration'] for body in json.load(sys.stdin)]))`,
          join(f.directory, "app"),
        ],
        {
          env: {
            ...env,
            FUMIAO_DATA: join(f.directory, "data"),
            FUMIAO_SITE: "http://localhost:3000",
            FUMIAO_MUSE_AUTOSTART: "0",
            FUMIAO_FLOW_AUTOSTART: "0",
            FUMIAO_PAYMENT_AUTOSTART: "0",
          },
          input: JSON.stringify(features.map((f) => f.body)),
          stdio: ["pipe", "pipe", "pipe"],
        },
      ).toString(),
    );
    for (let i = 0; i < features.length; i++)
      assert.deepEqual(
        features[i].actual,
        expected[i],
        features[i].label + " features",
      );
    assert.deepEqual(
      await snapshot(),
      before,
      "estimating must not write tasks, credits, timing, capacity or outbox",
    );
    assert.deepEqual(source("SELECT count(*) AS count FROM jobs"), oldBefore);
    await mkdir(".runtime-advanced/estimate-parity", { recursive: true });
    await writeFile(
      ".runtime-advanced/estimate-parity/report.json",
      JSON.stringify(
        { passed: true, checks, features: features.map((f) => f.label) },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `Original/Nest estimate parity: ${checks.length} HTTP checks and ${features.length} feature vectors passed without writes`,
    );
  } finally {
    for (const reset of restore) reset();
  }
}
