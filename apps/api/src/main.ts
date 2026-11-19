import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  Module,
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Req,
  Res,
  Param,
  Body,
  Inject,
  All,
} from "@nestjs/common";
import type { Request, Response } from "express";
import express from "express";
import { z, ZodError } from "zod";
import {
  Platform,
  uuid,
  type Actor,
} from "../../../packages/platform/src/platform.js";
import { runtime } from "../../../packages/platform/src/runtime.js";
import {
  configureCapacity,
  capacityMessage,
} from "../../../packages/platform/src/capacity.js";
import {
  DomainError,
  requireValue,
} from "../../../packages/platform/src/security.js";
import { one } from "../../../packages/platform/src/db.js";
import { Payments } from "../../../packages/platform/src/payments.js";
import { packInUse } from "../../../packages/platform/src/packs.js";
import { Operations } from "../../../packages/platform/src/operations.js";
import { GpuGateway } from "../../../packages/platform/src/gpu.js";
import { OriginalSettings } from "../../../packages/original-api/src/settings.js";
import { browserOrigins, secureSessionCookie } from "./browser-origins.js";
const PLATFORM = Symbol("platform");
type AuthRequest = Request & { actor: Actor };
function token(req: Request) {
  return (
    req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("fm_session="))
      ?.slice(11) || ""
  );
}
function nodeToken(req: Request) {
  return req.headers.authorization?.replace(/^Bearer /, "") || "";
}
function wid(req: Request) {
  return uuid.parse(req.headers["x-workspace-id"]);
}
@Controller()
class Api {
  gpu: GpuGateway;
  constructor(@Inject(PLATFORM) private p: Platform) {
    this.gpu = new GpuGateway(p);
  }
  @Get("health") health() {
    return { ok: true, service: "fumiao-advanced" };
  }
  @Post("api/login") async login(
    @Req() req: Request,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const value = await this.p.login(body, req.ip || "unknown");
    res.cookie("fm_session", value, {
      httpOnly: true,
      secure: secureSessionCookie(req.headers.origin),
      sameSite: "strict",
      maxAge: 30 * 86400000,
      path: "/",
    });
    res.json({ ok: true });
  }
  @Post("api/register") register(@Body() body: unknown) {
    return this.p.register(body);
  }
  @Post("api/logout") async logout(@Req() req: Request, @Res() res: Response) {
    await this.p.logout(token(req));
    res.clearCookie("fm_session", { path: "/" }).json({ ok: true });
  }
  @Get("api/me") me(@Req() req: AuthRequest) {
    return req.actor;
  }
  @Get("api/workspaces") workspaces(@Req() req: AuthRequest) {
    return this.p.workspaces(req.actor);
  }
  @Post("api/workspaces") createWorkspace(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.p.createWorkspace(req.actor, body);
  }
  @Put("api/workspaces/:id") updateWorkspace(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.p.updateWorkspace(req.actor, id, body);
  }
  @Get("api/wallet") wallet(@Req() req: AuthRequest) {
    return this.p.wallet(req.actor, wid(req));
  }
  @Get("api/payments") payments(@Req() req: AuthRequest) {
    return new Payments(this.p).list(req.actor, wid(req));
  }
  @Post("api/payments") payment(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return new Payments(this.p).create(req.actor, wid(req), body);
  }
  @Post("api/payments/:id/check") checkPayment(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return new Payments(this.p).refresh(req.actor, id);
  }
  @Put("api/admin/payments/:method") paymentConfig(
    @Req() req: AuthRequest,
    @Param("method") method: string,
    @Body() body: unknown,
  ) {
    return new Payments(this.p).configure(req.actor, method, body);
  }
  @All("api/payments/notify/:method") async paymentCallback(
    @Req() req: Request,
    @Param("method") method: string,
    @Res() res: Response,
  ) {
    try {
      requireValue(["GET", "POST"].includes(req.method), 405, "方法无效");
      await new Payments(this.p).callback(
        method,
        req.method === "GET" ? req.query : req.body,
      );
      res.type("text/plain").send("success");
    } catch {
      res.status(400).type("text/plain").send("fail");
    }
  }
  @Get("api/favorites") async favorites(@Req() req: AuthRequest) {
    return this.p.favorites(req.actor, wid(req));
  }
  @Put("api/favorites/:id") async favorite(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = z.object({ enabled: z.boolean() }).parse(body);
    return this.p.favorite(req.actor, id, input.enabled);
  }
  @Get("api/ledger") ledger(@Req() req: AuthRequest) {
    return this.p.ledger(req.actor, wid(req));
  }
  @Post("api/admin/credits/:id") adjust(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.p.adjustCredits(req.actor, id, body);
  }
  @Put("api/admin/users/:id") updateUser(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return new Operations(this.p).user(req.actor, id, body);
  }
  @Post("api/admin/jobs/:id/resolve") resolveJob(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return new Operations(this.p).resolve(req.actor, id, body);
  }
  @Post("api/admin/connections/:id/upgrade") upgrade(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return new Operations(this.p).upgrade(req.actor, id, body);
  }
  @Get("api/admin/uncertain-jobs") async uncertain(@Req() req: AuthRequest) {
    this.p.admin(req.actor);
    return (
      await this.p.db.query(
        "SELECT id,plugin_id,provider_model,workspace_id,created_at,error,remote_id FROM jobs WHERE state='uncertain' ORDER BY created_at LIMIT 100",
      )
    ).rows;
  }
  @Get("api/workspaces/:id/members") async members(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    this.p.admin(req.actor);
    await this.p.workspace(this.p.db, req.actor, id);
    return (
      await this.p.db.query(
        "SELECT user_id FROM members WHERE workspace_id=$1",
        [id],
      )
    ).rows;
  }
  @Get("api/admin/users") async users(@Req() req: AuthRequest) {
    this.p.admin(req.actor);
    return (
      await this.p.db.query(
        "SELECT id,name,nickname,role,active FROM users ORDER BY created_at",
      )
    ).rows;
  }
  @Get("api/admin/invites") async invites(@Req() req: AuthRequest) {
    this.p.admin(req.actor);
    return (
      await this.p.db.query(
        "SELECT id,name,workspace_id,credits,enabled,expires_at,uses FROM invites",
      )
    ).rows;
  }
  @Post("api/admin/invites") invite(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.p.createInvite(req.actor, body);
  }
  @Delete("api/admin/invites/:id") async disableInvite(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    this.p.admin(req.actor);
    await this.p.db.query(
      "UPDATE invites SET enabled=false,revision=revision+1 WHERE id=$1",
      [uuid.parse(id)],
    );
    return { ok: true };
  }
  @Get("api/admin/studio-catalog") async studioCatalog(
    @Req() req: AuthRequest,
  ) {
    this.p.admin(req.actor);
    const catalog = new OriginalSettings(this.p).catalog;
    return this.p.db.transaction(async (sql) => {
      await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      return {
        model_catalog: await catalog.catalog(sql),
        model_groups: await catalog.groups(sql),
        model_policy: await catalog.policy(sql),
        pricing: await catalog.prices(sql),
      };
    });
  }
  @Patch("api/admin/studio-catalog/models") studioModels(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return new OriginalSettings(this.p).models(req.actor, body);
  }
  @Put("api/admin/studio-catalog/prices") studioPrices(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return new OriginalSettings(this.p).prices(req.actor, body);
  }
  @Get("api/admin/plugins") async plugins(@Req() req: AuthRequest) {
    this.p.admin(req.actor);
    return (
      await this.p.db.query(
        "SELECT * FROM plugin_versions WHERE NOT (manifest ? 'fmworkerResources') ORDER BY id,version",
      )
    ).rows;
  }
  @Post("api/admin/plugins") install(
    @Req() req: AuthRequest,
    @Body() body: any,
  ) {
    this.p.admin(req.actor);
    requireValue(typeof body.endpoint === "string", 400, "需要插件服务地址");
    return this.p.registry.install(this.p.db, body.manifest, body.endpoint);
  }
  @Get("api/admin/connections") connections(@Req() req: AuthRequest) {
    return this.p.connections(req.actor);
  }
  @Post("api/admin/connections") connection(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.p.createConnection(req.actor, body);
  }
  @Put("api/admin/connections/:id") updateConnection(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.p.updateConnection(req.actor, id, body);
  }
  @Post("api/admin/connections/:id/health") test(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.p.connectionHealth(req.actor, id);
  }
  @Get("api/admin/models") async allModels(@Req() req: AuthRequest) {
    this.p.admin(req.actor);
    return (
      await this.p.db.query(
        "SELECT m.*,c.name AS provider FROM models m JOIN connections c ON c.id=m.connection_id ORDER BY c.name,m.label",
      )
    ).rows;
  }
  @Put("api/admin/models/:id") model(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.p.setModel(req.actor, id, body);
  }
  @Put("api/admin/model-permissions/:id") async modelPermission(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    this.p.admin(req.actor);
    const input = z.object({ modelId: uuid, enabled: z.boolean() }).parse(body);
    const w = await this.p.workspace(this.p.db, req.actor, uuid.parse(id));
    requireValue(w.kind === "team", 400, "请设置团队模型权限");
    const model = await one(
      this.p.db,
      "SELECT catalog_id FROM models WHERE id=$1",
      [input.modelId],
    );
    requireValue(model, 404, "模型不存在");
    await this.p.db.query(
      "INSERT INTO model_permissions(workspace_id,model_id,enabled) VALUES($1,$2,$3) ON CONFLICT(workspace_id,model_id) DO UPDATE SET enabled=EXCLUDED.enabled",
      [id, input.modelId, input.enabled],
    );
    return { ok: true };
  }
  @Get("api/models") models(@Req() req: AuthRequest) {
    return this.p.models(req.actor, wid(req));
  }
  @Get("api/jobs") jobs(@Req() req: AuthRequest) {
    return this.p.jobs(req.actor, wid(req));
  }
  @Post("api/jobs") submit(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.p.submit(req.actor, wid(req), body);
  }
  @Post("api/jobs/:id/cancel") cancel(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.p.cancel(req.actor, id);
  }
  @Get("api/assets") assets(@Req() req: AuthRequest) {
    return this.p.assets(req.actor, wid(req));
  }
  @Post("api/assets") upload(@Req() req: AuthRequest, @Body() body: Buffer) {
    requireValue(Buffer.isBuffer(body), 400, "请上传媒体二进制");
    return this.p.upload(
      req.actor,
      wid(req),
      body,
      req.headers["content-type"] || "",
    );
  }
  @Delete("api/assets/:id") removeAsset(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.p.deleteAsset(req.actor, id);
  }
  @Get("media/:id") async media(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const asset = await this.p.asset(req.actor, id);
    res.setHeader("Content-Type", asset.mime);
    res.setHeader("Accept-Ranges", "bytes");
    if (this.p.storage.downloadUrl) {
      res.redirect(307, await this.p.storage.downloadUrl(asset.object_key));
      return;
    }
    const size = Number(asset.size);
    let start = 0,
      end = size - 1;
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        res.status(416).setHeader("Content-Range", `bytes */${size}`);
        res.end();
        return;
      }
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      }
      if (start > end || start >= size) {
        res.status(416).setHeader("Content-Range", `bytes */${size}`);
        res.end();
        return;
      }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    res.setHeader("Content-Length", end - start + 1);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = await this.p.storage.stream(asset.object_key, start, end);
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  }
  @Get("api/documents/:kind") documents(
    @Req() req: AuthRequest,
    @Param("kind") kind: string,
  ) {
    return this.p.documents(req.actor, wid(req), kind);
  }
  @Put("api/documents") saveDocument(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.p.saveDocument(req.actor, wid(req), body);
  }
  @Delete("api/documents/:id") async deleteDocument(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.p.deleteDocument(req.actor, id);
  }

  @Post("api/admin/gpu/pairs") pair(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.gpu.pair(req.actor, body);
  }
  @Get("api/admin/gpu/nodes") async nodes(@Req() req: AuthRequest) {
    this.p.admin(req.actor);
    return (
      await this.p.db.query(
        "SELECT id,connection_id,name,models,enabled,last_seen FROM gpu_nodes",
      )
    ).rows;
  }
  @Delete("api/admin/gpu/nodes/:id") async revoke(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    this.p.admin(req.actor);
    await this.p.db.query("UPDATE gpu_nodes SET enabled=false WHERE id=$1", [
      uuid.parse(id),
    ]);
    return { ok: true };
  }
  @Post("agent/v2/enroll") enroll(@Body() body: unknown) {
    return this.gpu.enroll(body);
  }
  @Post("agent/v2/heartbeat") heartbeat(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.gpu.heartbeat(nodeToken(req), body);
  }
  @Post("agent/v2/claim") claim(@Req() req: Request) {
    return this.gpu.claim(nodeToken(req));
  }
  @Post("agent/v2/jobs/:id/fail") fail(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.gpu.fail(nodeToken(req), id, body);
  }
  @Get("agent/v2/jobs/:id/inputs/:asset") async input(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("asset") aid: string,
    @Res() res: Response,
  ) {
    const result = await this.gpu.input(
      nodeToken(req),
      id,
      String(req.headers["x-job-lease"] || ""),
      aid,
    );
    res.type(result.mime).send(Buffer.from(result.bytes));
  }
  @Put("agent/v2/jobs/:id/result") complete(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: Buffer,
  ) {
    requireValue(Buffer.isBuffer(body), 400, "需要媒体文件");
    return this.gpu.complete(
      nodeToken(req),
      id,
      String(req.headers["x-job-lease"] || ""),
      body,
      {
        sha256: String(req.headers["x-sha256"] || ""),
        report: String(req.headers["x-job-timing"] || ""),
      },
    );
  }
}
export async function createApp(p: Platform) {
  const origins = browserOrigins(
    process.env.PUBLIC_URL || "http://localhost:3000",
  );
  @Module({
    controllers: [Api],
    providers: [{ provide: PLATFORM, useValue: p }],
  })
  class App {}
  const app = await NestFactory.create(App, {
    bodyParser: false,
    logger: ["error", "warn"],
  });
  app.use(async (req: AuthRequest, res: Response, next: () => void) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.headers.origin &&
        !origins.has(req.headers.origin)
      )
        throw new DomainError(403, "请求来源无效");
      const open = ["/health", "/api/login", "/api/register"];
      if (
        !open.includes(req.path) &&
        !req.path.startsWith("/agent/v2/") &&
        !req.path.startsWith("/api/payments/notify/")
      )
        req.actor = await p.actor(token(req));
      if (req.path.startsWith("/agent/v2/") && req.path !== "/agent/v2/enroll")
        await new GpuGateway(p).node(nodeToken(req));
      next();
    } catch (error) {
      const e = error as DomainError;
      res
        .status(e.status || 500)
        .json({ message: e.status ? e.message : "服务错误" });
    }
  });
  app.use(express.json({ limit: "3mb" }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));
  app.use(
    express.raw({
      type: ["image/*", "video/*", "audio/*", "application/octet-stream"],
      limit: "128mb",
    }),
  );
  app.useGlobalFilters({
    catch(error: any, host: any) {
      const res = host.switchToHttp().getResponse();
      const status =
        error instanceof DomainError
          ? error.status
          : error instanceof ZodError
            ? 400
            : error.code === "P1002"
              ? 507
              : error.code === "P1001"
                ? 413
                : ["23505", "P1003"].includes(error.code)
                  ? 409
                  : error.code === "23503"
                    ? 400
                    : error.getStatus?.() || 500;
      res.status(status).json({
        message:
          error instanceof DomainError
            ? error.message
            : error instanceof ZodError
              ? "输入参数无效"
              : status === 507
                ? capacityMessage
                : status === 413
                  ? "工作区存储空间不足或文件过大"
                  : status === 409
                    ? error.code === "P1003"
                      ? packInUse
                      : "记录已存在"
                    : status === 404
                      ? "接口不存在"
                      : "请求处理失败",
      });
      if (status >= 500)
        console.error("Request failed", error.name, error.code || "");
    },
  });
  return app;
}
if (process.argv[1]?.endsWith("main.ts")) {
  const original = process.env.API_PROTOCOL === "original";
  const { studioConfiguration, checkStudio } =
    await import("../../../packages/platform/src/studio-runtime.js");
  if (original) studioConfiguration(process.env);
  const p = runtime();
  try {
    if (original) await checkStudio(p, process.env);
    await configureCapacity(p.db);
  } catch (error) {
    await p.db.close();
    throw error;
  }
  const app = original
    ? await (await import("./original.js")).createOriginalApp(p)
    : await createApp(p);
  await app.listen(
    Number(process.env.PORT || 4000),
    process.env.API_HOST || "0.0.0.0",
  );
  for (const event of ["SIGTERM", "SIGINT"])
    process.on(event, () => {
      void app
        .close()
        .then(() => p.db.close())
        .then(() => process.exit(0));
    });
}
