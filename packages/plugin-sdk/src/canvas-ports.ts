import type { CanvasExtension, CanvasPort } from "./canvas-nodes.js";
type Node = { type: string; extension?: CanvasExtension };
export function canvasSourceKind(
  node: Node,
  port?: string | null,
): CanvasPort["kind"] | undefined {
  if (node.type === "plugin")
    return node.extension?.definition.outputs.find((p) => p.id === port)?.kind;
  if (
    !port &&
    (node.type === "text" || node.type === "image" || node.type === "video")
  )
    return node.type;
}
export function acceptsCanvasEdge(
  source: Node,
  target: Node,
  from?: string | null,
  to?: string | null,
) {
  const kind = canvasSourceKind(source, from);
  if (!kind) return false;
  if (target.type === "plugin")
    return (
      target.extension?.definition.inputs.some(
        (p) => p.id === to && p.kind === kind,
      ) === true
    );
  return (
    !to &&
    (target.type === "image" || target.type === "video") &&
    (kind === "text" || kind === "image")
  );
}

type ShotDocument = {
  shots?: string[] | null;
  nodes: { id: string; type: string; x: number; y: number }[];
  edges: { source: string; target: string }[];
};

export function canvasShotOrder(doc: ShotDocument) {
  return doc.shots?.length
    ? doc.shots
    : doc.nodes
        .filter((node) => node.type === "video")
        .sort((a, b) => a.x - b.x || a.y - b.y)
        .map((node) => node.id);
}

export function tailParentNode(doc: ShotDocument, nodeId: string) {
  const order = canvasShotOrder(doc);
  const index = order.indexOf(nodeId);
  if (index > 0) return order[index - 1];
  return doc.edges.find(
    (edge) =>
      edge.target === nodeId &&
      doc.nodes.some(
        (node) => node.id === edge.source && node.type === "video",
      ),
  )?.source;
}
