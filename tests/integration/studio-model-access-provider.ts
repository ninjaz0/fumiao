import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import sharp from "sharp";

export async function modelProviderFixture() {
  const keys = {
    primary: randomBytes(24).toString("hex"),
    secondary: randomBytes(24).toString("hex"),
  };
  const image = await sharp({
    create: { width: 160, height: 96, channels: 3, background: "#905a36" },
  })
    .png()
    .toBuffer();
  const { stdout: video } = await promisify(execFile)(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x96:r=10",
      "-t",
      "7.8",
      "-c:v",
      "mpeg4",
      "-movflags",
      "frag_keyframe+empty_moov",
      "-f",
      "mp4",
      "pipe:1",
    ],
    { encoding: "buffer", timeout: 15000 },
  );
  const wire: string[] = [];
  const errors: string[] = [];
  let release = false;
  const server = createServer(async (req, res) => {
    const json = (value: unknown) =>
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(value));
    try {
      const match = /^\/(primary|secondary)\/v1\/(.+)$/.exec(req.url!);
      assert.ok(match);
      const line = match[1] as keyof typeof keys;
      const path = match[2];
      assert.equal(
        req.headers.authorization === "Bearer " + keys[line],
        true,
        "frozen route credential",
      );
      wire.push([line, req.method, path].join(" "));
      const body: Buffer[] = [];
      for await (const chunk of req) body.push(Buffer.from(chunk));
      const payload = Buffer.concat(body);
      const videoModel = {
        id: "suite-video",
        name: "验收视频",
        architecture: { output_modalities: ["video"] },
        supported_durations: line === "primary" ? [4, 8] : [4],
        supported_sizes: ["160x96"],
        supported_frame_images: ["first_frame"],
      };
      if (path === "models" && req.method === "GET") {
        json({
          data:
            line === "primary"
              ? [
                  {
                    id: "suite-chat",
                    name: "验收对话",
                    architecture: { output_modalities: ["text"] },
                    context_length: 32768,
                  },
                  {
                    id: "suite-image",
                    name: "验收图片",
                    architecture: { output_modalities: ["image"] },
                    supported_parameters: {
                      n: { type: "range", min: 1, max: 2 },
                    },
                  },
                  videoModel,
                ]
              : [videoModel],
        });
      } else if (path === "chat/completions" && req.method === "POST") {
        const data = JSON.parse(payload.toString());
        assert.equal(data.model, "suite-chat");
        const usage = {
          prompt_tokens: 10000,
          prompt_tokens_details: {
            cached_tokens: 7000,
            cache_write_tokens: 1000,
          },
          completion_tokens: 500,
        };
        const reply = "验收回复已交付。";
        if (data.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          for (const event of [
            { choices: [{ delta: { content: reply }, finish_reason: null }] },
            { choices: [{ delta: {}, finish_reason: "stop" }] },
            { choices: [], usage },
          ])
            res.write("data: " + JSON.stringify(event) + "\n\n");
          res.end("data: [DONE]\n\n");
        } else
          json({
            choices: [
              {
                message: { role: "assistant", content: reply },
                finish_reason: "stop",
              },
            ],
            usage,
          });
      } else if (path === "images/generations" && req.method === "POST") {
        const data = JSON.parse(payload.toString());
        assert.equal(data.model, "suite-image");
        assert.equal(data.n ?? 1, 1);
        json({ data: [{ b64_json: image.toString("base64") }] });
      } else if (path === "videos" && req.method === "POST") {
        const id = line + "-video-receipt";
        if (line === "primary") {
          const form = await new Response(new Uint8Array(payload), {
            headers: { "content-type": req.headers["content-type"]! },
          }).formData();
          assert.equal(form.get("model"), "suite-video");
          assert.equal(form.get("seconds"), "8");
          json({ id, status: "queued" });
        } else {
          const data = JSON.parse(payload.toString());
          assert.equal(data.model, "suite-video");
          assert.equal(data.duration, 4);
          assert.equal(data.frame_images[0].frame_type, "first_frame");
          assert.equal(
            data.frame_images[0].image_url.url,
            "data:image/png;base64," + image.toString("base64"),
          );
          json({
            id,
            status: "pending",
            polling_url:
              "https://model-access.invalid/secondary/v1/videos/" + id,
          });
        }
      } else if (
        req.method === "GET" &&
        path === "videos/" + line + "-video-receipt"
      ) {
        const id = line + "-video-receipt";
        json({
          id,
          status: release ? "completed" : "in_progress",
          ...(line === "secondary"
            ? {
                unsigned_urls: [
                  "https://model-access.invalid/secondary/v1/videos/" +
                    id +
                    "/content",
                ],
              }
            : {}),
        });
      } else if (
        req.method === "GET" &&
        path === "videos/" + line + "-video-receipt/content"
      ) {
        assert.ok(release);
        res
          .writeHead(200, {
            "content-type": "video/mp4",
            "content-length": video.length,
          })
          .end(video);
      } else
        throw new Error(
          "Unexpected model provider request " + req.method + " " + path,
        );
    } catch (error) {
      errors.push(String(error));
      res.writeHead(400).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    keys,
    wire,
    errors,
    image,
    video,
    url: "http://127.0.0.1:" + (server.address() as AddressInfo).port,
    release: () => {
      release = true;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
export type ModelProvider = Awaited<ReturnType<typeof modelProviderFixture>>;
