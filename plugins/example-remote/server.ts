/** Minimal out-of-process plugin. Run: PLUGIN_KEY=... pnpm exec tsx plugins/example-remote/server.ts */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
if (!process.env.PLUGIN_KEY) throw new Error("PLUGIN_KEY is required");
createServer(async (req, res) => {
  const expected = Buffer.from("Bearer " + process.env.PLUGIN_KEY),
    actual = Buffer.from(req.headers.authorization || "");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    res.writeHead(401).end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/health") {
    res.end('{"ok":true}');
    return;
  }
  if (req.url !== "/submit" || req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error("Too large");
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString());
    res.end(
      JSON.stringify({
        state: "completed",
        artifacts: [],
        text: "插件已收到：" + String(input.input.prompt),
      }),
    );
  } catch {
    res.writeHead(400).end('{"error":"Invalid request"}');
  }
}).listen(Number(process.env.PORT || 4100), process.env.PLUGIN_HOST || "127.0.0.1");
