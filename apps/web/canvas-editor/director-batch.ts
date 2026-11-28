import { canvasSourceKind } from "@fumiao/plugin-sdk/canvas-ports.js";
import {
  directorAudioEvidenceMismatch,
  directorAudioTargets,
  directorShotIds,
  directorTargetKey,
  type DirectorAudioInputs,
  type DirectorBatchSelection,
  type DirectorTarget,
} from "@fumiao/web-compat/director.js";
import type { CanvasNode, Doc, Job, PrecheckStage } from "./types";

export type BatchReceiptItem = { node: string; stage: PrecheckStage; line_id?: string };
export type BatchReceipt = {
  submitted: (BatchReceiptItem & { job_id: number })[];
  skipped: (BatchReceiptItem & { reason: string })[];
  total_credits: number;
  exact_total_credits?: string;
};

export type DirectorSubmission = {
  expected_revision: number;
  price_revision: number;
  precheck_token: string;
  expected_total_credits: number | string;
  director: DirectorBatchSelection;
  uid: string;
};

export type PendingDirectorBatch = {
  request: DirectorSubmission;
  receipt?: BatchReceipt;
  attachment?: { note?: string };
  rejected?: boolean;
};

const active = (job: Job) => ["queued", "running", "processing", "uncertain"].includes(job.status);
const completed = (job: Job) => job.status === "done" && Boolean(job.result);
const failed = (job?: Job) => job?.status === "failed" || job?.status === "cancelled";
const isAudio = (target: { stage: DirectorTarget["stage"] }) => target.stage === "narration" || target.stage === "dialogue";
const linkedNode = ({ node_id, stage, line_id }: DirectorTarget) =>
  stage === "dialogue" ? `dialogue:${node_id}:${line_id}` : stage === "narration" ? `voice:${node_id}` : node_id;
const lineFor = (node: CanvasNode, target: DirectorTarget) =>
  node.dialogue_lines?.find((line) => line.id === target.line_id);

export const receiptTarget = (item: BatchReceiptItem): DirectorTarget => ({
  node_id: item.node, stage: item.stage, ...(item.line_id ? { line_id: item.line_id } : {}),
});

function audioMatch(node: CanvasNode, target: DirectorTarget, job: Job, styles: DirectorAudioInputs) {
  const line = lineFor(node, target);
  const text = line?.text ?? node.narration_text;
  if (job.prompt.trim() !== text?.trim() || line?.audio_stale?.includes(job.id)) return "stale";
  const saved = job.inputs;
  const style = styles[directorTargetKey(target)];
  if (saved?.director_basis && !style) return "unchecked";
  const current = style ?? {
    model: line?.model ?? node.narration_model ?? undefined,
    pack_id: line?.pack_id ?? undefined,
    voice_id: line?.voice_id,
    instruction: line?.instruction ?? node.narration_instruction ?? undefined,
  };
  const savedModel = saved?.model || job.model;
  if (directorAudioEvidenceMismatch({ model: savedModel, ...saved }, current, job)) return "stale";
  if (saved?.director_basis) return "matches";
  return style && savedModel && saved?.instruction !== undefined &&
    (target.stage === "narration" || (saved.voice_id !== undefined && saved.pack_id !== undefined))
    ? "matches" : "unknown";
}

function targetRuns(node: CanvasNode, target: DirectorTarget, runs: Job[]) {
  const line = lineFor(node, target);
  const ids = isAudio(target)
    ? line ? [line.audio_pending, line.audio_job] : [node.narration_pending, node.narration_job]
    : [node.active_job];
  const kind = isAudio(target) ? "audio" : target.stage;
  return runs.filter((job) => job.kind === kind && (job.canvas_node === linkedNode(target) || ids.includes(job.id)))
    .sort((a, b) => b.id - a.id);
}

const directorMembers = (document: Doc) => new Set(document.director
  ? directorShotIds(document.shots ?? [], document.director)
  : []);

export function directorGenerationTargets(
  nodes: CanvasNode[],
  runs: Job[],
  stage: "video" | "audio",
  styles: DirectorAudioInputs = {},
): DirectorTarget[] {
  return nodes.flatMap((node) => {
    const targets = stage === "video" ? [{ node_id: node.id, stage }] : directorAudioTargets(node);
    return targets.filter((target) => {
      const takes = targetRuns(node, target, runs);
      if (takes.some(active)) return false;
      if (stage === "video") return true;
      const latest = takes[0];
      return !latest || !completed(latest) || audioMatch(node, target, latest, styles) === "stale";
    });
  });
}

export function directorRetryTargets(
  document: Doc,
  pending: PendingDirectorBatch,
  runs: Job[],
  styles: DirectorAudioInputs,
  only?: DirectorTarget,
): DirectorTarget[] {
  const members = directorMembers(document);
  const submitted = new Map(pending.receipt?.submitted.map((item) => [directorTargetKey(receiptTarget(item)), item.job_id]));
  const skipped = new Set(pending.receipt?.skipped.map((item) => directorTargetKey(receiptTarget(item))));
  return pending.request.director.targets.filter((target) => {
    const key = directorTargetKey(target);
    if (only && directorTargetKey(only) !== key) return false;
    const node = document.nodes.find((node) => node.id === target.node_id);
    if (!node) return false;
    const withinEpisode = target.stage === "image"
      ? node.type === "image" && document.edges.some((edge) => edge.source === node.id &&
          members.has(edge.target) && canvasSourceKind(node, edge.sourcePort) === "image")
      : node.type === "video" && members.has(node.id);
    if (!withinEpisode || (isAudio(target) &&
      !directorAudioTargets(node).some((candidate) => directorTargetKey(candidate) === key))) return false;

    const takes = targetRuns(node, target, runs);
    if (takes.some(active)) return false;
    const original = submitted.get(key);
    if (original === undefined) {
      if (pending.receipt && !skipped.has(key)) return false;
      const latest = takes[0];
      return !latest || !completed(latest) || (isAudio(target) && audioMatch(node, target, latest, styles) === "stale");
    }
    if (!failed(takes.find((job) => job.id === original))) return false;
    return !takes.some((job) => job.id > original && completed(job) &&
      (!isAudio(target) || ["matches", "unknown"].includes(audioMatch(node, target, job, styles))));
  });
}

export function directorAudioAttachment(
  document: Doc,
  accepted: BatchReceipt["submitted"],
  runs: Job[],
  styles: DirectorAudioInputs = {},
) {
  const byNode = new Map(document.nodes.map((node) => [node.id, node]));
  const byId = new Map(runs.map((job) => [job.id, job]));
  let detached = 0;
  let changed = false;
  for (const item of accepted) {
    if (!isAudio(item)) continue;
    const node = byNode.get(item.node);
    const target = receiptTarget(item);
    const job = byId.get(item.job_id);
    if (!node || job?.kind !== "audio" || job.canvas_node !== linkedNode(target) || !directorAudioTargets(node)
      .some((candidate) => directorTargetKey(candidate) === directorTargetKey(target)) ||
      !["matches", "unknown"].includes(audioMatch(node, target, job, styles))) {
      detached++;
      continue;
    }
    const line = lineFor(node, target);
    const [pending, applied] = line
      ? [line.audio_pending, line.audio_job] : [node.narration_pending, node.narration_job];
    if (pending === job.id || applied === job.id) continue;
    if (Math.max(pending ?? 0, applied ?? 0) > job.id) {
      detached++;
      continue;
    }
    byNode.set(node.id, line ? {
      ...node,
      dialogue_lines: node.dialogue_lines?.map((entry) => entry.id === line.id ? { ...line, audio_pending: job.id } : entry),
    } : { ...node, narration_pending: job.id });
    changed = true;
  }
  return { document: changed ? { ...document, nodes: [...byNode.values()] } : document, detached };
}

export function directorCompletedAudioNodes(document: Doc, runs: ReadonlyMap<number, Job>): string[] {
  return document.nodes.filter((node) => {
    const ids = [node.narration_pending, ...node.dialogue_lines?.map((line) => line.audio_pending) ?? []];
    return ids.some((id) => {
      const job = id ? runs.get(id) : undefined;
      return job?.kind === "audio" && completed(job) && Boolean(job.inputs?.director_basis);
    });
  }).map(({ id }) => id);
}

export function directorAudioPromotion(document: Doc, runs: Job[], styles: DirectorAudioInputs) {
  const byId = new Map(runs.map((job) => [job.id, job]));
  const members = directorMembers(document);
  let changed = false;
  const nodes = document.nodes.map((node) => {
    const allowed = new Set(directorAudioTargets(node).map(directorTargetKey));
    const canApply = (target: DirectorTarget, id?: number | null, applied?: number | null) => {
      const job = id ? byId.get(id) : undefined;
      if (job?.kind !== "audio" || !completed(job) || !job.inputs?.director_basis) return;
      if ((applied ?? 0) > job.id) return "superseded";
      if (!members.has(node.id) || !allowed.has(directorTargetKey(target))) return "stale";
      if (!styles[directorTargetKey(target)]) return;
      return audioMatch(node, target, job, styles) === "matches" ? "matches" : "stale";
    };
    const narration = canApply({ node_id: node.id, stage: "narration" }, node.narration_pending, node.narration_job);
    let dialogueChanged = false;
    const lines = node.dialogue_lines?.map((line) => {
      const result = canApply({ node_id: node.id, stage: "dialogue", line_id: line.id }, line.audio_pending, line.audio_job);
      if (!result) return line;
      dialogueChanged = true;
      const { audio_stale: previousStale, ...selected } = line;
      if (result === "matches") {
        return { ...selected, audio_pending: null, audio_job: line.audio_pending };
      }
      const stale = (previousStale ?? []).filter((id) => id === line.audio_job);
      if (result === "stale") stale.push(line.audio_pending!);
      return { ...selected, audio_pending: null, ...(stale.length ? { audio_stale: [...new Set(stale)] } : {}) };
    });
    if (!narration && !dialogueChanged) return node;
    changed = true;
    return {
      ...node, ...(dialogueChanged ? { dialogue_lines: lines } : {}),
      ...(narration ? {
        narration_pending: null,
        ...(narration === "matches" ? { narration_job: node.narration_pending } : {}),
      } : {}),
    };
  });
  return changed ? { ...document, nodes } : document;
}

export function promoteOrdinaryCanvasAudio(document: Doc, runs: ReadonlyMap<number, Job>) {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    const narration = node.narration_pending ? runs.get(node.narration_pending) : undefined;
    const promoteNarration = narration && !narration.inputs?.director_basis && completed(narration) &&
      narration.prompt.trim() === (node.narration_text ?? "").trim() &&
      (narration.inputs?.instruction ?? "").trim() === (node.narration_instruction ?? "").trim();

    let dialogueChanged = false;
    const dialogue = node.dialogue_lines?.map((line) => {
      const job = line.audio_pending ? runs.get(line.audio_pending) : undefined;
      if (!job || job.inputs?.director_basis || !completed(job) || job.prompt.trim() !== line.text.trim() ||
        line.audio_stale?.includes(job.id)) return line;
      dialogueChanged = true;
      return { ...line, audio_job: job.id, audio_pending: null, audio_stale: undefined };
    });

    if (!promoteNarration && !dialogueChanged) return node;
    changed = true;
    return {
      ...node,
      ...(promoteNarration ? { narration_job: narration.id, narration_pending: null } : {}),
      ...(dialogueChanged ? { dialogue_lines: dialogue } : {}),
    };
  });
  return changed ? { ...document, nodes } : document;
}
