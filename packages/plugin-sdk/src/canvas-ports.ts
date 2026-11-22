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
