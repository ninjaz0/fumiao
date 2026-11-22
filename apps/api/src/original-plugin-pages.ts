import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { readOriginalBody } from "@fumiao/original-api/canvas-http.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { DomainError, requireValue } from "@fumiao/platform/security.js";
import { resourceAction } from "@fumiao/platform/plugin-extensions.js";
import { PluginMedia } from "@fumiao/platform/plugin-media.js";
import { PluginPages } from "@fumiao/platform/plugin-pages.js";
import { originalSessionToken } from "./original-request.js";

// Read action bodies after authentication so malformed requests also reach the audit log.
export function isPluginPageAction(req: Request) {
  return (
    req.method === "POST" &&
    /^\/api\/plugins\/[^/]+\/pages\/[^/]+\/actions\/[^/]+\/?$/i.test(req.path)
  );
}

@Controller("api/plugins/:plugin")
export class OriginalPluginPagesController {
  private readonly pages: PluginPages;
  constructor(
    @Inject(OriginalIdentity) private readonly identity: OriginalIdentity,
  ) {
    this.pages = new PluginPages(identity.p);
  }

  @Post("actions/:action")
  @HttpCode(200)
  async menu(
    @Req() req: Request,
    @Param("plugin") plugin: string,
    @Param("action") action: string,
    @Body() body: unknown,
  ) {
    const identity = this.identity,
      actor = await identity.actor(originalSessionToken(req));
    const session = new PluginMedia(identity.p.storage);
    try {
      const result = await identity.p.db.transaction(async (sql) => {
        const {
          rows: [current],
        } = await sql.query<typeof actor>(
          "SELECT * FROM users WHERE id=$1 AND active AND deleted_at IS NULL FOR SHARE",
          [actor.id],
        );
        requireValue(current, 401, "请先登录");
        const space = await identity.activeWorkspace(
          sql,
          current,
          req.get("X-Workspace-Id"),
        );
        requireValue(space, 403, "无法访问这个工作区");
        return resourceAction(
          sql,
          session,
          current,
          space.id,
          plugin,
          action,
          body,
        );
      });
      if (result instanceof DomainError) throw result;
      return result;
    } catch (error) {
      await session.rollback();
      throw error;
    }
  }

  @Post("pages/:page/view")
  @HttpCode(200)
  async view(
    @Req() req: Request,
    @Param("plugin") plugin: string,
    @Param("page") page: string,
    @Body() body: unknown,
  ) {
    const actor = await this.identity.actor(originalSessionToken(req));
    requireValue(
      z.object({}).strict().safeParse(body).success,
      400,
      "设置页请求体必须为空对象",
    );
    return this.pages.view(actor, req.get("X-Workspace-Id"), plugin, page);
  }

  @Post("pages/:page/actions/:action")
  @HttpCode(200)
  async action(
    @Req() req: Request,
    @Param("plugin") plugin: string,
    @Param("page") page: string,
    @Param("action") action: string,
  ) {
    const actor = await this.identity.actor(originalSessionToken(req));
    const body = await readOriginalBody(
      req,
      JSON.parse,
      false,
      3 * 1024 * 1024,
    ).catch((error) =>
      error instanceof DomainError && error.status === 413
        ? new DomainError(413, "插件操作请求过大")
        : new DomainError(400, "插件操作请求无效"),
    );
    return this.pages.action(
      actor,
      req.get("X-Workspace-Id"),
      plugin,
      page,
      action,
      body,
    );
  }
}
