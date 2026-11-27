import type { CanvasDocument } from "./canvas-draft.js";
import { pythonJsonText } from "@fumiao/plugin-sdk/json.js";

/** Keep Python integers exact through request errors and stored run snapshots. */
export function parseCanvasRunJson(source: string): unknown {
  return pythonJsonText(source, (_key, value, context) => {
    if (
      typeof value === "number" &&
      !Number.isSafeInteger(value) &&
      context?.source &&
      /^-?\d+$/.test(context.source)
    ) {
      if (context.source.replace(/^-/, "").length > 4300)
        throw new RangeError("JSON integer exceeds the original digit limit");
      return BigInt(context.source);
    }
    return value;
  });
}

export function canvasBytes(value: string): Buffer {
  const bytes = Buffer.from(value);
  if (bytes.toString("utf8") !== value)
    throw new Error("Invalid UTF-8 canvas text");
  return bytes;
}
export const canvasText = (value: Uint8Array) =>
  Buffer.from(value).toString("utf8");
/** Native saves normalize a validated document; imports must retain original bytes. */
export function canvasDocumentBytes(document: CanvasDocument): Buffer {
  function check(value: unknown): void {
    if (typeof value === "string") canvasBytes(value);
    else if (Array.isArray(value)) value.forEach(check);
    else if (value && typeof value === "object")
      Object.values(value).forEach(check);
  }
  check(document);
  return canvasBytes(JSON.stringify(document));
}
export const canvasDocumentJson = (value: Uint8Array): Record<string, any> =>
  JSON.parse(canvasText(value));

/** The pinned 64-bit CPython {current, pending} - {None} order is observable
 * when duplicate assigns new link IDs. There are at most two positive integers. */
export function canvasVoiceIds(
  current: number | null,
  pending: number | null,
): number[] {
  const values = [...new Set([current, pending])].filter(
    (v): v is number => v !== null,
  );
  if (values.length < 2) return values;
  function tableOrder(input: number[]) {
    const slots = new Map<number, number>();
    for (const value of input) {
      let perturb = BigInt(value) % ((1n << 61n) - 1n),
        slot = Number(perturb & 7n);
      while (slots.has(slot)) {
        perturb >>= 5n;
        slot = Number((BigInt(slot) * 5n + 1n + perturb) & 7n);
      }
      slots.set(slot, value);
    }
    return [...slots].sort(([a], [b]) => a - b).map(([, v]) => v);
  }
  // Difference builds a new small set by iterating the initial set.
  return tableOrder(tableOrder(values));
}

export function tailParentNode(doc: CanvasDocument, nodeId: string) {
  const order = doc.shots?.length
    ? doc.shots
    : doc.nodes
        .filter((node) => node.type === "video")
        .sort((a, b) => a.x - b.x || a.y - b.y)
        .map((node) => node.id);
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
