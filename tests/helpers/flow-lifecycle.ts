import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { timingFixture } from "./timing.js";
import { flowLifecycle } from "../../plugins/flow/src/lifecycle.js";
import { Executor } from "../../packages/platform/src/executor.js";
import { JobTiming } from "../../packages/platform/src/timing.js";
import { one } from "../../packages/platform/src/db.js";
import type { ProviderPlugin } from "../../packages/plugin-sdk/src/index.js";
export const flowImage = "flow:gemini-3.1-flash-image-landscape",
  flowVideo = "flow:veo-3.1-quality-4s-landscape";
export const flowSuccess =
  'data: {"choices":[{"delta":{"content":"![result](https://public.example/flow/tmp/result)"}}]}\ndata: [DONE]\n';
export type FlowWire = {
  raw?: string;
  hex?: string;
  repeat?: number;
  status?: number;
  disconnect?: boolean;
  downloadError?: boolean;
  chunkSize?: number;
};
export async function flowLifecycleFixture(
  options: Partial<ProviderPlugin> = {},
) {
  let artifact: Buffer = Buffer.alloc(0);
  let artifactRequests = 0;
  let wire: FlowWire = { raw: flowSuccess },
    catalog: any = { data: [{ id: "fixture" }] },
    health: any = { backend_running: true, has_active_tokens: true };
  const requests: any[] = [],
    downloads: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer local-fixture") {
      res.writeHead(401).end();
      return;
    }
    if (req.url?.startsWith("/tmp/")) {
      artifactRequests++;
      res.end(artifact);
      return;
    }
    if (req.url === "/v1/models" || req.url === "/health") {
      res.end(JSON.stringify(req.url === "/health" ? health : catalog));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      path: req.url,
      headers: {
        Authorization: req.headers.authorization,
        "Content-type": req.headers["content-type"],
        "X-forwarded-host": req.headers["x-forwarded-host"],
        "X-forwarded-proto": req.headers["x-forwarded-proto"],
      },
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    if (wire.disconnect) {
      req.socket.destroy();
      return;
    }
    res.writeHead(wire.status ?? 200, { "Content-Type": "text/event-stream" });
    const raw =
      wire.repeat !== undefined
        ? Buffer.alloc(wire.repeat, 120)
        : wire.hex
          ? Buffer.from(wire.hex, "hex")
          : Buffer.from(wire.raw ?? "");
    const size = wire.chunkSize ?? 32768;
    for (let offset = 0; offset < raw.length; offset += size) {
      if (!res.write(raw.subarray(offset, offset + size)))
        await once(res, "drain");
    }
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  };
  let f: Awaited<ReturnType<typeof timingFixture>> | undefined;
  try {
    f = await timingFixture({
      ...flowLifecycle,
      manifest: {
        ...flowLifecycle.manifest,
        id: "lifecycle-flow",
        configSchema: { type: "object" },
        models: flowLifecycle.manifest.models.map(({ studio, ...m }) => m),
      },
      downloadArtifact: async (a) => {
        downloads.push(a.url);
        if (wire.downloadError) throw new Error("private-sentinel");
        return Buffer.from("synthetic-file");
      },
      validateArtifact: async (j) => ({
        metadata: {
          mime: j.kind === "image" ? "image/png" : "video/mp4",
          width: 8,
          height: 6,
          ...(j.kind === "video" ? { duration: 1, fps: "30/1" } : {}),
        },
      }),
      ...options,
    });
    const fixture = f,
      connection = f.connections["lifecycle-flow"],
      config = {
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
        publicUrl: "https://public.example/flow",
        apiKey: "local-fixture",
      };
    await f.p.updateConnection(f.admin, connection, {
      revision: 2,
      enabled: true,
      concurrency: 5,
      config,
    });
    await f.db.query(
      "UPDATE connections SET queue_health=$2,queue_health_revision=revision WHERE id=$1",
      [connection, JSON.stringify({ ready: true, checked: Date.now() / 1000 })],
    );
    const executor = new Executor(f.p);
    return {
      ...f,
      connection,
      config,
      executor,
      requests,
      downloads,
      setArtifact(bytes: Buffer) {
        artifact = bytes;
      },
      artifactRequests: () => artifactRequests,
      setWire(value: FlowWire) {
        wire = value;
      },
      setHealth(c: any, h: any) {
        catalog = c;
        health = h;
      },
      async reference() {
        const id = randomUUID(),
          key = randomUUID();
        await fixture.p.storage.put(
          key,
          Buffer.from("private-reference"),
          "image/png",
        );
        await fixture.db.query(
          "INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind) VALUES($1,$2,$3,$4,'image/png',17,'ready',$5,'ref')",
          [
            id,
            fixture.wid,
            fixture.admin.id,
            key,
            JSON.stringify({ width: 8, height: 6 }),
          ],
        );
        return id;
      },
      async snapshot(id: string) {
        const j = await one(fixture.db, "SELECT * FROM jobs WHERE id=$1", [id]),
          run = await new JobTiming(fixture.p).current(fixture.db, id),
          wallet = await fixture.p.wallet(fixture.admin, fixture.wid);
        const actual =
          j.state === "completed"
            ? flowLifecycle.originalState!.project({
                kind: j.kind,
                state: j.state,
                metadata: (
                  await one(
                    fixture.db,
                    "SELECT metadata FROM assets WHERE id=$1",
                    [j.result.assets[0]],
                  )
                ).metadata,
                usage: j.result.usage,
                view: j.original_view,
              } as any).actual
            : (j.original_view.actual ?? {});
        return {
          state:
            j.state === "completed"
              ? "done"
              : ["dispatching", "finalizing"].includes(j.state)
                ? "running"
                : j.state,
          note: j.request_note ?? j.error ?? "",
          attempts: j.attempts,
          uncertain: j.request_uncertain,
          held: Number(wallet.held),
          balance: Number(wallet.balance),
          runStatus: run?.status ?? null,
          phase: run?.phase ?? null,
          actual,
        };
      },
      async cleanup() {
        await close();
        await fixture.cleanup();
      },
    };
  } catch (error) {
    await close();
    await f?.cleanup();
    throw error;
  }
}
