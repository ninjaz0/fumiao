import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { capacity } from "./capacity.js";
import { ensureDerivativeQueued } from "./derivatives.js";
import type { Platform } from "./platform.js";
import { requireValue } from "./security.js";

export type GridCropInput = {
  sourceAssetId: string;
  sourcePublicId: string;
  sourceObjectKey: string;
  sourceMime: string;
  workspaceId: string;
  ownerId: string;
  rows: 2 | 3;
  cols: 2 | 3;
  row: number;
  col: number;
};

export type GridCropResult = {
  id: string;
  public_id: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  row: number;
  col: number;
  rows: number;
  cols: number;
};

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Crops a single cell from a 2x2 or 3x3 storyboard contact sheet image and registers
 * it as a ready workspace `ref` asset cleanly within storage capacity.
 */
export async function cropGridCell(
  p: Platform,
  input: GridCropInput,
): Promise<GridCropResult> {
  requireValue(
    (input.rows === 2 || input.rows === 3) &&
      (input.cols === 2 || input.cols === 3),
    400,
    "仅支持 2x2 或 3x3 宫格裁切",
  );
  requireValue(
    Number.isInteger(input.row) &&
      input.row >= 0 &&
      input.row < input.rows &&
      Number.isInteger(input.col) &&
      input.col >= 0 &&
      input.col < input.cols,
    400,
    "宫格行列索引超出范围",
  );
  requireValue(
    input.sourceMime.startsWith("image/"),
    400,
    "仅支持对图片素材执行宫格裁切",
  );

  const stream = await p.storage.stream(input.sourceObjectKey);
  const raw = await streamToBuffer(stream);
  const meta = await sharp(raw).rotate().metadata();
  const fullW = meta.width ?? 0;
  const fullH = meta.height ?? 0;
  requireValue(
    fullW >= input.cols * 4 && fullH >= input.rows * 4,
    400,
    "图片分辨率过小，无法进行宫格裁切",
  );

  const cellW = Math.floor(fullW / input.cols);
  const cellH = Math.floor(fullH / input.rows);
  const left = input.col * cellW;
  const top = input.row * cellH;
  const extractW = input.col === input.cols - 1 ? fullW - left : cellW;
  const extractH = input.row === input.rows - 1 ? fullH - top : cellH;

  const isJpeg = input.sourceMime === "image/jpeg";
  const outMime = isJpeg ? "image/jpeg" : "image/png";
  const pipeline = sharp(raw)
    .rotate()
    .extract({ left, top, width: extractW, height: extractH });
  const { data, info } = isJpeg
    ? await pipeline.jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true })
    : await pipeline.png().toBuffer({ resolveWithObject: true });

  await capacity(p.db, p.storage, data.length);
  const id = randomUUID();
  const publicId = randomUUID().replaceAll("-", "");
  const objectKey = `crop-${publicId}`;

  await p.storage.put(objectKey, data, outMime);
  try {
    const stat = await p.storage.stat(objectKey);
    await p.db.transaction(async (sql) => {
      await sql.query(
        `INSERT INTO assets(id, public_id, workspace_id, owner_id, object_key, mime, size, state, metadata, original_kind, object_modified)
         VALUES($1, $2, $3, $4, $5, $6, $7, 'ready', $8, 'ref', $9)`,
        [
          id,
          publicId,
          input.workspaceId,
          input.ownerId,
          objectKey,
          outMime,
          data.length,
          JSON.stringify({
            width: info.width,
            height: info.height,
            grid_crop: {
              source: input.sourcePublicId,
              rows: input.rows,
              cols: input.cols,
              row: input.row,
              col: input.col,
            },
          }),
          stat.modified,
        ],
      );
      await ensureDerivativeQueued(sql, id, outMime);
    });
  } catch (err) {
    await p.storage.remove(objectKey).catch(() => {});
    throw err;
  }

  return {
    id,
    public_id: publicId,
    mime: outMime,
    width: info.width,
    height: info.height,
    size: data.length,
    row: input.row,
    col: input.col,
    rows: input.rows,
    cols: input.cols,
  };
}
