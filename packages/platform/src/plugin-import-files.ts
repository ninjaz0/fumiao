import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ImportAsset } from "@fumiao/plugin-sdk/importers.js";
import {
  ReferenceImportError,
  ReferenceImportBusyError,
} from "@fumiao/plugin-sdk/references.js";
import { imageImporter } from "@fumiao/image-import/index.js";
import { referenceImporter } from "@fumiao/media-runtime/references.js";
import { capacity } from "./capacity.js";
import type { Sql } from "./db.js";
import type { Storage } from "./storage.js";
import { DomainError, requireValue } from "./security.js";
import { importBody, type HttpTransport } from "./plugin-host.js";

type Prepared = {
  key: string;
  id: string;
  object: string;
  kind: ImportAsset["kind"];
  name: string;
  file: string;
  mime: string;
  size: number;
  metadata: Record<string, unknown>;
  reference?: { seconds: number; fps: number; has_audio: boolean };
};
const maxBytes = 64 << 20;
let active = 0;

// Decoding happens before the committing transaction. Only files that have
// passed the regular upload decoders may acquire a workspace asset ID.
export async function prepareImportFiles<T>(
  assets: ImportAsset[],
  origins: string[],
  signal: AbortSignal,
  http: HttpTransport | undefined,
  commit: (files: Prepared[]) => Promise<T>,
) {
  if (!assets.length) return commit([]);
  requireValue(active < 4, 429, "导入任务繁忙，请稍后重试");
  active++;
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "fumiao-import-"));
    let rawBytes = 0,
      outputBytes = 0;
    const prepared: Prepared[] = [];
    for (const asset of assets) {
      const object = randomUUID(),
        id = randomUUID().replaceAll("-", "");
      const input = join(dir, object + ".input");
      const limit = Math.min(
        maxBytes - rawBytes,
        asset.kind === "image" ? 16 << 20 : maxBytes,
      );
      const body = importBody(asset.url, origins, limit, signal, http);
      await writeFile(input, body, { flag: "wx", mode: 0o600, signal });
      const raw = (await stat(input)).size;
      requireValue(raw > 0, 422, "素材文件为空");
      rawBytes += raw;
      const file = join(
        dir,
        object + { image: ".image", video: ".mp4", audio: ".wav" }[asset.kind],
      );
      const info =
        asset.kind === "image"
          ? await imageImporter.convert(input, file, "reference", signal)
          : await referenceImporter.import(input, file, asset.kind, signal);
      outputBytes += info.size;
      requireValue(
        outputBytes <= maxBytes && info.size === (await stat(file)).size,
        413,
        "导入素材总量超过上限或文件不完整",
      );
      const reference =
        "seconds" in info
          ? { seconds: info.seconds, fps: info.fps, has_audio: info.has_audio }
          : undefined;
      prepared.push({
        key: asset.key,
        id,
        object,
        kind: asset.kind,
        name: asset.name ?? "",
        file,
        mime: info.mime,
        size: info.size,
        metadata: {
          width: info.w,
          height: info.h,
          ...(!reference ? { originalImport: info } : {}),
        },
        reference,
      });
      await rm(input);
    }
    signal.throwIfAborted();
    return await commit(prepared);
  } catch (error) {
    if (error instanceof ReferenceImportBusyError)
      throw new DomainError(503, "参考素材转换繁忙");
    if (error instanceof ReferenceImportError)
      throw new DomainError(422, error.message);
    throw error;
  } finally {
    try {
      if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      console.warn("导入临时文件清理失败");
    } finally {
      active--;
    }
  }
}

export async function storeImportFiles(
  sql: Sql,
  storage: Storage,
  workspace: string,
  actor: string,
  files: Prepared[],
  written: string[],
  signal: AbortSignal,
) {
  if (files.length)
    await capacity(
      sql,
      storage,
      files.reduce((sum, f) => sum + f.size, 0),
    );
  for (const f of files) {
    signal.throwIfAborted();
    written.push(f.object);
    if (storage.putFile)
      await storage.putFile(f.object, f.file, f.mime, signal);
    else await storage.put(f.object, await readFile(f.file), f.mime);
    const stored = await storage.stat(f.object);
    await sql.query(
      `INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind,object_modified)
      VALUES($1,$2,$3,$4,$5,$6,$7,'ready',$8,$9,$10)`,
      [
        f.object,
        f.id,
        workspace,
        actor,
        f.object,
        f.mime,
        f.size,
        JSON.stringify(f.metadata),
        f.kind === "image" ? "ref" : "ref_" + f.kind,
        stored.modified ?? Date.now() / 1000,
      ],
    );
    if (f.reference)
      await sql.query(
        "INSERT INTO asset_reference_media(asset_id,seconds,fps,has_audio,name) VALUES($1,$2,$3,$4,$5)",
        [
          f.object,
          f.reference.seconds,
          f.reference.fps,
          f.reference.has_audio,
          f.name,
        ],
      );
  }
  return files.map(({ id, key, kind }) => ({ id, key, kind }));
}
