import { canvasSourceKind } from "@fumiao/plugin-sdk/canvas-ports.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import { CanvasSubmissionModels } from "@fumiao/platform/canvas-submission.js";
import type { Sql } from "@fumiao/platform/db.js";
import { DomainError, requireValue } from "@fumiao/platform/security.js";
import {
  canvasTailSourceId,
  directorAudioTargets,
  directorBasis,
  directorTargetKey,
  type DirectorShotInputs,
  type DirectorTarget,
} from "@fumiao/web-compat/director.js";
import type { CanvasDocument, CanvasNode, CinematographySpec } from "./canvas-draft.js";
import { canvasNodeMedia } from "./canvases.js";
import { resolveDialogueInput } from "./dialogue.js";
import { expandOriginalPacks, originalFlowSource } from "./generation-inputs.js";

/** F030: Compiles structured 6-dimension director cinematography spec into clean prompt text. */
export function compileCinematographyPrompt(
  basePrompt: string,
  spec?: CinematographySpec | null,
  generationMode?: string,
  gridLayout?: "2x2" | "3x3" | null,
): string {
  const parts: string[] = [];
  if (generationMode === "grid_preview") {
    const grid = gridLayout === "2x2" ? "2x2 四宫格" : "3x3 九宫格";
    const count = gridLayout === "2x2" ? 4 : 9;
    parts.push(
      `【${grid}分镜构图预览】在一张画布上平均划分为 ${grid}（共 ${count} 个等大独立连续分镜画面），细黑线整齐分隔，无文字水印，主体与场景风格连贯：`,
    );
  }
  parts.push(basePrompt.trim());
  if (spec) {
    const entries: [string, string | undefined][] = [
      ["景别", spec.shot_size],
      ["机位", spec.camera_angle],
      ["运镜", spec.camera_movement],
      ["光影", spec.lighting],
      ["镜头", spec.lens],
      ["氛围", spec.mood],
    ];
    const tags = entries
      .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
      .map(([k, v]) => `${k}:${v!.trim()}`);
    if (tags.length) {
      parts.push(`【导演参数：${tags.join(" / ")}】`);
    }
  }
  return parts.filter(Boolean).join("\n\n").slice(0, 12000);
}
type InputProject = { id: string; workspace_id: string };

export async function resolveCanvasSources(
  sql: Sql,
  projectId: string,
  document: CanvasDocument,
  nodeId: string,
  lock = false,
  fixedInputs = lock,
) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const sources: {
    node: CanvasNode;
    kind: "text" | "image";
    value: string | null;
  }[] = [];
  for (const edge of document.edges) {
    if (edge.target !== nodeId) continue;
    const node = nodes.get(edge.source);
    if (!node) continue;
    const kind = canvasSourceKind(node, edge.sourcePort) === "text" ? "text" : "image";
    const output = edge.sourcePort && node.extension?.result?.[edge.sourcePort];
    const value = kind === "text"
      ? pythonStrip(node.extension ? output || "" : node.text)
      : node.extension ? output || null : await canvasNodeMedia(sql, projectId, node, false, fixedInputs, lock);
    sources.push({ node, kind, value });
  }
  return sources;
}

export function canvasRawPrompt(text: string[], node: CanvasNode) {
  return [...text, pythonStrip(node.prompt)].filter(Boolean).join("\n\n");
}

function canvasVisualPrompt(raw: string, node: CanvasNode) {
  requireValue(
    raw && [...raw].length <= 12000, 400,
    "请输入提示词或连接文本，合计不超过 12000 字",
  );
  return compileCinematographyPrompt(raw, node.cinematography, node.generation_mode, node.grid_layout);
}

type CanvasVisualBase = Awaited<ReturnType<typeof resolveCanvasVisualBase>>;

export async function resolveCanvasVisualBase(
  sql: Sql,
  projectId: string,
  document: CanvasDocument,
  node: CanvasNode,
  bindings: CanvasSubmissionModels,
  resolvedSources?: Awaited<ReturnType<typeof resolveCanvasSources>>,
) {
  const text: string[] = [];
  const refs: string[] = [];
  const sources: ({ node: string; text: string } | { node: string; media: string })[] = [];
  const linked = resolvedSources ?? await resolveCanvasSources(sql, projectId, document, node.id);
  for (const { node: source, kind, value } of linked) {
    if (kind === "text") {
      requireValue(value, 409, `参考文本“${source.title || "文本"}”还没有内容`);
      text.push(value);
      sources.push({ node: source.id, text: value });
    } else {
      requireValue(value, 409, `参考图片“${source.title || "图片"}”尚未就绪`);
      if (!refs.includes(value)) refs.push(value);
      sources.push({ node: source.id, media: value });
    }
  }
  const prompt = canvasVisualPrompt(canvasRawPrompt(text, node), node);
  const params = node.params;
  const model = params.model || bindings.default(node.type);
  const rule = bindings.rules.get(model);
  let native: CanvasNode["params"]["h3"] = null;
  if (node.type === "video" && rule?.nativeH3) {
    const empty = { first_frame: null, last_frame: null, video_audio: [] };
    native = params.h3;
    if (node.generation_mode === "first_last_frame")
      native = { ...(native ?? empty), mode: "frames" };
    if (node.generation_mode === "omni_ref") {
      for (const id of [native?.first_frame, native?.last_frame])
        if (id && !refs.includes(id)) refs.push(id);
      native = { ...empty, video_audio: native?.video_audio ?? [], mode: "reference" };
    }
  }
  return { prompt, refs, sources, model, rule, native, linked };
}

/** Build the same request fields for an ordinary canvas run or a director run.
 * Automatic tail chaining is applied before this step by ordinary canvas runs. */
export function canvasVisualPayload(node: CanvasNode, base: CanvasVisualBase, seedOffset = 0) {
  const { model, native, rule, prompt } = base;
  const params = node.params;
  let refs = base.refs;
  const frameRefs = (frames: CanvasNode["params"]["h3"]) => [frames?.first_frame, frames?.last_frame]
    .filter((id): id is string => Boolean(id));
  if (native) {
    refs = [...new Set(native.mode === "frames" ? frameRefs(native) : [...refs, ...params.h3_refs])];
  } else if (node.generation_mode === "first_last_frame" && params.h3) {
    const frames = frameRefs(params.h3);
    if (frames.length) refs = [...new Set([...frames, ...refs])];
  } else if (node.generation_mode === "omni_ref" && params.h3_refs.length) {
    refs = [...new Set([...refs, ...params.h3_refs])];
  } else {
    requireValue(
      !params.h3_refs.length || !params.model || rule?.nativeH3,
      400, "请先移除 H3 参考素材后切换模型生成",
    );
  }
  const common = {
    prompt,
    refs,
    ratio: params.ratio,
    asset_packs: node.asset_packs,
    model,
    ...(node.extra_params && Object.keys(node.extra_params).length ? { params: node.extra_params } : {}),
  };
  return node.type === "image"
    ? { ...common, resolution: params.resolution, image_quality: params.image_quality }
    : {
      ...common,
      h3: native,
      flow_source_job: params.flow_source_job,
      quality: params.quality,
      seconds: params.seconds,
      seed: params.seed === null ? null : (params.seed + seedOffset) % 2 ** 53,
      sampling_steps: rule?.fixedSamplingSteps ?? (params.fast_mode ? 4 : params.sampling_steps),
    };
}

export function canvasNarrationInput(node: CanvasNode, bindings: CanvasSubmissionModels) {
  requireValue(pythonStrip(node.narration_text), 400, "请先填写镜头旁白");
  return {
    model: bindings.resolveAudio(node.narration_model),
    prompt: node.narration_text,
    instruction: node.narration_instruction,
  };
}

/** Read the effective input using the caller's snapshot. The caller can use
 * payload directly for paid acceptance so no mutable source is resolved twice. */
export async function resolveDirectorInput(
  sql: Sql,
  project: InputProject,
  document: CanvasDocument,
  target: DirectorTarget,
  bindings?: CanvasSubmissionModels,
  options?: {
    sources?: Awaited<ReturnType<typeof resolveCanvasSources>>;
    lock?: boolean;
  },
) {
  const node = document.nodes.find(({ id }) => id === target.node_id);
  requireValue(node && node.type === (target.stage === "image" ? "image" : "video"), 400, "生成阶段与节点类型不匹配");
  requireValue(target.stage === "dialogue" ? Boolean(target.line_id) : target.line_id === undefined, 400, "对白生成需要选择对应的台词");

  if (target.stage === "dialogue") {
    const line = node.dialogue_lines?.find(({ id }) => id === target.line_id);
    requireValue(line, 400, "未找到可合成的对白台词");
    const input = await resolveDialogueInput(sql, project.workspace_id, line, bindings ?? await CanvasSubmissionModels.read(sql), options?.lock);
    requireValue(!line.pack_id || input.voice.packId === line.pack_id, 409, `对白“${line.speaker || line.id}”的角色素材包不可用，请重新选择`);
    const { model, instruction, params } = input.payload;
    const material = { target, speaker: line.speaker, pack: input.voice.packId, model, instruction, params };
    return {
      stage: target.stage,
      ...input,
      material,
      basis: await directorBasis({ target, speaker: line.speaker, pack: input.voice.packId, payload: input.payload }),
    };
  }
  if (target.stage === "narration") {
    const payload = canvasNarrationInput(node, bindings ?? await CanvasSubmissionModels.read(sql));
    const material = { target, model: payload.model, instruction: payload.instruction };
    return { stage: target.stage, payload, material, basis: await directorBasis({ target, payload }) };
  }

  if (target.stage === "video" && node.tail_inherited) {
    const source = document.nodes.find(({ id }) => id === canvasTailSourceId(document, node.id));
    const label = source ? `“${source.title || source.id}”的` : "";
    requireValue(false, 409, `本镜已启用${label}自动尾帧继承，请先关闭自动继承，可在画布固定所需尾帧`);
  }
  const base = await resolveCanvasVisualBase(
    sql, project.id, document, node,
    bindings ?? await CanvasSubmissionModels.read(sql),
    options?.sources ?? (options?.lock ? await resolveCanvasSources(sql, project.id, document, node.id, true) : undefined),
  );
  const payload = canvasVisualPayload(node, base);
  const native = "h3" in payload ? payload.h3 : undefined;
  requireValue(native?.mode !== "frames" || !payload.asset_packs.length, 400, "首尾帧模式请在画布槽位中直接选择图片");
  const expanded = await expandOriginalPacks(sql, project.workspace_id, payload, options?.lock);
  const references = expanded.refs;
  const sourceJob = "flow_source_job" in payload ? payload.flow_source_job : null;
  const flowSource = sourceJob
    ? await originalFlowSource(sql, project.workspace_id, sourceJob, options?.lock)
    : undefined;
  let flowBasis;
  if (sourceJob) {
    const providerMedia: unknown = flowSource?.task.metadata.flow_media_id;
    requireValue(
      flowSource?.media && flowSource.task.state === "completed" &&
      flowSource.task.kind === "video" && flowSource.row.plugin_id === "flow" &&
      typeof providerMedia === "string" && providerMedia,
      409,
      "续写来源必须是当前工作区内已完成并保留来源信息的 Flow 视频",
    );
    flowBasis = {
      id: sourceJob,
      media: flowSource.media.id,
      providerMedia,
      model: flowSource.task.model,
      ratio: flowSource.task.view.ratio,
    };
  }
  const mediaToCheck = [...new Set([
    ...references,
    ...(native?.video_audio ?? []),
    ...base.sources.flatMap((source) => "media" in source ? [source.media] : []),
  ])];
  let referenceMedia: DirectorShotInputs["references"] = [];
  if (mediaToCheck.length) {
    const { rows } = await sql.query<{ id: string; mime: string }>(
      `SELECT public_id AS id,mime FROM assets
       WHERE public_id=ANY($1::text[]) AND workspace_id=$2 AND state='ready'
       ORDER BY id ${options?.lock ? "FOR SHARE" : ""}`,
      [mediaToCheck, project.workspace_id],
    );
    requireValue(rows.length === mediaToCheck.length, 409, "有参考素材已删除或不可访问，请重新选择");
    const mediaById = new Map(rows.map((row) => [row.id, row]));
    referenceMedia = references.map((id) => mediaById.get(id)!);
  }
  const unfixedSources = base.linked.flatMap(({ node: source, kind, value }) =>
    kind === "image" && value && references.includes(value) && (source.extension || (!source.use_media && !source.active_job))
      ? [source.title || source.id]
      : [],
  );
  if (flowSource?.media) referenceMedia.push({ ...flowSource.media, role: "continuation" });
  const material = { target, refs: references, h3: native, flow: flowBasis, packs: expanded.snapshots };
  // Script links are persisted as canvas metadata rather than generation settings.
  const settings = Object.fromEntries(Object.entries(payload.params ?? {}).filter(([key]) => !key.startsWith("script_")));
  return {
    stage: target.stage,
    payload,
    checked: { expanded, source: flowSource && { row: flowSource.row, task: flowSource.task } },
    sources: base.sources,
    references: referenceMedia,
    pack_texts: expanded.texts,
    unfixedSources,
    material,
    basis: await directorBasis({
      material,
      payload: { ...payload, prompt: expanded.prompt, refs: references, params: settings },
    }),
  };
}

export async function resolveDirectorInputBasis(
  sql: Sql,
  project: InputProject,
  document: CanvasDocument,
  target: DirectorTarget,
): Promise<string> {
  return (await resolveDirectorInput(sql, project, document, target)).basis;
}

export async function inspectDirectorShotInputs(
  sql: Sql,
  project: InputProject,
  document: CanvasDocument,
  node: CanvasNode,
  bindings?: CanvasSubmissionModels,
  options?: { adoption?: boolean; lock?: boolean },
): Promise<Omit<DirectorShotInputs, "revision">> {
  const result: Omit<DirectorShotInputs, "revision"> = {
    description: "", story_basis: null, material_basis: null,
    references: [], pack_texts: [], visual_issues: [], material_issues: [], voices: [], audio_input_bases: {}, audio_inputs: {},
  };
  const sources = await resolveCanvasSources(sql, project.id, document, node.id, options?.lock, options?.adoption || options?.lock);
  const texts = sources.filter(({ kind }) => kind === "text");
  const raw = canvasRawPrompt(texts.flatMap(({ value }) => value ? [value] : []), node);
  result.description = raw;
  if (raw && [...raw].length <= 12000 && texts.every(({ value }) => value)) {
    result.description = canvasVisualPrompt(raw, node);
    result.story_basis = await directorBasis({
      node: node.id,
      prompt: result.description,
      seconds: node.params.seconds,
      narration: pythonStrip(node.narration_text),
      dialogues: node.dialogue_lines?.filter((line) => pythonStrip(line.text))
        .map(({ id, speaker, text }) => ({ id, speaker, text: pythonStrip(text) })) ?? [],
    });
  }

  const models = bindings ?? await CanvasSubmissionModels.read(sql, { strict: false });
  const materials: unknown[] = [];
  let visualBasis: string | undefined;
  try {
    const visual = await resolveDirectorInput(sql, project, document, { node_id: node.id, stage: "video" }, models, { sources, lock: options?.lock });
    if (visual.stage === "video") {
      visualBasis = visual.basis;
      materials.push(visual.material);
      result.references = visual.references;
      result.pack_texts = visual.pack_texts;
      result.visual_issues.push(...visual.unfixedSources.map((title) => `请固定参考图“${title}”`));
    }
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    result.visual_issues.push(error.message);
  }
  for (const target of directorAudioTargets(node)) {
    try {
      const input = await resolveDirectorInput(sql, project, document, target, models, { lock: options?.lock });
      materials.push(input.material);
      if (input.stage !== "dialogue" && input.stage !== "narration") continue;
      const key = directorTargetKey(target);
      result.audio_input_bases[key] = input.basis;
      result.audio_inputs[key] = {
        basis: input.basis,
        model: input.payload.model,
        pack_id: input.stage === "dialogue" ? input.voice.packId : null,
        voice_id: input.stage === "dialogue" ? input.voice.voiceId ?? null : null,
        instruction: input.payload.instruction ?? "",
        ...(options?.adoption && "params" in input.payload ? { params: input.payload.params } : {}),
      };
      if (input.stage === "dialogue") {
        result.voices.push({
          speaker: input.line.speaker,
          model: input.payload.model,
          pack_id: input.voice.packId ?? undefined,
          voice: input.voice.voiceId,
          rate: input.voice.rate,
          pitch: input.voice.pitch,
          instruction: input.voice.instruction || undefined,
        });
      } else if (input.stage === "narration") {
        result.voices.push({ speaker: "旁白", model: input.payload.model, instruction: input.payload.instruction || undefined });
      }
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      result.material_issues.push(error.message);
    }
  }
  if (result.visual_issues.length === 0 && result.material_issues.length === 0)
    result.material_basis = await directorBasis({ materials, audio_strategy: node.audio_strategy ?? "replace" });
  if (options?.adoption) {
    const audioTargets = directorAudioTargets(node).map((target) => {
      const line = node.dialogue_lines?.find(({ id }) => id === target.line_id);
      const { model, pack_id, voice_id, instruction } = line ?? {};
      return {
        target,
        basis: result.audio_input_bases[directorTargetKey(target)],
        settings: line
          ? { model, pack_id, voice_id, instruction }
          : { model: node.narration_model, instruction: node.narration_instruction },
      };
    });
    result.adoption_input_basis = await directorBasis({
      node: node.id,
      story: result.story_basis ?? result.description,
      material: result.material_basis,
      audio: audioTargets,
      strategy: node.audio_strategy ?? "replace",
      ...(node.audio_strategy === "mix" ? { gain: node.original_audio_gain ?? 0.35 } : {}),
      visual: visualBasis ?? await legacyAdoptionVisual(sql, project, document, node, sources, options.lock),
    });
  }
  return result;
}

// An existing clip may have been adopted before the shot could be generated in
// the Director Desk. Retaining it still captures the editable inputs and live
// references that can affect the shot.
async function legacyAdoptionVisual(
  sql: Sql,
  project: InputProject,
  document: CanvasDocument,
  node: CanvasNode,
  sources: Awaited<ReturnType<typeof resolveCanvasSources>>,
  lock = false,
) {
  const packIds = node.asset_packs.map(({ id }) => id);
  const packs = packIds.length ? (await sql.query(
    `SELECT public_id, revision FROM documents
     WHERE workspace_id=$1 AND kind='pack' AND NOT deleted AND public_id=ANY($2::text[])
     ORDER BY id ${lock ? "FOR SHARE" : ""}`,
    [project.workspace_id, packIds],
  )).rows : [];
  const tail = node.tail_inherited
    ? document.nodes.find(({ id }) => id === canvasTailSourceId(document, node.id))
    : undefined;
  const native = node.params.h3;
  const mediaIds = [...new Set([
    ...sources.flatMap(({ kind, value }) => kind === "image" && value ? [value] : []),
    ...node.params.h3_refs,
    ...(native ? [native.first_frame, native.last_frame, ...native.video_audio] : []),
  ].filter((value): value is string => Boolean(value)))];
  const media = mediaIds.length ? (await sql.query(
    `SELECT public_id, state FROM assets WHERE workspace_id=$1 AND public_id=ANY($2::text[]) ORDER BY id`,
    [project.workspace_id, mediaIds],
  )).rows : [];
  return {
    prompt: node.prompt,
    storyboard: {
      narration: pythonStrip(node.narration_text),
      dialogue: node.dialogue_lines?.filter((line) => pythonStrip(line.text))
        .map(({ id, speaker, text }) => ({ id, speaker, text: pythonStrip(text) })),
    },
    params: node.params,
    extra: Object.fromEntries(Object.entries(node.extra_params ?? {}).filter(([key]) => !key.startsWith("script_"))),
    cinematography: node.cinematography,
    mode: node.generation_mode,
    grid: node.grid_layout,
    inheritTail: node.tail_inherited ?? false,
    sources: sources.map(({ node: source, kind, value }) => ({ id: source.id, kind, value })),
    media,
    packBindings: node.asset_packs,
    packs,
    ...(tail ? { tail: { id: tail.id, media: await canvasNodeMedia(sql, project.id, tail, false, true, lock) } } : {}),
  };
}
