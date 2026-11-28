import { runCanvasPlugin } from "@fumiao/original-api/canvas-plugin-runs.js";
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
  Query,
  Req,
  RequestMethod,
  Res,
} from "@nestjs/common";
import express, { type Request, type Response } from "express";
import { Platform } from "@fumiao/platform/platform.js";
import { DomainError } from "@fumiao/platform/security.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import {
  pathId,
  queryId,
  queryBoolean,
  ValidationError,
} from "@fumiao/original-api/validation.js";
import {
  canvasContracts,
  identityContracts,
  validateIdentityRequest,
} from "@fumiao/original-api/contracts.js";
import { OriginalCredits } from "@fumiao/original-api/credits.js";
import { OriginalSettings } from "@fumiao/original-api/settings.js";
import { OriginalImageSettings } from "@fumiao/original-api/image-settings.js";
import { OriginalChatSettings } from "@fumiao/original-api/chat-settings.js";
import { OriginalProviderCheckError } from "@fumiao/plugin-sdk/index.js";
import { OriginalMedia } from "@fumiao/original-api/media.js";
import { OriginalLibrary } from "@fumiao/original-api/library.js";
import { OriginalUploads } from "@fumiao/original-api/uploads.js";
import { OriginalPacks } from "@fumiao/original-api/packs.js";
import { OriginalReferences } from "@fumiao/original-api/references.js";
import { OriginalJobs } from "@fumiao/original-api/jobs.js";
import { OriginalGeneration } from "@fumiao/original-api/generation.js";
import { OriginalEstimates } from "@fumiao/original-api/estimate.js";
import { OriginalState } from "@fumiao/original-api/state.js";
import { OriginalCanvases } from "@fumiao/original-api/canvases.js";
import { OriginalCanvasRuns } from "@fumiao/original-api/canvas-runs.js";
import { OriginalStoryboardExports } from "@fumiao/original-api/storyboard-exports.js";
import { OriginalBatchPrecheck } from "@fumiao/original-api/batch-precheck.js";
import { OriginalScriptDocuments } from "@fumiao/original-api/script-documents.js";
import {
  authorizeTokenHttpRequest,
  OriginalApiTokens,
} from "@fumiao/original-api/tokens.js";
import { OriginalSkills } from "@fumiao/original-api/skills.js";
import {
  OriginalAgentPolicies,
  OriginalCanvasProposals,
} from "@fumiao/original-api/proposals.js";
import { OriginalObservability } from "@fumiao/original-api/admin-observability.js";
import { OriginalBudgets } from "@fumiao/original-api/budgets-api.js";
import { OriginalBillingExtras } from "@fumiao/original-api/billing-extras.js";
import { buildOpenApiSpec } from "@fumiao/original-api/openapi.js";
import { readCanvasBody } from "@fumiao/original-api/canvas-http.js";
import type { OriginalDraft } from "@fumiao/plugin-sdk/original.js";
import type { ReferenceKind } from "@fumiao/plugin-sdk/references.js";
import { capacityMessage } from "@fumiao/platform/capacity.js";
import { packInUse } from "@fumiao/platform/packs.js";
import {
  OriginalHttpAdapter,
  originalJson,
} from "@fumiao/original-api/http.js";
import { OriginalRecharge } from "@fumiao/original-api/recharge.js";
import {
  OriginalRechargeController,
  isOriginalRechargeRequest,
  originalRechargeRequest,
} from "./original-recharge.js";
import { OriginalChatController } from "./original-chat.js";
import { OriginalPluginPagesController, isPluginPageAction } from "./original-plugin-pages.js";
import { OriginalModelAccessController } from "./original-model-access.js";
import { OriginalModelAccess } from "@fumiao/original-api/model-access.js";
import type { HttpTransport } from "@fumiao/platform/plugin-host.js";
import { OriginalProviderController } from "./original-providers.js";
import {
  OriginalNodesController,
  originalNodeRequest,
} from "./original-nodes.js";
import { OriginalAgentController } from "./original-agent.js";
import { OriginalMcpController } from "./original-mcp.js";
import {
  isOriginalChatRequest,
  originalChatRequest,
} from "./original-chat-request.js";
import { ChatAdoptionDocumentError } from "@fumiao/original-api/chat-applications.js";
import {
  originalBearerToken,
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
  const code = error instanceof DomainError ? error.publicCode : undefined;
  originalJson(res, { detail, ...(code ? { code } : {}) }, status);
  if (status >= 500)
    console.error("Original API request failed", error.name, error.code || "");
}
@Controller()
class OriginalApi {
  @Get("api/canvases") listCanvases(@Req() req: AuthRequest) {
    const view = new URL(req.originalUrl, "http://localhost")
      .searchParams.getAll("view").at(-1);
    return this.canvases.list(
      req.actor,
      this.selected(req, req.headersDistinct["x-workspace-id"]?.[0]),
      view === "archived",
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
  @Put("api/canvases/:key/archive")
  archiveCanvas(@Req() req: AuthRequest, @Param("key") key: string) {
    return this.setCanvasArchived(req, key, true);
  }
  @Delete("api/canvases/:key/archive")
  restoreCanvas(@Req() req: AuthRequest, @Param("key") key: string) {
    return this.setCanvasArchived(req, key, false);
  }
  private setCanvasArchived(req: AuthRequest, key: string, archived: boolean) {
    const expectedChange = new URL(req.originalUrl, "http://localhost")
      .searchParams.getAll("expected_archive_change").at(-1);
    return this.canvases.setArchived(req.actor, key, archived, expectedChange);
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
  listStoryboardExports(@Req() req: AuthRequest, @Param("key") key: string, @Query("scope") scope?: string) {
    return this.storyboardExports.list(req.actor, key, scope);
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
  @Post("api/canvases/:key/nodes/:node/execute")
  @HttpCode(200)
  executeCanvasPlugin(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Param("node") node: string,
    @Body() body: unknown,
  ) {
    return runCanvasPlugin(this.canvases, req.actor, key, node, body);
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
  @Post("api/canvases/:key/nodes/:node/dialogue")
  @HttpCode(200)
  generateCanvasDialogue(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Param("node") node: string,
    @Body() body: unknown,
  ) {
    return this.canvasRuns.narrateDialogue(req.actor, key, node, body);
  }
  @Post("api/canvases/:key/bgm")
  @HttpCode(200)
  generateCanvasBgm(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.canvasRuns.generateBgm(req.actor, key, body);
  }
  @Post("api/canvases/:key/nodes/:node/tail-frame")
  @HttpCode(200)
  extractCanvasTailFrame(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Param("node") node: string,
  ) {
    return this.canvases.extractTailFrame(req.actor, key, node);
  }
  @Post("api/canvases/:key/nodes/:node/grid-crop")
  @HttpCode(200)
  cropCanvasGridCell(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Param("node") node: string,
    @Body() body: unknown,
  ) {
    return this.canvases.gridCrop(req.actor, key, node, body);
  }
  @Post("api/canvases/:key/batch-precheck")
  @HttpCode(200)
  precheckCanvasBatch(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.batchPrecheck.precheckCanvas(req.actor, key, body);
  }
  @Get("api/canvases/:key/nodes/:node/director-inputs")
  directorShotInputs(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Param("node") node: string,
  ) {
    return this.batchPrecheck.directorInputs(req.actor, key, node);
  }
  @Post("api/canvases/:key/batch-runs")
  @HttpCode(200)
  runCanvasBatch(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.canvasRuns.batchRun(req.actor, key, body);
  }
  @Get("api/canvases/:key/proposals")
  listCanvasProposals(
    @Req() req: AuthRequest,
    @Param("key") key: string,
  ) {
    return this.proposals.list(req.actor, key);
  }
  @Post("api/canvases/:key/proposals")
  @HttpCode(200)
  createCanvasProposal(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.proposals.create(req.actor, key, body);
  }
  @Post("api/canvases/:key/proposals/:pid/apply")
  @HttpCode(200)
  applyCanvasProposal(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Param("pid") pid: string,
    @Body() body: unknown,
  ) {
    return this.proposals.apply(req.actor, key, pid, body);
  }
  @Post("api/canvases/:key/proposals/:pid/reject")
  @HttpCode(200)
  rejectCanvasProposal(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Param("pid") pid: string,
  ) {
    return this.proposals.reject(req.actor, key, pid);
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
  @Post("api/quotes/batch")
  @HttpCode(200)
  batchQuotes(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.batchPrecheck.quoteBatch(req.actor, body, this.selected(req));
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
  private batchPrecheck: OriginalBatchPrecheck;
  private scriptDocs: OriginalScriptDocuments;
  private apiTokens: OriginalApiTokens;
  private skills: OriginalSkills;
  private proposals: OriginalCanvasProposals;
  private agentPolicies: OriginalAgentPolicies;
  private observability: OriginalObservability;
  private budgets: OriginalBudgets;
  private billingExtras: OriginalBillingExtras;
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
    this.batchPrecheck = new OriginalBatchPrecheck(identity.p);
    this.scriptDocs = new OriginalScriptDocuments(identity.p);
    this.apiTokens = new OriginalApiTokens(identity.p);
    this.skills = new OriginalSkills(identity.p);
    this.proposals = new OriginalCanvasProposals(identity.p);
    this.agentPolicies = new OriginalAgentPolicies(identity.p);
    this.observability = new OriginalObservability(identity.p);
    this.budgets = new OriginalBudgets(identity.p, identity);
    this.billingExtras = new OriginalBillingExtras(identity.p, identity);
  }
  @Get("api/v1/openapi.json")
  openApiSpec(@Req() req: Request) {
    const origin = `${req.protocol}://${req.get("host") || "localhost"}`;
    return buildOpenApiSpec(origin);
  }
  @Get("api/tokens")
  listTokens(@Req() req: AuthRequest) {
    return this.apiTokens.list(req.actor, this.selected(req));
  }
  @Post("api/tokens")
  @HttpCode(200)
  createToken(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.apiTokens.create(req.actor, body, this.selected(req));
  }
  @Delete("api/tokens/:id")
  revokeToken(@Req() req: AuthRequest, @Param("id") id: string) {
    return this.apiTokens.revoke(req.actor, id, this.selected(req));
  }
  @Get("api/skills")
  listSkills(@Req() req: AuthRequest) {
    return this.skills.list(req.actor, this.selected(req));
  }
  @Post("api/skills")
  @HttpCode(200)
  createSkill(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.skills.create(req.actor, body, this.selected(req));
  }
  @Post("api/skills/import-zip")
  @HttpCode(200)
  importSkillZip(@Req() req: AuthRequest, @Body() body: unknown) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    return this.skills.importZip(req.actor, bytes, this.selected(req));
  }
  @Put("api/skills/:key")
  updateSkill(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.skills.update(req.actor, key, body);
  }
  @Delete("api/skills/:key")
  removeSkill(@Req() req: AuthRequest, @Param("key") key: string) {
    return this.skills.remove(req.actor, key);
  }
  @Get("api/workspace/agent-policy")
  getAgentPolicy(@Req() req: AuthRequest) {
    return this.agentPolicies.get(req.actor, this.selected(req));
  }
  @Put("api/workspace/agent-policy")
  setAgentPolicy(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.agentPolicies.set(req.actor, body, this.selected(req));
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
  @Post("api/asset-packs/:key/lock")
  @HttpCode(200)
  lockPack(@Req() req: AuthRequest, @Param("key") key: string) {
    return this.packs.setLock(req.actor, key, true, this.selected(req));
  }
  @Post("api/asset-packs/:key/unlock")
  @HttpCode(200)
  unlockPack(@Req() req: AuthRequest, @Param("key") key: string) {
    return this.packs.setLock(req.actor, key, false, this.selected(req));
  }
  @Put("api/asset-packs/:key/scope")
  setPackScope(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.packs.setScope(req.actor, key, body, this.selected(req));
  }
  @Post("api/asset-packs/:key/turnaround")
  @HttpCode(200)
  packTurnaround(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.packs.turnaround(req.actor, key, body, this.selected(req));
  }
  @Get("api/workspace/scripts")
  listWorkspaceScripts(@Req() req: AuthRequest) {
    return this.scriptDocs.list(req.actor, this.selected(req));
  }
  @Post("api/workspace/scripts")
  @HttpCode(200)
  createWorkspaceScript(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.scriptDocs.create(req.actor, body, this.selected(req));
  }
  @Post("api/workspace/scripts/suite")
  @HttpCode(200)
  createWorkspaceScriptSuite(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.scriptDocs.createSuite(req.actor, body, this.selected(req));
  }
  @Post("api/workspace/scripts/search")
  @HttpCode(200)
  searchWorkspaceScripts(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.scriptDocs.search(req.actor, body, this.selected(req));
  }
  @Post("api/workspace/scripts/replace")
  @HttpCode(200)
  replaceWorkspaceScripts(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.scriptDocs.replace(req.actor, body, this.selected(req));
  }
  @Get("api/workspace/scripts/:key")
  getWorkspaceScript(@Req() req: AuthRequest, @Param("key") key: string) {
    return this.scriptDocs.get(req.actor, key, this.selected(req));
  }
  @Put("api/workspace/scripts/:key")
  updateWorkspaceScript(
    @Req() req: AuthRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.scriptDocs.update(req.actor, key, body, this.selected(req));
  }
  @Delete("api/workspace/scripts/:key")
  removeWorkspaceScript(@Req() req: AuthRequest, @Param("key") key: string) {
    const sp = new URL(req.originalUrl, "http://localhost").searchParams;
    const recursive = sp.get("recursive") === "true";
    const parseOptInt = (name: string): number | undefined => {
      const raw = sp.get(name);
      if (raw === null || raw === "") return undefined;
      const n = Number(raw);
      return Number.isInteger(n) && n >= 0 ? n : undefined;
    };
    const sigRaw = sp.get("expected_descendant_sig")?.trim();
    return this.scriptDocs.remove(req.actor, key, recursive, this.selected(req), {
      expectedRevision: parseOptInt("expected_revision"),
      expectedDescendants: parseOptInt("expected_descendants"),
      expectedRevisionSum: parseOptInt("expected_revision_sum"),
      ...(sigRaw ? { expectedDescendantSig: sigRaw } : {}),
    });
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
    const rawVariant = query.getAll("variant").at(-1);
    const variant =
      rawVariant === "thumb" || rawVariant === "poster"
        ? rawVariant
        : undefined;
    return this.media.serve(
      req.actor,
      key,
      queryBoolean(query.getAll("download").at(-1), "download"),
      req,
      res,
      variant,
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
  @Get("api/admin/observability/summary")
  observabilitySummary(@Req() req: AuthRequest) {
    const query = new URL(req.originalUrl, "http://localhost").searchParams;
    const days = queryId(query.getAll("days").at(-1), "days");
    return this.observability.summary(req.actor, days);
  }
  @Get("api/admin/observability/uncertain")
  observabilityUncertain(@Req() req: AuthRequest) {
    return this.observability.uncertainJobs(req.actor);
  }
  @Post("api/admin/observability/jobs/:id/reconcile")
  @HttpCode(200)
  reconcileJob(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.observability.reconcileJob(req.actor, id, body);
  }
  @Get("api/budgets")
  listBudgets(@Req() req: AuthRequest) {
    return this.budgets.list(req.actor, this.selected(req));
  }
  @Put("api/budgets")
  upsertBudget(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.budgets.upsertPolicy(req.actor, body, this.selected(req));
  }
  @Put("api/budgets/moderation")
  updateModeration(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.budgets.updateModeration(req.actor, body, this.selected(req));
  }
  @Get("api/admin/redeem-codes")
  listRedeemCodes(@Req() req: AuthRequest) {
    return this.billingExtras.listRedeemCodes(req.actor);
  }
  @Post("api/admin/redeem-codes/batch")
  @HttpCode(200)
  createRedeemBatch(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.billingExtras.createRedeemBatch(req.actor, body);
  }
  @Post("api/admin/redeem-codes/:id/disable")
  @HttpCode(200)
  disableRedeemCode(@Req() req: AuthRequest, @Param("id") id: string) {
    return this.billingExtras.disableRedeemCode(req.actor, id);
  }
  @Post("api/redeem")
  @HttpCode(200)
  applyRedeemCode(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.billingExtras.redeem(req.actor, body, this.selected(req));
  }
  @Get("api/invites/rewards")
  listInviteRewards(@Req() req: AuthRequest) {
    return this.billingExtras.inviteRewards(req.actor);
  }
  @Post("api/invites/rewards/claim")
  @HttpCode(200)
  claimInviteRewards(@Req() req: AuthRequest) {
    return this.billingExtras.claimInviteRewards(req.actor, this.selected(req));
  }
  @Get("api/subscriptions/plans")
  listSubscriptionPlans(@Req() req: AuthRequest) {
    return this.billingExtras.listPlans(req.actor, this.selected(req));
  }
  @Post("api/admin/subscriptions/plans")
  @HttpCode(200)
  createSubscriptionPlan(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.billingExtras.createPlan(req.actor, body);
  }
  @Post("api/subscriptions/subscribe")
  @HttpCode(200)
  subscribePlan(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.billingExtras.subscribe(req.actor, body, this.selected(req));
  }
  @Get("api/credits/statement")
  async creditStatement(@Req() req: AuthRequest, @Res() res: Response) {
    const query = new URL(req.originalUrl, "http://localhost").searchParams;
    const format = query.getAll("format").at(-1) === "pdf" ? "pdf" : "csv";
    const from = query.getAll("from").at(-1)?.trim() || undefined;
    const to = query.getAll("to").at(-1)?.trim() || undefined;
    const result = await this.billingExtras.exportStatement(
      req.actor,
      format,
      this.selected(req),
      { from, to },
    );
    res.setHeader("Content-Type", result.mime);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    );
    res.setHeader("X-Total-Count", String(result.totalCount));
    res.setHeader("X-Exported-Count", String(result.exportedCount));
    res.setHeader("X-Truncated", result.truncated ? "true" : "false");
    if (result.from) res.setHeader("X-Statement-From", result.from);
    if (result.to) res.setHeader("X-Statement-To", result.to);
    res.setHeader("Content-Length", result.bytes.length);
    res.end(result.bytes);
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
export async function createOriginalApp(
  p: Platform,
  options: { modelAccessHttp?: HttpTransport<string | Uint8Array> } = {},
) {
  const identity = new OriginalIdentity(p);
  const site = process.env.PUBLIC_URL || "http://localhost:3000";
  const aliases = additionalBrowserOrigins();
  const recharge = new OriginalRecharge(identity, site);
  @Module({
    controllers: [
      OriginalApi,
      OriginalChatController,
      OriginalProviderController,
      OriginalModelAccessController,
      OriginalPluginPagesController,
      OriginalNodesController,
      OriginalAgentController,
      OriginalMcpController,
      OriginalRechargeController,
    ],
    providers: [
      { provide: OriginalIdentity, useValue: identity },
      {
        provide: OriginalModelAccess,
        useValue: new OriginalModelAccess(identity, options.modelAccessHttp),
      },
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
  const parseSkillZip = express.raw({ limit: "300kb", type: () => true });
  const apiTokens = new OriginalApiTokens(p);
  const agentPolicies = new OriginalAgentPolicies(p);
  const tokenActorWithAgent = (
    auth: NonNullable<AuthRequest["tokenAuth"]>,
    req: AuthRequest,
  ) => {
    const headerPid = req.headers["x-approved-proposal-id"];
    const bodyPid =
      req.body &&
      typeof req.body === "object" &&
      !Array.isArray(req.body) &&
      typeof (req.body as Record<string, unknown>).approved_proposal_id ===
        "string"
        ? String((req.body as Record<string, unknown>).approved_proposal_id)
        : "";
    const approvedProposalId =
      typeof headerPid === "string" && headerPid.trim()
        ? headerPid.trim()
        : bodyPid.trim() || null;
    return {
      ...auth.actor,
      agentAction: {
        source: "token" as const,
        approvedProposalId,
      },
    };
  };
  const authenticate = async (req: AuthRequest, normalizedPath: string) => {
    const bearer = originalBearerToken(req);
    if (bearer) {
      let auth = req.tokenAuth;
      if (!auth) {
        const requestedWs = req.headers["x-workspace-id"]
          ? String(req.headers["x-workspace-id"])
          : new URL(req.originalUrl, "http://localhost").searchParams
              .getAll("workspace")
              .at(-1);
        auth = await apiTokens.authenticateBearer(bearer, requestedWs);
        req.tokenAuth = auth;
      }
      const rule = authorizeTokenHttpRequest(auth, req.method, normalizedPath);
      const actor = tokenActorWithAgent(auth, req);
      if (rule.paidAgentAction) {
        // Fast-fail on plan_only / missing-cap / missing proposal header; authoritative locked
        // target project/node/budget check runs inside acceptTask() & runCanvasPlugin().
        const policy = await agentPolicies.readPolicy(p.db, auth.workspaceId);
        if (policy === "plan_only") {
          await agentPolicies.enforceForAgentAction(p.db, auth.workspaceId, {
            approvedProposalId: actor.agentAction?.approvedProposalId ?? null,
          });
        } else if (policy === "auto_within_budget") {
          await agentPolicies.enforceForAgentAction(p.db, auth.workspaceId);
        } else if (policy === "propose_and_confirm") {
          if (!actor.agentAction?.approvedProposalId) {
            await agentPolicies.enforceForAgentAction(p.db, auth.workspaceId, {
              approvedProposalId: null,
            });
          }
        }
      }
      return actor;
    }
    return identity.actor(token(req));
  };
  const prepareChat = originalChatRequest(identity, failure);
  const prepareNodes = originalNodeRequest(identity, failure);
  const prepareRecharge = originalRechargeRequest(identity, failure);
  app.use(async (req: AuthRequest, res: Response, next: () => void) => {
    const path = decodePath(req.path);
    // Reject Bearer tokens on browser-session-only endpoints (admin, chat, recharge, tokens, etc.)
    // before specialized sub-routers run, while letting valid /api/mcp and allowlisted routes proceed.
    if (originalBearerToken(req) && path !== "/api/mcp") {
      try {
        const requestedWs = req.headers["x-workspace-id"]
          ? String(req.headers["x-workspace-id"])
          : new URL(req.originalUrl, "http://localhost").searchParams
              .getAll("workspace")
              .at(-1);
        const auth = await apiTokens.authenticateBearer(
          originalBearerToken(req),
          requestedWs,
        );
        const rule = authorizeTokenHttpRequest(auth, req.method, path);
        req.tokenAuth = auth;
        req.actor = tokenActorWithAgent(auth, req);
        if (rule.paidAgentAction) {
          const policy = await agentPolicies.readPolicy(p.db, auth.workspaceId);
          if (policy === "plan_only" || policy === "auto_within_budget") {
            await agentPolicies.enforceForAgentAction(p.db, auth.workspaceId);
          }
        }
      } catch (error) {
        failure(error, res);
        return;
      }
    }
    if (/^\/api\/admin\/model-access(?:\/|$)/i.test(path)) {
      try {
        req.actor = await identity.actor(token(req));
        p.admin(req.actor);
      } catch (error) {
        failure(error, res);
        return;
      }
    }
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
        req.actor = await authenticate(req, path);
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
    if (req.method === "POST" && req.path === "/api/skills/import-zip") {
      parseSkillZip(req, res, (error) => (error ? failure(error, res) : next()));
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
        if (!contract.public) req.actor = await authenticate(req, req.path);
      } else if (req.tokenAuth) {
        req.actor = tokenActorWithAgent(req.tokenAuth, req);
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

const NEST_METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.PUT]: "PUT",
  [RequestMethod.DELETE]: "DELETE",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.HEAD]: "HEAD",
  [RequestMethod.OPTIONS]: "OPTIONS",
};

/**
 * Reflects the live NestJS controller route table so tests can verify
 * `TOKEN_REST_ALLOWLIST` and `buildOpenApiSpec()` stay 1-to-1 with real controllers.
 */
export function listRegisteredOriginalRoutes(): Array<{
  method: string;
  template: string;
}> {
  const controllers = [
    OriginalApi,
    OriginalMcpController,
    OriginalChatController,
    OriginalNodesController,
    OriginalPluginPagesController,
    OriginalProviderController,
    OriginalModelAccessController,
    OriginalRechargeController,
    OriginalAgentController,
  ];
  const out: Array<{ method: string; template: string }> = [];
  for (const ctrl of controllers) {
    const prefixRaw = Reflect.getMetadata("path", ctrl);
    const prefixes = Array.isArray(prefixRaw)
      ? prefixRaw.map(String)
      : [typeof prefixRaw === "string" ? prefixRaw : ""];
    for (const key of Object.getOwnPropertyNames(ctrl.prototype)) {
      if (key === "constructor") continue;
      const fn = (ctrl.prototype as unknown as Record<string, unknown>)[key];
      if (typeof fn !== "function") continue;
      const methodNum = Reflect.getMetadata("method", fn);
      const pathRaw = Reflect.getMetadata("path", fn);
      if (methodNum === undefined || pathRaw === undefined) continue;
      const method = NEST_METHOD_NAMES[methodNum];
      if (!method) continue;
      const paths = Array.isArray(pathRaw)
        ? pathRaw.map(String)
        : [String(pathRaw)];
      for (const prefix of prefixes) {
        for (const sub of paths) {
          const joined =
            "/" +
            [prefix, sub]
              .map((s) => s.replace(/^\/+|\/+$/g, ""))
              .filter(Boolean)
              .join("/");
          out.push({ method, template: joined });
        }
      }
    }
  }
  return out;
}
