import { canvasSourceKind } from "@fumiao/plugin-sdk/canvas-ports.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import { CanvasSubmissionModels } from "@fumiao/platform/canvas-submission.js";
import type { Sql } from "@fumiao/platform/db.js";
import { DomainError, requireValue } from "@fumiao/platform/security.js";
import {
  canvasTailSourceId,
  directorAudioTargets,
  directorBasis,
  type DirectorShotInputs,
  type DirectorTarget,
} from "@fumiao/web-compat/director.js";
import type { CanvasDocument, CanvasNode, CinematographySpec } from "./canvas-draft.js";
import { canvasNodeMedia } from "./canvases.js";
import { resolveDialogueInput } from "./dialogue.js";

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
      : node.extension ? output || null : await canvasNodeMedia(sql, projectId, node);
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

async function directorPacks(sql: Sql, workspaceId: string, node: CanvasNode) {
  if (!node.asset_packs.length) return [];
  const ids = node.asset_packs.map(({ id }) => id);
  requireValue(new Set(ids).size === ids.length, 400, "请勿重复引用素材包");
  const { rows } = await sql.query<{
    id: string;
    title: string;
    revision: number;
    body: { purpose?: string; description?: string };
    pack_text: { name: string; description: string } | null;
    media: (string | null)[];
  }>(
    `SELECT d.public_id AS id, d.title, d.revision, d.body, d.pack_text,
        ARRAY(SELECT a.public_id FROM jsonb_array_elements_text(COALESCE(d.body->'assets','[]')) WITH ORDINALITY AS s(id, position)
          LEFT JOIN assets a ON a.id=s.id::uuid AND a.state='ready' AND a.workspace_id=d.workspace_id
          ORDER BY s.position) AS media
      FROM documents d
      WHERE d.public_id=ANY($1::text[]) AND d.workspace_id=$2 AND d.kind='pack' AND NOT d.deleted`,
    [ids, workspaceId],
  );
  const byId = new Map(rows.map((pack) => [pack.id, pack]));
  return node.asset_packs.map(({ id, revision }) => {
    const pack = byId.get(id);
    requireValue(pack, 409, `素材包 ${id.slice(0, 6)} 已删除或不可访问`);
    const { name, description } = pack.pack_text ?? { name: pack.title, description: pack.body.description ?? "" };
    requireValue(Number(pack.revision) === revision, 409, `素材包“${name}”已有新版本，请重新选择`);
    const media = pack.media.filter((id): id is string => Boolean(id));
    requireValue(media.length === pack.media.length && media.length, 409, `素材包“${name}”缺少可用图片`);
    return { id, revision, name, description, purpose: pack.body.purpose || "subject", media };
  });
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
  sources?: Awaited<ReturnType<typeof resolveCanvasSources>>,
) {
  const node = document.nodes.find(({ id }) => id === target.node_id);
  requireValue(node && node.type === (target.stage === "image" ? "image" : "video"), 400, "生成阶段与节点类型不匹配");
  requireValue(target.stage === "dialogue" ? Boolean(target.line_id) : target.line_id === undefined, 400, "对白生成需要选择对应的台词");

  if (target.stage === "dialogue") {
    const line = node.dialogue_lines?.find(({ id }) => id === target.line_id);
    requireValue(line, 400, "未找到可合成的对白台词");
    const input = await resolveDialogueInput(sql, project.workspace_id, line, bindings ?? await CanvasSubmissionModels.read(sql));
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
  const base = await resolveCanvasVisualBase(sql, project.id, document, node, bindings ?? await CanvasSubmissionModels.read(sql), sources);
  const payload = canvasVisualPayload(node, base);
  const packs = await directorPacks(sql, project.workspace_id, node);
  const native = "h3" in payload ? payload.h3 : undefined;
  requireValue(native?.mode !== "frames" || !packs.length, 400, "首尾帧模式请在画布槽位中直接选择图片");
  const references = [...new Set([...payload.refs, ...packs.flatMap((pack) => pack.media)])];
  const mediaToCheck = [...new Set([
    ...references,
    ...(native?.video_audio ?? []),
    ...base.sources.flatMap((source) => "media" in source ? [source.media] : []),
  ])];
  let referenceMedia: DirectorShotInputs["references"] = [];
  if (mediaToCheck.length) {
    const { rows } = await sql.query<{ id: string; mime: string }>(
      "SELECT public_id AS id,mime FROM assets WHERE public_id=ANY($1::text[]) AND workspace_id=$2 AND state='ready'",
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
  const material = { target, refs: payload.refs, h3: native, flow_source_job: "flow_source_job" in payload ? payload.flow_source_job : undefined, packs };
  // Script links are persisted as canvas metadata rather than generation settings.
  const settings = Object.fromEntries(Object.entries(payload.params ?? {}).filter(([key]) => !key.startsWith("script_")));
  return {
    stage: target.stage,
    payload,
    sources: base.sources,
    references: referenceMedia,
    unfixedSources,
    material,
    basis: await directorBasis({ target, payload: { ...payload, params: settings }, packs }),
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
): Promise<Omit<DirectorShotInputs, "revision">> {
  const result: Omit<DirectorShotInputs, "revision"> = {
    description: "", story_basis: null, material_basis: null,
    references: [], visual_issues: [], material_issues: [], voices: [],
  };
  const sources = await resolveCanvasSources(sql, project.id, document, node.id);
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
  try {
    const visual = await resolveDirectorInput(sql, project, document, { node_id: node.id, stage: "video" }, models, sources);
    if (visual.stage === "video") {
      materials.push(visual.material);
      result.references = visual.references;
      result.visual_issues.push(...visual.unfixedSources.map((title) => `请固定参考图“${title}”`));
    }
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    result.visual_issues.push(error.message);
  }
  for (const target of directorAudioTargets(node)) {
    try {
      const input = await resolveDirectorInput(sql, project, document, target, models);
      materials.push(input.material);
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
  return result;
}
