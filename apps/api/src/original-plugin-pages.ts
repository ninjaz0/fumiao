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
import {
  DomainError,
  requireValue,
} from "@fumiao/platform/security.js";
import { PluginPages } from "@fumiao/platform/plugin-pages.js";
import { originalSessionToken } from "./original-request.js";

// Read action bodies after authentication so malformed requests also reach the audit log.
export function isPluginPageAction(req: Request) {
  return (
    req.method === "POST" &&
    /^\/api\/plugins\/[^/]+\/pages\/[^/]+\/actions\/[^/]+\/?$/i.test(req.path)
  );
}

@Controller("api/plugins/:plugin/pages/:page")
export class OriginalPluginPagesController {
  private readonly pages: PluginPages;
  constructor(
    @Inject(OriginalIdentity) private readonly identity: OriginalIdentity,
  ) {
    this.pages = new PluginPages(identity.p);
  }

  @Post("view")
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

  @Post("actions/:action")
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
