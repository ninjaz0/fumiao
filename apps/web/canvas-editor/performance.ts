import { Position, type NodeHandle } from "@xyflow/react";
import type { CanvasNode, Draft, Job, Studio } from "./types";

export const VIRTUALIZATION_NODE_THRESHOLD = 24;

export function shouldVirtualizeCanvas(
  nodeCount: number,
  hasLoadedImage: boolean,
): boolean {
  // Small canvases keep loaded images mounted during drag auto-pan without
  // hurting responsiveness; large canvases must virtualize off-screen nodes.
  if (nodeCount > VIRTUALIZATION_NODE_THRESHOLD) return true;
  return !hasLoadedImage;
}

export function buildNodeHandles(
  node: CanvasNode,
  videoPort: boolean,
): NodeHandle[] {
  const handles: NodeHandle[] = [];
  if (node.extension) {
    const { inputs, outputs } = node.extension.definition;
    for (let i = 0; i < inputs.length; i++) {
      handles.push({
        id: inputs[i].id,
        type: "target",
        position: Position.Left,
        x: 0,
        y: ((i + 1) / (inputs.length + 1)) * node.height,
        width: 0,
        height: 0,
      });
    }
    for (let i = 0; i < outputs.length; i++) {
      handles.push({
        id: outputs[i].id,
        type: "source",
        position: Position.Right,
        x: node.width,
        y: ((i + 1) / (outputs.length + 1)) * node.height,
        width: 0,
        height: 0,
      });
    }
  }
  if (node.type === "image" || node.type === "video") {
    handles.push({
      type: "target",
      position: Position.Left,
      x: 0,
      y: node.height / 2,
      width: 0,
      height: 0,
    });
  }
  if (
    node.type === "text" ||
    node.type === "image" ||
    (node.type === "video" && videoPort)
  ) {
    handles.push({
      type: "source",
      position: Position.Right,
      x: node.width,
      y: node.height / 2,
      width: 0,
      height: 0,
    });
  }
  return handles;
}

export function indexRunsByNode(runs: readonly Job[]): Map<string, Job[]> {
  const byNode = new Map<string, Job[]>();
  for (const job of runs) {
    if (!job.canvas_node) continue;
    const list = byNode.get(job.canvas_node);
    if (list) list.push(job);
    else byNode.set(job.canvas_node, [job]);
  }
  return byNode;
}

export function resolveNodeFromIndex(
  node: CanvasNode,
  runsByNode: ReadonlyMap<string, readonly Job[]>,
) {
  const list = runsByNode.get(node.id) ?? [];
  const latest = list[0];
  const run = node.use_media
    ? undefined
    : node.active_job
      ? list.find((j) => j.id === node.active_job)
      : latest;
  return {
    run,
    latest,
    list,
    media: run ? (run.status === "done" ? run.result : null) : node.media_id,
  };
}

function shallowJobValueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function jobEqual(a: Job, b: Job): boolean {
  if (a === b) return true;
  if (
    a.id !== b.id ||
    a.status !== b.status ||
    a.result !== b.result ||
    a.note !== b.note ||
    a.canvas_node !== b.canvas_node ||
    a.kind !== b.kind ||
    a.prompt !== b.prompt ||
    a.model !== b.model ||
    a.model_label !== b.model_label ||
    a.seconds !== b.seconds ||
    a.quality !== b.quality ||
    a.ratio !== b.ratio ||
    a.width !== b.width ||
    a.height !== b.height ||
    a.created !== b.created ||
    a.seed !== b.seed ||
    a.sampling_steps !== b.sampling_steps ||
    a.image_quality !== b.image_quality ||
    a.owner !== b.owner
  ) {
    return false;
  }
  return (
    shallowJobValueEqual(a.eta, b.eta) &&
    shallowJobValueEqual(a.timing, b.timing) &&
    shallowJobValueEqual(a.actual, b.actual) &&
    shallowJobValueEqual(a.batch, b.batch) &&
    shallowJobValueEqual(a.refs, b.refs) &&
    shallowJobValueEqual(a.inputs, b.inputs)
  );
}

/**
 * Reconcile polled runs against the previous array, preserving object identity
 * for unchanged jobs and returning `prev` unchanged when nothing differs.
 */
export function reconcileRuns(prev: Job[], next: Job[]): Job[] {
  if (prev === next) return prev;
  const prevById = new Map<number, Job>();
  for (const job of prev) prevById.set(job.id, job);
  let changed = prev.length !== next.length;
  const merged = new Array<Job>(next.length);
  for (let i = 0; i < next.length; i++) {
    const incoming = next[i];
    const existing = prevById.get(incoming.id);
    if (existing && jobEqual(existing, incoming)) {
      merged[i] = existing;
      if (!changed && prev[i] !== existing) changed = true;
    } else {
      merged[i] = incoming;
      changed = true;
    }
  }
  return changed ? merged : prev;
}

export function studioFingerprint(studio: Studio): string {
  const { server_time: _ignored, ...rest } = studio as Studio & {
    server_time?: unknown;
  };
  return JSON.stringify(rest);
}

/**
 * Fast structural equality for canvas drafts that exploits immutable array item
 * references so single-node drag/text updates don't stringify the whole canvas.
 */
export function draftEquals(a: Draft, b: Draft): boolean {
  if (a === b) return true;
  if (a.title !== b.title) return false;
  if (a.document === b.document) return true;
  const da = a.document;
  const db = b.document;
  if (
    da.schemaVersion !== db.schemaVersion ||
    da.nodes.length !== db.nodes.length ||
    da.edges.length !== db.edges.length ||
    da.loudnorm !== db.loudnorm ||
    da.bgm_applied_job !== db.bgm_applied_job ||
    !shallowJobValueEqual(da.bgm ?? null, db.bgm ?? null)
  ) {
    return false;
  }
  const sa = da.shots;
  const sb = db.shots;
  if (sa !== sb) {
    if ((sa?.length ?? 0) !== (sb?.length ?? 0)) return false;
    if (sa && sb) {
      for (let i = 0; i < sa.length; i++) {
        if (sa[i] !== sb[i]) return false;
      }
    } else if (Boolean(sa) !== Boolean(sb)) {
      // Preserve JSON.stringify distinction between missing `shots` and `shots: []`
      return false;
    }
  }
  for (let i = 0; i < da.nodes.length; i++) {
    const na = da.nodes[i];
    const nb = db.nodes[i];
    if (na === nb) continue;
    if (JSON.stringify(na) !== JSON.stringify(nb)) return false;
  }
  for (let i = 0; i < da.edges.length; i++) {
    const ea = da.edges[i];
    const eb = db.edges[i];
    if (ea === eb) continue;
    if (
      ea.id !== eb.id ||
      ea.source !== eb.source ||
      ea.target !== eb.target ||
      ea.sourcePort !== eb.sourcePort ||
      ea.targetPort !== eb.targetPort
    ) {
      return false;
    }
  }
  return true;
}

export function computeGridGap(zoom: number): number {
  const safeZoom = Math.max(0.05, zoom);
  return (
    24 *
    safeZoom *
    2 ** Math.max(0, Math.ceil(Math.log2(16 / (24 * safeZoom))))
  );
}

export function computeOverlayPositions(params: {
  viewport: { x: number; y: number; zoom: number };
  windowSize: { w: number; h: number };
  node: Pick<CanvasNode, "x" | "y" | "width" | "height" | "type"> | null;
  panelHeight: number;
}) {
  const { viewport, windowSize, node, panelHeight } = params;
  const nodeRect = node
    ? {
        x: node.x * viewport.zoom + viewport.x,
        y: node.y * viewport.zoom + viewport.y,
        w: node.width * viewport.zoom,
        h: node.height * viewport.zoom,
      }
    : null;
  const toolbarBelow = Boolean(nodeRect && nodeRect.y < 150);
  return {
    toolbar: nodeRect
      ? {
          left: Math.max(
            76,
            Math.min(nodeRect.x + nodeRect.w / 2 - 170, windowSize.w - 370),
          ),
          top: toolbarBelow
            ? Math.max(68, nodeRect.y + nodeRect.h + 14)
            : nodeRect.y - 82,
        }
      : null,
    composer: nodeRect
      ? {
          left: Math.max(
            76,
            Math.min(nodeRect.x + nodeRect.w / 2 - 260, windowSize.w - 544),
          ),
          top: Math.max(
            100,
            Math.min(
              nodeRect.y + nodeRect.h + (toolbarBelow ? 70 : 20),
              windowSize.h - panelHeight - (node?.type === "text" ? 80 : 20),
            ),
          ),
        }
      : null,
    downstream: {
      left: Math.min(
        windowSize.w - 190,
        Math.max(80, (nodeRect?.x || 100) + (nodeRect?.w || 200) + 35),
      ),
      top: Math.min(
        windowSize.h - 160,
        Math.max(80, (nodeRect?.y || 100) + (nodeRect?.h || 100) / 2),
      ),
    },
  };
}
