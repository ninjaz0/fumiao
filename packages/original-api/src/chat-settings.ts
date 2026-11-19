import type { Actor, Platform } from "../../platform/src/platform.js";
import { ChatProviders } from "../../platform/src/chat-providers.js";
import { StudioCatalog } from "../../platform/src/catalog.js";
import { requireValue, DomainError } from "../../platform/src/security.js";
import {
  ChatProbeError,
  OriginalProviderCheckError,
} from "../../plugin-sdk/src/index.js";
import { pythonJson } from "../../plugin-sdk/src/json.js";
import { OriginalIdentity } from "./identity.js";
import { OriginalCredits } from "./credits.js";
export class OriginalChatSettings {
  constructor(readonly p: Platform) {}
  async config(actor: Actor, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      const workspace = await new OriginalIdentity(this.p).activeWorkspace(
        sql,
        actor,
        selected,
      );
      const catalog = new StudioCatalog(this.p.db),
        flags = await catalog.effective(sql, workspace.id),
        providers = await new ChatProviders(this.p).read(sql);
      const models: Record<string, any> = {};
      for (const { plugin, provider, configured, row } of providers.values()) {
        for (const model of plugin.manifest.models.filter((m) =>
          provider.models.includes(m.id),
        )) {
          if (flags[model.id] && configured && row?.enabled !== false)
            models[model.id] = model.studio!.descriptor;
        }
      }
      return {
        models,
        pricing: await catalog.prices(sql),
        credits: await new OriginalCredits(this.p).wallet(
          sql,
          Number(workspace.public_id),
        ),
      };
    });
  }
  async read(actor: Actor) {
    this.p.admin(actor);
    return this.p.db.transaction(async (sql) => ({
      providers: Object.fromEntries(
        [...(await new ChatProviders(this.p).read(sql))].map(([id, c]) => [
          id,
          { label: c.provider.label, configured: c.configured },
        ]),
      ),
    }));
  }
  async save(actor: Actor, name: string, bytes: Buffer) {
    this.p.admin(actor);
    let body: any;
    try {
      body = pythonJson(bytes);
    } catch {
      throw new DomainError(400, "密钥格式无效");
    }
    requireValue(
      body &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        Object.keys(body).length === 1 &&
        typeof body.key === "string" &&
        /^sk-[A-Za-z0-9_-]{16,512}$/.test(body.key) &&
        !body.key.endsWith("\n"),
      400,
      "密钥格式无效",
    );
    return this.p.db.transaction(async (sql) => {
      await sql.query("SELECT price_revision FROM studio_policy FOR SHARE");
      // All original saves serialize with connection creation, including two first saves.
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "original-chat-settings",
      ]);
      const resolved = (await new ChatProviders(this.p).read(sql)).get(name);
      requireValue(resolved, 404, "未知服务");
      const { plugin, provider, row, storedConfig } = resolved;
      const config = plugin.chatConfigure!(storedConfig, body.key);
      if (row) {
        // Lock and re-read before updating so concurrent Advanced configuration edits
        // cannot lose their endpoint/concurrency changes.
        const locked = (
          await sql.query(
            "SELECT config FROM connections WHERE id=$1 FOR UPDATE",
            [row.id],
          )
        ).rows[0];
        requireValue(locked, 409, "连接配置已更新，请刷新");
        await sql.query(
          "UPDATE connections SET config=$2,revision=revision+1 WHERE id=$1",
          [
            row.id,
            this.p.vault.seal(
              plugin.chatConfigure!(this.p.vault.open(locked.config), body.key),
            ),
          ],
        );
        await this.p.audit(sql, actor, "studio.chat-settings", name);
      } else {
        const created = await this.p.createConnectionOn(sql, actor, {
          name: provider.label,
          pluginId: plugin.manifest.id,
          version: plugin.manifest.version,
          config,
          concurrency: 1,
        });
        await sql.query("UPDATE connections SET enabled=true WHERE id=$1", [
          created.id,
        ]);
        await this.p.audit(sql, actor, "studio.chat-settings", name);
      }
      return { configured: true };
    });
  }
  async check(actor: Actor, name: string, signal: AbortSignal) {
    this.p.admin(actor);
    const connection = await this.p.db.transaction(async (sql) => {
      const connection = (await new ChatProviders(this.p).read(sql)).get(name);
      requireValue(connection, 404, "未知服务");
      requireValue(connection.configured, 409, "请先配置密钥");
      return connection;
    });
    try {
      await connection.plugin.chatProbe!(connection.config, signal);
    } catch (error) {
      if (error instanceof ChatProbeError)
        throw new DomainError(502, error.message);
      throw new OriginalProviderCheckError("Internal Server Error", 500);
    }
    return { ok: true };
  }
}
