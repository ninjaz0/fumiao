import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import sharp from "sharp";
import { muse } from "../../plugins/muse/src/index.js";
import { flow } from "../../plugins/flow/src/index.js";
import { images } from "../../plugins/images/src/index.js";
import { storyboard } from "../../plugins/storyboard/src/index.js";
import { remotePlugin } from "../../plugins/remote/src/index.js";
import { inspectMedia } from "../../packages/platform/src/media.js";
import type { Execution } from "../../packages/plugin-sdk/src/index.js";
async function server(handler: any) {
  const http = createServer(handler);
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const address = http.address() as any;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((r, j) => {
        http.close((e) => (e ? j(e) : r()));
        http.closeAllConnections();
      }),
  };
}
function execution(
  url: string,
  kind: "image" | "video" | "chat" = "image",
): Execution {
  return {
    jobId: "job",
    idempotencyKey: "stable-key",
    model: "muse-image",
    kind,
    input: { prompt: "test", params: {}, references: [] },
    config: { baseUrl: url, apiKey: "test-key" },
    signal: AbortSignal.timeout(10000),
  };
}
test("Muse submits idempotently and normalizes the actual asynchronous response shape", async () => {
  let seen = false;
  const s = await server(async (req: any, res: any) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      assert.equal(req.headers["idempotency-key"], "stable-key");
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.prompt, "test");
      seen = true;
      res.end(
        JSON.stringify({ id: "task-1", task_id: "task-1", status: "queued" }),
      );
    } else
      res.end(
        JSON.stringify({
          status: "completed",
          url: "https://media.example/image.png",
          result: { url: "https://media.example/image.png" },
          data: [{ url: "https://media.example/image.png" }],
        }),
      );
  });
  try {
    const e = execution(s.url);
    assert.deepEqual(await muse.submit(e), {
      state: "pending",
      remoteId: "task-1",
    });
    assert.deepEqual(await muse.inspect!(e, "task-1"), {
      state: "completed",
      artifacts: [{ url: "https://media.example/image.png" }],
    });
    assert.ok(seen);
  } finally {
    await s.close();
  }
});
test("Flow parses chunked SSE and the last unterminated data line", async () => {
  const s = await server(async (req: any, res: any) => {
    for await (const _ of req) {
    }
    res.setHeader("Content-Type", "text/event-stream");
    const text =
      "data: " +
      JSON.stringify({
        choices: [
          { delta: { content: "![作品](https://media.example/image.png)" } },
        ],
      });
    const bytes = Buffer.from(text);
    res.write(bytes.subarray(0, 30));
    res.end(bytes.subarray(30));
  });
  try {
    const e = execution(s.url);
    e.model = flow.manifest.models.find(
      (m) =>
        m.kind === "image" && (m.inputSchema["x-references"] as any).min === 0,
    )!.id;
    const result = await flow.submit(e);
    assert.deepEqual(result, {
      state: "completed",
      artifacts: [{ url: "https://media.example/image.png" }],
    });
  } finally {
    await s.close();
  }
});
test("image plugin preserves JSON generation and multipart editing contracts", async () => {
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  let edited = false;
  const s = await server(async (req: any, res: any) => {
    let body = "";
    for await (const chunk of req) body += chunk.toString();
    if (req.url.endsWith("/edits")) {
      assert.match(req.headers["content-type"], /multipart/);
      assert.match(body, /name="image\[\]"/);
      edited = true;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
  });
  try {
    const e = execution(s.url);
    e.model = "gpt-image-2.6-sunburst";
    assert.equal((await images.submit(e)).state, "completed");
    e.input.references = [
      {
        id: "ref",
        mime: "image/png",
        url: "data:image/png;base64," + png.toString("base64"),
      },
    ];
    assert.equal((await images.submit(e)).state, "completed");
    assert.ok(edited);
  } finally {
    await s.close();
  }
});
test("remote plugin runs with a versioned manifest without a core code change", async () => {
  const s = await server(async (req: any, res: any) => {
    assert.equal(req.headers.authorization, "Bearer test-key");
    let body = "";
    for await (const chunk of req) body += chunk.toString();
    if (req.url === "/health") {
      res.end("{}");
      return;
    }
    const input = JSON.parse(body);
    assert.equal(input.idempotencyKey, "stable-key");
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        state: "completed",
        artifacts: [],
        text: input.input.prompt,
      }),
    );
  });
  try {
    const manifest = {
      ...muse.manifest,
      id: "custom-provider",
      models: [
        {
          id: "custom",
          label: "custom",
          kind: "chat" as const,
          inputSchema: { type: "object" },
        },
      ],
    };
    const plugin = remotePlugin(manifest, s.url);
    assert.ok(
      await plugin.health({ apiKey: "test-key" }, AbortSignal.timeout(10000)),
    );
    const result = await plugin.submit(execution(s.url, "chat"));
    assert.equal(result.state, "completed");
  } finally {
    await s.close();
  }
});
test("storyboard plugin encodes and validates an actual playable MP4", async () => {
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const e = execution("http://unused", "video");
  e.signal = AbortSignal.timeout(30000);
  e.input.params = { ratio: "1:1", imageSeconds: 1 };
  e.input.references = [
    {
      id: "ref",
      mime: "image/png",
      url: "data:image/png;base64," + png.toString("base64"),
    },
  ];
  const receipt = await storyboard.submit(e);
  assert.equal(receipt.state, "completed");
  if (receipt.state !== "completed") return;
  const media = await inspectMedia(
    Buffer.from(receipt.artifacts[0].url.split(",")[1], "base64"),
    "video",
  );
  assert.equal(media.mime, "video/mp4");
  assert.equal(media.width, 720);
  assert.ok(media.duration >= 0.9);
});
