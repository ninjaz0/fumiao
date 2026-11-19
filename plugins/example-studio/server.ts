import { createServer } from "node:http";
import sharp from "sharp";

if (!process.env.PLUGIN_KEY) throw new Error("Set PLUGIN_KEY");

const image = await sharp({
  create: { width: 96, height: 54, channels: 3, background: "#5289b3" },
})
  .png()
  .toBuffer();

createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer " + process.env.PLUGIN_KEY) {
    res.writeHead(401).end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "POST" || req.url !== "/submit") {
    res.writeHead(404).end();
    return;
  }
  // The result is a fixed fixture, so a repeated request returns the same bytes.
  for await (const _ of req) {
    /* consume the request */
  }
  res.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      state: "completed",
      artifacts: [{ url: "data:image/png;base64," + image.toString("base64") }],
    }),
  );
}).listen(Number(process.env.PORT || 4100), "127.0.0.1");
