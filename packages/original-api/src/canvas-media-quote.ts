import {
  canvasShotOrder,
  canvasSourceKind,
  tailParentNode,
} from "@fumiao/plugin-sdk/canvas-ports.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import { creditUnits } from "@fumiao/platform/credit-amount.js";
import type { CanvasSubmissionModels } from "@fumiao/platform/canvas-submission.js";
import type { StudioCatalog } from "@fumiao/platform/catalog.js";
import type { Sql } from "@fumiao/platform/db.js";
import type { PrecheckHealth, PrecheckItem } from "./batch-precheck.js";
import type { CanvasDocument, CanvasNode } from "./canvas-draft.js";
import { readCanvasTail, withTailCount } from "./canvas-tail.js";
import { canvasMediaParameters } from "./canvas-values.js";
import type { OriginalCanvases } from "./canvases.js";

/** Price a document or an unapplied preview using the same references and prospective parent frames. */
export async function canvasMediaQuotes(
  sql: Sql,
  doc: CanvasDocument,
  targets: CanvasNode[],
  options: {
    projectId: string;
    workspaceId: string;
    canvases: OriginalCanvases;
    catalog: StudioCatalog;
    bindings: CanvasSubmissionModels;
    includesImages: boolean;
    requireConnection?: boolean;
  },
) {
  const {
    projectId,
    workspaceId,
    canvases,
    catalog,
    bindings,
    includesImages,
    requireConnection,
  } = options;
  const nodesById = new Map(doc.nodes.map((n) => [n.id, n]));
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
        [packPublicIds, workspaceId],
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

  const shotOrder = new Map(canvasShotOrder(doc).map((id, i) => [id, i]));
  const plannedVideos = new Set<string>();
  // Evaluate parent video stages in dispatch order, then restore the request's display order.
  const executionOrder = [...targets].sort(
    (a, b) =>
      (shotOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (shotOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  async function quote(
    node: CanvasNode,
    stage: "image" | "video",
    busy = false,
  ) {
    const issues: string[] = [];
    let status: PrecheckHealth = "ready";
    let units = 0n;
    let model = "";
    let routeQuote:
      Pick<PrecheckItem, "price_revision_id" | "route_revision"> | undefined;
    if (busy) {
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
        const media = src.extension
          ? src.extension.result?.[edge.sourcePort ?? ""]
          : await canvases.mediaForNode(sql, projectId, src);
        refIds.add(
          media || "pending:" + src.id + ":" + (edge.sourcePort ?? ""),
        );
        if (!media) {
          // If upstream image is also being run in this batch, warn instead of hard block!
          if (includesImages && targets.some((t) => t.id === src.id)) {
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
      for (const frame of [
        node.params.h3?.first_frame,
        node.params.h3?.last_frame,
      ])
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
        stage === "video" &&
        node.tail_inherited &&
        tailParentNode(doc, node.id);
      const planned = Boolean(tailNodeId && plannedVideos.has(tailNodeId));
      const tail =
        tailNodeId && !planned
          ? await readCanvasTail(sql, projectId, workspaceId, tailNodeId, [
              ...refIds,
            ])
          : null;
      const q = await catalog.quoteReadOnly(
        sql,
        model,
        workspaceId,
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
          requireConnection,
          nativeParams: canvasMediaParameters(node.extra_params),
          referenceCount:
            withTailCount(refIds, tail) + Number(Boolean(planned)),
        },
      );
      if (!q.allowed || !q.priced) {
        issues.push(
          `节点「${node.title || node.id}」：${q.reason || "当前模型不可用或未定价"}`,
        );
        status = "blocked";
      } else {
        units = creditUnits(String(q.exactAmount ?? q.amount));
        if (q.route_revision && q.price_revision_id)
          routeQuote = {
            route_revision: q.route_revision,
            price_revision_id: q.price_revision_id,
          };
      }
    }
    if (stage === "video" && status !== "blocked") plannedVideos.add(node.id);
    return { model, status, issues, units, routeQuote };
  }
  return { executionOrder, quote };
}
