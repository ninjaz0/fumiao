import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Request, Response } from "express";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { DomainError, requireValue } from "@fumiao/platform/security.js";
import { capacity } from "@fumiao/platform/capacity.js";
import {
  ReferenceImportError,
  ReferenceImportBusyError,
  referenceResultSchema,
  type ReferenceKind,
} from "@fumiao/plugin-sdk/references.js";
import { OriginalIdentity } from "./identity.js";
import { receive } from "./uploads.js";

export class OriginalReferences {
  constructor(readonly p: Platform) {}
  async upload(
    user: Actor,
    req: Request,
    res: Response,
    kind: ReferenceKind,
    adapter = "h3",
  ) {
    const { plugin, capability } = await this.p.registry.referenceImporter(
      this.p.db,
      adapter,
    );
    requireValue(capability.kinds.includes(kind), 400, "参考素材类型不受支持");
    const directory = await mkdtemp(join(tmpdir(), "fumiao-reference-")),
      controller = new AbortController();
    const abort = () => {
      if (!res.writableEnded)
        controller.abort(new Error("Reference client disconnected"));
    };
    req.once("aborted", abort);
    res.once("close", abort);
    let object: string | undefined;
    try {
      const input = await receive(req, directory, capability.maxBytes),
        output = join(
          directory,
          kind === "video" ? "reference.mp4" : "reference.wav",
        );
      const info = referenceResultSchema.parse(
        await plugin.importReference!(input, output, kind, controller.signal),
      );
      requireValue(
        (await stat(output)).size === info.size &&
          info.mime === (kind === "video" ? "video/mp4" : "audio/wav"),
        500,
        "参考素材转换结果无效",
      );
      controller.signal.throwIfAborted();
      const identity = new OriginalIdentity(this.p),
        selected = req.headers["x-workspace-id"]
          ? String(req.headers["x-workspace-id"])
          : new URL(req.originalUrl, "http://localhost").searchParams
              .getAll("workspace")
              .at(-1);
      await identity.activeWorkspace(this.p.db, user, selected);
      await capacity(this.p.db, this.p.storage, info.size);
      const key = randomUUID().replaceAll("-", ""),
        id = randomUUID();
      object = id;
      if (this.p.storage.putFile)
        await this.p.storage.putFile(id, output, info.mime, controller.signal);
      else await this.p.storage.put(id, await readFile(output), info.mime);
      controller.signal.throwIfAborted();
      // urllib.parse.unquote replaces malformed UTF-8, preserves literal '+'.
      const encoded = String(req.headers["x-file-name"] || "");
      const decoded = encoded.replace(/(?:%[a-fA-F0-9]{2})+/g, (s) =>
        Buffer.from(s.replaceAll("%", ""), "hex").toString("utf8"),
      );
      const name = [
        ...(decoded
          .split("/")
          .filter((part) => part && part !== ".")
          .at(-1) || ""),
      ]
        .filter((c) => c.codePointAt(0)! >= 32)
        .slice(0, 120)
        .join("");
      const stored = await this.p.storage.stat(id);
      const result = await this.p.db.transaction(async (sql) => {
        const workspace = await identity.activeWorkspace(sql, user, selected);
        await sql.query(
          "INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind,object_modified) VALUES($1,$2,$3,$4,$10,$5,$6,'ready',$7,$8,$9)",
          [
            id,
            key,
            workspace.id,
            user.id,
            info.mime,
            info.size,
            JSON.stringify({ width: info.w, height: info.h }),
            "ref_" + kind,
            stored.modified ?? Date.now() / 1000,
            id,
          ],
        );
        await sql.query(
          "INSERT INTO asset_reference_media(asset_id,plugin_id,plugin_version,seconds,fps,has_audio,name) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            id,
            plugin.manifest.id,
            plugin.manifest.version,
            info.seconds,
            info.fps,
            info.has_audio,
            name,
          ],
        );
        controller.signal.throwIfAborted();
        const owner = await sql.query(
          "SELECT public_id FROM users WHERE id=$1",
          [user.id],
        );
        return {
          id: key,
          kind: "ref_" + kind,
          mime: info.mime,
          w: info.w,
          h: info.h,
          size: info.size,
          seconds: info.seconds,
          has_audio: info.has_audio,
          name,
          owner: Number(owner.rows[0].public_id),
        };
      });
      object = undefined;
      return result;
    } catch (error) {
      if (object) await this.p.storage.remove(object);
      if (error instanceof ReferenceImportError)
        throw new DomainError(400, error.message);
      if (error instanceof ReferenceImportBusyError)
        throw new DomainError(503, "请求处理失败");
      if (["P1001", "P1002"].includes((error as any).code))
        throw new DomainError(507, "空间不足，请先清理素材或作品");
      throw error;
    } finally {
      req.off("aborted", abort);
      res.off("close", abort);
      await rm(directory, { recursive: true, force: true });
    }
  }
}
