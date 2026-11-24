import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import { one, type Sql } from "./db.js";
import type { Platform } from "./platform.js";

const execFileAsync = promisify(execFile);

export type DerivativeVariant = "thumb" | "poster";

export type DerivativeRow = {
  asset_id: string;
  variant: DerivativeVariant;
  object_key: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  state: "pending" | "ready" | "failed";
};

export async function hasDerivativesTable(sql: Sql): Promise<boolean> {
  const row = await one(
    sql,
    "SELECT to_regclass('asset_derivatives') IS NOT NULL AS ok",
  );
  return Boolean(row?.ok);
}

export function defaultDerivativeVariant(mime: string): DerivativeVariant | null {
  if (mime.startsWith("image/")) return "thumb";
  if (mime.startsWith("video/")) return "poster";
  return null;
}

/**
 * Enqueue a pending derivative record (never touches assets table, so 20 GiB user quota
 * trigger in 011_storage_capacity.sql is unaffected per architecture decision Q2).
 */
export async function ensureDerivativeQueued(
  sql: Sql,
  assetId: string,
  mime: string,
): Promise<DerivativeVariant | null> {
  const variant = defaultDerivativeVariant(mime);
  if (!variant) return null;
  if (!(await hasDerivativesTable(sql))) return null;
  const placeholderKey = `pend-${randomUUID().replaceAll("-", "")}`;
  await sql.query(
    `INSERT INTO asset_derivatives(asset_id, variant, object_key, mime, width, height, size, state)
     VALUES($1, $2, $3, $4, 1, 1, 0, 'pending')
     ON CONFLICT (asset_id, variant) DO NOTHING`,
    [
      assetId,
      variant,
      placeholderKey,
      variant === "thumb" ? "image/webp" : "image/jpeg",
    ],
  );
  return variant;
}

export async function listPendingDerivatives(
  sql: Sql,
  limit = 16,
): Promise<{ asset_id: string; variant: DerivativeVariant }[]> {
  if (!(await hasDerivativesTable(sql))) return [];
  const { rows } = await sql.query<{
    asset_id: string;
    variant: DerivativeVariant;
  }>(
    `SELECT d.asset_id, d.variant
     FROM asset_derivatives d
     JOIN assets a ON a.id = d.asset_id AND a.state = 'ready'
     WHERE d.state = 'pending'
     ORDER BY d.created_at ASC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function collectDerivativeObjectKeys(
  sql: Sql,
  assetIds: string[],
): Promise<string[]> {
  if (!assetIds.length || !(await hasDerivativesTable(sql))) return [];
  const { rows } = await sql.query<{ object_key: string }>(
    `SELECT object_key FROM asset_derivatives
     WHERE asset_id = ANY($1::uuid[]) AND state = 'ready'`,
    [assetIds],
  );
  return rows.map((r) => r.object_key);
}

async function readStreamToBuffer(
  stream: NodeJS.ReadableStream,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function extractVideoPosterPng(videoPath: string): Promise<Buffer> {
  const attempts: string[][] = [
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      videoPath,
      "-vf",
      "thumbnail=30,scale='min(480,iw)':-2",
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "-",
    ],
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "0",
      "-i",
      videoPath,
      "-vf",
      "scale='min(480,iw)':-2",
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "-",
    ],
  ];
  let lastErr: unknown;
  for (const args of attempts) {
    try {
      const { stdout } = await execFileAsync("ffmpeg", args, {
        encoding: "buffer",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30_000,
      });
      if (stdout.length > 0) return stdout;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Poster extraction failed");
}

/**
 * Generates a 400px WebP thumbnail (images) or 480px JPEG poster frame (videos)
 * in private object storage and marks asset_derivatives.state = 'ready'.
 */
export async function generateDerivative(
  p: Platform,
  assetId: string,
  variant: DerivativeVariant,
): Promise<DerivativeRow | null> {
  if (!(await hasDerivativesTable(p.db))) return null;
  const asset = await one(
    p.db,
    "SELECT id, object_key, mime, state FROM assets WHERE id=$1 AND state='ready'",
    [assetId],
  );
  if (!asset) return null;

  const existing = await one(
    p.db,
    "SELECT * FROM asset_derivatives WHERE asset_id=$1 AND variant=$2",
    [assetId, variant],
  );
  if (existing?.state === "ready") return existing as DerivativeRow;

  const objectKey = `deriv-${randomUUID().replaceAll("-", "")}`;
  try {
    let buffer: Buffer;
    let width: number;
    let height: number;
    let mime: string;

    if (variant === "thumb") {
      if (!String(asset.mime).startsWith("image/")) {
        throw new Error("Thumbnail derivative requires an image asset");
      }
      const stream = await p.storage.stream(asset.object_key);
      const raw = await readStreamToBuffer(stream);
      const out = await sharp(raw)
        .rotate()
        .resize({
          width: 400,
          height: 400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      buffer = out.data;
      width = Math.max(1, out.info.width);
      height = Math.max(1, out.info.height);
      mime = "image/webp";
    } else {
      if (!String(asset.mime).startsWith("video/")) {
        throw new Error("Poster derivative requires a video asset");
      }
      const dir = await mkdtemp(join(tmpdir(), "fumiao-poster-"));
      try {
        const videoFile = join(dir, "input.bin");
        const stream = await p.storage.stream(asset.object_key);
        await pipeline(stream, createWriteStream(videoFile));
        const png = await extractVideoPosterPng(videoFile);
        const out = await sharp(png)
          .resize({
            width: 480,
            height: 480,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 82 })
          .toBuffer({ resolveWithObject: true });
        buffer = out.data;
        width = Math.max(1, out.info.width);
        height = Math.max(1, out.info.height);
        mime = "image/jpeg";
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }

    await p.storage.put(objectKey, buffer, mime);
    const saved = await one(
      p.db,
      `INSERT INTO asset_derivatives(asset_id, variant, object_key, mime, width, height, size, state)
       VALUES($1, $2, $3, $4, $5, $6, $7, 'ready')
       ON CONFLICT (asset_id, variant) DO UPDATE SET
         object_key = excluded.object_key,
         mime = excluded.mime,
         width = excluded.width,
         height = excluded.height,
         size = excluded.size,
         state = 'ready'
       RETURNING *`,
      [assetId, variant, objectKey, mime, width, height, buffer.length],
    );
    return saved as DerivativeRow;
  } catch {
    await p.storage.remove(objectKey).catch(() => {});
    await p.db
      .query(
        `UPDATE asset_derivatives SET state='failed' WHERE asset_id=$1 AND variant=$2 AND state='pending'`,
        [assetId, variant],
      )
      .catch(() => {});
    return null;
  }
}

export async function getReadyDerivative(
  sql: Sql,
  assetId: string,
  variant: DerivativeVariant,
): Promise<DerivativeRow | null> {
  if (!(await hasDerivativesTable(sql))) return null;
  const row = await one(
    sql,
    `SELECT * FROM asset_derivatives WHERE asset_id=$1 AND variant=$2 AND state='ready'`,
    [assetId, variant],
  );
  return (row as DerivativeRow | null) ?? null;
}
