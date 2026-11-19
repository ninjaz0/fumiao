import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Request, Response } from "express";
import type { Actor, Platform } from "../../platform/src/platform.js";
import { one, type Sql } from "../../platform/src/db.js";
import { DomainError, requireValue } from "../../platform/src/security.js";
import {
  imageImporter,
  type ImageImporter,
} from "../../image-import/src/index.js";
import { OriginalIdentity, type OriginalActor } from "./identity.js";
import { OriginalMedia } from "./media.js";
import { discardAvatar } from "./avatar-storage.js";
import { capacity } from "../../platform/src/capacity.js";

export async function receive(req: Request, directory: string, limit: number) {
  const length = req.headers["content-length"] || "";
  requireValue(
    !/^\d+$/.test(length) || BigInt(length) <= BigInt(limit),
    413,
    "文件过大",
  );
  const path = join(directory, "input"),
    file = await open(path, "wx", 0o600);
  let size = 0;
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      requireValue(size <= limit, 413, "文件过大");
      await file.writeFile(chunk);
    }
    requireValue(size > 0, 400, "文件为空");
    return path;
  } catch (error) {
    req.resume();
    throw error;
  } finally {
    await file.close();
  }
}
export class OriginalUploads {
  private identity: OriginalIdentity;
  private media: OriginalMedia;
  constructor(
    readonly p: Platform,
    readonly importer: ImageImporter = imageImporter,
  ) {
    this.identity = new OriginalIdentity(p);
    this.media = new OriginalMedia(p);
  }
  private async staged(
    req: Request,
    res: Response,
    mode: "reference" | "avatar",
    fn: (
      file: string,
      info: Awaited<ReturnType<ImageImporter["convert"]>>,
      directory: string,
    ) => Promise<unknown>,
  ) {
    const directory = await mkdtemp(join(tmpdir(), "fumiao-upload-")),
      controller = new AbortController();
    const abort = () => {
      if (!res.writableEnded)
        controller.abort(new Error("Upload client disconnected"));
    };
    req.once("aborted", abort);
    res.once("close", abort);
    try {
      const input = await receive(
          req,
          directory,
          mode === "avatar" ? 5 << 20 : 16 << 20,
        ),
        output = join(directory, "converted");
      const info = await this.importer.convert(
        input,
        output,
        mode,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      return await fn(output, info, directory);
    } finally {
      req.off("aborted", abort);
      res.off("close", abort);
      await rm(directory, { recursive: true, force: true });
    }
  }
  private async selection(sql: Sql, user: Actor, req: Request) {
    const selected = req.headers["x-workspace-id"]
      ? String(req.headers["x-workspace-id"])
      : new URL(req.originalUrl, "http://localhost").searchParams
          .getAll("workspace")
          .at(-1);
    const workspace = await this.identity.activeWorkspace(sql, user, selected),
      source = req.headers["x-frame-source"],
      frame = req.headers["x-frame-time"];
    let provenance: { id: string; key: string; seconds: number } | undefined;
    if (source !== undefined || frame !== undefined) {
      requireValue(source && frame !== undefined, 400, "取帧来源信息不完整");
      const asset = await this.media.resource(
        sql,
        user,
        String(source),
        workspace.id,
      );
      requireValue(
        asset.original_kind === "video",
        404,
        "内容不存在或无权访问",
      );
      const raw = String(frame).trim();
      // Python float accepts decimal/exponent notation and digit separators, not hex.
      const numeric =
          /^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/.test(
            raw,
          ),
        seconds = Number(raw.replaceAll("_", ""));
      requireValue(
        numeric && Number.isFinite(seconds) && seconds >= 0 && seconds <= 3600,
        400,
        "取帧时间无效",
      );
      provenance = { id: asset.id, key: asset.public_id, seconds };
    }
    return { workspace, provenance };
  }
  async asset(user: Actor, req: Request, res: Response) {
    return this.staged(req, res, "reference", async (file, info, directory) => {
      await this.selection(this.p.db, user, req);
      const id = randomUUID(),
        key = randomUUID().replaceAll("-", "");
      await capacity(this.p.db, this.p.storage, info.size);
      const disk = await statfs(directory);
      requireValue(
        Number(disk.bavail) * Number(disk.bsize) >= info.size + (1 << 30),
        507,
        "空间不足，请先清理素材或作品",
      );
      try {
        await this.p.storage.put(id, await readFile(file), info.mime);
        await this.p.db.transaction(async (sql) => {
          const { workspace, provenance } = await this.selection(
            sql,
            user,
            req,
          );
          const stored = await this.p.storage.stat(id);
          await sql.query(
            "INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind,object_modified) VALUES($1,$2,$3,$4,$9,$5,$6,'ready',$7,'ref',$8)",
            [
              id,
              key,
              workspace.id,
              user.id,
              info.mime,
              info.size,
              JSON.stringify({
                width: info.w,
                height: info.h,
                originalImport: info,
              }),
              stored.modified ?? Date.now() / 1000,
              id,
            ],
          );
          if (provenance)
            await sql.query(
              "INSERT INTO asset_provenance(asset_id,source_id,source_public_id,frame_seconds) VALUES($1,$2,$3,$4)",
              [id, provenance.id, provenance.key, provenance.seconds],
            );
        });
      } catch (error) {
        await this.p.storage.remove(id);
        if (["P1001", "P1002"].includes((error as any).code))
          throw new DomainError(507, "空间不足，请先清理素材或作品");
        throw error;
      }
      return { id: key, ...info };
    });
  }
  async avatar(user: Actor, req: Request, res: Response) {
    return this.staged(req, res, "avatar", async (file, info) => {
      const key = randomUUID().replaceAll("-", ""),
        object = "avatar-" + randomUUID(),
        bytes = await readFile(file);
      let previous = "",
        result;
      try {
        await this.p.storage.put(object, bytes, "image/webp");
        const stored = await this.p.storage.stat(object);
        result = await this.p.db.transaction(async (sql) => {
          const row = await one(
            sql,
            "SELECT * FROM users WHERE id=$1 AND active=true AND deleted_at IS NULL FOR UPDATE",
            [user.id],
          );
          requireValue(row, 401, "请重新登录");
          previous = row.avatar;
          await sql.query(
            "INSERT INTO avatar_objects(public_id,object_key,size,modified,sha256) VALUES($1,$2,$3,$4,$5)",
            [
              key,
              object,
              info.size,
              stored.modified ?? Date.now() / 1000,
              createHash("sha256").update(bytes).digest("hex"),
            ],
          );
          await sql.query("UPDATE users SET avatar=$2 WHERE id=$1", [
            user.id,
            "upload:" + key,
          ]);
          return this.identity.profile({
            ...row,
            avatar: "upload:" + key,
          } as OriginalActor);
        });
      } catch (error) {
        await this.p.storage.remove(object);
        throw error;
      }
      await discardAvatar(this.p, previous);
      return result;
    });
  }
}
