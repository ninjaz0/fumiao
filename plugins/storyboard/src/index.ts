import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ProviderError,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
const run = promisify(execFile);
export const storyboard: ProviderPlugin = {
  manifest: {
    id: "storyboard-export",
    version: "1.0.0",
    contractVersion: 1,
    label: "分镜视频合成",
    mode: "request",
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    models: [
      {
        id: "storyboard-mp4",
        label: "分镜导出 MP4",
        kind: "video",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          "x-references": { min: 1, max: 12, types: ["image", "video"] },
          properties: {
            ratio: {
              type: "string",
              enum: ["16:9", "9:16", "1:1"],
              default: "16:9",
            },
            imageSeconds: {
              type: "number",
              minimum: 1,
              maximum: 30,
              default: 3,
            },
          },
        },
      },
    ],
  },
  async health() {
    try {
      await run("ffmpeg", ["-version"]);
      return true;
    } catch {
      return false;
    }
  },
  async submit(e) {
    const folder = await mkdtemp(join(tmpdir(), "fumiao-export-"));
    try {
      const [w, h] =
        e.input.params.ratio === "9:16"
          ? [720, 1280]
          : e.input.params.ratio === "1:1"
            ? [720, 720]
            : [1280, 720];
      const list = [];
      for (const [index, ref] of e.input.references.entries()) {
        if (
          !ref.url.startsWith("data:") ||
          !["image", "video"].includes(ref.mime.split("/")[0])
        )
          throw new ProviderError("分镜素材无效", "rejected");
        const path = join(folder, `input-${index}`);
        await writeFile(path, Buffer.from(ref.url.split(",")[1], "base64"));
        const output = join(folder, `clip-${index}.mp4`);
        const image = ref.mime.startsWith("image/");
        const args = [
          "-v",
          "error",
          "-nostdin",
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          ...(image ? ["-loop", "1"] : []),
          "-i",
          path,
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=48000:cl=stereo",
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-vf",
          `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24`,
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-shortest",
          ...(image ? ["-t", String(e.input.params.imageSeconds || 3)] : []),
          output,
        ];
        // Preserve video audio when present; use silence for image and silent-video clips.
        if (!image) {
          const probe = await run(
            "ffprobe",
            [
              "-v",
              "error",
              "-protocol_whitelist",
              "file,pipe",
              "-show_streams",
              "-of",
              "json",
              path,
            ],
            { signal: e.signal, maxBuffer: 1024 * 1024 },
          );
          if (
            JSON.parse(probe.stdout).streams?.some(
              (s: any) => s.codec_type === "audio",
            )
          )
            args[args.indexOf("1:a:0")] = "0:a:0";
        }
        await run("ffmpeg", args, {
          signal: e.signal,
          timeout: 600000,
          maxBuffer: 1024 * 1024,
        });
        list.push(`file 'clip-${index}.mp4'`);
      }
      await writeFile(join(folder, "clips.txt"), list.join("\n"));
      const output = join(folder, "output.mp4");
      await run(
        "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          "-f",
          "concat",
          "-safe",
          "1",
          "-i",
          join(folder, "clips.txt"),
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          output,
        ],
        { signal: e.signal, timeout: 600000, maxBuffer: 1024 * 1024 },
      );
      const bytes = await readFile(output);
      if (bytes.length > 128 * 1024 * 1024)
        throw new ProviderError("合成结果超过 128 MiB", "rejected");
      return {
        state: "completed",
        artifacts: [
          { url: "data:video/mp4;base64," + bytes.toString("base64") },
        ],
      };
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
};
