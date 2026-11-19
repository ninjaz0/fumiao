import { resolve as resolveFlow } from "../../../legacy/pure/canvas/src/flowPicker";

export type Member = {
  id: number;
  name: string;
  nickname?: string;
  avatar?: string;
  avatar_url?: string;
  role: string;
};
export type Space = {
  id: number;
  name: string;
  kind: "personal" | "team";
  member_count: number;
  revision: number;
  members?: number[];
};
export type ManagedMember = Member & { active: number };
export type InviteCode = {
  id: number;
  code: string;
  name: string;
  enabled: boolean;
  expires: number | null;
  grant_credits: boolean;
  initial_credits: number;
  team_id: number | null;
  uses: number;
  revision: number;
};
export type CreditEntry = {
  id: number;
  action: string;
  amount: number;
  created: number;
  actor_name?: string | null;
  note?: string | null;
  job?: number | null;
};
export type CreditAccount = {
  workspace: number;
  kind: Space["kind"];
  name: string;
  username: string | null;
  available: number;
  reserved: number;
};
type ModelPolicy = { revision: number; enabled: Record<string, boolean> };
type ModelKind = "video" | "image" | "audio" | "chat";
type ModelGroup = { kind: ModelKind; label: string; models: string[] };
export type Asset = {
  id: string;
  owner: number;
  kind?: "ref" | "ref_video" | "ref_audio";
  w: number;
  h: number;
  seconds?: number;
  has_audio?: boolean;
};
export type GpuNode = {
  id: number;
  name: string;
  stage: "preparing" | "ready" | "busy" | "error" | "offline";
  control: "active" | "paused" | "draining";
  contributor: string;
  models?: string[] | null;
  profile?: { gpu_name?: string; vram_gib?: number };
  detail: string;
};
export type Job = {
  id: number;
  author: string;
  owner: number;
  kind: "video" | "image" | "audio";
  model: string;
  prompt: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  result?: string;
  refs: string[];
  seconds: number;
  created: number;
  ratio: string;
  quality: number;
  image_quality?: "low" | "medium" | "high";
  sampling_steps?: number;
  seed?: number;
  h3_inputs?: H3Options;
  audio_settings?: { instruction?: string };
  width?: number;
  height?: number;
  actual?: {
    duration?: number;
    width?: number;
    height?: number;
    canvas_project?: string;
    storyboard_export?: string;
    flow_source_job?: number;
    flow_media_id?: string;
  };
  node?: number | null;
  note?: string;
  ahead?: number;
  timing?: {
    source: string;
    elapsed: number;
    total: number;
    queue: number;
    attempt: number;
    prepare?: number;
    generation?: number;
    finalize?: number;
    upload?: number;
    validation?: number;
    phase_source?: string;
    prediction?: { median?: number; high?: number };
  };
  eta?: {
    phase?: string;
    reason?: string;
    median?: number;
    high?: number;
    elapsed?: number;
    overdue?: boolean;
  };
};
export type StudioState = {
  studio_plugins?: boolean;
  me: Member;
  avatars: { id: string; label: string; url: string }[];
  workspaces: Space[];
  users?: ManagedMember[];
  invite_codes?: InviteCode[];
  workspace_id: number;
  legacy_workspace_id: number;
  used?: number;
  reserved?: number;
  quota?: number;
  disk_free?: number;
  jobs: Job[];
  nodes: GpuNode[];
  gpu_models?: Record<string, { label: string; min_vram_gib: number }>;
  assets: Asset[];
  favorites: string[];
  ratios: string[];
  sizes: Record<string, number[]>;
  video_models: Record<string, string>;
  audio_models: Record<string, string>;
  model_access?: Record<string, boolean>;
  model_policy: ModelPolicy;
  team_model_policies?: Record<string, ModelPolicy>;
  model_groups: Record<string, ModelGroup>;
  model_catalog: Record<
    string,
    {
      provider: string;
      label: string;
      family?: string;
      family_label?: string;
      mode?: string;
      ratio?: string;
      resolution?: string;
      seconds?: number;
      min_refs?: number;
      max_refs?: number;
      hidden?: boolean;
    }
  >;
  images: {
    enabled: boolean;
    configured: boolean;
    models: Record<string, string>;
    default_model: string;
    sizes: Record<string, number[]>;
  };
  flow: { configured: boolean };
  pricing: {
    items: {
      key: string;
      model: string;
      kind: ModelKind;
      label: string;
      amount: number | null;
    }[];
    revision: number;
  };
  credits: { available: number; reserved: number };
  credit_history: CreditEntry[];
  credit_accounts?: CreditAccount[];
};
export const H3 = "MiniMax H3";
export type FrameSlot = "first_frame" | "last_frame";
type H3Options = {
  mode: "reference" | "frames";
  first_frame?: string | null;
  last_frame?: string | null;
  video_audio?: string[];
};
export type Pack = { id: string; revision: number; media: string[] };
export const emptyH3 = {
  mode: "reference" as const,
  first_frame: null,
  last_frame: null,
  video_audio: [] as string[],
};
const initialDraft = {
  audioModel: "breeze-tts-2",
  voiceDescription: "",
  kind: "video" as Job["kind"],
  videoModel: H3,
  prompt: "",
  ratio: "16:9",
  quality: "480",
  seconds: "5",
  sampling_steps: 20,
  fast_mode: false,
  seed: "",
  model: "",
  imageQuality: "medium",
  resolution: "1K",
};
export type Draft = typeof initialDraft & {
  h3?: H3Options;
  packs?: Pack[];
  flowSourceJob?: number | null;
  h3ReferenceDraft?: {
    refs: string[];
    prompt: string;
    packs: Pack[];
    video_audio: string[];
  };
  h3FrameInitialPrompt?: string;
};
type DraftSnapshot = {
  draft: Draft;
  refs: string[];
  parent: number | null;
  retainedSeed: number | null;
  submitId: string;
};
export type DraftSession = DraftSnapshot & {
  suspendedImageDraft: DraftSnapshot | null;
};
export const displayName = (member: Member) => member.nickname || member.name;
export const mediaURL = (key: string) => "/media/" + key;
export function modelAvailable(state: StudioState, model: string) {
  if (
    !model ||
    (state.model_access || state.model_policy?.enabled)?.[model] !== true
  )
    return false;
  if (
    ["gpt-image-2.6-sunburst", "muse-image"].includes(model) &&
    !state.images.enabled
  )
    return false;
  if (state.model_catalog[model]?.provider === "flow")
    return Boolean(state.flow?.configured);
  return model !== "gpt-image-2.6-sunburst" || state.images.configured;
}
const keyFor = (state: StudioState) =>
  `fm-draft-${state.me.id}-workspace-${state.workspace_id}`;
export function readDraft(state: StudioState): DraftSession {
  const key = keyFor(state);
  const legacyKey = `fm-draft-${state.me.id}`;
  const legacy =
    state.workspace_id === state.legacy_workspace_id
      ? sessionStorage.getItem(legacyKey)
      : null;
  if (!sessionStorage.getItem(key) && legacy) {
    sessionStorage.setItem(key, legacy);
    sessionStorage.removeItem(legacyKey);
  }
  let saved: Partial<DraftSession> | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
  } catch {}
  const draft = { ...initialDraft, ...saved?.draft };
  if (saved?.draft) {
    if (!["image", "audio"].includes(draft.kind)) draft.kind = "video";
    if (!state.images.models[draft.model])
      draft.model = state.images.default_model;
    if (!state.video_models[draft.videoModel]) draft.videoModel = H3;
    if (!["low", "medium", "high"].includes(draft.imageQuality))
      draft.imageQuality = "medium";
    if (!state.ratios.includes(draft.ratio)) draft.ratio = "16:9";
    if (!["480", "768"].includes(String(draft.quality))) draft.quality = "480";
  }
  return {
    parent: null,
    retainedSeed: null,
    suspendedImageDraft: null,
    ...saved,
    refs: (saved?.refs || []).filter((id) =>
      state.assets.some((asset) => asset.id === id),
    ),
    draft: saved?.draft ? normalizeParams(state, draft) : draft,
    submitId: saved?.submitId || crypto.randomUUID(),
  };
}
export function writeDraft(state: StudioState, session: DraftSession) {
  sessionStorage.setItem(keyFor(state), JSON.stringify(session));
}

export const selectedModel = (draft: Draft) =>
  (draft.kind === "image"
    ? draft.model
    : draft.kind === "audio"
      ? draft.audioModel
      : draft.videoModel) || "";
export const isH3 = (draft: Draft) =>
  draft.kind === "video" && selectedModel(draft) === H3;
export const isMuseDraft = (draft: Draft) =>
  ["muse-image", "muse-video"].includes(selectedModel(draft));
export const promptLimit = (draft: Draft) =>
  draft.kind === "audio" ? 300 : 12000;
export const imageQualityLabels = { low: "草稿", medium: "标准", high: "高清" };
export const creationOptions = [
  ["video", "视频生成", "film"],
  ["image", "图片生成", "picture"],
  ["audio", "语音生成", "voice"],
] as const;
export const modelsForKind = (state: StudioState, kind: Job["kind"]) =>
  kind === "audio"
    ? state.audio_models
    : kind === "image"
      ? state.images.models
      : state.video_models;
export const flowSpec = (state: StudioState, model: string) => {
  const spec = state.model_catalog[model];
  return spec?.provider === "flow" ? spec : undefined;
};

export function chooseModel(draft: Draft, model: string): Draft {
  if (draft.kind === "audio") return { ...draft, audioModel: model };
  if (draft.kind === "image") return { ...draft, model };
  return {
    ...draft,
    videoModel: model,
    seconds: model === "muse-video" ? "6" : draft.seconds,
  };
}
export function ensureModel(state: StudioState, draft: Draft) {
  const models = Object.keys(modelsForKind(state, draft.kind)).filter((id) =>
    modelAvailable(state, id),
  );
  if (
    models.includes(selectedModel(draft)) ||
    (!models.length && !selectedModel(draft))
  )
    return draft;
  return normalizeParams(state, chooseModel(draft, models[0] || ""));
}
export function standardSteps(value?: number) {
  const steps = Number(value);
  return [16, 20, 32, 50].includes(steps) ? steps : 20;
}
function effectiveSteps(draft: Pick<Draft, "sampling_steps" | "fast_mode">) {
  return draft.fast_mode || Number(draft.sampling_steps) === 4
    ? 4
    : standardSteps(draft.sampling_steps);
}
export function videoDurations(draft: Draft) {
  return isMuseDraft(draft) ? ["5", "6", "8", "10"] : ["5", "10", "15"];
}
export function ratiosFor(state: StudioState, draft: Draft) {
  if (!isMuseDraft(draft)) return state.ratios;
  return draft.kind === "image"
    ? ["1:1", "16:9", "9:16", "4:3", "3:4"]
    : ["16:9", "9:16"];
}
export function normalizeParams(state: StudioState, draft: Draft): Draft {
  const flow = flowSpec(state, selectedModel(draft));
  if (flow) {
    return {
      ...draft,
      ratio: flow.ratio || draft.ratio,
      seconds: String(flow.seconds ?? draft.seconds),
      resolution: flow.resolution === "原生" ? "1K" : flow.resolution || "1K",
      imageQuality: "medium",
      seed: "",
      fast_mode: false,
      sampling_steps: 20,
      flowSourceJob: flow.mode === "extend" ? draft.flowSourceJob : null,
    };
  }
  const next = {
    ...draft,
    flowSourceJob: null,
    resolution: ["1K", "2K"].includes(draft.resolution)
      ? draft.resolution
      : "1K",
    fast_mode: draft.fast_mode === true || Number(draft.sampling_steps) === 4,
    sampling_steps: standardSteps(draft.sampling_steps),
  };
  if (draft.kind === "audio")
    return { ...next, seed: Number(draft.seed) > 4294967295 ? "" : draft.seed };
  if (!ratiosFor(state, draft).includes(draft.ratio)) next.ratio = "16:9";
  if (!isMuseDraft(draft)) {
    if (!["480", "768"].includes(String(draft.quality))) next.quality = "480";
    if (!["low", "medium", "high"].includes(draft.imageQuality))
      next.imageQuality = "medium";
  }
  if (
    draft.kind === "video" &&
    !videoDurations(draft).includes(String(draft.seconds))
  ) {
    next.seconds = isMuseDraft(draft) ? "6" : "5";
  }
  return next;
}
export function changeFlow(
  state: StudioState,
  draft: Draft,
  patch: { ratio?: string; seconds?: number; mode?: string },
) {
  const flow = flowSpec(state, selectedModel(draft));
  if (!flow?.family) return null;
  const videoModel = resolveFlow(
    state.model_catalog,
    selectedModel(draft),
    (id) => modelAvailable(state, id),
    {
      ratio: draft.ratio,
      seconds: Number(draft.seconds),
      mode: flow.mode,
      ...patch,
    },
  );
  if (!videoModel) return null;
  return normalizeParams(state, {
    ...draft,
    videoModel,
    flowSourceJob:
      state.model_catalog[videoModel].ratio === draft.ratio
        ? draft.flowSourceJob
        : null,
  });
}
export function h3Options(value?: H3Options) {
  return {
    mode: value?.mode || "reference",
    first_frame: value?.first_frame || null,
    last_frame: value?.last_frame || null,
    video_audio: value?.video_audio || [],
  };
}
function jobH3(job: Job) {
  return h3Options(
    job.h3_inputs?.mode
      ? job.h3_inputs
      : job.refs.length === 1
        ? { mode: "frames", first_frame: job.refs[0] }
        : undefined,
  );
}
export const frames = (draft: Draft) =>
  isH3(draft) && draft.h3?.mode === "frames";
export function activeReferences({ draft, refs }: DraftSession) {
  const { first_frame, last_frame } = h3Options(draft.h3);
  return frames(draft)
    ? [...new Set([first_frame, last_frame].filter((id): id is string => !!id))]
    : refs;
}
export function packReferences(session: DraftSession) {
  return [
    ...new Set([
      ...activeReferences(session),
      ...(session.draft.packs || []).flatMap((pack) => pack.media),
    ]),
  ];
}
export const referenceAsset = (state: StudioState, id: string | null) =>
  state.assets.find((asset) => asset.id === id);
export function referenceType(state: StudioState, id: string) {
  const kind = referenceAsset(state, id)?.kind;
  return kind === "ref_video"
    ? "Video"
    : kind === "ref_audio"
      ? "Audio"
      : "Picture";
}
export function referenceIndex(state: StudioState, id: string, refs: string[]) {
  return (
    refs
      .filter((key) => referenceType(state, key) === referenceType(state, id))
      .indexOf(id) + 1
  );
}
export function referenceLabel(state: StudioState, id: string, refs: string[]) {
  return (
    { Picture: "图片", Video: "视频", Audio: "音频" }[
      referenceType(state, id)
    ] + referenceIndex(state, id, refs)
  );
}

function frameRatiosDiffer(first?: Asset, last?: Asset) {
  return !!(
    first?.w &&
    first.h &&
    last?.w &&
    last.h &&
    Math.abs(Math.log(first.w / first.h / (last.w / last.h))) > 0.035
  );
}
export function changeH3Mode(
  state: StudioState,
  session: DraftSession,
  mode: H3Options["mode"],
): DraftSession {
  const { draft, refs } = session;
  const old = h3Options(draft.h3);
  if (old.mode === mode) return session;
  if (mode === "frames") {
    const images = packReferences(session).filter(
      (id) => referenceType(state, id) === "Picture",
    );
    const [first, last] = images;
    const lastFrame =
      first &&
      last &&
      !frameRatiosDiffer(
        referenceAsset(state, first),
        referenceAsset(state, last),
      )
        ? last
        : null;
    const prompt = draft.prompt.replace(
      /<(Picture|Video|Audio) (\d+)>/g,
      (_, type, index) =>
        type === "Picture" && index === "1"
          ? "首帧"
          : type === "Picture" && index === "2" && lastFrame
            ? "尾帧"
            : "",
    );
    return {
      ...session,
      draft: {
        ...draft,
        prompt,
        packs: [],
        h3FrameInitialPrompt: prompt,
        h3ReferenceDraft: {
          refs,
          prompt: draft.prompt,
          packs: draft.packs || [],
          video_audio: old.video_audio,
        },
        h3: {
          ...emptyH3,
          mode,
          first_frame: first || null,
          last_frame: lastFrame,
        },
      },
    };
  }
  const { h3ReferenceDraft: saved, ...values } = draft;
  const prompt =
    saved && draft.prompt === draft.h3FrameInitialPrompt
      ? saved.prompt
      : draft.prompt;
  return {
    ...session,
    refs: [
      ...new Set([...(saved?.refs || refs), ...activeReferences(session)]),
    ].filter((id) => referenceAsset(state, id)),
    draft: {
      ...values,
      prompt,
      h3FrameInitialPrompt: prompt,
      packs: saved?.packs || [],
      h3: { mode, video_audio: saved?.video_audio || [] },
    },
  };
}
export function assignFrame(
  state: StudioState,
  session: DraftSession,
  id: string,
  slot?: FrameSlot,
): DraftSession {
  if (referenceType(state, id) !== "Picture")
    throw new Error("首尾帧只接收图片");
  const options = h3Options(session.draft.h3);
  slot ||= !options.first_frame
    ? "first_frame"
    : !options.last_frame
      ? "last_frame"
      : undefined;
  if (!slot) throw new Error("两个帧位置已填满，请先移除或替换图片");
  const other = options[slot === "first_frame" ? "last_frame" : "first_frame"];
  if (
    frameRatiosDiffer(referenceAsset(state, other), referenceAsset(state, id))
  ) {
    throw new Error("请上传比例相同的首尾帧图片");
  }
  return {
    ...session,
    draft: { ...session.draft, h3: { ...options, [slot]: id } },
  };
}
export function checkImages(
  state: StudioState,
  session: DraftSession,
  ids: string[],
  existing = packReferences(session),
) {
  const images = [...new Set(ids)];
  if (
    images.some(
      (id) =>
        !referenceAsset(state, id) || referenceType(state, id) !== "Picture",
    )
  )
    throw new Error("图片已移除或不在当前空间，请重新选择");
  const combined = [...new Set([...existing, ...images])];
  if (
    combined.filter((id) => referenceType(state, id) === "Picture").length > 9
  )
    throw new Error("最多选择 9 张参考图片，请先移除部分图片");
  if (combined.length > (isH3(session.draft) ? 12 : 9))
    throw new Error("参考素材已达上限，请先移除部分素材");
  return images.filter((id) => !existing.includes(id));
}
export function addImages(
  state: StudioState,
  session: DraftSession,
  ids: string[],
): DraftSession {
  const added = checkImages(state, session, ids);
  if (!added.length) return session;
  return frames(session.draft)
    ? added.reduce((current, id) => assignFrame(state, current, id), session)
    : { ...session, refs: [...session.refs, ...added] };
}

export function referenceIssue(
  state: StudioState,
  session: DraftSession,
  job?: Job,
) {
  const { draft } = session;
  const keys = job ? job.refs : packReferences(session);
  const kind = job?.kind || draft.kind;
  const model = job ? job.model : selectedModel(draft);
  if (kind === "audio") return "";
  if (model !== H3) {
    return keys.some((id) => referenceType(state, id) !== "Picture")
      ? "这个模型只接收图片，请移除视频和音频参考"
      : "";
  }
  const h3 = job ? jobH3(job) : h3Options(draft.h3);
  if (h3.mode === "frames")
    return frameRatiosDiffer(
      referenceAsset(state, h3.first_frame),
      referenceAsset(state, h3.last_frame),
    )
      ? "请使用比例相同的首尾帧图片"
      : "";
  if (keys.length > 12) return "最多选择 12 个参考素材";
  for (const [type, max, label] of [
    ["Picture", 9, "图片"],
    ["Video", 3, "视频"],
    ["Audio", 3, "音频"],
  ] as const) {
    const files = keys
      .filter((id) => referenceType(state, id) === type)
      .map((id) => referenceAsset(state, id));
    if (files.length > max) return `最多选择 ${max} 个${label}参考`;
    if (
      type !== "Picture" &&
      files.reduce((total, asset) => total + (asset?.seconds || 0), 0) > 15.05
    )
      return `参考${label}总时长不能超过 15 秒`;
    if (
      type === "Video" &&
      files.some(
        (asset) =>
          (asset?.seconds || 0) > Number(job?.seconds ?? draft.seconds) + 0.05,
      )
    )
      return "生成时长不能短于参考视频，请调整时长";
  }
  return "";
}
export function flowIssue(
  state: StudioState,
  session: DraftSession,
  job?: Job,
) {
  const spec = flowSpec(state, job ? job.model : selectedModel(session.draft));
  if (!spec) return "";
  const count = (job ? job.refs : packReferences(session)).length;
  if (spec.min_refs !== undefined && count < spec.min_refs)
    return `请添加至少 ${spec.min_refs} 张参考图片`;
  if (spec.max_refs !== undefined && count > spec.max_refs)
    return spec.max_refs
      ? `这个模型最多接收 ${spec.max_refs} 张参考图片`
      : "这个模型不接收参考图片，请移除参考图或选择图生视频模型";
  return spec.mode === "extend" &&
    !(job ? job.actual?.flow_source_job : session.draft.flowSourceJob)
    ? "请选择来源视频"
    : "";
}

export function estimateBody(session: DraftSession) {
  const { draft } = session;
  const audio = draft.kind === "audio";
  return {
    kind: draft.kind,
    model: selectedModel(draft),
    ratio: draft.ratio,
    quality: Number(draft.quality),
    seconds: Number(draft.seconds),
    sampling_steps: isH3(draft) ? effectiveSteps(draft) : 20,
    resolution: draft.resolution,
    image_quality: draft.imageQuality,
    refs: audio ? [] : packReferences(session),
    ...(isH3(draft) ? { h3: h3Options(draft.h3) } : {}),
    ...(audio
      ? {
          text_chars: Math.min(300, draft.prompt.length),
          language: /[一-鿿]/.test(draft.prompt) ? "zh" : "en",
          audio_instruction: draft.voiceDescription || "",
        }
      : {}),
  };
}

export function loadJob(
  state: StudioState,
  session: DraftSession,
  job: Job,
): DraftSession {
  const image = job.kind === "image";
  const audio = job.kind === "audio";
  const draft = normalizeParams(state, {
    ...initialDraft,
    h3: job.kind === "video" && job.model === H3 ? jobH3(job) : undefined,
    flowSourceJob: job.actual?.flow_source_job || null,
    audioModel: audio ? job.model : initialDraft.audioModel,
    voiceDescription: job.audio_settings?.instruction || "",
    kind: job.kind,
    videoModel: image ? H3 : job.model,
    model: image ? job.model : "",
    imageQuality: job.image_quality || "medium",
    resolution: job.quality === 2048 ? "2K" : "1K",
    prompt: job.prompt,
    ratio: job.ratio,
    quality: image ? "480" : String(job.quality),
    seconds: image ? "5" : String(job.seconds),
    sampling_steps: standardSteps(job.sampling_steps),
    fast_mode: Number(job.sampling_steps) === 4,
  });
  return {
    ...session,
    draft: ensureModel(state, draft),
    refs: [...job.refs],
    parent: job.id,
    retainedSeed:
      image || isMuseDraft(draft) || flowSpec(state, job.model)
        ? null
        : (job.seed ?? null),
  };
}
export function generationRequest(
  state: StudioState,
  session: DraftSession,
  job?: Job,
  retryId?: string,
) {
  const { draft, parent, submitId, refs } = session;
  const kind = job?.kind || draft.kind;
  const model = job
    ? job.model || (kind === "image" ? state.images.default_model : H3)
    : selectedModel(draft);
  const common = {
    prompt: job ? job.prompt : draft.prompt,
    parent: job?.id ?? parent,
    uid: retryId ?? submitId,
    price_revision: state.pricing?.revision,
  };
  const seed = job || draft.seed === "" ? null : Number(draft.seed);
  if (kind === "audio")
    return {
      kind,
      path: "/api/audio-jobs",
      body: {
        ...common,
        model,
        seed,
        instruction:
          (job ? job.audio_settings?.instruction : draft.voiceDescription) ||
          "",
      },
    };
  const asset_packs = job
    ? []
    : (draft.packs || []).map(({ id, revision }) => ({ id, revision }));
  if (kind === "image")
    return {
      kind,
      path: "/api/image-jobs",
      body: {
        ...common,
        model,
        asset_packs,
        refs: job?.refs ?? refs,
        ratio: job?.ratio ?? draft.ratio,
        resolution: job
          ? job.quality === 2048
            ? "2K"
            : "1K"
          : draft.resolution,
        image_quality: job
          ? flowSpec(state, model)
            ? "medium"
            : job.image_quality
          : draft.imageQuality,
      },
    };
  const { h3, ...values } = draft;
  return {
    kind,
    path: "/api/jobs",
    body: {
      ...(job ? {} : values),
      ...common,
      model,
      seed,
      asset_packs,
      refs: job?.refs ?? activeReferences(session),
      ratio: job?.ratio ?? draft.ratio,
      quality: job?.quality ?? Number(draft.quality),
      seconds: job?.seconds ?? Number(draft.seconds),
      sampling_steps:
        model === H3
          ? job
            ? effectiveSteps({
                sampling_steps: job.sampling_steps ?? 20,
                fast_mode: false,
              })
            : effectiveSteps(draft)
          : 20,
      flow_source_job:
        (job ? job.actual?.flow_source_job : draft.flowSourceJob) || null,
      ...(model === H3 ? { h3: job ? jobH3(job) : h3Options(h3) } : {}),
    },
  };
}
export const resultTab = (kind: Job["kind"]) =>
  kind === "image" ? "images" : kind === "audio" ? "audio" : "videos";

export function quote(state: StudioState, draft: Draft) {
  const model = selectedModel(draft);
  const tier =
    flowSpec(state, model) || model === "muse-image"
      ? "native"
      : draft.kind === "audio"
        ? "standard"
        : model === "muse-video"
          ? String(draft.seconds)
          : draft.kind === "image"
            ? `${draft.resolution}|${draft.imageQuality}`
            : `${draft.quality}|${draft.seconds}`;
  const amount =
    state.pricing?.items.find(({ key }) => key === `${model}|${tier}`)
      ?.amount ?? undefined;
  const available = state.credits?.available || 0;
  return {
    amount,
    available,
    allowed: amount !== undefined && available >= amount,
    label:
      amount === undefined
        ? "未定价"
        : `${amount} 积分${available < amount ? " · 余额不足" : ""}`,
  };
}
