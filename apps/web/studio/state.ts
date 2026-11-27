import type { MenuEntry, PluginPageEntry } from "@fumiao/plugin-sdk/contributions";
import type { InstalledSettingsPage } from "@fumiao/plugin-sdk/settings-pages";
import {
  mediaDownloadFilename,
  normalizeMediaMime,
} from "@fumiao/plugin-sdk/media-filename";
import { resolve as resolveFlow } from "../canvas-editor/flowPicker";
import {
  formError,
  matches,
  normalizeForm,
  type FormValues,
  type ModelForm,
} from "@fumiao/plugin-sdk/model-form";

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
  mime?: string;
  name?: string;
  w: number;
  h: number;
  seconds?: number;
  has_audio?: boolean | number;
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
  params?: FormValues;
  id: number;
  author: string;
  owner: number;
  kind: "video" | "image" | "audio";
  model: string;
  prompt: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  result?: string;
  results?: string[];
  result_mime?: string;
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
  settings_pages?: InstalledSettingsPage[];
  studio_plugins?: boolean;
  plugin_importers?: import("@fumiao/plugin-sdk/importers.js").ImporterEntry[];
  plugin_actions?: MenuEntry[];
  plugin_pages?: PluginPageEntry[];
  studio_pages?: PluginPageEntry[];
  gpu_node_settings?: {id:string;version:string;title:string;enabled:boolean;pending:number}|null;
  model_forms: Record<string, ModelForm>;
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
  model_plugin_access?: Record<string, boolean>;
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
    published?: {
      model: string;
      price: import("@fumiao/web-compat/model-access.js").PublishedPrice;
    }[];
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
export type Pack = {
  id: string;
  revision: number;
  media: string[];
  name?: string;
  purpose?: string;
};
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
  params?: FormValues;
  h3?: H3Options;
  suspendedH3Frames?: H3Options;
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
  suspendedAudioDraft: DraftSnapshot | null;
  suspendedMediaDraft: DraftSnapshot | null;
};
type ReferenceType = "Picture" | "Video" | "Audio";
type StoredReferenceTypes = Partial<
  Record<string, Exclude<ReferenceType, "Picture">>
>;
type StoredDraft = Partial<
  DraftSession & { referenceTypes: StoredReferenceTypes }
>;
function draftSnapshot(session: DraftSession): DraftSnapshot {
  return {
    draft: session.draft,
    refs: session.refs,
    parent: session.parent,
    retainedSeed: session.retainedSeed,
    submitId: session.submitId,
  };
}
export function suspendAudioDraft(session: DraftSession): DraftSnapshot | null {
  return session.draft.kind === "audio"
    ? draftSnapshot(session)
    : session.suspendedAudioDraft;
}
function savedReferenceType(state: StudioState, types?: StoredReferenceTypes) {
  return (id: string): ReferenceType => {
    const type = types?.[id];
    // Older drafts don't store types; a missing asset defaults to Picture.
    return type === "Video" || type === "Audio"
      ? type
      : referenceType(state, id);
  };
}
function restoreDraftReferences(
  state: StudioState,
  draft: Draft,
  storedRefs: string[] | undefined,
  storedTypes: StoredReferenceTypes | undefined,
) {
  if (draft.kind === "audio")
    return { draft: { ...draft, packs: [] }, refs: [] };
  const previousRefs = Array.isArray(storedRefs)
    ? storedRefs.filter((id) => typeof id === "string")
    : [];
  const refs = previousRefs.filter((id) => referenceAsset(state, id));
  if (refs.length === previousRefs.length || frames(draft)) return { draft, refs };
  const prompt = reindexPromptReferences(
    state,
    draft.prompt,
    packReferences({ draft, refs: previousRefs }),
    packReferences({ draft, refs }),
    savedReferenceType(state, storedTypes),
  );
  return { draft: { ...draft, prompt }, refs };
}
function readSnapshot(
  state: StudioState,
  value: unknown,
  storedTypes: StoredReferenceTypes | undefined,
): DraftSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<DraftSnapshot>;
  if (!raw.draft || typeof raw.draft !== "object") return null;
  const draft = { ...initialDraft, ...raw.draft };
  if (!state.studio_plugins) {
    if (!["image", "audio"].includes(draft.kind)) draft.kind = "video";
    if (!state.images.models[draft.model])
      draft.model = state.images.default_model;
    if (!state.video_models[draft.videoModel]) draft.videoModel = H3;
  }
  return {
    ...restoreDraftReferences(state, draft, raw.refs, storedTypes),
    parent: typeof raw.parent === "number" ? raw.parent : null,
    retainedSeed: typeof raw.retainedSeed === "number" ? raw.retainedSeed : null,
    submitId:
      typeof raw.submitId === "string" && raw.submitId
        ? raw.submitId
        : crypto.randomUUID(),
  };
}
export const displayName = (member: Member) => member.nickname || member.name;
export const mediaURL = (key: string) => "/media/" + key;
export function assetDownloadFilename(
  asset: Pick<Asset, "id" | "kind" | "mime" | "name">,
): string | undefined {
  const mime =
    normalizeMediaMime(asset.mime) ||
    (asset.kind === "ref_video"
      ? "video/mp4"
      : asset.kind === "ref_audio"
        ? "audio/wav"
        : undefined);
  if (!mime && !asset.name) return undefined;
  return mediaDownloadFilename(asset.id, mime, asset.name);
}
export function jobDownloadFilename(
  job: Pick<Job, "result" | "kind" | "result_mime">,
): string | undefined {
  if (!job.result) return undefined;
  const mime =
    normalizeMediaMime(job.result_mime) ||
    (job.kind === "video"
      ? "video/mp4"
      : job.kind === "audio"
        ? "audio/wav"
        : undefined);
  return mime ? mediaDownloadFilename(job.result, mime) : undefined;
}
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
function readStoredDraft(key: string): StoredDraft | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
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
  return restoreStoredDraft(state, readStoredDraft(key));
}

export function readDraftBackup(state: StudioState): DraftSession | null {
  const saved = readStoredDraft(keyFor(state) + "-before-history");
  return saved ? restoreStoredDraft(state, saved) : null;
}

function restoreStoredDraft(state: StudioState, saved: StoredDraft | null): DraftSession {
  const storedTypes = saved?.referenceTypes;
  const draft = { ...initialDraft, ...saved?.draft };
  if (saved?.draft && !state.studio_plugins) {
    if (!["image", "audio"].includes(draft.kind)) draft.kind = "video";
    if (!state.images.models[draft.model])
      draft.model = state.images.default_model;
    if (!state.video_models[draft.videoModel]) draft.videoModel = H3;
  }
  const normalizedDraft =
    saved?.draft &&
    state.studio_plugins &&
    !modelAvailable(state, selectedModel(draft))
      ? draft
      : normalizeParams(state, saved?.draft ? draft : ensureModel(state, draft));
  const session: DraftSession = {
    parent: typeof saved?.parent === "number" ? saved.parent : null,
    retainedSeed:
      typeof saved?.retainedSeed === "number" ? saved.retainedSeed : null,
    suspendedImageDraft: readSnapshot(
      state,
      saved?.suspendedImageDraft,
      storedTypes,
    ),
    suspendedAudioDraft: readSnapshot(
      state,
      saved?.suspendedAudioDraft,
      storedTypes,
    ),
    suspendedMediaDraft: readSnapshot(
      state,
      saved?.suspendedMediaDraft,
      storedTypes,
    ),
    ...restoreDraftReferences(state, normalizedDraft, saved?.refs, storedTypes),
    submitId: saved?.submitId || crypto.randomUUID(),
  };
  return pruneDraftAssets(state, session, savedReferenceType(state, storedTypes));
}
export function writeDraft(state: StudioState, session: DraftSession) {
  writeStoredDraft(state, session, keyFor(state));
}

export function writeDraftBackup(state: StudioState, session: DraftSession | null) {
  const key = keyFor(state) + "-before-history";
  if (session) writeStoredDraft(state, session, key);
  else sessionStorage.removeItem(key);
}

function writeStoredDraft(state: StudioState, session: DraftSession, key: string) {
  const refs = new Set(
    [session, session.suspendedImageDraft, session.suspendedMediaDraft].flatMap(
      (snapshot) => snapshot
        ? [...snapshot.refs, ...(snapshot.draft.h3ReferenceDraft?.refs ?? [])]
        : [],
    ),
  );
  let savedTypes: StoredReferenceTypes | undefined;
  const referenceTypes = Object.fromEntries(
    [...refs].flatMap((id) => {
      const asset = referenceAsset(state, id);
      if (!asset) savedTypes ??= readStoredDraft(key)?.referenceTypes ?? {};
      const type = asset ? assetReferenceType(asset) : savedTypes?.[id];
      return type === "Video" || type === "Audio" ? [[id, type]] : [];
    }),
  );
  sessionStorage.setItem(key, JSON.stringify({ ...session, referenceTypes }));
}

function pruneH3Assets(state: StudioState, h3?: H3Options) {
  if (!h3) return h3;
  const exists = (id: string) => !!referenceAsset(state, id);
  const first = h3.first_frame;
  const last = h3.last_frame;
  const videoAudio = h3.video_audio?.filter(exists);
  if (
    !(first && !exists(first)) &&
    !(last && !exists(last)) &&
    videoAudio?.length === h3.video_audio?.length
  )
    return h3;
  return {
    ...h3,
    first_frame: first && exists(first) ? first : null,
    last_frame: last && exists(last) ? last : null,
    video_audio: videoAudio,
  };
}

export function pruneDraftAssets(
  state: StudioState,
  session: DraftSession,
  previousType = savedReferenceType(state),
): DraftSession {
  const exists = (id: string) => !!referenceAsset(state, id);
  function prune(snapshot: DraftSnapshot): DraftSnapshot {
    const { draft } = snapshot;
    const h3 = pruneH3Assets(state, draft.h3);
    const suspendedH3Frames = pruneH3Assets(state, draft.suspendedH3Frames);
    const saved = draft.h3ReferenceDraft;
    let nextSaved = saved;
    if (saved) {
      const refs = saved.refs.filter(exists);
      const savedAudio = saved.video_audio.filter(exists);
      if (
        refs.length !== saved.refs.length ||
        savedAudio.length !== saved.video_audio.length
      ) {
        const prompt =
          refs.length === saved.refs.length
            ? saved.prompt
            : reindexPromptReferences(
                state,
                saved.prompt,
                withPackMedia(saved.refs, saved.packs),
                withPackMedia(refs, saved.packs),
                previousType,
              );
        nextSaved = { ...saved, refs, prompt, video_audio: savedAudio };
      }
    }
    const changedH3 = h3 !== draft.h3;
    const changedSuspendedH3 = suspendedH3Frames !== draft.suspendedH3Frames;
    const changedSaved = nextSaved !== saved;
    if (!changedH3 && !changedSuspendedH3 && !changedSaved) return snapshot;
    return {
      ...snapshot,
      draft: {
        ...draft,
        ...(changedH3 ? { h3 } : {}),
        ...(changedSuspendedH3 ? { suspendedH3Frames } : {}),
        ...(changedSaved ? { h3ReferenceDraft: nextSaved } : {}),
      },
    };
  }
  const active = prune(session);
  const image =
    session.suspendedImageDraft && prune(session.suspendedImageDraft);
  const audio =
    session.suspendedAudioDraft && prune(session.suspendedAudioDraft);
  const media =
    session.suspendedMediaDraft && prune(session.suspendedMediaDraft);
  return active === session &&
    image === session.suspendedImageDraft &&
    audio === session.suspendedAudioDraft &&
    media === session.suspendedMediaDraft
    ? session
    : {
        ...session,
        ...active,
        suspendedImageDraft: image,
        suspendedAudioDraft: audio,
        suspendedMediaDraft: media,
      };
}

export const selectedModel = (draft: Draft) =>
  (draft.kind === "image"
    ? draft.model
    : draft.kind === "audio"
      ? draft.audioModel
      : draft.videoModel) || "";
export const isH3 = (draft: Draft) => draft.kind === "video" && !!draft.h3;
export const modelForm = (state: StudioState, draft: Draft) =>
  state.model_forms?.[selectedModel(draft)];
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
export function standardSteps(form: ModelForm | undefined, value?: number) {
  const field = form?.fields.sampling_steps;
  return value !== form?.fastSteps && field?.enum?.includes(Number(value))
    ? Number(value)
    : Number(field?.default ?? 20);
}
function effectiveSteps(
  form: ModelForm | undefined,
  draft: Pick<Draft, "sampling_steps" | "fast_mode">,
) {
  return form?.fastSteps &&
    (draft.fast_mode || Number(draft.sampling_steps) === form.fastSteps)
    ? form.fastSteps
    : standardSteps(form, draft.sampling_steps);
}
export function draftValues(draft: Draft): FormValues {
  return {
    ratio: draft.ratio,
    resolution: draft.resolution,
    image_quality: draft.imageQuality,
    quality: Number(draft.quality),
    seconds: Number(draft.seconds),
  };
}
export function seedError(form: ModelForm | undefined, raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const field = form?.fields.seed;
  const min = field?.minimum ?? 0;
  const max = field?.maximum;
  if (!/^\d+$/.test(value)) return "请输入有效的非负整数";
  const parsed = Number(value);
  if (max !== undefined) {
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
      return `随机种子需为 ${min}–${max} 之间的整数`;
    return "";
  }
  if (!Number.isSafeInteger(parsed)) return "请输入有效的非负整数";
  if (parsed < min) return `随机种子需为不小于 ${min} 的整数`;
  return "";
}
export function normalizeParams(state: StudioState, draft: Draft): Draft {
  const form = modelForm(state, draft);
  const flow = flowSpec(state, selectedModel(draft));
  const supportsH3 = draft.kind === "video" && form?.referenceModes && !flow;
  const suspendedH3Frames = supportsH3
    ? undefined
    : frames(draft)
      ? draft.h3
      : draft.suspendedH3Frames;
  if (flow) {
    return {
      ...draft,
      h3: undefined,
      suspendedH3Frames,
      params: undefined,
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
  const values = form
    ? normalizeForm(form, { ...draftValues(draft), ...draft.params })
    : {};
  const seed = typeof draft.seed === "string" ? draft.seed.trim() : "";
  const h3 = supportsH3
    ? h3Options(
        draft.suspendedH3Frames
          ? pruneH3Assets(state, draft.suspendedH3Frames)
          : draft.h3,
      )
    : undefined;
  return {
    ...draft,
    h3,
    suspendedH3Frames,
    flowSourceJob: null,
    params: form?.parameterObject ? values : undefined,
    ratio: String(values.ratio ?? draft.ratio),
    quality: String(values.quality ?? draft.quality),
    seconds: String(values.seconds ?? draft.seconds),
    resolution: String(values.resolution ?? draft.resolution),
    imageQuality: String(values.image_quality ?? draft.imageQuality),
    fast_mode:
      !!form?.fastSteps &&
      (draft.fast_mode || draft.sampling_steps === form.fastSteps),
    sampling_steps: standardSteps(form, draft.sampling_steps),
    seed: seedError(form, seed) ? "" : seed,
  };
}
function ensureCreation(state: StudioState, draft: Draft, kind: Draft["kind"]) {
  const next = { ...draft, kind };
  const available = Object.keys(modelsForKind(state, kind)).filter((id) =>
    modelAvailable(state, id),
  );
  return normalizeParams(
    state,
    available.includes(selectedModel(next))
      ? next
      : chooseModel(next, available[0] || ""),
  );
}
function restoreParent(state: StudioState, saved: DraftSnapshot) {
  const hasParent =
    saved.parent !== null && state.jobs.some((job) => job.id === saved.parent);
  return {
    parent: hasParent ? saved.parent : null,
    retainedSeed: hasParent ? saved.retainedSeed : null,
  };
}
export function changeCreation(
  state: StudioState,
  session: DraftSession,
  kind: Draft["kind"],
): DraftSession {
  const { draft } = session;
  if (draft.kind === kind) return session;
  if (kind === "audio") {
    const mediaSnapshot = draftSnapshot(session);
    const savedAudio = session.suspendedAudioDraft;
    if (savedAudio) {
      return {
        ...savedAudio,
        draft: ensureCreation(
          state,
          { ...savedAudio.draft, packs: [] },
          "audio",
        ),
        refs: [],
        ...restoreParent(state, savedAudio),
        suspendedImageDraft: session.suspendedImageDraft,
        suspendedAudioDraft: null,
        suspendedMediaDraft: mediaSnapshot,
      };
    }
    return {
      draft: ensureCreation(
        state,
        {
          ...initialDraft,
          audioModel: draft.audioModel,
          voiceDescription: draft.voiceDescription,
          kind: "audio",
        },
        "audio",
      ),
      refs: [],
      parent: null,
      retainedSeed: null,
      submitId: session.submitId,
      suspendedImageDraft: session.suspendedImageDraft,
      suspendedAudioDraft: null,
      suspendedMediaDraft: mediaSnapshot,
    };
  }
  if (draft.kind === "audio") {
    const audioSnapshot = draftSnapshot(session);
    if (kind === "image" && session.suspendedImageDraft) {
      const saved = session.suspendedImageDraft;
      return {
        ...saved,
        draft: ensureCreation(state, saved.draft, "image"),
        refs: saved.refs.filter((id) => referenceAsset(state, id)),
        ...restoreParent(state, saved),
        suspendedImageDraft: null,
        suspendedAudioDraft: audioSnapshot,
        suspendedMediaDraft: null,
      };
    }
    if (session.suspendedMediaDraft) {
      const saved = session.suspendedMediaDraft;
      const sameKind = saved.draft.kind === kind;
      return {
        ...saved,
        draft: ensureCreation(state, saved.draft, kind),
        refs: saved.refs.filter((id) => referenceAsset(state, id)),
        ...(sameKind
          ? restoreParent(state, saved)
          : { parent: null, retainedSeed: null }),
        suspendedImageDraft: session.suspendedImageDraft,
        suspendedAudioDraft: audioSnapshot,
        suspendedMediaDraft: null,
      };
    }
    return {
      draft: ensureCreation(
        state,
        {
          ...initialDraft,
          videoModel: draft.videoModel,
          model: draft.model,
          ratio: draft.ratio,
          quality: draft.quality,
          seconds: draft.seconds,
          sampling_steps: draft.sampling_steps,
          fast_mode: draft.fast_mode,
          imageQuality: draft.imageQuality,
          resolution: draft.resolution,
          kind,
        },
        kind,
      ),
      refs: [],
      parent: null,
      retainedSeed: null,
      submitId: session.submitId,
      suspendedImageDraft: session.suspendedImageDraft,
      suspendedAudioDraft: audioSnapshot,
      suspendedMediaDraft: null,
    };
  }
  if (kind === "image" && session.suspendedImageDraft) {
    const saved = session.suspendedImageDraft;
    return {
      ...saved,
      refs: saved.refs.filter((id) => referenceAsset(state, id)),
      ...restoreParent(state, saved),
      suspendedImageDraft: null,
      suspendedAudioDraft: session.suspendedAudioDraft,
      suspendedMediaDraft: null,
    };
  }
  return {
    ...session,
    draft: ensureCreation(state, draft, kind),
    parent: null,
    retainedSeed: null,
  };
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
export function activeReferences({
  draft,
  refs,
}: Pick<DraftSession, "draft" | "refs">) {
  if (draft.kind === "audio") return [];
  const { first_frame, last_frame } = h3Options(draft.h3);
  return frames(draft)
    ? [...new Set([first_frame, last_frame].filter((id): id is string => !!id))]
    : refs;
}
function withPackMedia(refs: string[], packs: Pack[] | undefined) {
  return [...new Set([...refs, ...(packs ?? []).flatMap((pack) => pack.media)])];
}
export function packReferences(session: Pick<DraftSession, "draft" | "refs">) {
  if (session.draft.kind === "audio") return [];
  return withPackMedia(activeReferences(session), session.draft.packs);
}
export const referenceAsset = (state: StudioState, id: string | null) =>
  state.assets.find((asset) => asset.id === id);
function assetReferenceType(asset?: Asset): ReferenceType {
  const kind = asset?.kind;
  return kind === "ref_video"
    ? "Video"
    : kind === "ref_audio"
      ? "Audio"
      : "Picture";
}
export function referenceType(state: StudioState, id: string): ReferenceType {
  return assetReferenceType(referenceAsset(state, id));
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
export function referencesShifted(
  prevState: StudioState,
  nextState: StudioState,
  prevRefs: string[],
  nextRefs: string[],
) {
  return prevRefs.some(
    (id) =>
      !nextRefs.includes(id) ||
      referenceType(prevState, id) !== referenceType(nextState, id) ||
      referenceIndex(prevState, id, prevRefs) !==
        referenceIndex(nextState, id, nextRefs),
  );
}
export function reindexPrompt(
  prevState: StudioState,
  nextState: StudioState,
  prompt: string,
  prevRefs: string[],
  nextRefs: string[],
  plain = false,
) {
  return plain
    ? prompt
    : reindexPromptReferences(nextState, prompt, prevRefs, nextRefs, (id) =>
        referenceType(prevState, id),
      );
}
function reindexPromptReferences(
  nextState: StudioState,
  prompt: string,
  prevRefs: string[],
  nextRefs: string[],
  previousType: (id: string) => ReferenceType,
) {
  if (!prompt) return prompt;
  return prompt.replace(
    /<(Picture|Video|Audio) (\d+)>/g,
    (match, type: ReferenceType, digits: string) => {
      const index = Number(digits);
      if (!Number.isSafeInteger(index) || index < 1 || String(index) !== digits)
        return match;
      const id = prevRefs.filter((ref) => previousType(ref) === type)[index - 1];
      if (!id) return match;
      if (!nextRefs.includes(id)) return "";
      const nextType = referenceType(nextState, id);
      return `<${nextType} ${referenceIndex(nextState, id, nextRefs)}>`;
    },
  );
}
export function syncDraftReferences(
  prevState: StudioState,
  nextState: StudioState,
  prevSession: DraftSession,
  nextSession: DraftSession,
  reindexActive?: (nextRefs: string[]) => string,
): DraftSession {
  const plain = frames(nextSession.draft) || nextSession.draft.kind === "audio";
  if (plain) return nextSession;
  const prevRefs = packReferences(prevSession);
  const nextRefs = packReferences(nextSession);
  if (!referencesShifted(prevState, nextState, prevRefs, nextRefs))
    return nextSession;
  const prompt = reindexActive
    ? reindexActive(nextRefs)
    : reindexPrompt(
        prevState,
        nextState,
        nextSession.draft.prompt,
        prevRefs,
        nextRefs,
        false,
      );
  return prompt === nextSession.draft.prompt
    ? nextSession
    : {
        ...nextSession,
        draft: { ...nextSession.draft, prompt },
      };
}
export function mergeAssetPackAssets<T extends { id: string }>(
  loaded: T[],
  uploaded: T[],
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of [...uploaded, ...loaded]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}
export function hasDraftPacks(session: DraftSession) {
  return Boolean(
    session.draft.packs?.length ||
      session.draft.h3ReferenceDraft?.packs?.length ||
      session.suspendedImageDraft?.draft.packs?.length ||
      session.suspendedImageDraft?.draft.h3ReferenceDraft?.packs?.length ||
      session.suspendedMediaDraft?.draft.packs?.length ||
      session.suspendedMediaDraft?.draft.h3ReferenceDraft?.packs?.length,
  );
}
function mapPackList(
  packs: Pack[] | undefined,
  transform: (pack: Pack) => Pack | null,
) {
  if (!packs?.length) return { packs, changed: false };
  let changed = false;
  const next: Pack[] = [];
  for (const pack of packs) {
    const updated = transform(pack);
    if (!updated) {
      changed = true;
    } else {
      if (updated !== pack) changed = true;
      next.push(updated);
    }
  }
  return changed ? { packs: next, changed: true } : { packs, changed: false };
}
function updateSnapshotPacks<T extends DraftSnapshot>(
  prevState: StudioState,
  nextState: StudioState,
  snapshot: T,
  transform: (pack: Pack) => Pack | null,
  includeH3Saved: boolean,
  reindexActive?: (nextRefs: string[]) => string,
): T {
  let draft = snapshot.draft;
  if (includeH3Saved && draft.h3ReferenceDraft?.packs?.length) {
    const saved = draft.h3ReferenceDraft;
    const mappedSaved = mapPackList(saved.packs, transform);
    if (mappedSaved.changed) {
      const nextSavedPacks = mappedSaved.packs ?? [];
      const prevSavedRefs = withPackMedia(saved.refs, saved.packs);
      const nextSavedRefs = withPackMedia(saved.refs, nextSavedPacks);
      const prompt = referencesShifted(
        prevState,
        nextState,
        prevSavedRefs,
        nextSavedRefs,
      )
        ? reindexPrompt(
            prevState,
            nextState,
            saved.prompt,
            prevSavedRefs,
            nextSavedRefs,
            false,
          )
        : saved.prompt;
      draft = {
        ...draft,
        h3ReferenceDraft: {
          ...saved,
          packs: nextSavedPacks,
          prompt,
        },
      };
    }
  }
  const mapped = mapPackList(draft.packs, transform);
  if (mapped.changed) {
    draft = { ...draft, packs: mapped.packs };
  }
  if (draft === snapshot.draft) return snapshot;
  const nextSnapshot = { ...snapshot, draft };
  const plain = frames(draft) || draft.kind === "audio";
  if (plain) return nextSnapshot;
  const prevRefs = packReferences(snapshot);
  const nextRefs = packReferences(nextSnapshot);
  if (!referencesShifted(prevState, nextState, prevRefs, nextRefs))
    return nextSnapshot;
  const prompt = reindexActive
    ? reindexActive(nextRefs)
    : reindexPrompt(
        prevState,
        nextState,
        draft.prompt,
        prevRefs,
        nextRefs,
        false,
      );
  return prompt === draft.prompt
    ? nextSnapshot
    : { ...nextSnapshot, draft: { ...draft, prompt } };
}
export function removeDraftPack(
  state: StudioState,
  session: DraftSession,
  packId: string,
  options?: {
    allSnapshots?: boolean;
    reindexActive?: (nextRefs: string[]) => string;
  },
): DraftSession {
  const allSnapshots = options?.allSnapshots ?? false;
  const transform = (pack: Pack) => (pack.id === packId ? null : pack);
  const updated = updateSnapshotPacks(
    state,
    state,
    session,
    transform,
    allSnapshots,
    options?.reindexActive,
  );
  if (!allSnapshots) return updated;
  const suspendedImageDraft = updated.suspendedImageDraft
    ? updateSnapshotPacks(
        state,
        state,
        updated.suspendedImageDraft,
        transform,
        true,
      )
    : null;
  const suspendedMediaDraft = updated.suspendedMediaDraft
    ? updateSnapshotPacks(
        state,
        state,
        updated.suspendedMediaDraft,
        transform,
        true,
      )
    : null;
  if (
    updated === session &&
    suspendedImageDraft === session.suspendedImageDraft &&
    suspendedMediaDraft === session.suspendedMediaDraft
  )
    return session;
  return {
    ...updated,
    suspendedImageDraft,
    suspendedMediaDraft,
  };
}
export function pruneDraftPacks(
  prevState: StudioState,
  nextState: StudioState,
  session: DraftSession,
  livePacks: ReadonlyMap<string, Pick<Pack, "id" | "name">>,
  reindexActive?: (nextRefs: string[]) => string,
): DraftSession {
  const transform = (pack: Pack) => {
    const live = livePacks.get(pack.id);
    if (!live) return null;
    if (!pack.name && live.name) return { ...pack, name: live.name };
    return pack;
  };
  const updated = updateSnapshotPacks(
    prevState,
    nextState,
    session,
    transform,
    true,
    reindexActive,
  );
  const suspendedImageDraft = updated.suspendedImageDraft
    ? updateSnapshotPacks(
        prevState,
        nextState,
        updated.suspendedImageDraft,
        transform,
        true,
      )
    : null;
  const suspendedMediaDraft = updated.suspendedMediaDraft
    ? updateSnapshotPacks(
        prevState,
        nextState,
        updated.suspendedMediaDraft,
        transform,
        true,
      )
    : null;
  if (
    updated === session &&
    suspendedImageDraft === session.suspendedImageDraft &&
    suspendedMediaDraft === session.suspendedMediaDraft
  )
    return session;
  return {
    ...updated,
    suspendedImageDraft,
    suspendedMediaDraft,
  };
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
export function submittedDraft(session: DraftSession): DraftSession {
  const { h3ReferenceDraft, ...values } = session.draft;
  return {
    ...session,
    refs: [],
    parent: null,
    retainedSeed: null,
    draft: {
      ...values,
      prompt: "",
      packs: [],
      h3: values.h3 && { ...emptyH3, mode: values.h3.mode },
    },
  };
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
  const nextRefs = [
    ...new Set([...(saved?.refs || refs), ...activeReferences(session)]),
  ].filter((id) => referenceAsset(state, id));
  const prompt =
    saved && draft.prompt === draft.h3FrameInitialPrompt
      ? reindexPrompt(
          state,
          state,
          saved.prompt,
          withPackMedia(saved.refs, saved.packs),
          withPackMedia(nextRefs, saved.packs),
        )
      : draft.prompt;
  return {
    ...session,
    refs: nextRefs,
    draft: {
      ...values,
      prompt,
      h3FrameInitialPrompt: prompt,
      packs: saved?.packs || [],
      h3: { mode, video_audio: saved?.video_audio || [] },
    },
  };
}
export function imageToVideoDraft(
  state: StudioState,
  previous: DraftSession,
  result: string,
): DraftSession {
  const draft = {
    ...previous.draft,
    kind: "video" as const,
    prompt: "",
    quality: "480",
    seconds: "5",
    seed: "",
  };
  const session: DraftSession = {
    ...previous,
    draft: normalizeParams(state, ensureModel(state, draft)),
    refs: [],
    parent: null,
    retainedSeed: null,
    suspendedAudioDraft: suspendAudioDraft(previous),
    suspendedMediaDraft: null,
  };
  return frames(session.draft)
    ? assignFrame(state, session, result, "first_frame")
    : { ...session, refs: [result] };
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
  if (session.draft.kind === "audio")
    throw new Error("当前语音生成不支持参考图片，请先切换为视频生成或图片生成");
  const images = [...new Set(ids)];
  if (
    images.some(
      (id) =>
        !referenceAsset(state, id) || referenceType(state, id) !== "Picture",
    )
  )
    throw new Error("图片已移除或不在当前空间，请重新选择");
  const combined = [...new Set([...existing, ...images])];
  const limits = modelForm(state, session.draft)?.references;
  const max = limits?.max ?? 0;
  const pictures = limits?.counts?.image ?? max;
  if (pictures <= 0 || max <= 0)
    throw new Error("当前模型不支持参考图片，请先切换支持参考图的模型");
  if (
    combined.filter((id) => referenceType(state, id) === "Picture").length >
    pictures
  )
    throw new Error(`最多选择 ${pictures} 张参考图片，请先移除部分图片`);
  if (combined.length > max)
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
  const form = state.model_forms?.[model];
  if (form?.parameterObject) {
    const issue = formError(
      form,
      job ? normalizeForm(form, savedParameters(job)) : (draft.params ?? {}),
    );
    if (issue) return issue;
  }
  if (kind === "audio") return "";
  if (!state.model_forms?.[model]?.referenceModes) {
    const limits = state.model_forms?.[model]?.references;
    if (
      limits &&
      !flowSpec(state, model) &&
      (keys.length < limits.min || keys.length > limits.max)
    )
      return `这个模型需要 ${limits.min}–${limits.max} 张参考图片`;
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
  if (keys.length > form.references.max)
    return `最多选择 ${form.references.max} 个参考素材`;
  const counts = form.references.counts!;
  for (const [type, max, label] of [
    ["Picture", counts.image, "图片"],
    ["Video", counts.video, "视频"],
    ["Audio", counts.audio, "音频"],
  ] as const) {
    const files = keys
      .filter((id) => referenceType(state, id) === type)
      .map((id) => referenceAsset(state, id));
    if (files.length > max) return `最多选择 ${max} 个${label}参考`;
    if (
      type !== "Picture" &&
      files.reduce((total, asset) => total + (asset?.seconds || 0), 0) >
        form.references.maxSeconds! + 0.05
    )
      return `参考${label}总时长不能超过 ${form.references.maxSeconds} 秒`;
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

export function estimateBody(state: StudioState, session: DraftSession) {
  const { draft } = session;
  const audio = draft.kind === "audio";
  return {
    kind: draft.kind,
    model: selectedModel(draft),
    ...(state.pricing?.published?.some((entry) => entry.model === selectedModel(draft))
      ? { params: draft.params ?? {} }
      : {}),
    ratio: draft.ratio,
    quality: Number(draft.quality),
    seconds: Number(draft.seconds),
    sampling_steps: isH3(draft)
      ? effectiveSteps(modelForm(state, draft), draft)
      : 20,
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

function savedParameters(job: Job): FormValues {
  return (
    job.params ?? {
      ratio: job.ratio,
      seconds: job.seconds,
      quality: job.quality,
      resolution: job.quality === 2048 ? "2K" : "1K",
      image_quality: job.image_quality ?? "medium",
      instruction: job.audio_settings?.instruction ?? "",
      ...(job.seed == null ? {} : { seed: job.seed }),
    }
  );
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
    params: savedParameters(job),
    h3:
      job.kind === "video" && state.model_forms?.[job.model]?.referenceModes
        ? jobH3(job)
        : undefined,
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
    sampling_steps: standardSteps(
      state.model_forms?.[job.model],
      job.sampling_steps,
    ),
    fast_mode:
      Number(job.sampling_steps) === state.model_forms?.[job.model]?.fastSteps,
  });
  const wasAudio = session.draft.kind === "audio";
  return {
    ...session,
    draft: ensureModel(state, draft),
    refs: audio ? [] : [...job.refs],
    parent: job.id,
    retainedSeed: !state.model_forms?.[job.model]?.fields.seed
      ? null
      : (job.seed ?? null),
    suspendedAudioDraft: audio ? null : suspendAudioDraft(session),
    suspendedMediaDraft: audio
      ? wasAudio
        ? session.suspendedMediaDraft
        : draftSnapshot(session)
      : null,
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
  if (state.model_forms?.[model]?.parameterObject) {
    return {
      kind,
      path:
        kind === "video"
          ? "/api/jobs"
          : kind === "image"
            ? "/api/image-jobs"
            : "/api/audio-jobs",
      body: {
        ...common,
        model,
        params: job
          ? normalizeForm(state.model_forms?.[model], savedParameters(job))
          : (draft.params ?? {}),
        ...(kind === "audio"
          ? {}
          : {
              refs: job?.refs ?? refs,
              asset_packs: job
                ? []
                : (draft.packs ?? []).map(({ id, revision }) => ({
                    id,
                    revision,
                  })),
            }),
      },
    };
  }
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
  const { h3, suspendedH3Frames, ...values } = draft;
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
      sampling_steps: state.model_forms?.[model]?.referenceModes
        ? job
          ? effectiveSteps(state.model_forms?.[model], {
              sampling_steps: job.sampling_steps ?? 20,
              fast_mode: false,
            })
          : effectiveSteps(state.model_forms?.[model], draft)
        : 20,
      flow_source_job:
        (job ? job.actual?.flow_source_job : draft.flowSourceJob) || null,
      ...(state.model_forms?.[model]?.referenceModes
        ? { h3: job ? jobH3(job) : h3Options(h3) }
        : {}),
    },
  };
}
export const resultTab = (kind: Job["kind"]) =>
  kind === "image" ? "images" : kind === "audio" ? "audio" : "videos";

export function quote(state: StudioState, draft: Draft) {
  const model = selectedModel(draft);
  const form = state.model_forms?.[model];
  const values = form?.parameterObject
    ? (draft.params ?? {})
    : draftValues(draft);
  const tiers = form?.tiers.filter((t) => matches(t.when, values));
  const tier = tiers?.length === 1 ? tiers[0].tier : undefined;
  const amount =
    tier === undefined
      ? undefined
      : (state.pricing?.items.find(({ key }) => key === `${model}|${tier}`)
          ?.amount ?? undefined);
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

export function composerFeedback(
  state: StudioState,
  session: DraftSession,
  options: { uploading?: boolean; submitting?: boolean } = {},
) {
  const { draft } = session;
  const model = selectedModel(draft);
  const available = modelAvailable(state, model);
  const issue = referenceIssue(state, session) || flowIssue(state, session);
  const limit = promptLimit(draft);
  const overLimit = draft.prompt.length > limit;
  const hasPrompt = !!draft.prompt.trim();
  const price = quote(state, draft);
  const unpricedReason =
    (modelForm(state, draft)?.tiers.length ?? 0) > 1
      ? "当前规格尚未定价"
      : "当前模型尚未定价";
  const unavailableReason = model ? "当前模型暂不可用" : "暂无可用模型";
  const priceReason = price.allowed
    ? ""
    : price.amount === undefined
      ? unpricedReason
      : "当前空间积分不足";

  const limitReason = overLimit
    ? `超出字数限制：${draft.prompt.length} / ${limit} 字`
    : "";
  const promptReason = hasPrompt
    ? ""
    : draft.kind === "audio"
      ? "请输入要朗读的文字"
      : "请输入提示词";
  const status = options.uploading
    ? "上传中"
    : options.submitting
      ? "正在提交…"
      : !available
        ? model || hasPrompt
          ? unavailableReason
          : ""
        : issue || limitReason || priceReason;

  const submitReason = options.submitting
    ? "提交中"
    : options.uploading
      ? "上传中"
      : !available
        ? unavailableReason
        : issue || limitReason || priceReason || promptReason;

  return { status, submitReason, priceReason };
}
