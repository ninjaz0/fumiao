import { additionalBrowserOrigins } from "./browser-origins.js";
/** Original HTTP contracts backed solely by PostgreSQL. Opt-in until all domains migrate. */
import "reflect-metadata";
import { unescape as decodePath } from "node:querystring";
import { NestFactory } from "@nestjs/core";
import {
  Body,
  Controller,
  Get,
  Head,
  Delete,
  HttpCode,
  Inject,
  Module,
  Param,
  Patch,
  Put,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import express, { type Request, type Response } from "express";
import { Platform } from "../../../packages/platform/src/platform.js";
import { DomainError } from "../../../packages/platform/src/security.js";
import { OriginalIdentity } from "../../../packages/original-api/src/identity.js";
import {
  pathId,
  queryId,
  queryBoolean,
  ValidationError,
} from "../../../packages/original-api/src/validation.js";
import {
  canvasContracts,
  identityContracts,
  validateIdentityRequest,
} from "../../../packages/original-api/src/contracts.js";
import { OriginalCredits } from "../../../packages/original-api/src/credits.js";
import { OriginalSettings } from "../../../packages/original-api/src/settings.js";
import { OriginalImageSettings } from "../../../packages/original-api/src/image-settings.js";
import { OriginalChatSettings } from "../../../packages/original-api/src/chat-settings.js";
import { OriginalProviderCheckError } from "../../../packages/plugin-sdk/src/index.js";
import { OriginalMedia } from "../../../packages/original-api/src/media.js";
import { OriginalLibrary } from "../../../packages/original-api/src/library.js";
import { OriginalUploads } from "../../../packages/original-api/src/uploads.js";
import { OriginalPacks } from "../../../packages/original-api/src/packs.js";
import { OriginalReferences } from "../../../packages/original-api/src/references.js";
import { OriginalJobs } from "../../../packages/original-api/src/jobs.js";
import { OriginalGeneration } from "../../../packages/original-api/src/generation.js";
import { OriginalEstimates } from "../../../packages/original-api/src/estimate.js";
import { OriginalState } from "../../../packages/original-api/src/state.js";
import { OriginalCanvases } from "../../../packages/original-api/src/canvases.js";
import { OriginalCanvasRuns } from "../../../packages/original-api/src/canvas-runs.js";
import { OriginalStoryboardExports } from "../../../packages/original-api/src/storyboard-exports.js";
import { readCanvasBody } from "../../../packages/original-api/src/canvas-http.js";
import type { OriginalDraft } from "../../../packages/plugin-sdk/src/original.js";
import type { ReferenceKind } from "../../../packages/plugin-sdk/src/references.js";
import { capacityMessage } from "../../../packages/platform/src/capacity.js";
import { packInUse } from "../../../packages/platform/src/packs.js";
import {
  OriginalHttpAdapter,
  originalJson,
} from "../../../packages/original-api/src/http.js";
import { OriginalRecharge } from "../../../packages/original-api/src/recharge.js";
import {
  OriginalRechargeController,
  isOriginalRechargeRequest,
  originalRechargeRequest,
} from "./original-recharge.js";
import { OriginalChatController } from "./original-chat.js";
import { OriginalPluginPagesController, isPluginPageAction } from "./original-plugin-pages.js";
import { OriginalProviderController } from "./original-providers.js";
import {
  OriginalNodesController,
  originalNodeRequest,
} from "./original-nodes.js";
import { OriginalAgentController } from "./original-agent.js";
import {
  isOriginalChatRequest,
  originalChatRequest,
} from "./original-chat-request.js";
import { ChatAdoptionDocumentError } from "../../../packages/original-api/src/chat-applications.js";
import {
  originalSessionToken as token,
  originalWorkspace,
  type OriginalAuthRequest,
} from "./original-request.js";
type AuthRequest = OriginalAuthRequest & { draft: OriginalDraft };
function failure(error: any, res: Response) {
  if (res.headersSent || res.destroyed) {
    res.destroy();
    return;
  }
  if (
    error instanceof ChatAdoptionDocumentError ||
    (error instanceof OriginalProviderCheckError && error.status === 500)
  ) {
    res
      .status(500)
      .setHeader("Content-Type", "text/plain; charset=utf-8")
      .end("Internal Server Error");
    return;
  }
  if (error instanceof OriginalProviderCheckError) {
    originalJson(res, { detail: error.message }, 502);
    return;
  }
  const status =
    error instanceof DomainError
      ? error.status
      : ["P1001", "P1002"].includes(error.code)
        ? 507
        : ["23505", "P1003"].includes(error.code)
          ? 409
          : error.getStatus?.() || error.status || 500;
  const detail =
    error instanceof ValidationError
      ? error.detail
      : error instanceof DomainError
        ? error.message
        : status === 507
          ? capacityMessage
          : error.code === "P1003"
            ? packInUse
            : error.code === "23505"
              ? error.constraint === "users_name"
                ? "用户名已被使用"
                : error.constraint === "workspaces_team_name"
                  ? "团队名称已存在"
                  : "记录已存在"
              : status === 404
                ? "Not Found"
                : status === 413
                  ? "Request body too large"
                  : "请求处理失败";
  // FastAPI emits a plain 500 when an original canvas constraint fails.
  if (
    res.locals.originalCanvas &&
    (status === 500 ||
      (error.code === "23505" && error.constraint === "canvas_media_refs_pkey"))
  ) {
    res
      .status(500)
      .type("text/plain; charset=utf-8")
      .end("Internal Server Error");
    return;
  }
  originalJson(res, { detail }, status);
  if (status >= 500)
    console.error("Original API request failed", error.name, error.code || "");
}
@Controller()
class OriginalApi {
  @Get("api/canvases") listCanvases(@Req() req: AuthRequest) {
    return this.canvases.list(
      req.actor,
      this.selected(req, req.headersDistinct["x-workspace-id"]?.[0]),
    );
  }
  @Post("api/canvases")
  @HttpCode(200)
  createCanvas(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.canvases.create(
      req.actor,
      body,
      this.selected(req, req.headersDistinct["x-workspace-id"]?.[0]),
    );
  }
  @Get("api/canvases/:key")
  getCanvas(@Req() req: AuthRequest, @Param("key") key: string) {
    return this.canvases.get(req.actor, key);
  }
  @Put("api/canvases/:key/document")
  saveCanvas(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.canvases.save(req.actor, key, body);
  }
  @Post("api/canvases/:key/duplicate")
  @HttpCode(200)
  duplicateCanvas(@Req() req: AuthRequest, @Param("key") key: string) {
    return this.canvases.duplicate(req.actor, key);
  }
  @Delete("api/canvases/:key")
  deleteCanvas(@Req() req: AuthRequest, @Param("key") key: string) {
    return this.canvases.remove(req.actor, key);
  }
  @Get("api/canvases/:key/runs")
  listCanvasRuns(@Req() req: AuthRequest, @Param("key") key: string) {
    return this.canvasRuns.list(req.actor, key);
  }
  @Get("api/canvases/:key/exports")
  listStoryboardExports(@Req() req: AuthRequest, @Param("key") key: string) {
    return this.storyboardExports.list(req.actor, key);
  }
  @Post("api/canvases/:key/exports")
  @HttpCode(200)
  createStoryboardExport(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.storyboardExports.create(req.actor, key, body);
  }
  @Get("api/storyboard-exports/:key/subtitles")
  async storyboardSubtitles(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Res() res: Response,
  ) {
    const query = new URL(req.originalUrl, "http://localhost").searchParams;
    const format = query.getAll("format").at(-1) === "vtt" ? "vtt" : "srt";
    const subtitles = await this.storyboardExports.subtitles(
      req.actor,
      key,
      format,
    );
    const bytes = Buffer.from(subtitles.body);
    res.setHeader(
      "Content-Type",
      format === "vtt" ? `${subtitles.mime}; charset=utf-8` : subtitles.mime,
    );
    if (subtitles.disposition)
      res.setHeader("Content-Disposition", subtitles.disposition);
    res.setHeader("Content-Length", bytes.length);
    res.end(bytes);
  }
  @Post("api/canvases/:key/shots/download")
  @HttpCode(200)
  downloadCanvasShots(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.canvases.downloadShots(req.actor, key, body);
  }
  @Post("api/canvases/:key/nodes/:node/runs")
  @HttpCode(200)
  generateCanvasRun(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Param("node") node: string,
    @Body() body: unknown,
  ) {
    return this.canvasRuns.generate(req.actor, key, node, body);
  }
  @Post("api/canvases/:key/nodes/:node/candidates")
  @HttpCode(200)
  generateCanvasCandidates(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Param("node") node: string,
    @Body() body: unknown,
  ) {
    return this.canvasRuns.candidates(req.actor, key, node, body);
  }
  @Post("api/canvases/:key/nodes/:node/narration")
  @HttpCode(200)
  generateCanvasNarration(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Param("node") node: string,
    @Body() body: unknown,
  ) {
    return this.canvasRuns.narrate(req.actor, key, node, body);
  }
  @Get("api/chat/config") chatConfig(@Req() req: AuthRequest) {
    return new OriginalChatSettings(this.identity.p).config(
      req.actor,
      this.selected(req),
    );
  }
  @Get("api/admin/chat") chatSettings(@Req() req: AuthRequest) {
    return new OriginalChatSettings(this.identity.p).read(req.actor);
  }
  @Put("api/admin/chat/:provider") chatConfigure(
    @Req() req: AuthRequest,
    @Param("provider") provider: string,
    @Body() body: unknown,
  ) {
    return new OriginalChatSettings(this.identity.p).save(
      req.actor,
      provider,
      Buffer.isBuffer(body) ? body : Buffer.alloc(0),
    );
  }
  @Post("api/admin/chat/:provider/test")
  @HttpCode(200)
  async chatCheck(
    @Req() req: AuthRequest,
    @Param("provider") provider: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const controller = new AbortController(),
      abort = () => controller.abort();
    res.once("close", abort);
    try {
      return await new OriginalChatSettings(this.identity.p).check(
        req.actor,
        provider,
        controller.signal,
      );
    } finally {
      res.off("close", abort);
    }
  }
  @Get("api/state")
  state(@Req() req: AuthRequest) {
    return new OriginalState(this.identity.p).read(
      req.actor,
      this.selected(req),
    );
  }
  @Post("api/estimate")
  @HttpCode(200)
  estimate(@Req() req: AuthRequest, @Body() body: unknown) {
    return new OriginalEstimates(this.identity.p).read(
      req.actor,
      body,
      this.selected(req),
    );
  }
  @Post(["api/jobs", "api/image-jobs", "api/audio-jobs"])
  @HttpCode(200)
  submitJob(@Req() req: AuthRequest) {
    return new OriginalGeneration(this.identity.p).submit(
      req.actor,
      req.draft,
      this.selected(req),
    );
  }
  @Delete("api/jobs/:id")
  removeJob(@Req() req: AuthRequest, @Param("id") id: string) {
    return new OriginalJobs(this.identity.p).remove(
      req.actor,
      pathId(id, "i"),
      this.selected(req),
    );
  }
  @Post("api/jobs/:id/cancel")
  @HttpCode(200)
  cancelJob(@Req() req: AuthRequest, @Param("id") id: string) {
    return new OriginalJobs(this.identity.p).cancel(
      req.actor,
      pathId(id, "i"),
      this.selected(req),
    );
  }
  @Post("api/h3/references")
  @HttpCode(200)
  referenceUpload(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return new OriginalReferences(this.identity.p).upload(
      req.actor,
      req,
      res,
      new URL(req.originalUrl, "http://localhost").searchParams
        .getAll("kind")
        .at(-1) as ReferenceKind,
    );
  }
  private packs: OriginalPacks;
  private uploads: OriginalUploads;
  private library: OriginalLibrary;
  private credits: OriginalCredits;
  private media: OriginalMedia;
  private settings: OriginalSettings;
  private canvases: OriginalCanvases;
  private canvasRuns: OriginalCanvasRuns;
  private storyboardExports: OriginalStoryboardExports;
  constructor(@Inject(OriginalIdentity) private identity: OriginalIdentity) {
    this.packs = new OriginalPacks(identity.p);
    this.uploads = new OriginalUploads(identity.p);
    this.library = new OriginalLibrary(identity.p);
    this.credits = new OriginalCredits(identity.p, identity);
    this.media = new OriginalMedia(identity.p);
    this.settings = new OriginalSettings(identity.p);
    this.canvases = new OriginalCanvases(identity.p);
    this.canvasRuns = new OriginalCanvasRuns(identity.p);
    this.storyboardExports = new OriginalStoryboardExports(identity.p);
  }
  @Post("api/assets")
  @HttpCode(200)
  upload(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    return this.uploads.asset(req.actor, req, res);
  }
  @Put("api/me/avatar")
  avatarUpload(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.uploads.avatar(req.actor, req, res);
  }
  private selected(req: Request, header = req.headers["x-workspace-id"]) {
    return originalWorkspace(req, header);
  }
  @Get("api/asset-packs") listPacks(@Req() req: AuthRequest) {
    return this.packs.list(req.actor, this.selected(req));
  }
  @Post("api/asset-packs")
  @HttpCode(200)
  createPack(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.packs.save(req.actor, body, this.selected(req));
  }
  @Put("api/asset-packs/:key")
  updatePack(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Param("key") key: string,
  ) {
    return this.packs.save(req.actor, body, this.selected(req), key);
  }
  @Delete("api/asset-packs/:key")
  deletePack(@Req() req: AuthRequest, @Param("key") key: string) {
    return this.packs.remove(req.actor, key, this.selected(req));
  }
  @Put("api/favorites") favorites(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.library.changeFavorites(req.actor, body, this.selected(req));
  }
  @Post("api/assets/batch-delete")
  @HttpCode(200)
  batchDelete(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.library.remove(req.actor, body, this.selected(req));
  }
  @Post("api/assets/batch-download")
  @HttpCode(200)
  batchDownload(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.library.prepareDownload(req.actor, body, this.selected(req));
  }
  @Get("api/downloads/:secret") download(
    @Req() req: AuthRequest,
    @Param("secret") secret: string,
    @Res() res: Response,
  ) {
    return this.library.download(req.actor, secret, res);
  }
  @Get("media/:key") mediaFile(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Res() res: Response,
  ) {
    const query = new URL(req.originalUrl, "http://localhost").searchParams;
    return this.media.serve(
      req.actor,
      key,
      queryBoolean(query.getAll("download").at(-1), "download"),
      req,
      res,
    );
  }
  @Get("avatars/:filename") builtinAvatar(
    @Req() req: Request,
    @Param("filename") filename: string,
    @Res() res: Response,
  ) {
    return this.media.builtin(filename, req, res);
  }
  @Get("avatars/uploads/:filename") uploadedAvatar(
    @Req() req: AuthRequest,
    @Param("filename") filename: string,
    @Res() res: Response,
  ) {
    return this.media.avatar(filename, req, res);
  }
  @Delete("api/assets/:key") removeAsset(
    @Req() req: AuthRequest,
    @Param("key") key: string,
  ) {
    const query = new URL(req.originalUrl, "http://localhost").searchParams;
    return this.media.remove(
      req.actor,
      key,
      req.headers["x-workspace-id"]
        ? String(req.headers["x-workspace-id"])
        : query.getAll("workspace").at(-1),
    );
  }
  @Patch("api/settings/models") modelPolicy(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.settings.models(req.actor, body);
  }
  @Put("api/settings/prices") modelPrices(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.settings.prices(req.actor, body);
  }
  @Put("api/settings/openai") imageSettings(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return new OriginalImageSettings(this.identity.p).save(
      req.actor,
      "openai",
      body,
    );
  }
  @Post("api/settings/openai/check")
  @HttpCode(200)
  async imageCheck(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const controller = new AbortController(),
      abort = () => controller.abort();
    res.once("close", abort);
    try {
      return await new OriginalImageSettings(this.identity.p).check(
        req.actor,
        "openai",
        controller.signal,
      );
    } finally {
      res.off("close", abort);
    }
  }
  @Get("api/credits") creditHistory(@Req() req: AuthRequest) {
    const query = new URL(req.originalUrl, "http://localhost").searchParams;
    return this.credits.list(
      req.actor,
      req.headers["x-workspace-id"]
        ? String(req.headers["x-workspace-id"])
        : query.getAll("workspace").at(-1),
      queryId(query.getAll("before").at(-1), "before"),
    );
  }
  @Get("api/admin/credits") creditAccounts(@Req() req: AuthRequest) {
    const query = new URL(req.originalUrl, "http://localhost").searchParams;
    return this.credits.accounts(
      req.actor,
      queryId(query.getAll("workspace").at(-1), "workspace"),
      queryId(query.getAll("before").at(-1), "before"),
    );
  }
  @Post("api/admin/credits/adjust")
  @HttpCode(200)
  adjustCredits(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.credits.adjust(req.actor, body);
  }
  @Get("health") health() {
    return { service: "fumiao", ok: true };
  }
  @Head("health") healthHeaders() {
    return this.health();
  }
  private signedIn(res: Response, value: string) {
    res.cookie("fm_session", value, {
      httpOnly: true,
      secure: process.env.PUBLIC_URL?.startsWith("https:"),
      sameSite: "strict",
      maxAge: 30 * 86400000,
      path: "/",
    });
    originalJson(res, { ok: true });
  }
  @Post("api/login")
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    this.signedIn(res, await this.identity.login(body, req.ip || "unknown"));
  }
  @Post("api/register")
  @HttpCode(200)
  async register(
    @Req() req: Request,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    this.signedIn(res, await this.identity.register(body, req.ip || "unknown"));
  }
  @Post("api/logout")
  @HttpCode(200)
  async logout(@Req() req: Request, @Res() res: Response) {
    await this.identity.logout(token(req));
    res.clearCookie("fm_session", { path: "/" });
    originalJson(res, { ok: true });
  }
  @Get("api/workspaces") workspaces(@Req() req: AuthRequest) {
    return this.identity.workspaces(req.actor);
  }
  @Post("api/workspaces")
  @HttpCode(200)
  createWorkspace(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.identity.createWorkspace(req.actor, body);
  }
  @Patch("api/workspaces/:wid")
  updateWorkspace(
    @Req() req: AuthRequest,
    @Param("wid") id: string,
    @Body() body: unknown,
  ) {
    return this.identity.updateWorkspace(req.actor, pathId(id, "wid"), body);
  }
  @Post("api/workspaces/:wid/select")
  @HttpCode(200)
  selectWorkspace(@Req() req: AuthRequest, @Param("wid") id: string) {
    return this.identity.selectWorkspace(req.actor, pathId(id, "wid"));
  }
  @Get("api/invite-codes") invites(@Req() req: AuthRequest) {
    return this.identity.invites(req.actor);
  }
  @Post("api/invite-codes")
  @HttpCode(200)
  createInvite(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.identity.createInvite(req.actor, body);
  }
  @Patch("api/invite-codes/:i")
  updateInvite(
    @Req() req: AuthRequest,
    @Param("i") id: string,
    @Body() body: unknown,
  ) {
    return this.identity.updateInvite(req.actor, pathId(id, "i"), body);
  }
  @Post(["api/invites", "api/invites/:i/revoke"])
  @HttpCode(200)
  retired(@Req() req: AuthRequest, @Param("i") id?: string) {
    if (id !== undefined) pathId(id, "i");
    this.identity.p.admin(req.actor);
    throw new DomainError(410, "邀请链接已停用，请前往设置中的邀请码管理");
  }
  @Post("api/users")
  @HttpCode(200)
  createMember(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.identity.createMember(req.actor, body);
  }
  @Delete("api/users/:uid")
  deleteMember(@Req() req: AuthRequest, @Param("uid") id: string) {
    return this.identity.deleteMember(req.actor, pathId(id, "uid"));
  }
  @Post("api/users/:uid/password")
  @HttpCode(200)
  resetPassword(
    @Req() req: AuthRequest,
    @Param("uid") id: string,
    @Body() body: unknown,
  ) {
    return this.identity.resetPassword(req.actor, pathId(id, "uid"), body);
  }
  @Post("api/users/:i/disable")
  @HttpCode(200)
  disable(@Req() req: AuthRequest, @Param("i") id: string) {
    return this.identity.disable(req.actor, pathId(id, "i"));
  }
  @Patch("api/me") editProfile(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.identity.editProfile(req.actor, body);
  }
  @Post("api/me/password")
  @HttpCode(200)
  password(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.identity.changePassword(req.actor, token(req), body);
  }
}
export async function createOriginalApp(p: Platform) {
  const identity = new OriginalIdentity(p);
  const site = process.env.PUBLIC_URL || "http://localhost:3000";
  const aliases = additionalBrowserOrigins();
  const recharge = new OriginalRecharge(identity, site);
  @Module({
    controllers: [
      OriginalApi,
      OriginalChatController,
      OriginalProviderController,
      OriginalPluginPagesController,
      OriginalNodesController,
      OriginalAgentController,
      OriginalRechargeController,
    ],
    providers: [
      { provide: OriginalIdentity, useValue: identity },
      { provide: OriginalRecharge, useValue: recharge },
    ],
  })
  class OriginalApp {}
  const app = await NestFactory.create(OriginalApp, new OriginalHttpAdapter(), {
    bodyParser: false,
    logger: ["error", "warn"],
  });
  app.use((req: Request, res: Response, next: () => void) => {
    const origin = req.headers.origin;
    if (
      !["GET", "HEAD"].includes(req.method) &&
      origin &&
      origin !== site &&
      !aliases.has(origin)
    ) {
      originalJson(res, { detail: "来源无效" }, 403);
      return;
    }
    res.set({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    next();
  });
  const parseJSON = express.json({ limit: "3mb", strict: false });
  const parseChatKey = express.raw({ limit: "3mb", type: () => true });
  const prepareChat = originalChatRequest(identity, failure);
  const prepareNodes = originalNodeRequest(identity, failure);
  const prepareRecharge = originalRechargeRequest(identity, failure);
  app.use(async (req: AuthRequest, res: Response, next: () => void) => {
    const path = decodePath(req.path);
    if (await prepareNodes(path, req, res, next)) return;
    if (isOriginalRechargeRequest(path)) {
      await prepareRecharge(req, res, next);
      return;
    }
    if (/^\/api\/(?:canvases|storyboard-exports)(?:\/|$)/i.test(path)) {
      res.locals.originalCanvas = true;
      try {
        const matches = canvasContracts.filter((contract) =>
          contract.path.test(path),
        );
        const contract = matches.find((match) => match.method === req.method);
        if (!contract) {
          if (matches.length) {
            res.setHeader("Allow", matches[0].method);
            throw new DomainError(405, "Method Not Allowed");
          }
          const target = path.replace(/\/+$/, "");
          if (
            target !== path &&
            canvasContracts.some((match) => match.path.test(target))
          ) {
            const query = req.url.slice(req.path.length);
            res
              .status(307)
              .location(req.protocol + "://" + req.get("host") + target + query)
              .end();
            return;
          }
          throw new DomainError(404, "Not Found");
        }
        if (contract.body)
          req.body = await readCanvasBody(req, !!contract.exactIntegers);
        validateIdentityRequest(
          contract,
          path,
          req.body,
          new URL(req.originalUrl, "http://localhost").searchParams,
        );
        req.actor = await identity.actor(token(req));
        // Match the decoded FastAPI path, preserving escaped project IDs for Express.
        req.url =
          path.split("/").map(encodeURIComponent).join("/") +
          req.url.slice(req.path.length);
        next();
      } catch (error) {
        failure(error, res);
      }
      return;
    }
    if (isOriginalChatRequest(req)) {
      await prepareChat(req, res, next);
      return;
    }
    if (req.path === "/api/chat/config") {
      next();
      return;
    }
    // Original chat admin handlers authenticate before reading JSON, and the
    // probe ignores its body entirely. Keep bytes until that ordering is applied.
    if (/^\/api\/admin\/chat(?:\/[^/]+(?:\/test)?)?$/.test(req.path)) {
      if (
        req.method === "PUT" &&
        /^\/api\/admin\/chat\/[^/]+$/.test(req.path)
      ) {
        try {
          p.admin(await identity.actor(token(req)));
        } catch (error) {
          failure(error, res);
          return;
        }
        parseChatKey(req, res, (error) =>
          error ? failure(error, res) : next(),
        );
      } else next();
      return;
    }
    if (
      isPluginPageAction(req) ||
      (req.method === "POST" &&
        ["/api/assets", "/api/h3/references"].includes(req.path)) ||
      (req.method === "PUT" && req.path === "/api/me/avatar") ||
      (req.method === "DELETE" && /^\/api\/users\/[^/]+$/.test(path))
    )
      next();
    else parseJSON(req, res, next);
  });
  app.use(async (req: AuthRequest, res: Response, next: () => void) => {
    try {
      if (req.headers["content-length"] === "0") req.body = undefined;
      const matches = identityContracts.filter((c) => c.path.test(req.path));
      const contract = matches.find((c) => c.method === req.method);
      if (matches.length && !contract) {
        res.setHeader("Allow", matches.map((c) => c.method).join(", "));
        throw new DomainError(405, "Method Not Allowed");
      }
      if (contract) {
        validateIdentityRequest(
          contract,
          req.path,
          req.body,
          new URL(req.originalUrl, "http://localhost").searchParams,
        );
        if (contract.generation)
          req.draft = await new OriginalGeneration(identity.p).parse(
            contract.generation,
            req.body,
          );
        if (contract.imageSettings)
          await new OriginalImageSettings(identity.p).parse(
            contract.imageSettings,
            req.body,
          );
        if (!contract.public) req.actor = await identity.actor(token(req));
      }
      next();
    } catch (error) {
      failure(error, res);
    }
  });
  app.useGlobalFilters({
    catch(error: any, host: any) {
      failure(error, host.switchToHttp().getResponse());
    },
  });
  return app;
}
