import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { z } from "zod";
import { authorSuite } from "./contracts.js";

export async function serveAuthorProject(directory: string, port: number) {
  const root = resolve(directory);
  const page = await readFile(new URL("./preview.html", import.meta.url));
  const streams = new Set<ServerResponse>();
  let serial = 0;
  let suite = authorSuite(root);
  // An invalid edit remains visible in the inspector until the next save.
  void suite.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  const changed = (_event: string, name: string | null) => {
    if (!name) return;
    const parts = relative(root, resolve(root, name)).split(sep);
    if (
      parts.some(
        (part) =>
          part.startsWith(".") || part === "node_modules" || part === "dist",
      )
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      suite = authorSuite(root);
      void suite.catch(() => {});
      serial++;
      for (const stream of streams) stream.write("data: " + serial + "\n\n");
    }, 75);
  };
  // Watching the whole tree recursively would also subscribe to node_modules.
  const watchers = [
    watch(root, (event, name) => {
      if (name === "fixtures.json" || name === "manifest.json")
        changed(event, name);
    }),
  ];
  for (const sub of ["package", "distribution"]) {
    try {
      watchers.push(watch(resolve(root, sub), { recursive: true }, changed));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const stopWatching = () => watchers.forEach((w) => w.close());
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    const json = (status: number, data: unknown) =>
      res
        .writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        })
        .end(JSON.stringify(data));
    try {
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin)
      ) {
        json(403, { error: "仅接受本机开发宿主请求" });
        return;
      }
      if (req.url === "/" && req.method === "GET") {
        res
          .writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy":
              "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
          })
          .end(page);
        return;
      }
      if (req.url === "/changes" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        res.write(": ready\n\n");
        streams.add(res);
        res.on("close", () => streams.delete(res));
        return;
      }
      if (req.url === "/project" && req.method === "GET") {
        const { plugin, version, cases } = await suite;
        json(200, { plugin, version, cases });
        return;
      }
      if (
        req.url === "/run" &&
        req.method === "POST" &&
        req.headers.origin === origin &&
        req.headers["content-type"]?.startsWith("application/json")
      ) {
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const part of req) {
          size += part.length;
          if (size > 65536) {
            json(413, { error: "输入超过 64 KiB" });
            return;
          }
          chunks.push(part);
        }
        const run = z
          .object({ id: z.string(), args: z.array(z.unknown()) })
          .strict()
          .parse(JSON.parse(Buffer.concat(chunks).toString()));
        json(200, await (await suite).execute(run.id, run.args));
        return;
      }
      json(404, { error: "入口不存在" });
    } catch (error) {
      json(400, { error: error instanceof Error ? error.message : "运行失败" });
    }
  }
  try {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
  } catch (error) {
    stopWatching();
    throw error;
  }
  console.log(
    "插件开发宿主 http://127.0.0.1:" + (server.address() as AddressInfo).port,
  );
  const close = () => {
    clearTimeout(timer);
    stopWatching();
    for (const stream of streams) stream.end();
    server.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  await once(server, "close");
  process.removeListener("SIGINT", close);
  process.removeListener("SIGTERM", close);
}
