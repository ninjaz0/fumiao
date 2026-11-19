import { randomUUID } from "node:crypto";
import { canvasesFixture } from "./canvases.js";
import { OriginalCanvasRuns } from "../../packages/original-api/src/canvas-runs.js";
import { gpuCanvasRuns } from "../../plugins/gpu/src/canvas-runs.js";
import { museCanvasRuns } from "../../plugins/muse/src/canvas-runs.js";
import { flowCanvasRuns } from "../../plugins/flow/src/canvas-runs.js";
import { imagesCanvasRuns } from "../../plugins/images/src/canvas-runs.js";
export const canvasRunPlugins = [
  gpuCanvasRuns,
  museCanvasRuns,
  flowCanvasRuns,
  imagesCanvasRuns,
];
export async function activateCanvasRunPlugins(
  f: Pick<
    Awaited<ReturnType<typeof canvasesFixture>>,
    "db" | "p" | "catalog" | "admin"
  >,
  baseUrl = "http://127.0.0.1:9",
  plugins = canvasRunPlugins,
) {
  const connections: Record<string, string> = {};
  for (const plugin of plugins) {
    const { id, version, mode } = plugin.manifest;
    await f.db.transaction((sql) => f.catalog.activate(sql, plugin.manifest));
    const connection = await f.p.createConnection(f.admin, {
      name: id + " runs",
      pluginId: id,
      version,
      config: mode === "pull" ? {} : { baseUrl, apiKey: "sk-canvas-unused" },
    });
    await f.p.updateConnection(f.admin, connection.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
    connections[id] = connection.id;
  }
  return connections;
}

export async function canvasRunsFixture() {
  const f = await canvasesFixture();
  try {
    const connections = await activateCanvasRunPlugins(f);
    await f.db.query("UPDATE studio_prices SET amount=2");
    await f.db.query("UPDATE wallets SET balance=1000");
    const runs = new OriginalCanvasRuns(f.p, () => 1800000000);
    async function project(
      nodes: any[] = [
        {
          id: "v",
          type: "video",
          x: 0,
          y: 0,
          prompt: "画面",
          params: { seed: 42 },
        },
      ],
      edges: any[] = [],
      selected?: string,
      owner = f.admin,
    ) {
      const p = await f.canvases.create(owner, { title: "生成画布" }, selected);
      await f.canvases.save(owner, p.id, {
        title: p.title,
        expected_revision: 1,
        document: { nodes, edges },
      });
      return p.id;
    }
    return {
      ...f,
      runs,
      connections,
      project,
      body: (fields: Record<string, unknown> = {}) => ({
        uid: randomUUID(),
        expected_revision: 2,
        ...fields,
      }),
    };
  } catch (e) {
    await f.cleanup();
    throw e;
  }
}
