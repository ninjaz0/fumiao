import { canvasSourceKind } from "@fumiao/plugin-sdk/canvas-ports.js";
import { directorAudioTargets, directorBasis, directorScriptConflict, directorShotIds, directorTargetKey, type DirectorBatchSelection, type DirectorTarget } from "@fumiao/web-compat/director.js";
import { creditUnits, formatCredits } from "@fumiao/platform/credit-amount.js";
import { canvasMediaQuotes } from "./canvas-media-quote.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import { evaluateBudgetImpact } from "@fumiao/platform/budgets.js";
import type { Platform } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { CanvasSubmissionModels } from "@fumiao/platform/canvas-submission.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { ReferencePacks } from "@fumiao/platform/packs.js";
import { DomainError, hash, requireValue } from "@fumiao/platform/security.js";
import { OriginalIdentity, type OriginalActor } from "./identity.js";
import { OriginalCanvases, canvasConflict } from "./canvases.js";
import { resolveDialogueInput } from "./dialogue.js";
import { canvasRawPrompt, inspectDirectorShotInputs, resolveCanvasSources, resolveDirectorInput } from "./director-inputs.js";
import {
  batchQuoteFields,
  canvasBatchFields,
  canvasBatchPrecheckFields,
  parseCanvasDocument,
  type CanvasDocument,
  type CanvasNode,
} from "./canvas-draft.js";
import { canvasDocumentJson } from "./canvas-values.js";
import { parseBody } from "./validation.js";
import { OriginalGeneration, type DirectorGenerationQuote } from "./generation.js";
import { parseDraft } from "./drafts.js";

import { activeCanvasJobStates, readCanvasTail, withTailCount } from "./canvas-tail.js";

export type PrecheckStage = "image" | "video" | "narration" | "dialogue";
export type PrecheckHealth = "ready" | "warning" | "blocked";

export type PrecheckItem = {
  node_id: string;
  line_id?: string;
  title: string;
  node_type: CanvasNode["type"];
  stage: PrecheckStage;
  model: string;
  credits: number;
  exact_credits: string;
  route_revision?: string;
  price_revision_id?: string;
  status: PrecheckHealth;
  issues: string[];
};

export type DirectorTicketItem = { basis: string; quote: DirectorGenerationQuote };
export type DirectorTicket = Record<string, DirectorTicketItem>;

export function directorLinkNode(target: DirectorTarget) {
  if (target.stage === "dialogue") return `dialogue:${target.node_id}:${target.line_id}`;
  if (target.stage === "narration") return `voice:${target.node_id}`;
  return target.node_id;
}

export function normalizeDirectorSelection(selection: DirectorBatchSelection): DirectorBatchSelection {
  for (const target of selection.targets) {
    requireValue((target.stage === "dialogue") === Boolean(target.line_id), 400, "仅对白生成可以选择对应的台词");
  }
  return {
    script_revision: selection.script_revision,
    use_confirmed_script: selection.use_confirmed_script === true,
    targets: [...new Map(selection.targets.map((target) => [directorTargetKey(target), target])).values()],
  };
}

export function canvasBatchRequestHash(body: { node_ids: string[]; stages: PrecheckStage[]; director?: DirectorBatchSelection }) {
  if (body.director) {
    return hash(JSON.stringify(body.director));
  }
  return hash(JSON.stringify({
    node_ids: [...new Set(body.node_ids)].sort(),
    stages: [...new Set(body.stages)].sort(),
  }));
}

export async function validateDirectorSelection(
  sql: Sql,
  canvases: OriginalCanvases,
  project: { workspace_id: string; revision: number },
  document: CanvasDocument,
  revision: number | bigint | null,
  selection: DirectorBatchSelection,
  lock = false,
) {
  requireValue(revision === project.revision, 409, canvasConflict);
  const production = document.director;
  requireValue(production, 409, "已同步剧本版本不一致，请重新预检");
  await validateDirectorScriptRevision(sql, canvases, project.workspace_id, production, selection, lock);
  const ordered = directorShotIds(document.shots ?? [], production);
  requireValue(ordered.length > 0 && ordered.length === production.shot_ids.length &&
    production.order_basis === await directorBasis(ordered), 409, "请先保存并确认本集片单顺序");
  return { production, ordered };
}

export async function validateDirectorScriptRevision(
  sql: Sql,
  canvases: OriginalCanvases,
  workspaceId: string,
  production: NonNullable<CanvasDocument["director"]>,
  selection: { script_revision: number; use_confirmed_script?: boolean },
  lock: boolean,
) {
  requireValue(production.script_revision === selection.script_revision, 409, "已同步剧本版本不一致，请重新确认");
  const script = await canvases.directorScript(sql, workspaceId, production.script_id, lock);
  requireValue(script && script.revision >= production.script_revision, 409, "主剧本文档不存在或版本不可用");
  requireValue(script.revision === production.script_revision || selection.use_confirmed_script, 409, directorScriptConflict);
}

export function directorTargetShots(document: CanvasDocument, ordered: string[], target: DirectorTarget) {
  const node = document.nodes.find(({ id }) => id === target.node_id);
  requireValue(node && node.type === (target.stage === "image" ? "image" : "video"), 400, "生成阶段与节点类型不匹配");
  if (target.stage === "image") {
    const shots = document.edges.filter((edge) =>
      edge.source === node.id && ordered.includes(edge.target) && canvasSourceKind(node, edge.sourcePort) === "image",
    ).map(({ target: id }) => id);
    requireValue(shots.length, 400, "参考图与本集镜头没有关联");
    return { node, shots };
  }
  requireValue(ordered.includes(node.id), 400, "镜头不属于本集");
  return { node, shots: [node.id] };
}

export function requireDirectorAudioTarget(node: CanvasNode, target: DirectorTarget) {
  if (target.stage !== "dialogue" && target.stage !== "narration") return;
  requireValue(directorAudioTargets(node).some((item) => directorTargetKey(item) === directorTargetKey(target)),
    409, "音频目标已移除或不符合本镜策略");
}

export function directorDraft(input: Awaited<ReturnType<typeof resolveDirectorInput>>, catalog: Awaited<ReturnType<StudioCatalog["catalog"]>>, uid: string) {
  return parseDraft(input.stage === "image" || input.stage === "video" ? input.stage : "audio",
    { ...input.payload, uid }, catalog);
}

export function expandGroupNodeIds(
  nodes: CanvasNode[],
  requestedIds: string[],
): CanvasNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const result: CanvasNode[] = [];
  const seen = new Set<string>();
  const addNode = (node: CanvasNode) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    result.push(node);
  };
  for (const id of requestedIds) {
    const node = byId.get(id);
    if (!node) continue;
    if (node.type === "group") {
      for (const child of nodes) {
        if (child.parent_id === node.id && child.type !== "group") {
          addNode(child);
        }
      }
    } else {
      addNode(node);
    }
  }
  return result;
}

export class OriginalBatchPrecheck {
  readonly identity: OriginalIdentity;
  readonly canvases: OriginalCanvases;
  readonly catalog: StudioCatalog;
  readonly packs: ReferencePacks;
  constructor(readonly p: Platform) {
    this.identity = new OriginalIdentity(p);
    this.canvases = new OriginalCanvases(p);
    this.catalog = new StudioCatalog(p.db);
    this.packs = new ReferencePacks(p.db);
  }

  async directorInputs(user: OriginalActor, projectKey: string, nodeId: string) {
    return this.p.db.transaction(async (sql) => {
      await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const project = await this.canvases.project(sql, user, projectKey);
      const doc = parseCanvasDocument(canvasDocumentJson(project.document));
      const node = doc.nodes.find((item) => item.id === nodeId && item.type === "video");
      requireValue(node && doc.director?.shot_ids.includes(nodeId), 404, "本集镜头不存在");
      const bindings = await CanvasSubmissionModels.read(sql, {
        strict: false,
        workspaceId: String(project.workspace_id),
        vault: this.p.vault,
        registry: this.p.registry,
      });
      const inputs = await inspectDirectorShotInputs(sql, { id: project.id, workspace_id: project.workspace_id }, doc, node, bindings, { adoption: true });
      return { revision: Number(project.revision), ...inputs };
    });
  }

  /**
   * F010: Standalone read-only batch credit quote (`POST /api/quotes/batch`).
   * Executes inside a single REPEATABLE READ READ ONLY transaction with zero write locks.
   */
  async quoteBatch(user: OriginalActor, value: unknown, selected?: string) {
    const body = parseBody(value, batchQuoteFields, true) as {
      items: {
        kind: "image" | "video" | "audio";
        model: string;
        seconds?: number;
        quality?: number;
        resolution?: string;
        image_quality?: string;
        ratio?: string;
        count?: number;
        reference_count?: number;
        refs?: string[];
        canvas_tail?: { project: string; parent: string };
        params?: Record<string, unknown>;
      }[];
    };
    return this.p.db.transaction(async (sql) => {
      await sql.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      const bindings = await CanvasSubmissionModels.read(sql, {
        strict: false,
        workspaceId: String(workspace.id),
        vault: this.p.vault,
        registry: this.p.registry,
      });
      const wallet = await one(
        sql,
        "SELECT balance-held AS available FROM wallets WHERE workspace_id=$1",
        [workspace.id],
      );
      const available =
        creditUnits(String(wallet?.available ?? 0));
      let priceRevision = 1;
      let totalUnits = 0n;
      const items = [];
      for (const [index, item] of body.items.entries()) {
        const count = item.count ?? 1;
        let model = item.model;
        if (!model) {
          if (item.kind === "audio") {
            try {
              model = bindings.resolveAudio();
            } catch {
              model = "";
            }
          } else {
            try {
              model = bindings.default(item.kind);
            } catch {
              model = "";
            }
          }
        }
        const params: Record<string, unknown> = {
          ...(item.seconds !== undefined ? { seconds: item.seconds } : {}),
          ...(item.quality !== undefined ? { quality: item.quality } : {}),
          ...(item.resolution ? { resolution: item.resolution } : {}),
          ...(item.image_quality ? { image_quality: item.image_quality } : {}),
          ...(item.ratio ? { ratio: item.ratio } : {}),
        };
        let referenceCount = item.refs ? new Set(item.refs).size : item.reference_count;
        if (item.canvas_tail) {
          const project = await this.canvases.project(sql, user, item.canvas_tail.project);
          requireValue(project.workspace_id === workspace.id, 404, "画布不存在");
          const refs = new Set(item.refs ?? []);
          const tail = await readCanvasTail(sql, project.id, workspace.id, item.canvas_tail.parent, [...refs]);
          referenceCount = withTailCount(refs, tail);
        }
        const q = !model
          ? {
              allowed: false,
              priced: false,
              amount: 0,
              key: null,
              revision: priceRevision,
              reason: `缺少可用的 ${item.kind} 默认模型`,
            }
          : item.kind === "audio" &&
              bindings.isSpeechModel(model) &&
              !bindings.hasEnabledAudio(model)
            ? {
                allowed: false,
                priced: false,
                amount: 0,
                key: null,
                revision: priceRevision,
                reason: "音频配音服务尚未配置或连接已停用",
              }
            : await this.catalog.quoteReadOnly(
                sql,
                model,
                workspace.id,
                params,
                { kind: item.kind, nativeParams: item.params, referenceCount },
              );
        if (item.seconds !== undefined && (item.seconds < 0 || item.seconds > 15))
          requireValue(await one(sql, "SELECT 1 FROM studio_catalog WHERE id=$1 AND plugin_id IS NULL AND descriptor->>'kind'='video'", [model]), 422, "镜头时长超出范围");
        priceRevision = q.revision;
        const subtotal =
          creditUnits(String(q.exactAmount ?? q.amount)) * BigInt(count);
        if (q.allowed && q.priced) totalUnits += subtotal;
        items.push({
          index,
          kind: item.kind,
          model,
          count,
          unit_credits: q.amount,
          exact_unit_credits: String(q.exactAmount ?? q.amount),
          exact_credits: formatCredits(subtotal),
          ...(q.route_revision && { route_revision: q.route_revision, price_revision_id: q.price_revision_id }),
          credits: Number(formatCredits(subtotal)),
          allowed: q.allowed,
          priced: q.priced,
          ...(q.reason ? { reason: q.reason } : {}),
        });
      }
      return {
        price_revision: priceRevision,
        items,
        total_credits: Number(formatCredits(totalUnits)),
        exact_total_credits: formatCredits(totalUnits),
        exact_available_credits: formatCredits(available),
        available_credits: Number(formatCredits(available)),
        sufficient: available >= totalUnits,
      };
    });
  }

  private async directorPrecheck(user: OriginalActor, projectKey: string, revision: number | null, selection: DirectorBatchSelection, requestHash: string) {
    const snapshot = await this.p.db.transaction(async (sql) => {
      await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const project = await this.canvases.project(sql, user, projectKey);
      const document = parseCanvasDocument(canvasDocumentJson(project.document));
      const { production, ordered } = await validateDirectorSelection(sql, this.canvases, { workspace_id: project.workspace_id, revision: project.revision }, document, revision, selection);
      const bindings = await CanvasSubmissionModels.read(sql, {
        strict: false, workspaceId: project.workspace_id, vault: this.p.vault, registry: this.p.registry,
      });
      const catalog = await this.catalog.catalog(sql);
      const generation = new OriginalGeneration(this.p);
      const confirmations = new Map(production.shots?.map((shot) => [shot.node_id, shot]));
      const inputs = new Map<string, Awaited<ReturnType<typeof inspectDirectorShotInputs>>>();
      const inspect = async (id: string) => {
        const cached = inputs.get(id);
        if (cached) return cached;
        const shot = document.nodes.find((node) => node.id === id)!;
        const current = await inspectDirectorShotInputs(sql, { id: project.id, workspace_id: project.workspace_id }, document, shot, bindings);
        inputs.set(id, current);
        return current;
      };
      const imageIds = new Set(selection.targets.filter(({ stage }) => stage === "image").map(({ node_id }) => node_id));
      const busyRows = await sql.query<{ node: string }>(
        `SELECT DISTINCT l.node FROM canvas_job_links l JOIN jobs j ON j.id=l.job_id AND j.deleted_at IS NULL
         WHERE l.project_id=$1 AND j.state=ANY($2::text[]) AND l.node=ANY($3::text[])`,
        [project.id, activeCanvasJobStates, selection.targets.map(directorLinkNode)],
      );
      const busy = new Set(busyRows.rows.map(({ node }) => node));
      const directorItems: DirectorTicket = {};
      const items: PrecheckItem[] = [];
      for (const target of selection.targets) {
        const { node, shots } = directorTargetShots(document, ordered, target);
        const item: PrecheckItem = {
          ...target, title: node.title || node.id, node_type: node.type, model: "", credits: 0, exact_credits: "0", status: "ready", issues: [],
        };
        const line = node.dialogue_lines?.find(({ id }) => id === target.line_id);
        if (line) item.title += ` · ${line.speaker ? line.speaker + "：" : ""}${line.text}`;
        try {
          requireDirectorAudioTarget(node, target);
          let storyConfirmed = false;
          for (const id of shots) {
            const current = await inspect(id);
            if (current.story_basis && current.story_basis === confirmations.get(id)?.story_basis) storyConfirmed = true;
          }
          requireValue(storyConfirmed, 409, "请先确认关联镜头的分镜");
          if (target.stage === "video") {
            requireValue(!document.edges.some((edge) => edge.target === node.id && imageIds.has(edge.source)),
              409, "请先生成并固定本镜参考图，再重新预检视频");
          }
          if (target.stage !== "image") {
            const current = await inspect(node.id);
            requireValue(current.material_basis && current.material_basis === confirmations.get(node.id)?.material_basis,
              409, [...current.visual_issues, ...current.material_issues].join("；") || "素材或声线已变更，请重新确认本镜素材");
          }
          requireValue(!busy.has(directorLinkNode(target)), 409, "此项正在生成，请等待任务结束");
          const input = await resolveDirectorInput(sql, { id: project.id, workspace_id: project.workspace_id }, document, target, bindings);
          item.model = input.payload.model;
          const quote = await generation.quoteDirectorOn(
            sql, user, directorDraft(input, catalog, "00000000-0000-4000-8000-000000000000"),
            String(project.workspace_number), "checked" in input ? input.checked : undefined,
          );
          directorItems[directorTargetKey(target)] = { basis: input.basis, quote };
          const itemExact = quote.exactAmount ?? formatCredits(creditUnits(String(quote.amount)));
          item.exact_credits = itemExact;
          item.credits = Number(itemExact);
          if (quote.routeRevision && quote.priceRevisionId) {
            item.route_revision = quote.routeRevision;
            item.price_revision_id = quote.priceRevisionId;
          }
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          item.status = "blocked";
          item.issues.push(error.message);
        }
        items.push(item);
      }
      const wallet = await one(sql, "SELECT balance-held AS available FROM wallets WHERE workspace_id=$1", [project.workspace_id]);
      const availableUnits = creditUnits(String(wallet?.available ?? 0));
      const availableExact = formatCredits(availableUnits);
      const price = await one(sql, "SELECT price_revision FROM studio_policy");
      const priceRevision = Number(price?.price_revision ?? 1);
      const totalUnits = items.reduce((sum, item) => sum + (item.status === "blocked" ? 0n : creditUnits(item.exact_credits)), 0n);
      const totalExact = formatCredits(totalUnits);
      const budget = await evaluateBudgetImpact(sql, { workspaceId: project.workspace_id, projectId: project.id, amount: totalExact });
      const executableKeys = Object.keys(directorItems);
      const precheckToken = await directorBasis({
        user: user.id, project: project.id, requestHash, revision, priceRevision, directorItems,
      });
      return {
        projectId: project.id,
        directorItems,
        result: {
          revision: Number(project.revision), stale_revision: false, price_revision: priceRevision,
          precheck_token: precheckToken, executable_keys: executableKeys, items,
          summary: {
            total: items.length, ready: executableKeys.length, warning: 0,
            blocked: items.length - executableKeys.length, runnable: executableKeys.length,
            total_credits: Number(totalExact), exact_total_credits: totalExact,
            available_credits: Number(availableExact), exact_available_credits: availableExact,
            sufficient: availableUnits >= totalUnits,
            budget_blocked: budget.blocked, budget_blocks: budget.blocks, budget_warnings: budget.warnings,
          },
        },
      };
    });
    const { result } = snapshot;
    await this.p.db.query(
      `INSERT INTO canvas_precheck_tickets(
         token,owner_id,project_id,revision,price_revision,request_hash,executable_keys,total_credits,budget_blocked,director_items
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (token) DO UPDATE SET created_at=now(),budget_blocked=EXCLUDED.budget_blocked`,
      [result.precheck_token, user.id, snapshot.projectId, result.revision, result.price_revision, requestHash,
        result.executable_keys, result.summary.exact_total_credits, result.summary.budget_blocked, JSON.stringify(snapshot.directorItems)],
    );
    return result;
  }

  /**
   * F010 + F007: Canvas node/group Precheck (`POST /api/canvases/:key/batch-precheck`).
   * Validates prompts, busy jobs, asset pack revisions, ref limits, model permissions,
   * and exact credit cost in a single lock-free REPEATABLE READ READ ONLY transaction.
   */
  async precheckCanvas(user: OriginalActor, projectKey: string, value: unknown) {
    const body = parseBody(value, canvasBatchFields(value, canvasBatchPrecheckFields), true) as {
      expected_revision: number | null;
      node_ids: string[];
      stages: PrecheckStage[];
      director?: DirectorBatchSelection;
    };
    if (body.director) body.director = normalizeDirectorSelection(body.director);
    const requestHash = canvasBatchRequestHash(body);
    if (body.director) return this.directorPrecheck(user, projectKey, body.expected_revision, body.director, requestHash);
    const snapshot = await this.p.db.transaction(async (sql) => {
      await sql.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const project = await this.canvases.project(sql, user, projectKey);
      const doc = parseCanvasDocument(canvasDocumentJson(project.document));
      const targets = expandGroupNodeIds(doc.nodes, body.node_ids);
      requireValue(targets.length > 0, 400, "未找到可预检的目标节点");

      const bindings = await CanvasSubmissionModels.read(sql, {
        strict: false,
        workspaceId: String(project.workspace_id),
        vault: this.p.vault,
        registry: this.p.registry,
      });
      const wallet = await one(
        sql,
        "SELECT balance-held AS available FROM wallets WHERE workspace_id=$1",
        [project.workspace_id],
      );
      const availableCredits =
        creditUnits(String(wallet?.available ?? 0));
      const policyRow = await one(
        sql,
        "SELECT price_revision FROM studio_policy",
      );
      const priceRevision = Number(policyRow?.price_revision ?? 1);
      const staleRevision =
        body.expected_revision !== null &&
        Number(body.expected_revision) !== Number(project.revision);

      // Fetch active jobs for this canvas once (lock-free).
      const busyRows = (
        await sql.query<{ node: string }>(
          `SELECT DISTINCT l.node FROM canvas_job_links l
           JOIN jobs j ON j.id = l.job_id AND j.deleted_at IS NULL
           WHERE l.project_id=$1 AND j.state = ANY($2::text[])`,
          [project.id, activeCanvasJobStates],
        )
      ).rows;
      const busyNodes = new Set(busyRows.map((r) => r.node));

      const items: PrecheckItem[] = [];
      const stages = [...new Set(body.stages)];
      const { executionOrder, quote } = await canvasMediaQuotes(
        sql,
        doc,
        targets,
        {
          projectId: project.id,
          workspaceId: project.workspace_id,
          bindings,
          canvases: this.canvases,
          catalog: this.catalog,
          includesImages: stages.includes("image"),
        },
      );
      for (const node of executionOrder) {
        for (const stage of stages) {
          if (stage === "image" && node.type !== "image") continue;
          if (stage === "video" && node.type !== "video") continue;
          if (
            (stage === "narration" || stage === "dialogue") &&
            node.type !== "video"
          )
            continue;

          const issues: string[] = [];
          let status: PrecheckHealth = "ready";
          let units = 0n;
          let model = "";
          let routeQuote: Pick<PrecheckItem, "price_revision_id" | "route_revision"> | undefined;

          if (staleRevision) {
            issues.push("画布已有新版本，提交前请先同步保存");
            status = "warning";
          }

          if (stage === "image" || stage === "video") {
            const media = await quote(node, stage, busyNodes.has(node.id));
            ({ model, units, routeQuote } = media);
            issues.push(...media.issues);
            if (media.status !== "ready") status = media.status;
          } else if (stage === "narration") {
            if (!pythonStrip(node.narration_text)) {
              issues.push("镜头未填写旁白文本");
              status = "blocked";
            }
            if (busyNodes.has("voice:" + node.id)) {
              issues.push("该镜头旁白正在生成中");
              status = "blocked";
            }
            try {
              model = bindings.resolveAudio((node as any).narration_model);
            } catch {
              model = "";
            }
            if (!model || !bindings.hasEnabledAudio(model)) {
              issues.push(
                model
                  ? "音频配音服务尚未配置或连接已停用"
                  : "音频配音服务尚未配置",
              );
              status = "blocked";
            } else {
              const q = await this.catalog.quoteReadOnly(
                sql,
                model,
                project.workspace_id,
                {},
              );
              if (!q.allowed || !q.priced) {
                issues.push(q.reason || "音频配音服务尚未配置或连接已停用");
                status = "blocked";
              } else {
                units = creditUnits(String(q.exactAmount ?? q.amount));
                if (model === "edge-tts") {
                  issues.push("使用内置免费 Edge TTS 兜底引擎（0 积分）");
                  if (status === "ready") status = "warning";
                }
              }
            }
          } else if (stage === "dialogue") {
            const validLines = (node.dialogue_lines ?? []).filter((l) =>
              Boolean(pythonStrip(l.text)),
            );
            if (!validLines.length) {
              issues.push("镜头未填写多角色对白台词");
              status = "blocked";
            } else {
              // F027 + F010: Quote EACH line using its actual resolved character/explicit voice model!
              let lineCreditsSum = 0n;
              const usedModels = new Set<string>();
              let edgeLineCount = 0;
              for (const line of validLines) {
                if (busyNodes.has(`dialogue:${node.id}:${line.id}`)) {
                  issues.push(`对白「${line.speaker || line.id}」正在生成中`);
                  status = "blocked";
                  continue;
                }
                let lineModel = "";
                try {
                  const input = await resolveDialogueInput(sql, project.workspace_id, line, bindings);
                  lineModel = input.payload.model;
                } catch (error) {
                  if (!(error instanceof DomainError)) throw error;
                }
                if (!lineModel || !bindings.hasEnabledAudio(lineModel)) {
                  issues.push(
                    lineModel
                      ? `对白「${line.speaker || line.id}」(${lineModel})：音频配音服务尚未配置或连接已停用`
                      : `对白「${line.speaker || line.id}」缺少可用的语音配音服务`,
                  );
                  status = "blocked";
                  continue;
                }
                const q = await this.catalog.quoteReadOnly(
                  sql,
                  lineModel,
                  project.workspace_id,
                  {},
                );
                if (!q.allowed || !q.priced) {
                  issues.push(
                    `对白「${line.speaker || line.id}」(${lineModel})：${q.reason || "语音模型不可用"}`,
                  );
                  status = "blocked";
                  continue;
                }
                usedModels.add(lineModel);
                lineCreditsSum += creditUnits(String(q.amount));
                if (lineModel === "edge-tts") edgeLineCount++;
              }
              model = [...usedModels].join(", ");
              units = lineCreditsSum;
              if (status !== "blocked" && edgeLineCount > 0) {
                issues.push(
                  edgeLineCount === validLines.length
                    ? `${validLines.length} 句对白将使用内置免费 Edge TTS（0 积分）`
                    : `其中 ${edgeLineCount}/${validLines.length} 句对白将使用免费 Edge TTS（0 积分）`,
                );
                if (status === "ready") status = "warning";
              }
            }
          }

          items.push({
            node_id: node.id,
            title: node.title || node.id,
            node_type: node.type,
            stage,
            model,
            ...routeQuote,
            exact_credits: status === "blocked" ? "0" : formatCredits(units),
            credits: status === "blocked" ? 0 : Number(formatCredits(units)),
            status,
            issues,
          });
        }
      }

      const targetOrder = new Map(targets.map((node, i) => [node.id, i]));
      items.sort((a,b) => targetOrder.get(a.node_id)! - targetOrder.get(b.node_id)!);
      const readyCount = items.filter((i) => i.status === "ready").length;
      const warningCount = items.filter((i) => i.status === "warning").length;
      const blockedCount = items.filter((i) => i.status === "blocked").length;
      const totalUnits = items.reduce((sum, i) => sum + creditUnits(i.exact_credits), 0n);
      const totalCredits = formatCredits(totalUnits);
      const budgetImpact = await evaluateBudgetImpact(sql, {
        workspaceId: project.workspace_id,
        projectId: String(project.id),
        amount: totalCredits,
      });
      const executableKeys = items
        .filter((i) => i.status !== "blocked")
        .map((i) => `${i.node_id}:${i.stage}`);
      const executableItems = items
        .filter((i) => i.status !== "blocked")
        .map((i) => `${i.node_id}:${i.stage}:${i.model}:${i.exact_credits}`)
        .sort();
      const precheckToken = hash(
        JSON.stringify({
          owner_id: user.id,
          project_id: String(project.id),
          request_hash: requestHash,
          revision: Number(project.revision),
          price_revision: priceRevision,
          // Keep integer precheck tickets issued before precision migration verifiable.
          total_credits: Number.isSafeInteger(Number(totalCredits)) && !totalCredits.includes(".")
            ? Number(totalCredits) : totalCredits,
          executable: executableItems,
        }),
      );

      return {
        projectUuid: String(project.id),
        result: {
          revision: Number(project.revision),
          stale_revision: staleRevision,
          price_revision: priceRevision,
          precheck_token: precheckToken,
          executable_keys: executableKeys,
          items,
          summary: {
            total: items.length,
            ready: readyCount,
            warning: warningCount,
            blocked: blockedCount,
            runnable: readyCount + warningCount,
            total_credits: Number(totalCredits),
            exact_total_credits: totalCredits,
            available_credits: Number(formatCredits(availableCredits)),
            exact_available_credits: formatCredits(availableCredits),
            sufficient: availableCredits >= totalUnits,
            budget_blocked: budgetImpact.blocked,
            budget_blocks: budgetImpact.blocks,
            budget_warnings: budgetImpact.warnings,
          },
        },
      };
    });

    // Persist server-bound precheck ticket outside the read-only snapshot transaction
    // so batchRun enforces the exact server-verified executable set & credit quote.
    const hasTicketTable = Boolean(
      (
        await one(
          this.p.db,
          "SELECT to_regclass('canvas_precheck_tickets') IS NOT NULL AS ok",
        )
      )?.ok,
    );
    if (hasTicketTable) {
      await this.p.db.query(
        `INSERT INTO canvas_precheck_tickets(
           token, owner_id, project_id, revision, price_revision,
           request_hash, executable_keys, total_credits, budget_blocked
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9)
         ON CONFLICT (token) DO UPDATE SET created_at = now()`,
        [
          snapshot.result.precheck_token,
          user.id,
          snapshot.projectUuid,
          snapshot.result.revision,
          snapshot.result.price_revision,
          requestHash,
          snapshot.result.executable_keys,
          snapshot.result.summary.exact_total_credits,
          snapshot.result.summary.budget_blocked,
        ],
      );
    }

    return snapshot.result;
  }
}
