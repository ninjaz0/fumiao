import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { one } from "./db.js";
import { retiredShotPromptPluginId } from "./canvas-node-plugins.js";
import type { Platform, Actor } from "./platform.js";
import { DomainError, requireValue } from "./security.js";
import {
  newer,
  parsePackageFile,
  releaseVersion,
  sourceURL,
  StudioPackages,
} from "./studio-packages.js";

const infoSchema = z.object({
  id: z.string(),
  version: releaseVersion,
  notes: z.string().max(4000),
  package: z.string().min(1).max(2048),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const exec = promisify(execFile);
const limit = 3 * 1024 * 1024;
async function bytes(url: URL, token?: string) {
  const r = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  requireValue(r.ok && r.body, 502, "更新源返回错误");
  const reader = r.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      requireValue(size <= limit, 400, "插件文件过大");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
// All repository reads in one operation use the same detached FETCH_HEAD.
async function readSource(
  source: string,
  token: string | undefined,
  includePackage: boolean,
) {
  const url = new URL(sourceURL.parse(source));
  let dir: string | undefined;
  try {
    let read: (path: string) => Promise<Buffer>;
    if (url.pathname.endsWith(".git")) {
      dir = await mkdtemp(join(tmpdir(), "fumiao-plugin-"));
      const run = async (args: string[]) =>
        (
          await exec("git", args, {
            cwd: dir,
            env: {
              PATH: process.env.PATH,
              HOME: dir,
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_CONFIG_GLOBAL: "/dev/null",
              GIT_TERMINAL_PROMPT: "0",
              GIT_ALLOW_PROTOCOL: "http:https",
              ...(token
                ? {
                    GIT_CONFIG_COUNT: "1",
                    GIT_CONFIG_KEY_0: "http.extraHeader",
                    GIT_CONFIG_VALUE_0:
                      "Authorization: " +
                      (token.includes(":")
                        ? "Basic " + Buffer.from(token).toString("base64")
                        : "Bearer " + token),
                  }
                : {}),
            },
            timeout: 20000,
            maxBuffer: limit,
            encoding: "buffer",
          })
        ).stdout;
      await run(["init", "--bare", "--quiet"]);
      await run([
        "-c",
        "http.followRedirects=false",
        "fetch",
        "--quiet",
        "--no-tags",
        "--depth=1",
        url.href,
        "HEAD",
      ]);
      read = async (path) => {
        requireValue(
          /^[\w./-]+$/.test(path) &&
            !path.startsWith("/") &&
            !path.split("/").includes(".."),
          400,
          "仓库文件路径无效",
        );
        return run(["show", "FETCH_HEAD:" + path]);
      };
    } else {
      read = async (path) => {
        const target = new URL(path, url);
        requireValue(
          target.origin === url.origin && !target.username && !target.password,
          400,
          "插件包与更新清单必须同源",
        );
        return bytes(target, token);
      };
    }
    const manifest = await read(dir ? "update.json" : url.href);
    const info = infoSchema.parse(JSON.parse(manifest.toString("utf8")));
    if (!includePackage) return { info };
    const raw = await read(info.package);
    requireValue(
      createHash("sha256").update(raw).digest("hex") === info.sha256,
      409,
      "插件包校验失败",
    );
    const value: unknown = JSON.parse(raw.toString("utf8"));
    const file = parsePackageFile(value);
    requireValue(
      file.id === info.id && file.version === info.version,
      409,
      "插件文件与更新清单不一致",
    );
    return { info, file: value };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(502, "无法读取更新源，请检查地址、清单和只读凭据");
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
export class StudioUpdates {
  constructor(readonly p: Platform) {}
  async configure(actor: Actor, id: string, value: unknown) {
    this.p.admin(actor);
    requireValue(
      id !== retiredShotPromptPluginId,
      409,
      "镜头提示词示例插件已停用",
    );
    const input = z
      .object({
        revision: z.number().int(),
        url: sourceURL.nullable(),
        token: z
          .string()
          .max(4096)
          .regex(/^[^\r\n]*$/)
          .optional(),
      })
      .parse(value);
    const row = await one(
      this.p.db,
      `UPDATE studio_packages SET update_url=$2,
      update_auth=CASE WHEN $3::text IS NOT NULL THEN $3 WHEN update_url IS DISTINCT FROM $2 OR $4 THEN NULL ELSE update_auth END,
      revision=revision+1,checked_at=NULL,update_info=NULL WHERE id=$1 AND installed AND revision=$5 RETURNING id`,
      [
        id,
        input.url,
        input.token && input.url
          ? this.p.vault.seal({ token: input.token })
          : null,
        input.token !== undefined,
        input.revision,
      ],
    );
    requireValue(row, 409, "更新源已变化，请刷新");
  }
  async check(
    id: string,
    apply?: {
      actor: Actor;
      revision: number;
      sha256: string;
      confirmPublisher?: string;
      supplements?: Record<string, Record<string, unknown>>;
    },
  ) {
    if (apply) this.p.admin(apply.actor);
    requireValue(
      id !== retiredShotPromptPluginId,
      409,
      "镜头提示词示例插件已停用",
    );
    const row = await one(
      this.p.db,
      "SELECT * FROM studio_packages WHERE id=$1 AND installed",
      [id],
    );
    requireValue(row?.update_url, 400, "请先设置更新源");
    if (apply)
      requireValue(
        row.revision === apply.revision &&
          row.update_info?.sha256 === apply.sha256,
        409,
        "请重新检查并确认更新",
      );
    const token = row.update_auth
      ? this.p.vault.open(row.update_auth).token
      : undefined;
    try {
      const { info, file } = await readSource(row.update_url, token, !!apply);
      requireValue(info.id === id, 409, "更新源的插件标识不一致");
      if (apply) {
        requireValue(
          info.sha256 === apply.sha256 &&
            info.version === row.update_info.version &&
            file,
          409,
          "发布内容已变化，请重新检查",
        );
        return new StudioPackages(this.p).install(
          apply.actor,
          file,
          apply.revision,
          false,
          apply.supplements,
          apply.confirmPublisher,
        );
      }
      const update = newer(info.version, row.version) ? info : null;
      await this.p.db.query(
        "UPDATE studio_packages SET checked_at=now(),update_info=$2 WHERE id=$1 AND revision=$3",
        [id, update && JSON.stringify(update), row.revision],
      );
      return update;
    } catch (error) {
      if (!apply)
        await this.p.db.query(
          "UPDATE studio_packages SET checked_at=now(),update_info=$2 WHERE id=$1 AND revision=$3",
          [id, JSON.stringify({ error: "检查更新失败" }), row.revision],
        );
      throw error;
    }
  }
  async review(actor: Actor, id: string) {
    this.p.admin(actor);
    requireValue(
      id !== retiredShotPromptPluginId,
      409,
      "镜头提示词示例插件已停用",
    );
    const row = await one(
      this.p.db,
      "SELECT * FROM studio_packages WHERE id=$1 AND installed",
      [id],
    );
    requireValue(
      row?.update_info?.sha256 && row.update_url,
      409,
      "请先检查更新",
    );
    const { info, file } = await readSource(
      row.update_url,
      row.update_auth ? this.p.vault.open(row.update_auth).token : undefined,
      true,
    );
    requireValue(
      file && info.id === id && info.sha256 === row.update_info.sha256,
      409,
      "更新内容已变化，请重新检查",
    );
    return new StudioPackages(this.p).preview(actor, file);
  }
  async due() {
    // Claim the daily probe before network I/O so worker replicas do not duplicate it.
    const rows = await this.p.db.query(
      `UPDATE studio_packages SET checked_at=now() WHERE id IN (
      SELECT id FROM studio_packages WHERE installed AND NOT removing AND id <> $1 AND update_url IS NOT NULL AND
      (checked_at IS NULL OR checked_at<now()-interval '1 day') ORDER BY checked_at NULLS FIRST LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING id`,
      [retiredShotPromptPluginId],
    );
    await Promise.allSettled(rows.rows.map((r) => this.check(r.id)));
  }
}
