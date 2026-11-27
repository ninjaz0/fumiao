import { creditUnits, formatCredits } from "@fumiao/platform/credit-amount.js";
import { canvasShotOrder, canvasSourceKind, tailParentNode } from "@fumiao/plugin-sdk/canvas-ports.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import { evaluateBudgetImpact } from "@fumiao/platform/budgets.js";
import type { Platform } from "@fumiao/platform/platform.js";
import { one } from "@fumiao/platform/db.js";
import { CanvasSubmissionModels } from "@fumiao/platform/canvas-submission.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { ReferencePacks } from "@fumiao/platform/packs.js";
import { hash, requireValue } from "@fumiao/platform/security.js";
import { OriginalIdentity, type OriginalActor } from "./identity.js";
import { OriginalCanvases } from "./canvases.js";
import { resolveSpeakerVoice } from "./dialogue.js";
import {
  batchQuoteFields,
  canvasBatchPrecheckFields,
  parseCanvasDocument,
  type CanvasNode,
} from "./canvas-draft.js";
import { canvasMediaParameters, canvasDocumentJson } from "./canvas-values.js";
import { parseBody } from "./validation.js";

import { activeCanvasJobStates, readCanvasTail, withTailCount } from "./canvas-tail.js";

export type PrecheckStage = "image" | "video" | "narration" | "dialogue";
export type PrecheckHealth = "ready" | "warning" | "blocked";

export type PrecheckItem = {
  node_id: string;
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

  /**
   * F010 + F007: Canvas node/group Precheck (`POST /api/canvases/:key/batch-precheck`).
   * Validates prompts, busy jobs, asset pack revisions, ref limits, model permissions,
   * and exact credit cost in a single lock-free REPEATABLE READ READ ONLY transaction.
   */
  async precheckCanvas(user: OriginalActor, projectKey: string, value: unknown) {
    const body = parseBody(value, canvasBatchPrecheckFields, true) as {
      expected_revision: number | null;
      node_ids: string[];
      stages: PrecheckStage[];
    };
    const requestHash = hash(
      JSON.stringify({
        node_ids: [...new Set(body.node_ids)].sort(),
        stages: [...new Set(body.stages)].sort(),
      }),
    );
    const snapshot = await this.p.db.transaction(async (sql) => {
      await sql.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const project = await this.canvases.project(sql, user, projectKey);
      const doc = parseCanvasDocument(canvasDocumentJson(project.document));
      const nodesById = new Map(doc.nodes.map((n) => [n.id, n]));
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

      // Check referenced AssetPack revisions once.
      const packPublicIds = [
        ...new Set(targets.flatMap((n) => n.asset_packs.map((p) => p.id))),
      ];
      const livePackRevisions = new Map<
        string,
        { revision: number; name: string; media: string[] }
      >();
      if (packPublicIds.length) {
        const pRows = (
          await sql.query(
            `SELECT d.public_id, d.title, d.revision, d.pack_text,
             ARRAY(SELECT a.public_id FROM jsonb_array_elements_text(d.body->'assets') AS ids(id) JOIN assets a ON a.id=ids.id::uuid) AS media
             FROM documents d
             LEFT JOIN asset_pack_meta m ON m.pack_id=d.id
             WHERE d.public_id = ANY($1::text[]) AND d.kind='pack' AND NOT d.deleted
             AND (d.workspace_id=$2 OR COALESCE(m.scope,'workspace')='global')`,
            [packPublicIds, project.workspace_id],
          )
        ).rows;
        for (const r of pRows) {
          livePackRevisions.set(r.public_id, {
            revision: Number(r.revision),
            name: r.pack_text?.name ?? r.title,
            media: r.media,
          });
        }
      }

      const items: PrecheckItem[] = [];
      const stages = [...new Set(body.stages)];

      const shotOrder = new Map(canvasShotOrder(doc).map((id, i) => [id, i]));
      const plannedVideos = new Set<string>();
      // Evaluate parent video stages in dispatch order, then restore the request's display order.
      const executionOrder = [...targets].sort((a, b) =>
        (shotOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (shotOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER));
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
            if (busyNodes.has(node.id)) {
              issues.push("该节点当前有运行中的任务");
              status = "blocked";
            }
            const connectedTexts: string[] = [];
            const refIds = new Set<string>();
            for (const edge of doc.edges) {
              if (edge.target !== node.id) continue;
              const src = nodesById.get(edge.source);
              if (!src) continue;
              const srcKind = canvasSourceKind(src, edge.sourcePort);
              if (srcKind === "text") {
                const txt = pythonStrip(src.text);
                if (!txt) {
                  issues.push(`上游文本节点「${src.title || src.id}」为空`);
                  status = "blocked";
                } else {
                  connectedTexts.push(txt);
                }
              } else if (srcKind === "image") {
                const media = src.extension ? src.extension.result?.[edge.sourcePort ?? ""] : await this.canvases.mediaForNode(
                  sql,
                  project.id,
                  src,
                );
                refIds.add(media || "pending:" + src.id + ":" + (edge.sourcePort ?? ""));
                if (!media) {
                  // If upstream image is also being run in this batch, warn instead of hard block!
                  if (
                    stages.includes("image") &&
                    targets.some((t) => t.id === src.id)
                  ) {
                    issues.push(
                      `依赖上游图片「${src.title || src.id}」，将按顺序先生成图片`,
                    );
                    if (status === "ready") status = "warning";
                  } else {
                    issues.push(`上游参考图「${src.title || src.id}」尚未就绪`);
                    status = "blocked";
                  }
                }
              }
            }
            const combinedPrompt = [
              ...connectedTexts,
              ...(pythonStrip(node.prompt) ? [pythonStrip(node.prompt)] : []),
            ].join("\n\n");
            if (!combinedPrompt) {
              issues.push("缺少提示词或连接的上游文本");
              status = "blocked";
            } else if ([...combinedPrompt].length > 12000) {
              issues.push("提示词超过 12000 字上限");
              status = "blocked";
            }


            for (const sel of node.asset_packs) {
              const live = livePackRevisions.get(sel.id);
              if (!live) {
                issues.push(`绑定的素材包已删除或不可访问 (${sel.id.slice(0, 6)})`);
                status = "blocked";
              } else {
                for (const ref of live.media) refIds.add(ref);
                if (live.revision !== sel.revision) {
                  issues.push(`素材包「${live.name}」已有新版本，请重新选择`);
                  status = "blocked";
                }
              }
            }
            for (const ref of node.params.h3_refs ?? []) refIds.add(ref);
            if (node.generation_mode === "first_last_frame") {
              for (const frame of [node.params.h3?.first_frame, node.params.h3?.last_frame])
                if (frame) refIds.add(frame);
            }
            const totalRefs = refIds.size;
            if (totalRefs > 9) {
              issues.push(`参考图片合计 ${totalRefs} 张，超过上限 9 张`);
              status = "blocked";
            }

            model = node.params.model || "";
            if (!model) {
              try {
                model = bindings.default(stage);
              } catch {
                issues.push(
                  stage === "image" ? "未配置默认生图模型" : "未配置默认视频模型",
                );
                status = "blocked";
              }
            }
            if (model) {
              const tailNodeId =
                stage === "video" && node.tail_inherited && tailParentNode(doc, node.id);
              const planned = Boolean(tailNodeId && plannedVideos.has(tailNodeId));
              const tail = tailNodeId && !planned ? await readCanvasTail(sql, project.id, project.workspace_id, tailNodeId, [...refIds]) : null;
              const q = await this.catalog.quoteReadOnly(
                sql,
                model,
                project.workspace_id,
                stage === "image"
                  ? {
                      resolution: node.params.resolution,
                      image_quality: node.params.image_quality,
                      ratio: node.params.ratio,
                    }
                  : {
                      seconds: node.params.seconds,
                      quality: node.params.quality,
                      ratio: node.params.ratio,
                    },
                {
                  kind: stage,
                  nativeParams: canvasMediaParameters(node.extra_params),
                  referenceCount: withTailCount(refIds, tail) + Number(Boolean(planned)),
                },
              );
              if (!q.allowed || !q.priced) {
                issues.push(`节点「${node.title || node.id}」：${q.reason || "当前模型不可用或未定价"}`);
                status = "blocked";
              } else {
                units = creditUnits(String(q.exactAmount ?? q.amount));
                if (q.route_revision && q.price_revision_id) routeQuote = { route_revision: q.route_revision, price_revision_id: q.price_revision_id };
              }
            }
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
                const resolved = await resolveSpeakerVoice(
                  sql,
                  project.workspace_id,
                  line,
                );
                let lineModel = "";
                try {
                  lineModel = bindings.resolveAudio(resolved.model);
                } catch {
                  lineModel = "";
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

          if (stage === "video" && status !== "blocked") plannedVideos.add(node.id);
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
