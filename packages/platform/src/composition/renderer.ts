import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { subtitleCues } from "./subtitles.js";
const exec = promisify(execFile);

export type ShotAudioStrategy = "replace" | "keep_original" | "mix";

export interface ShotDialogueSegment {
  voice: string;
  speaker: string;
  text: string;
}

export interface Shot {
  node: string;
  title: string;
  video: string;
  voice: string | null;
  text: string;
  audioStrategy?: ShotAudioStrategy;
  originalGain?: number;
  dialogue?: ShotDialogueSegment[];
  tailInherited?: boolean;
  trimLeadingFrames?: number;
}

export interface CompositionBgm {
  asset: string;
  volume?: number;
  ducking?: boolean;
  duckThreshold?: number;
  duckRatio?: number;
  duckAttackMs?: number;
  duckReleaseMs?: number;
  loop?: boolean;
}

export interface CompositionOptions {
  bgm?: CompositionBgm | null;
  loudnorm?: boolean;
  overlapTrimFrames?: number;
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
    options?: CompositionOptions,
  ): Promise<Composition>;
}

export const compositionError = "素材解码或合成失败，请检查视频和音轨后重试";
const DIALOGUE_GAP_SEC = 0.15;

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
  async compose(shots, folder, materialize, signal, options) {
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
    const duration = (info: any, kind: string, maxSeconds = 120) => {
      const stream = info.streams.find((s: any) => s.codec_type === kind);
      if (!stream) throw new Error("素材缺少所需的视频或音轨");
      const value = Number(stream.duration || info.format.duration || 0);
      if (!Number.isFinite(value) || value <= 0.05 || value > maxSeconds)
        throw new Error("单段素材时长需在 0.05–120 秒之间");
      return value;
    };
    const ensureSource = async (
      paths: Map<string, string>,
      key: string | null | undefined,
    ) => {
      if (!key) return undefined;
      if (!paths.has(key)) {
        const path = join(folder, `source-${paths.size}`);
        await materialize(key, path);
        paths.set(key, path);
      }
      return paths.get(key)!;
    };

    const paths = new Map<string, string>(),
      segments: string[] = [],
      captions: string[] = [];
    let total = 0,
      width = 0,
      height = 0;

    for (const [shotIndex, shot] of shots.entries()) {
      signal.throwIfAborted();
      const video = (await ensureSource(paths, shot.video))!;
      const info = await probe(video);
      let vd = duration(info, "video");
      const trimFrames =
        shot.tailInherited && shotIndex > 0
          ? Math.max(
              1,
              Math.min(
                3,
                Math.floor(
                  shot.trimLeadingFrames ?? options?.overlapTrimFrames ?? 1,
                ),
              ),
            )
          : 0;
      if (trimFrames > 0) {
        vd = Math.max(0.05, vd - trimFrames / 24);
      }

      const strategy: ShotAudioStrategy = shot.audioStrategy ?? "replace";
      const origGain = Math.max(0, Math.min(1, shot.originalGain ?? 0.35));

      let voicePath: string | undefined;
      let ad = 0;
      const shotCues: { offsetInShot: number; length: number; text: string }[] =
        [];

      if (shot.dialogue && shot.dialogue.length > 0) {
        const dialogueFiles: string[] = [];
        let cursor = 0;
        for (const [segIdx, seg] of shot.dialogue.entries()) {
          const segPath = (await ensureSource(paths, seg.voice))!;
          const segDur = duration(await probe(segPath), "audio");
          dialogueFiles.push(segPath);
          const labeled = seg.speaker.trim()
            ? `${seg.speaker.trim()}：${seg.text}`
            : seg.text;
          shotCues.push({
            offsetInShot: cursor,
            length: segDur,
            text: labeled,
          });
          cursor += segDur;
          if (segIdx < shot.dialogue.length - 1) cursor += DIALOGUE_GAP_SEC;
        }
        ad = cursor;
        if (dialogueFiles.length === 1) {
          voicePath = dialogueFiles[0];
        } else {
          voicePath = join(folder, `dialogue-${shotIndex}.wav`);
          const dArgs = ["-v", "error", "-nostdin", "-y"];
          const filterParts: string[] = [];
          const concatInputs: string[] = [];
          for (const [i, file] of dialogueFiles.entries()) {
            dArgs.push("-protocol_whitelist", "file,pipe", "-i", file);
            filterParts.push(
              `[${i}:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[d${i}]`,
            );
            concatInputs.push(`[d${i}]`);
            if (i < dialogueFiles.length - 1) {
              filterParts.push(
                `anullsrc=r=48000:cl=stereo:d=${DIALOGUE_GAP_SEC}[gap${i}]`,
              );
              concatInputs.push(`[gap${i}]`);
            }
          }
          const totalConcat = concatInputs.length;
          dArgs.push(
            "-filter_complex",
            `${filterParts.join(";")};${concatInputs.join("")}concat=n=${totalConcat}:v=0:a=1[dout]`,
            "-map",
            "[dout]",
            "-c:a",
            "pcm_s16le",
            voicePath,
          );
          await command("ffmpeg", dArgs, 120000);
        }
      } else if (shot.voice) {
        voicePath = await ensureSource(paths, shot.voice);
        ad = voicePath ? duration(await probe(voicePath), "audio") : 0;
        if (voicePath && shot.text) {
          shotCues.push({ offsetInShot: 0, length: ad, text: shot.text });
        }
      }

      const effectiveVoiceDuration = strategy === "keep_original" ? 0 : ad;
      const length =
        Math.ceil(Math.max(vd, effectiveVoiceDuration) * 24 - 1e-4) / 24;
      const shotStart = total;
      total += length;
      if (total > 300)
        throw new Error("成片总时长最多 5 分钟，请减少镜头或旁白");
      if (!width) {
        const stream = info.streams.find((s: any) => s.codec_type === "video");
        const scale = Math.min(1, 1920 / Math.max(stream.width, stream.height));
        width = Math.max(2, Math.floor((stream.width * scale) / 2) * 2);
        height = Math.max(2, Math.floor((stream.height * scale) / 2) * 2);
      }

      const hasVideoAudio = info.streams.some(
        (s: any) => s.codec_type === "audio",
      );
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

      const trimPrefix =
        trimFrames > 0 ? `select='gte(n\\,${trimFrames})',` : "";
      const vf = `${trimPrefix}setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=${length},trim=duration=${length},format=yuv420p`;

      let audioFilterGraph: string;
      if (strategy === "keep_original") {
        if (hasVideoAudio) {
          audioFilterGraph = `[0:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${length}[a]`;
        } else {
          args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
          audioFilterGraph = `[1:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${length}[a]`;
        }
      } else if (strategy === "mix" && voicePath && hasVideoAudio) {
        args.push("-protocol_whitelist", "file,pipe", "-i", voicePath);
        audioFilterGraph =
          `[0:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${origGain},apad,atrim=duration=${length}[orig];` +
          `[1:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${length}[vox];` +
          `[orig][vox]amix=inputs=2:duration=first:normalize=0,atrim=duration=${length}[a]`;
      } else if (voicePath) {
        args.push("-protocol_whitelist", "file,pipe", "-i", voicePath);
        audioFilterGraph = `[1:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${length}[a]`;
      } else if (hasVideoAudio) {
        audioFilterGraph = `[0:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${length}[a]`;
      } else {
        args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
        audioFilterGraph = `[1:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${length}[a]`;
      }

      const name = `shot-${String(segments.length).padStart(3, "0")}.mp4`;
      args.push(
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        `[0:v:0]${vf}[v];${audioFilterGraph}`,
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

      if (strategy !== "keep_original") {
        for (const cue of shotCues) {
          captions.push(
            ...subtitleCues(
              cue.text,
              shotStart + cue.offsetInShot,
              cue.length,
              captions.length + 1,
            ),
          );
        }
      }
    }

    const hasBgm = Boolean(options?.bgm?.asset);
    const wantsLoudnorm = Boolean(options?.loudnorm);
    const needsMasterPass = hasBgm || wantsLoudnorm;

    const manifest = join(folder, "segments.txt"),
      path = join(folder, "result.mp4"),
      concatOut =
        needsMasterPass || captions.length
          ? join(folder, "concat.mp4")
          : path;

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
        concatOut,
      ],
      120000,
    );

    let picture = concatOut;
    if (needsMasterPass) {
      const mastered = captions.length ? join(folder, "picture.mp4") : path;
      if (hasBgm && options?.bgm?.asset) {
        const bgmPath = (await ensureSource(paths, options.bgm.asset))!;
        // Validate BGM has an audio stream (up to 600s track allowed).
        duration(await probe(bgmPath), "audio", 600);
        const bgmVol = Math.max(0.02, Math.min(1, options.bgm.volume ?? 0.35));
        const duck = options.bgm.ducking !== false;
        const thresh = Math.max(
          0.005,
          Math.min(0.5, options.bgm.duckThreshold ?? 0.03),
        );
        const ratio = Math.max(1.5, Math.min(20, options.bgm.duckRatio ?? 6));
        const attack = Math.max(
          5,
          Math.min(500, options.bgm.duckAttackMs ?? 40),
        );
        const release = Math.max(
          50,
          Math.min(2000, options.bgm.duckReleaseMs ?? 350),
        );
        const loud =
          options.loudnorm !== false ? ",loudnorm=I=-14:TP=-1.5:LRA=11" : "";
        const masterGraph = duck
          ? `[0:a:0]asplit=2[voice][sc];` +
            `[1:a:0]aresample=48000,aformat=channel_layouts=stereo,volume=${bgmVol},atrim=duration=${total},asetpts=PTS-STARTPTS[bg];` +
            `[bg][sc]sidechaincompress=threshold=${thresh}:ratio=${ratio}:attack=${attack}:release=${release}[ducked];` +
            `[voice][ducked]amix=inputs=2:duration=first:normalize=0${loud},atrim=duration=${total}[aout]`
          : `[1:a:0]aresample=48000,aformat=channel_layouts=stereo,volume=${bgmVol},atrim=duration=${total},asetpts=PTS-STARTPTS[bg];` +
            `[0:a:0][bg]amix=inputs=2:duration=first:normalize=0${loud},atrim=duration=${total}[aout]`;

        const mArgs = [
          "-v",
          "error",
          "-nostdin",
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          concatOut,
        ];
        if (options.bgm.loop !== false) mArgs.push("-stream_loop", "-1");
        mArgs.push(
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          bgmPath,
          "-filter_complex_threads",
          "1",
          "-filter_complex",
          masterGraph,
          "-map",
          "0:v:0",
          "-map",
          "[aout]",
          "-t",
          String(total),
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "+faststart",
          mastered,
        );
        await command("ffmpeg", mArgs, 180000);
      } else {
        await command(
          "ffmpeg",
          [
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            concatOut,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0",
            "-c:v",
            "copy",
            "-af",
            "loudnorm=I=-14:TP=-1.5:LRA=11",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            mastered,
          ],
          180000,
        );
      }
      picture = mastered;
    }

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
