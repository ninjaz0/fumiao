import { directorAudioTargets, directorTargetKey, type DirectorBatchSelection, type DirectorTarget } from "@fumiao/web-compat/director.js";
import type { CanvasNode, Doc, Job, PrecheckStage } from "./types";

export type BatchReceipt = {
  submitted: { node: string; stage: PrecheckStage; job_id: number; line_id?: string }[];
  skipped: { node: string; stage: PrecheckStage; line_id?: string; reason: string }[];
  total_credits: number;
};

export type DirectorSubmission = {
  expected_revision: number;
  price_revision: number;
  precheck_token: string;
  expected_total_credits: number;
  director: DirectorBatchSelection;
  uid: string;
};

export type PendingDirectorBatch = {
  request: DirectorSubmission;
  receipt?: BatchReceipt;
  attachment?: { note?: string };
  rejected?: boolean;
};

const active = (job?: Job) => job && ["queued", "running", "processing", "uncertain"].includes(job.status);
const completed = (job?: Job) => job?.status === "done" && Boolean(job.result);
const audioNode = ({ node_id, stage, line_id }: DirectorTarget) =>
  stage === "dialogue" ? `dialogue:${node_id}:${line_id}` : `voice:${node_id}`;
const inputFor = (node: CanvasNode, lineId?: string) =>
  lineId ? node.dialogue_lines?.find((line) => line.id === lineId) : null;

export function directorGenerationTargets(
  nodes: CanvasNode[],
  runs: Job[],
  stage: "video" | "audio",
  currentBases: Record<string, string> = {},
): DirectorTarget[] {
  return nodes.flatMap((node) => {
    if (stage === "video") return runs.some((job) => job.canvas_node === node.id && active(job))
      ? [] : [{ node_id: node.id, stage: "video" } as const];
    return directorAudioTargets(node).filter((target) => {
      const line = inputFor(node, target.line_id);
      const linked = runs.filter((job) => job.canvas_node === audioNode(target));
      if (linked.some(active)) return false;
      const pending = line ? line.audio_pending : node.narration_pending;
      const applied = line ? line.audio_job : node.narration_job;
      const takes = [pending, applied].flatMap((id) => id ? runs.find((job) => job.id === id) ?? [] : []);
      const latest = takes[0] ?? linked[0];
      const text = line?.text ?? node.narration_text;
      const basis = currentBases[directorTargetKey(target)];
      return !latest || !completed(latest) || latest.prompt.trim() !== text?.trim() ||
        Boolean(line?.audio_stale?.includes(latest.id)) ||
        Boolean(basis && latest.inputs?.director_basis && latest.inputs.director_basis !== basis);
    });
  });
}

export function directorAudioAttachment(
  document: Doc,
  accepted: BatchReceipt["submitted"],
  runs: Job[],
  currentBases: Record<string, string> = {},
) {
  const byNode = new Map(document.nodes.map((node) => [node.id, node]));
  const byId = new Map(runs.map((job) => [job.id, job]));
  let detached = 0;
  let changed = false;
  for (const item of accepted) {
    if (item.stage !== "narration" && item.stage !== "dialogue") continue;
    const node = byNode.get(item.node);
    const target: DirectorTarget = { node_id: item.node, stage: item.stage, line_id: item.line_id };
    const job = byId.get(item.job_id);
    const line = node && inputFor(node, item.line_id);
    const matching = node && job?.canvas_node === audioNode(target) && directorAudioTargets(node)
      .some((candidate) => candidate.stage === target.stage && candidate.line_id === target.line_id);
    if (!matching || !node || !job ||
      (job.inputs?.director_basis && job.inputs.director_basis !== currentBases[directorTargetKey(target)])) {
      detached++;
      continue;
    }
    if (line) {
      if (line.audio_pending === job.id || line.audio_job === job.id) continue;
      if (job.prompt.trim() !== line.text.trim() || line.audio_stale?.includes(job.id) ||
        (!job.inputs?.director_basis && ((line.voice_id && line.voice_id !== job.inputs?.voice_id) ||
          (line.pack_id && line.pack_id !== job.inputs?.pack_id) ||
          (line.model && line.model !== job.model) ||
          (line.instruction && line.instruction.trim() !== job.inputs?.instruction?.trim()))) ||
        Math.max(line.audio_pending ?? 0, line.audio_job ?? 0) > job.id) {
        detached++;
        continue;
      }
      byNode.set(node.id, {
        ...node,
        dialogue_lines: node.dialogue_lines?.map((entry) => entry.id === line.id ? { ...line, audio_pending: job.id } : entry),
      });
    } else {
      if (node.narration_pending === job.id || node.narration_job === job.id) continue;
      if (job.prompt.trim() !== node.narration_text?.trim() ||
        (!job.inputs?.director_basis && (
          (job.inputs?.instruction ?? "").trim() !== (node.narration_instruction ?? "").trim() ||
          (node.narration_model && node.narration_model !== job.model)
        )) ||
        Math.max(node.narration_pending ?? 0, node.narration_job ?? 0) > job.id) {
        detached++;
        continue;
      }
      byNode.set(node.id, { ...node, narration_pending: job.id });
    }
    changed = true;
  }
  return { document: changed ? { ...document, nodes: [...byNode.values()] } : document, detached };
}
