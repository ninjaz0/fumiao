import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";
import type { Actor, Platform } from "../../platform/src/platform.js";
import { one, type Sql } from "../../platform/src/db.js";
import {
  hash,
  requireValue,
  DomainError,
} from "../../platform/src/security.js";
import { OriginalIdentity } from "./identity.js";
import { OriginalMedia } from "./media.js";
import { parseBody } from "./validation.js";
import { identityBodies } from "./contracts.js";
import { zipStream, type ArchiveEntry } from "./zip.js";
type Selection = { kind: "job" | "asset"; row: any };
const terminal = ["completed", "failed", "cancelled"];
const extensions: Record<string, string> = {
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
export function archiveEntry(
  asset: { public_id: string; size: number | string; mime: string },
  name: string,
): ArchiveEntry {
  const extension = Object.hasOwn(extensions, asset.mime)
    ? extensions[asset.mime]
    : undefined;
  requireValue(extension, 400, "不支持下载此文件类型");
  return {
    key: asset.public_id,
    size: Number(asset.size),
    name: `${name}.${extension}`,
  };
}
export class OriginalLibrary {
  private identity: OriginalIdentity;
  private media: OriginalMedia;
  constructor(readonly p: Platform) {
    this.identity = new OriginalIdentity(p);
    this.media = new OriginalMedia(p);
  }
  async resolve(sql: Sql, key: string): Promise<Selection> {
    if (/^job:[1-9][0-9]{0,15}$/.test(key))
      return {
        kind: "job",
        row: await one(
          sql,
          "SELECT * FROM jobs WHERE public_id=$1 AND deleted_at IS NULL",
          [key.slice(4)],
        ),
      };
    if (/^asset:[0-9a-f]{32}$/.test(key)) {
      const job = await one(
        sql,
        `SELECT j.* FROM jobs j JOIN job_assets r ON r.job_id=j.id AND r.role='output' JOIN assets a ON a.id=r.asset_id WHERE a.public_id=$1 AND j.deleted_at IS NULL ORDER BY j.public_id LIMIT 1`,
        [key.slice(6)],
      );
      if (job) return { kind: "job", row: job };
      return {
        kind: "asset",
        row: await one(
          sql,
          "SELECT * FROM assets WHERE public_id=$1 AND original_kind IN ('ref','ref_video','ref_audio')",
          [key.slice(6)],
        ),
      };
    }
    throw new DomainError(400, "资产标识无效");
  }
  async access(sql: Sql, user: Actor, item: Selection, workspace: string) {
    requireValue(
      item.row.workspace_id === workspace,
      404,
      "内容不存在或无权访问",
    );
    // activeWorkspace already authorized the selected space. Check again against current membership.
    const row = await one(
      sql,
      `SELECT id FROM workspaces w WHERE w.id=$1 AND ((w.kind='personal' AND w.owner_id=$2) OR (w.kind='team' AND ($3='admin' OR EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=w.id AND m.user_id=$2))))`,
      [workspace, user.id, user.role],
    );
    requireValue(row, 404, "内容不存在或无权访问");
  }
  async result(sql: Sql, row: any) {
    return one(
      sql,
      "SELECT a.* FROM assets a JOIN job_assets r ON r.asset_id=a.id WHERE r.job_id=$1 AND r.role='output' ORDER BY a.created_at,a.public_id LIMIT 1",
      [row.id],
    );
  }
  async favorites(sql: Sql, user: Actor, workspace: string) {
    return (
      await sql.query(
        `SELECT j.public_id AS job,a.public_id AS asset FROM favorites f LEFT JOIN jobs j ON j.id=f.job_id AND j.deleted_at IS NULL LEFT JOIN assets a ON a.id=f.asset_id WHERE f.user_id=$1 AND COALESCE(j.workspace_id,a.workspace_id)=$2 ORDER BY f.created_at DESC,f.id DESC`,
        [user.id, workspace],
      )
    ).rows.map((r) => (r.job ? "job:" + r.job : "asset:" + r.asset));
  }
  async changeFavorites(user: Actor, value: unknown, selected?: string) {
    const body = parseBody(value, identityBodies.favorites);
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      // Serialize only this user's favorites, retaining request order for equal timestamps.
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "favorites:" + user.id,
      ]);
      const selections: Selection[] = [];
      for (const key of new Set<string>(body.keys)) {
        const item = await this.resolve(sql, key);
        if (!item.row) {
          requireValue(!body.favorite, 404, "部分资产已删除，请刷新后重试");
          continue;
        }
        await this.access(sql, user, item, workspace.id);
        if (item.kind === "job" && body.favorite)
          requireValue(
            item.row.state === "completed" &&
              (await this.result(sql, item.row)),
            409,
            "只有已完成的作品可以收藏",
          );
        selections.push(item);
      }
      // The same order as bulk deletion prevents a mixed asset/job selection deadlock.
      for (const kind of ["job", "asset"] as const) {
        const ids = [
          ...new Set<string>(
            selections.filter((i) => i.kind === kind).map((i) => i.row.id),
          ),
        ].sort();
        await sql.query(
          `SELECT id FROM ${kind === "job" ? "jobs" : "assets"} WHERE id=ANY($1::uuid[]) ORDER BY id FOR KEY SHARE`,
          [ids],
        );
      }
      for (const key of new Set<string>(body.keys)) {
        const item = await this.resolve(sql, key);
        if (!item.row) {
          requireValue(!body.favorite, 404, "部分资产已删除，请刷新后重试");
          continue;
        }
        const table = item.kind === "job" ? "jobs" : "assets";
        item.row = await one(
          sql,
          `SELECT * FROM ${table} WHERE id=$1${item.kind === "job" ? " AND deleted_at IS NULL" : ""} FOR KEY SHARE`,
          [item.row.id],
        );
        if (!item.row) {
          requireValue(!body.favorite, 404, "部分资产已删除，请刷新后重试");
          continue;
        }
        await this.access(sql, user, item, workspace.id);
        if (item.kind === "job" && body.favorite)
          requireValue(
            item.row.state === "completed" &&
              (await this.result(sql, item.row)),
            409,
            "只有已完成的作品可以收藏",
          );
        const column = item.kind === "job" ? "job_id" : "asset_id";
        if (body.favorite)
          await sql.query(
            `INSERT INTO favorites(user_id,${column}) VALUES($1,$2) ON CONFLICT DO NOTHING`,
            [user.id, item.row.id],
          );
        else
          await sql.query(
            `DELETE FROM favorites WHERE user_id=$1 AND ${column}=$2`,
            [user.id, item.row.id],
          );
      }
      return { favorites: await this.favorites(sql, user, workspace.id) };
    });
  }
  async remove(user: Actor, value: unknown, selected?: string) {
    const body = parseBody(value, identityBodies.assetKeys);
    const outcome = await this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      const keys = [...new Set<string>(body.keys)],
        initial: Selection[] = [];
      // Preserve the original request-order errors before acquiring deterministic row locks.
      for (const key of keys) {
        const item = await this.resolve(sql, key);
        if (!item.row) continue;
        await this.access(sql, user, item, workspace.id);
        requireValue(
          user.role === "admin" || item.row.owner_id === user.id,
          403,
          "所选内容包含其他成员的资产，只有管理员可以删除",
        );
        if (item.kind === "job")
          requireValue(
            terminal.includes(item.row.state),
            409,
            "所选内容包含未完成任务，请先取消或等待生成结束",
          );
        initial.push(item);
      }
      const jobIds = [
        ...new Set<string>(
          initial.filter((i) => i.kind === "job" && i.row).map((i) => i.row.id),
        ),
      ].sort();
      await sql.query(
        "SELECT id FROM jobs WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [jobIds],
      );
      const assetIds = new Set<string>(
        initial.filter((i) => i.kind === "asset" && i.row).map((i) => i.row.id),
      );
      for (const r of (
        await sql.query(
          "SELECT asset_id FROM job_assets WHERE job_id=ANY($1::uuid[]) AND role='output'",
          [jobIds],
        )
      ).rows)
        assetIds.add(r.asset_id);
      const assets = (
        await sql.query(
          "SELECT * FROM assets WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
          [[...assetIds].sort()],
        )
      ).rows;
      const entries = new Set<string>(),
        jobs: string[] = [];
      for (const key of keys) {
        const item = await this.resolve(sql, key);
        if (!item.row) continue;
        await this.access(sql, user, item, workspace.id);
        requireValue(
          user.role === "admin" || item.row.owner_id === user.id,
          403,
          "所选内容包含其他成员的资产，只有管理员可以删除",
        );
        if (item.kind === "job") {
          requireValue(
            terminal.includes(item.row.state),
            409,
            "所选内容包含未完成任务，请先取消或等待生成结束",
          );
          jobs.push(item.row.id);
        }
        entries.add(item.kind + ":" + item.row.id);
      }
      for (const asset of assets) {
        await this.media.protect(sql, asset.id);
        requireValue(
          !(await one(
            sql,
            "SELECT r.job_id FROM job_assets r JOIN jobs j ON j.id=r.job_id WHERE r.asset_id=$1 AND j.deleted_at IS NULL AND NOT(j.id=ANY($2::uuid[])) LIMIT 1",
            [asset.id, jobs],
          )),
          409,
          "所选素材仍被其他作品或任务引用，请先移除相关版本；本次未删除任何内容",
        );
      }
      // A tombstone keeps accepted request identities and immutable ledger foreign keys.
      await sql.query(
        "UPDATE jobs SET deleted_at=clock_timestamp() WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL",
        [jobs],
      );
      await sql.query(
        "DELETE FROM favorites WHERE job_id=ANY($1::uuid[]) OR asset_id=ANY($2::uuid[])",
        [jobs, assets.map((a) => a.id)],
      );
      await sql.query("DELETE FROM job_assets WHERE job_id=ANY($1::uuid[])", [
        jobs,
      ]);
      await sql.query(
        "DELETE FROM document_assets WHERE asset_id=ANY($1::uuid[])",
        [assets.map((a) => a.id)],
      );
      await sql.query("DELETE FROM assets WHERE id=ANY($1::uuid[])", [
        assets.map((a) => a.id),
      ]);
      return {
        deleted: entries.size,
        objects: assets.map((a) => a.object_key as string),
      };
    });
    for (const object of outcome.objects) await this.p.storage.remove(object);
    return { deleted: outcome.deleted };
  }
  async prepareDownload(user: Actor, value: unknown, selected?: string) {
    const body = parseBody(value, identityBodies.assetKeys);
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
          sql,
          user,
          selected,
        ),
        manifest: ArchiveEntry[] = [],
        seen = new Set<string>();
      for (const key of new Set<string>(body.keys)) {
        const item = await this.resolve(sql, key);
        requireValue(item.row, 404, "部分资产已删除，请刷新后重试");
        await this.access(sql, user, item, workspace.id);
        let asset = item.row,
          name = "素材-" + String(item.row.public_id).slice(0, 12);
        if (item.kind === "job") {
          asset = await this.result(sql, item.row);
          requireValue(
            item.row.state === "completed" && item.row.result,
            409,
            "所选内容包含未生成完成的作品，暂时无法下载",
          );
          name =
            (
              { video: "视频", image: "图片", audio: "语音" } as Record<
                string,
                string
              >
            )[item.row.kind] || "作品";
          name += "-" + item.row.public_id;
        }
        requireValue(asset, 404, "部分文件已不存在，请刷新后重试");
        if (seen.has(asset.id)) continue;
        seen.add(asset.id);
        manifest.push(
          archiveEntry(
            asset,
            String(manifest.length + 1).padStart(3, "0") + "-" + name,
          ),
        );
      }
      return this.archiveTicket(sql, user, manifest);
    });
  }
  async archiveTicket(sql: Sql, user: Actor, manifest: ArchiveEntry[]) {
    const secret = randomBytes(32).toString("base64url");
    await sql.query("DELETE FROM download_tickets WHERE expires_at<=now()");
    await sql.query(
      "INSERT INTO download_tickets(key_hash,owner_id,manifest,expires_at) VALUES($1,$2,$3,now()+interval '15 minutes')",
      [hash(secret), user.id, JSON.stringify(manifest)],
    );
    return {
      url: "/api/downloads/" + secret,
      filename: this.filename(manifest),
    };
  }
  private filename(entries: ArchiveEntry[]) {
    return `弗淼-${entries.every((e) => e.name.startsWith("镜头-")) ? "镜头" : "资产"}-${entries.length}项.zip`;
  }
  async download(user: Actor, secret: string, res: Response) {
    const ticket = await one(
      this.p.db,
      "SELECT * FROM download_tickets WHERE key_hash=$1 AND expires_at>now()",
      [hash(secret)],
    );
    requireValue(ticket, 410, "下载链接已过期，请重新选择下载");
    requireValue(ticket.owner_id === user.id, 403, "下载链接不属于当前账户");
    const entries = ticket.manifest as ArchiveEntry[],
      streams: Readable[] = [];
    let closed = false;
    const close = () => {
      closed = true;
      for (const stream of streams) stream.destroy();
    };
    res.once("close", close);
    try {
      const assets = [];
      for (const entry of entries)
        assets.push(await this.media.resource(this.p.db, user, entry.key));
      try {
        for (const asset of assets) {
          if (closed) return;
          const stream = await this.p.storage.stream(asset.object_key);
          streams.push(stream);
          // Prevent unhandled errors while subsequent private objects are opening.
          stream.on("error", () => {});
          if (closed) {
            stream.destroy();
            return;
          }
        }
      } catch {
        throw new DomainError(404, "部分文件暂时无法读取，请重新选择下载");
      }
      res.status(200);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename*=UTF-8''" +
          encodeURIComponent(this.filename(entries)).replace(
            /[!'()*]/g,
            (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
          ),
      );
      res.setHeader("X-Accel-Buffering", "no");
      await pipeline(Readable.from(zipStream(entries, streams)), res).catch(
        (error) => {
          if (!closed) throw error;
        },
      );
    } finally {
      res.off("close", close);
      close();
    }
  }
}
