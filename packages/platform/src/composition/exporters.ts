import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import type { Sql } from "../db.js";
import { packageContributions } from "@fumiao/plugin-sdk/contributions.js";
import { loadProgram } from "../plugin-program.js";
import { requireValue } from "../security.js";
import type { Shot } from "./renderer.js";
import { subtitleCues } from "./subtitles.js";

const exec = promisify(execFile);

export type ExporterOutputKind = "composition" | "project";
export type ExporterMime =
  | "video/mp4"
  | "application/zip"
  | "application/xml"
  | "text/plain";
export type ExporterExtension = "mp4" | "zip" | "fcpxml" | "edl";

export function exporterOutputKind(decl: {
  outputKind?: ExporterOutputKind;
}): ExporterOutputKind {
  return decl.outputKind ?? "composition";
}

export function exporterMime(decl: {
  outputKind?: ExporterOutputKind;
  mime?: ExporterMime;
}): ExporterMime {
  if (decl.mime) return decl.mime;
  return exporterOutputKind(decl) === "project"
    ? "application/zip"
    : "video/mp4";
}

export function exporterFileExtension(decl: {
  outputKind?: ExporterOutputKind;
  mime?: ExporterMime;
  fileExtension?: ExporterExtension;
}): ExporterExtension {
  if (decl.fileExtension) return decl.fileExtension;
  const mime = exporterMime(decl);
  if (mime === "application/xml") return "fcpxml";
  if (mime === "text/plain") return "edl";
  if (mime === "application/zip") return "zip";
  return "mp4";
}

export async function canvasExporters(
  sql: Sql,
  plugin?: string,
  pin?: { plugin: string; version: string },
) {
  const { rows } = pin
    ? await sql.query(
        `SELECT r.id,r.version,r.package->'contributes' AS contributes
         FROM studio_package_releases r
         WHERE r.id=$1 AND r.version=$2 AND r.package->'contributes' ? 'exporters'`,
        [pin.plugin, pin.version],
      )
    : await sql.query(
        `SELECT p.id,p.version,r.package->'contributes' AS contributes
         FROM studio_packages p JOIN studio_package_releases r USING(id,version)
         WHERE p.installed AND p.enabled AND NOT p.removing AND r.package->'contributes' ? 'exporters'
         AND ($1::text IS NULL OR p.id=$1) ORDER BY p.id FOR SHARE OF p`,
        [plugin ?? null],
      );
  return rows.flatMap((row) =>
    (packageContributions(row).exporters ?? []).map((decl) => ({
      key: row.id + "/" + decl.id,
      plugin: String(row.id),
      version: String(row.version),
      ...decl,
      outputKind: exporterOutputKind(decl),
      mime: exporterMime(decl),
      fileExtension: exporterFileExtension(decl),
    })),
  );
}

const segments = z
  .array(
    z
      .object({
        index: z.number().int().nonnegative(),
        narration: z.boolean(),
        subtitles: z.boolean(),
      })
      .strict(),
  )
  .min(1)
  .max(30);

export async function planComposition(program: string, shots: Shot[]) {
  const run = await loadProgram(program);
  const shotsForPlan = shots.map((s) =>
    s.voice || !s.dialogue?.length ? s : { ...s, voice: s.dialogue[0].voice },
  );
  const plan = segments.safeParse(run("plan", { shots: shotsForPlan }));
  requireValue(plan.success, 400, "导出器返回了无效的分镜计划");
  return plan.data.map(({ index, narration, subtitles }) => {
    const shot = shots[index];
    requireValue(shot, 400, "导出器引用了当前画布之外的镜头");
    const mapped: Shot = {
      ...shot,
      voice: narration ? shot.voice : null,
      text: narration && subtitles ? shot.text : "",
    };
    if (!narration && mapped.dialogue) delete mapped.dialogue;
    return mapped;
  });
}

function isSafeArchivePath(p: string): boolean {
  if (!p || p.length > 240) return false;
  if (p.startsWith("/") || p.endsWith("/") || p.includes("\\") || p.includes("\0"))
    return false;
  const parts = p.split("/");
  return parts.every(
    (part) => part.length > 0 && part !== "." && part !== "..",
  );
}

const safeArchivePath = z
  .string()
  .min(1)
  .max(240)
  .refine(isSafeArchivePath, "无效的归档相对路径");

const projectBundleSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._\u4e00-\u9fff-]+\.(?:zip|fcpxml|edl)$/),
    format: z.enum(["zip", "text"]),
    directories: z.array(safeArchivePath).max(32).optional(),
    files: z
      .array(
        z
          .object({
            path: safeArchivePath,
            content: z.string().max(4 * 1024 * 1024),
            encoding: z.enum(["utf8", "base64"]).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    mediaCopies: z
      .array(
        z
          .object({
            assetId: z.string().regex(/^[0-9a-f]{32}$/),
            archivePath: safeArchivePath,
          })
          .strict(),
      )
      .max(128)
      .optional(),
    subtitles: z.string().max(1024 * 1024).optional(),
  })
  .strict();

export type ProjectBundlePlan = z.infer<typeof projectBundleSchema>;

export interface ProjectExportShotInput {
  index: number;
  node: string;
  title: string;
  video: string;
  videoDurationMs: number;
  videoWidth: number;
  videoHeight: number;
  videoFps: number;
  videoHasAudio: boolean;
  videoExt: string;
  voice: string | null;
  voiceDurationMs: number;
  voiceExt: string;
  text: string;
  audioStrategy?: "replace" | "keep_original" | "mix";
  originalGain?: number;
  dialogue?: {
    voice: string;
    speaker: string;
    text: string;
    durationMs: number;
    ext: string;
  }[];
  subtitles: { startMs: number; endMs: number; text: string }[];
}

export interface ProjectExportInput {
  project: {
    id: string;
    title: string;
    revision: number;
    fps: number;
    width: number;
    height: number;
  };
  shots: ProjectExportShotInput[];
  bgm?: {
    asset: string;
    durationMs: number;
    ext: string;
    volume: number;
    loop: boolean;
  } | null;
}

function parseFrameRate(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw !== "string" || !raw) return 30;
  const parts = raw.split("/");
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0 && num > 0)
      return Math.round((num / den) * 1000) / 1000;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/** Probe real media metadata with millisecond floor clamping to prevent NLE overshoot. */
export async function probeProjectMedia(
  filePath: string,
  kind: "video" | "audio",
  signal: AbortSignal,
): Promise<{
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}> {
  const { stdout } = await exec(
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
      filePath,
    ],
    { signal, timeout: 30_000, maxBuffer: 4 << 20 },
  );
  const info = JSON.parse(stdout) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  const streams = info.streams ?? [];
  const primary = streams.find((s) => s.codec_type === kind);
  if (!primary) throw new Error("素材缺少所需的视频或音轨");
  const rawDuration = Number(primary.duration || info.format?.duration || 0);
  if (!Number.isFinite(rawDuration) || rawDuration <= 0.05 || rawDuration > 600)
    throw new Error("单段素材时长需在 0.05–600 秒之间");
  // Floor to integer milliseconds so NLE source_timerange never overshoots true media length.
  const durationMs = Math.max(50, Math.floor(Math.max(rawDuration, 0) * 1000));
  const width = Number(primary.width || 0);
  const height = Number(primary.height || 0);
  const fps = parseFrameRate(primary.r_frame_rate ?? primary.avg_frame_rate);
  const hasAudio = streams.some((s) => s.codec_type === "audio");
  return { durationMs, width, height, fps, hasAudio };
}

/** Parse SRT cues generated by subtitleCues into structured millisecond spans for NLE tracks. */
export function buildShotSubtitleSpans(
  text: string,
  startMs: number,
  durationMs: number,
): { startMs: number; endMs: number; text: string }[] {
  if (!text.trim() || durationMs <= 0) return [];
  const rawCues = subtitleCues(text, startMs / 1000, durationMs / 1000, 1);
  const out: { startMs: number; endMs: number; text: string }[] = [];
  const parseTs = (ts: string) => {
    const m = /^(\d+):(\d+):(\d+),(\d+)$/.exec(ts.trim());
    if (!m) return 0;
    return (
      Number(m[1]) * 3_600_000 +
      Number(m[2]) * 60_000 +
      Number(m[3]) * 1_000 +
      Number(m[4])
    );
  };
  for (const block of rawCues) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;
    const [a, b] = lines[1].split("-->");
    if (!a || !b) continue;
    const cueStart = parseTs(a);
    const cueEnd = Math.max(cueStart + 100, parseTs(b));
    out.push({
      startMs: cueStart,
      endMs: cueEnd,
      text: lines.slice(2).join("\n"),
    });
  }
  return out;
}

/** Canonical SHA-256 export basis (inspired by ArcReel ArtifactBasis) excluding non-render fields. */
export function computeExportBasisHash(input: {
  exporterPlugin: string;
  exporterVersion: string;
  exporterId: string;
  projectTitle: string;
  shots: Shot[];
  bgm?: { asset: string; volume?: number; loop?: boolean } | null;
}): string {
  const canonical = {
    kind: "fumiao-project-export",
    v: 1,
    exporter: `${input.exporterPlugin}@${input.exporterVersion}/${input.exporterId}`,
    title: input.projectTitle,
    ...(input.bgm?.asset
      ? {
          bgm: {
            asset: input.bgm.asset,
            volume: input.bgm.volume ?? 0.35,
            loop: input.bgm.loop !== false,
          },
        }
      : {}),
    shots: input.shots.map((s) => ({
      node: s.node,
      title: s.title,
      video: s.video,
      voice: s.voice,
      text: s.text,
      ...(s.audioStrategy && s.audioStrategy !== "replace"
        ? { audioStrategy: s.audioStrategy, originalGain: s.originalGain ?? 0.35 }
        : {}),
      ...(s.dialogue?.length ? { dialogue: s.dialogue } : {}),
    })),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

export async function planProjectExport(
  program: string,
  input: ProjectExportInput,
): Promise<ProjectBundlePlan> {
  const run = await loadProgram(program);
  const parsed = projectBundleSchema.safeParse(run("export", input));
  requireValue(parsed.success, 400, "工程导出器返回了无效的打包清单");
  const plan = parsed.data;
  const admittedAssets = new Set<string>();
  for (const shot of input.shots) {
    admittedAssets.add(shot.video);
    if (shot.voice) admittedAssets.add(shot.voice);
    for (const seg of shot.dialogue ?? []) admittedAssets.add(seg.voice);
  }
  if (input.bgm?.asset) admittedAssets.add(input.bgm.asset);
  const seenArchivePaths = new Set<string>();
  let totalInlineBytes = 0;
  for (const file of plan.files) {
    const key = file.path.toLowerCase();
    requireValue(!seenArchivePaths.has(key), 400, "导出清单包含重复归档路径");
    seenArchivePaths.add(key);
    const buf =
      file.encoding === "base64"
        ? Buffer.from(file.content, "base64")
        : Buffer.from(file.content, "utf8");
    totalInlineBytes += buf.length;
    requireValue(totalInlineBytes <= 16 * 1024 * 1024, 400, "导出文本文件超出大小限制");
  }
  for (const copy of plan.mediaCopies ?? []) {
    requireValue(
      admittedAssets.has(copy.assetId),
      400,
      "导出器引用了未授权的媒体资产",
    );
    const key = copy.archivePath.toLowerCase();
    requireValue(!seenArchivePaths.has(key), 400, "导出清单包含重复归档路径");
    seenArchivePaths.add(key);
  }
  if (plan.format === "text") {
    requireValue(
      plan.files.length === 1 && !(plan.mediaCopies?.length),
      400,
      "纯文本工程导出只能包含单个输出文件",
    );
  }
  return plan;
}
