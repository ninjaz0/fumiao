import { requireValue } from "../../platform/src/security.js";
import type { CanvasModels } from "../../platform/src/canvas-models.js";
import type { CanvasDocument } from "./canvas-draft.js";
import { canvasVoiceIds } from "./canvas-values.js";

/** The caller must bind all lookups and authorization to the same save transaction. */
export interface CanvasValidationResources {
  media(
    key: string,
  ): Promise<{ kind: string; authorize(): Promise<void> } | undefined>;
  pack(key: string): Promise<void>;
  voice(
    node: string,
    key: number,
  ): Promise<{ result: string | null; authorize(): Promise<void> } | undefined>;
  active(node: string, key: number, kind: string): Promise<boolean>;
}
export type CanvasReference = { node: string; media: string };

/** Preserve source check ordering and per-node references, including cross-role duplicates. */
export async function validateCanvasDocument(
  document: CanvasDocument,
  models: CanvasModels,
  resources: CanvasValidationResources,
): Promise<CanvasReference[]> {
  const nodes = new Map(document.nodes.map((n) => [n.id, n]));
  requireValue(
    nodes.size === document.nodes.length &&
      new Set(document.edges.map((e) => e.id)).size === document.edges.length,
    400,
    "节点或连线标识重复",
  );
  const shots = document.shots ?? [];
  requireValue(
    new Set(shots).size === shots.length &&
      shots.every((id) => nodes.get(id)?.type === "video"),
    400,
    "镜头列表只能包含不同的视频节点",
  );
  const refs: CanvasReference[] = [];
  for (const node of document.nodes) {
    const attached = [...node.params.h3_refs];
    if (node.params.h3)
      attached.push(
        ...[node.params.h3.first_frame, node.params.h3.last_frame].filter(
          (key): key is string => !!key,
        ),
      );
    for (const key of new Set(attached)) {
      const media = await resources.media(key);
      requireValue(
        media && ["ref", "ref_video", "ref_audio"].includes(media.kind),
        400,
        "参考素材不存在",
      );
      await media.authorize();
      refs.push({ node: node.id, media: key });
    }
    for (const selected of node.asset_packs) await resources.pack(selected.id);
    models.validate(node.type, node.params);
    for (const key of canvasVoiceIds(
      node.narration_job,
      node.narration_pending,
    )) {
      const voice = await resources.voice("voice:" + node.id, key);
      requireValue(node.type === "video" && voice, 400, "镜头旁白任务不存在");
      await voice.authorize();
      if (voice.result) refs.push({ node: node.id, media: voice.result });
    }
    if (node.media_id) {
      const media = await resources.media(node.media_id);
      requireValue(
        media &&
          ["image", "video"].includes(node.type) &&
          media.kind === (node.type === "video" ? "video" : "ref"),
        400,
        "节点素材不存在或类型不匹配",
      );
      await media.authorize();
      refs.push({ node: node.id, media: node.media_id });
    }
    if (node.active_job)
      requireValue(
        await resources.active(node.id, node.active_job, node.type),
        400,
        "选中的生成版本不存在",
      );
  }
  const seen = new Set<string>(),
    incoming = new Map<string, number>(),
    adjacent = new Map<string, string[]>();
  for (const id of nodes.keys()) adjacent.set(id, []);
  for (const edge of document.edges) {
    const a = nodes.get(edge.source),
      b = nodes.get(edge.target);
    requireValue(
      a &&
        b &&
        a.id !== b.id &&
        ["text", "image"].includes(a.type) &&
        ["image", "video"].includes(b.type),
      400,
      "这两个节点不能建立参考连线",
    );
    const pair = JSON.stringify([a.id, b.id]);
    requireValue(!seen.has(pair), 400, "参考连线重复");
    seen.add(pair);
    adjacent.get(a.id)!.push(b.id);
    const count = (incoming.get(b.id) ?? 0) + Number(a.type === "image");
    incoming.set(b.id, count);
    requireValue(count <= 9, 400, "每个节点最多连接 9 张参考图片");
  }
  const visited = new Set<string>(),
    visiting = new Set<string>();
  function visit(id: string) {
    requireValue(!visiting.has(id), 400, "参考连线不能形成循环");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dest of adjacent.get(id)!) visit(dest);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of nodes.keys()) visit(id);
  return refs;
}
