import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { timingFixture } from "./timing.js";
import { imagesLifecycle } from "../../plugins/images/src/lifecycle.js";
import { Executor } from "../../packages/platform/src/executor.js";
import { JobTiming } from "../../packages/platform/src/timing.js";
import { one } from "../../packages/platform/src/db.js";
import type { ProviderPlugin } from "../../packages/plugin-sdk/src/index.js";
export const imagesModel = "gpt-image-2.6-sunburst";
export type ImagesWire = {
  raw?: string;
  hex?: string;
  status?: number;
  disconnect?: boolean;
  repeat?: number;
  requestId?: string;
  redirect?: number;
};
export async function imagesLifecycleFixture(
  options: Partial<ProviderPlugin> = {},
) {
  let wire: ImagesWire = {};
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const contentType = req.headers["content-type"] ?? "",
      body = Buffer.concat(chunks).toString();
    requests.push({
      path: req.url,
      method: req.method,
      authorization: req.headers.authorization,
      idempotency: req.headers["idempotency-key"] ?? null,
      contentType: contentType.replace(/boundary=.*/, "boundary=fixture"),
      body: contentType.startsWith("multipart/")
        ? body.replaceAll(contentType.split("boundary=")[1], "fixture")
        : body
          ? JSON.parse(body)
          : null,
    });
    if (wire.disconnect) {
      req.socket.destroy();
      return;
    }
    if (wire.redirect && req.url !== "/redirected") {
      res.writeHead(wire.redirect, { location: "/redirected" }).end();
      return;
    }
    res.writeHead(wire.status ?? 200, {
      "content-type": "application/json",
      ...(wire.requestId === undefined
        ? {}
        : { "x-request-id": wire.requestId }),
    });
    const raw =
      wire.repeat !== undefined
        ? Buffer.alloc(wire.repeat, 120)
        : wire.hex
          ? Buffer.from(wire.hex, "hex")
          : Buffer.from(wire.raw ?? "{}");
    for (let n = 0; n < raw.length; n += 32768)
      if (!res.write(raw.subarray(n, n + 32768))) await once(res, "drain");
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
      ...imagesLifecycle,
      manifest: {
        ...imagesLifecycle.manifest,
        id: "lifecycle-images",
        configSchema: { type: "object" },
        models: imagesLifecycle.manifest.models.map(({ studio, ...m }) => m),
      },
      ...options,
    });
    const fixture = f,
      connection = f.connections["lifecycle-images"],
      config = {
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
        apiKey: "sk-local-fixture",
      };
    await f.p.updateConnection(f.admin, connection, {
      revision: 2,
      enabled: true,
      concurrency: 5,
      config,
    });
    return {
      ...f,
      connection,
      config,
      requests,
      executor: new Executor(f.p),
      setWire(value: ImagesWire) {
        wire = value;
      },
      async reference(mime = "image/png") {
        const id = randomUUID(),
          key = randomUUID();
        await fixture.p.storage.put(
          key,
          Buffer.from("private-reference"),
          mime,
        );
        await fixture.db.query(
          "INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind) VALUES($1,$2,$3,$4,$5,17,'ready',$6,'ref')",
          [
            id,
            fixture.wid,
            fixture.admin.id,
            key,
            mime,
            JSON.stringify({ width: 8, height: 6 }),
          ],
        );
        return id;
      },
      async snapshot(id: string) {
        const j = await one(fixture.db, "SELECT * FROM jobs WHERE id=$1", [id]),
          run = await new JobTiming(fixture.p).current(fixture.db, id),
          wallet = await fixture.p.wallet(fixture.admin, fixture.wid),
          output =
            j.state === "completed"
              ? await one(fixture.db, "SELECT * FROM assets WHERE id=$1", [
                  j.result.assets[0],
                ])
              : null;
        return {
          state:
            j.state === "completed"
              ? "done"
              : ["dispatching", "finalizing"].includes(j.state)
                ? "running"
                : j.state,
          note: j.request_note ?? j.error ?? "",
          attempts: j.attempts,
          held: Number(wallet.held),
          balance: Number(wallet.balance),
          runStatus: run?.status ?? null,
          phase: run?.phase ?? null,
          output: output
            ? {
                mime: output.mime,
                width: output.metadata.width,
                height: output.metadata.height,
                size: Number(output.size),
              }
            : null,
          providerResponse: j.result?.providerResponse ?? null,
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
