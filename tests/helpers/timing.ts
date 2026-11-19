import { randomUUID } from "node:crypto";
import { databaseFixture } from "./database.js";
import { PluginRegistry } from "../../packages/platform/src/plugins.js";
import { one } from "../../packages/platform/src/db.js";
import { GpuGateway } from "../../packages/platform/src/gpu.js";
import { gpuTiming } from "../../plugins/gpu/src/timing.js";
import type { ProviderPlugin } from "../../packages/plugin-sdk/src/index.js";

export const timedGpu: ProviderPlugin = {
  ...gpuTiming,
  manifest: {
    ...gpuTiming.manifest,
    id: "timing-gpu",
    models: gpuTiming.manifest.models.map(({ studio, ...m }) => m),
  },
};
export const timedRequest: ProviderPlugin = {
  manifest: {
    id: "timing-request",
    version: "1.0.0",
    contractVersion: 1,
    label: "Isolated timing fixture",
    mode: "request",
    configSchema: { type: "object", additionalProperties: false },
    models: [
      {
        id: "timer-chat",
        label: "Timer",
        kind: "chat",
        inputSchema: { type: "object" },
      },
    ],
    timing: {
      version: 1,
      geometry: "pixels",
      hardware: false,
      scaleSteps: false,
    },
  },
  health: async () => true,
  timingFeatures: ({ model, kind }) => ({
    kind,
    model,
    executor: "fixture",
    workflow: "fixture-v1",
    width: 1,
    height: 1,
    seconds: 0,
    steps: 20,
    video_mode: "chat",
    quality: "default",
    refs: 0,
    ref_pixels: 0,
    hardware: "",
    runtime_id: "",
    cold: null,
    profile: {},
  }),
  submit: async (e) => {
    await e.reportTiming?.({ job_phase: "generating" });
    return { state: "completed", text: "local fixture", artifacts: [] };
  },
};
export async function timingFixture(request = timedRequest) {
  const f = await databaseFixture();
  try {
    f.p.registry = new PluginRegistry([timedGpu, request]);
    await f.p.registry.installBuiltins(f.db);
    const admin = await f.p.bootstrap({
        name: "timing-admin",
        nickname: "Timer",
        password: "isolated-timing-password",
      }),
      wid = admin.workspaceId;
    await f.p.adjustCredits(admin, wid, { amount: 10000, key: randomUUID() });
    const connections: Record<string, string> = {},
      models: Record<string, string> = {};
    for (const plugin of [timedGpu, request]) {
      const { id } = await f.p.createConnection(admin, {
        name: plugin.manifest.id,
        pluginId: plugin.manifest.id,
        version: plugin.manifest.version,
        config: {},
      });
      connections[plugin.manifest.id] = id;
      await f.p.updateConnection(admin, id, {
        revision: 1,
        enabled: true,
        concurrency: 2,
      });
      for (const m of (
        await f.db.query("SELECT * FROM models WHERE connection_id=$1", [id])
      ).rows) {
        models[m.provider_model] = m.id;
        await f.p.setModel(admin, m.id, { enabled: true, price: 2 });
      }
    }
    const gateway = new GpuGateway(f.p),
      pair = await gateway.pair(admin, {
        connectionId: connections["timing-gpu"],
      });
    const node = await gateway.enroll({
      code: pair.code,
      name: "Synthetic node",
      models: ["MiniMax H3", "breeze-tts-2"],
    });
    const create = async (model = "MiniMax H3") => {
      const { id } = await f.p.submit(admin, wid, {
        key: randomUUID(),
        modelId: models[model],
        prompt: "private fixture prompt",
        params: {},
      });
      return one(f.db, "SELECT * FROM jobs WHERE id=$1", [id]);
    };
    return { ...f, admin, wid, connections, models, node, gateway, create };
  } catch (e) {
    await f.cleanup();
    throw e;
  }
}
export function wavFixture() {
  const wav = Buffer.alloc(44 + 4800);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(4800, 40);
  return wav;
}
