import { createServer } from "node:http";
import { once } from "node:events";
import { timingFixture } from "./timing.js";
import { museLifecycle } from "@fumiao/plugin-muse/lifecycle.js";
import {
  ArtifactDownloadError,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
import { Executor } from "@fumiao/platform/executor.js";
import { JobTiming } from "@fumiao/platform/timing.js";
import { one } from "@fumiao/platform/db.js";
export const museTaskId = "task_" + "a".repeat(32);
export const museAck = { id: museTaskId, status: "queued", phase: "queued" };
export type Wire = {
  status?: number;
  body?: unknown;
  raw?: string;
  encoding?: string;
  bytes?: Buffer;
  disconnect?: boolean;
};
export function wireBytes(wire: Wire): Buffer {
  if (wire.bytes) return wire.bytes;
  const text = wire.raw ?? JSON.stringify(wire.body ?? null),
    encoding = wire.encoding ?? "utf-8";
  if (encoding.startsWith("utf-32")) {
    const chars = Array.from(text),
      bom = encoding === "utf-32",
      bytes = Buffer.alloc(chars.length * 4 + (bom ? 4 : 0));
    if (bom) bytes.writeUInt32LE(0xfeff, 0);
    chars.forEach((c, i) =>
      encoding === "utf-32-be"
        ? bytes.writeUInt32BE(c.codePointAt(0)!, i * 4)
        : bytes.writeUInt32LE(c.codePointAt(0)!, i * 4 + (bom ? 4 : 0)),
    );
    return bytes;
  }
  if (encoding.startsWith("utf-16")) {
    const bytes = Buffer.from(
      (encoding === "utf-16" ? "\ufeff" : "") + text,
      "utf16le",
    );
    return encoding === "utf-16-be" ? bytes.swap16() : bytes;
  }
  return Buffer.from((encoding === "utf-8-sig" ? "\ufeff" : "") + text);
}
export async function museLifecycleFixture(
  options: Partial<ProviderPlugin> = {},
) {
  let wire: Wire = { body: museAck };
  const requests: {
      method: string;
      path: string;
      body: any;
      key: boolean;
      idempotency: string | undefined;
    }[] = [],
    downloads: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer local-fixture") {
      res.writeHead(401).end();
      return;
    }
    if (req.method === "GET" && req.url === "/readyz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"status":"ready","accounts":1}');
      return;
    }
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"data":[{"id":"muse-image"},{"id":"muse-video"}]}');
      return;
    }
    if (req.method === "GET" && req.url === "/v1/queue") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"capacity":2,"maintenance":0,"tasks":[]}');
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      method: req.method!,
      path: req.url!,
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null,
      key: Boolean(req.headers["idempotency-key"]),
      idempotency: req.headers["idempotency-key"] as string | undefined,
    });
    if (wire.disconnect) {
      req.socket.destroy();
      return;
    }
    res.writeHead(wire.status ?? 200, { "Content-Type": "application/json" });
    res.end(wireBytes(wire));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  };
  let f: Awaited<ReturnType<typeof timingFixture>>;
  try {
    f = await timingFixture({
      ...museLifecycle,
      manifest: {
        ...museLifecycle.manifest,
        id: "lifecycle-muse",
        configSchema: { type: "object" },
        models: museLifecycle.manifest.models.map(({ studio, ...m }) => m),
      },
      downloadArtifact: async (artifact) => {
        downloads.push(artifact.url);
        throw new ArtifactDownloadError("unavailable", "retry");
      },
      ...options,
    });
    const connection = f.connections["lifecycle-muse"];
    await f.p.updateConnection(f.admin, connection, {
      revision: 2,
      enabled: true,
      concurrency: 2,
      config: {
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
        apiKey: "local-fixture",
      },
    });
    await f.db.query(
      "UPDATE connections SET queue_health=$2,queue_health_revision=revision WHERE id=$1",
      [
        connection,
        JSON.stringify({
          ready: true,
          checked: Date.now() / 1000,
          capacity: 2,
          maintenance: 0,
          tasks: [],
        }),
      ],
    );
    const executor = new Executor(f.p);
    return {
      ...f,
      connection,
      executor,
      requests,
      downloads,
      setWire(value: Wire) {
        wire = value;
      },
      async snapshot(id: string) {
        const j = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [id]),
          run = await new JobTiming(f.p).current(f.db, id),
          wallet = await f.p.wallet(f.admin, f.wid);
        return {
          state: ["dispatching", "finalizing"].includes(j.state)
            ? "running"
            : j.state,
          note: j.request_note ?? j.error ?? "",
          attempts: j.attempts,
          uncertain: j.request_uncertain,
          retry: Boolean(j.request_retry_at && j.state === "queued"),
          held: Number(wallet.held),
          balance: Number(wallet.balance),
          runStatus: run?.status ?? null,
          phase: run?.phase ?? null,
          remote: Boolean(j.remote_id),
        };
      },
      async cleanup() {
        await close();
        await f.cleanup();
      },
    };
  } catch (error) {
    await close();
    if (f!) await f.cleanup();
    throw error;
  }
}
