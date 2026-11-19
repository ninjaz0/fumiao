import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { subtitleCues } from "./subtitles.js";
const exec = promisify(execFile);
export interface Shot {
  node: string;
  title: string;
  video: string;
  voice: string | null;
  text: string;
}
export interface Composition {
  path: string;
  subtitles: string;
  width: number;
  height: number;
  duration: number;
}
export interface CompositionPlugin {
  id: string;
  version: string;
  health(): Promise<boolean>;
  compose(
    shots: Shot[],
    folder: string,
    materialize: (key: string, path: string) => Promise<void>,
    signal: AbortSignal,
  ): Promise<Composition>;
}
export const compositionError = "素材解码或合成失败，请检查视频和音轨后重试";
export const originalStoryboard: CompositionPlugin = {
  id: "original-storyboard",
  version: "1.0.0",
  async health() {
    try {
      await exec("ffmpeg", ["-version"]);
      await exec("ffprobe", ["-version"]);
      return true;
    } catch {
      return false;
    }
  },
  async compose(shots, folder, materialize, signal) {
    const command = async (
      program: string,
      args: string[],
      timeout = 180000,
    ) => {
      try {
        return (
          await exec(program, args, { signal, timeout, maxBuffer: 4 << 20 })
        ).stdout;
      } catch (error) {
        signal.throwIfAborted();
        if ((error as any).killed)
          throw new Error("合成中断，请检查素材后重试");
        throw new Error(compositionError);
      }
    };
    const probe = async (path: string) =>
      JSON.parse(
        await command(
          "ffprobe",
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            path,
          ],
          30000,
        ),
      );
    const duration = (info: any, kind: string) => {
      const stream = info.streams.find((s: any) => s.codec_type === kind);
      if (!stream) throw new Error("素材缺少所需的视频或音轨");
      const value = Number(stream.duration || info.format.duration || 0);
      if (!Number.isFinite(value) || value <= 0.05 || value > 120)
        throw new Error("单段素材时长需在 0.05–120 秒之间");
      return value;
    };
    const paths = new Map<string, string>(),
      segments: string[] = [],
      captions: string[] = [];
    let total = 0,
      width = 0,
      height = 0;
    for (const shot of shots) {
      signal.throwIfAborted();
      for (const key of [shot.video, shot.voice])
        if (key && !paths.has(key)) {
          const path = join(folder, `source-${paths.size}`);
          await materialize(key, path);
          paths.set(key, path);
        }
      const video = paths.get(shot.video)!,
        voice = shot.voice ? paths.get(shot.voice) : undefined;
      const info = await probe(video),
        vd = duration(info, "video"),
        ad = voice ? duration(await probe(voice), "audio") : 0;
      const length = Math.ceil(Math.max(vd, ad) * 24 - 1e-4) / 24;
      total += length;
      if (total > 300)
        throw new Error("成片总时长最多 5 分钟，请减少镜头或旁白");
      if (!width) {
        const stream = info.streams.find((s: any) => s.codec_type === "video");
        const scale = Math.min(1, 1920 / Math.max(stream.width, stream.height));
        width = Math.max(2, Math.floor((stream.width * scale) / 2) * 2);
        height = Math.max(2, Math.floor((stream.height * scale) / 2) * 2);
      }
      const args = [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-threads",
        "2",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        video,
      ];
      let audio: string;
      if (voice) {
        args.push("-protocol_whitelist", "file,pipe", "-i", voice);
        audio = "1:a:0";
      } else if (info.streams.some((s: any) => s.codec_type === "audio"))
        audio = "0:a:0";
      else {
        args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
        audio = "1:a:0";
      }
      const vf = `setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=${length},trim=duration=${length},format=yuv420p`;
      const af = `asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${length}`;
      const name = `shot-${String(segments.length).padStart(3, "0")}.mp4`;
      args.push(
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        `[0:v:0]${vf}[v];[${audio}]${af}[a]`,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-t",
        String(length),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-maxrate",
        "4M",
        "-bufsize",
        "8M",
        "-threads",
        "2",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        join(folder, name),
      );
      await command("ffmpeg", args, 300000);
      segments.push(name);
      if (voice)
        captions.push(
          ...subtitleCues(shot.text, total - length, ad, captions.length + 1),
        );
    }
    const manifest = join(folder, "segments.txt"),
      path = join(folder, "result.mp4"),
      picture = captions.length ? join(folder, "picture.mp4") : path;
    await writeFile(manifest, segments.map((s) => `file '${s}'\n`).join(""));
    await command(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        manifest,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        picture,
      ],
      120000,
    );
    const subtitles = captions.join("\n");
    if (captions.length) {
      const srt = join(folder, "subtitles.srt");
      await writeFile(srt, subtitles);
      await command(
        "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-y",
          "-i",
          picture,
          "-i",
          srt,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0",
          "-map",
          "1:0",
          "-c",
          "copy",
          "-c:s",
          "mov_text",
          "-metadata:s:s:0",
          "language=zho",
          "-disposition:s:0",
          "default",
          "-movflags",
          "+faststart",
          path,
        ],
        120000,
      );
    }
    const actual = Number((await probe(path)).format.duration || 0);
    if (!Number.isFinite(actual)) throw new Error("成片时长无效");
    if (
      Math.abs(actual - total) > 0.25 ||
      (await stat(path)).size > 256 * 1024 * 1024
    )
      throw new Error("合成结果时长或体积异常，请调整后重试");
    return { path, subtitles, width, height, duration: actual };
  },
};
