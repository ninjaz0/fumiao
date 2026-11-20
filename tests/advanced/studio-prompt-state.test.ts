import assert from "node:assert/strict";
import test from "node:test";
import { paintPrompt, readPrompt } from "../../apps/web/studio/prompt.js";
import {
  activeReferences,
  changeCreation,
  H3,
  loadJob,
  modelForm,
  normalizeParams,
  packReferences,
  readDraft,
  seedError,
  writeDraft,
  type DraftSession,
  type Job,
  type StudioState,
} from "../../apps/web/studio/state.js";

// Minimal DOM & sessionStorage shim for pure unit tests of prompt.ts and state.ts.
class FakeNode {
  static readonly ELEMENT_NODE = 1;
  static readonly TEXT_NODE = 3;
  static readonly DOCUMENT_FRAGMENT_NODE = 11;

  readonly nodeType: number;
  childNodes: FakeNode[] = [];
  textContent: string | null = null;

  constructor(nodeType: number) {
    this.nodeType = nodeType;
  }

  append(...items: (FakeNode | string)[]) {
    for (const item of items) {
      if (typeof item === "string") {
        this.childNodes.push(new FakeText(item));
      } else if (item.nodeType === FakeNode.DOCUMENT_FRAGMENT_NODE) {
        this.childNodes.push(...item.childNodes);
        item.childNodes = [];
      } else {
        this.childNodes.push(item);
      }
    }
  }

  normalize() {
    const merged: FakeNode[] = [];
    for (const child of this.childNodes) {
      if (child.nodeType === FakeNode.TEXT_NODE) {
        if (!child.textContent) continue;
        const prev = merged[merged.length - 1];
        if (prev && prev.nodeType === FakeNode.TEXT_NODE) {
          prev.textContent = (prev.textContent || "") + child.textContent;
        } else {
          merged.push(child);
        }
      } else {
        child.normalize();
        merged.push(child);
      }
    }
    this.childNodes = merged;
  }

  replaceChildren(...items: (FakeNode | string)[]) {
    this.childNodes = [];
    this.append(...items);
  }
}

class FakeText extends FakeNode {
  constructor(text: string) {
    super(FakeNode.TEXT_NODE);
    this.textContent = text;
  }
}

class FakeHTMLElement extends FakeNode {
  readonly tagName: string;
  className = "";
  contentEditable = "";
  dataset: Record<string, string | undefined> = {};
  attributes = new Map<string, string>();
  src = "";
  alt = "";
  preload = "";
  playsInline = false;

  constructor(tagName: string) {
    super(FakeNode.ELEMENT_NODE);
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === "class") this.className = value;
  }

  querySelectorAll(selector: string): FakeHTMLElement[] {
    const matches: FakeHTMLElement[] = [];
    const walk = (node: FakeNode) => {
      for (const child of node.childNodes) {
        if (child instanceof FakeHTMLElement) {
          if (
            (selector === ".reference-token" &&
              child.className.split(/\s+/).includes("reference-token")) ||
            (selector === "[data-refid]" && child.dataset.refid !== undefined)
          ) {
            matches.push(child);
          }
          walk(child);
        }
      }
    };
    walk(this);
    return matches;
  }
}

class FakeDocumentFragment extends FakeNode {
  constructor() {
    super(FakeNode.DOCUMENT_FRAGMENT_NODE);
  }
}

function installFakeEnv() {
  const previous = {
    Node: globalThis.Node,
    HTMLElement: globalThis.HTMLElement,
    document: globalThis.document,
    sessionStorage: globalThis.sessionStorage,
  };
  const storage = new Map<string, string>();
  const fakeDocument = {
    createDocumentFragment: () => new FakeDocumentFragment(),
    createElement: (tag: string) => new FakeHTMLElement(tag),
    createElementNS: (_ns: string, tag: string) => new FakeHTMLElement(tag),
    createTextNode: (text: string) => new FakeText(text),
  };
  const fakeStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, String(value));
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };
  Object.assign(globalThis, {
    Node: FakeNode,
    HTMLElement: FakeHTMLElement,
    document: fakeDocument,
    sessionStorage: fakeStorage,
  });
  return {
    storage,
    el(
      tag: string,
      children: (FakeNode | string)[] = [],
      dataset?: Record<string, string>,
    ) {
      const node = new FakeHTMLElement(tag);
      if (dataset) node.dataset = { ...dataset };
      node.append(...children);
      return node;
    },
    restore() {
      Object.assign(globalThis, previous);
    },
  };
}

function makeState(overrides: Partial<StudioState> = {}): StudioState {
  return {
    model_forms: {
      [H3]: {
        fields: {
          ratio: {
            type: "string",
            enum: ["16:9", "9:16", "1:1"],
            default: "16:9",
          },
          quality: { type: "integer", enum: [480, 768], default: 480 },
          seconds: { type: "integer", enum: [5, 10, 15], default: 5 },
          sampling_steps: {
            type: "integer",
            enum: [4, 16, 20, 32, 50],
            default: 20,
          },
          seed: { type: "integer", minimum: 0, maximum: 9007199254740991 },
        },
        tiers: [],
        references: {
          min: 0,
          max: 9,
          counts: { image: 9, video: 3, audio: 3 },
          minSeconds: 2,
          maxSeconds: 15,
        },
        referenceModes: ["reference", "frames"],
        fastSteps: 4,
      },
      "breeze-tts-2": {
        fields: {
          instruction: { type: "string", maxLength: 300 },
          seed: { type: "integer", minimum: 0, maximum: 4294967295 },
        },
        tiers: [],
        references: { min: 0, max: 0 },
      },
      "gpt-image-2.6-sunburst": {
        fields: {
          ratio: {
            type: "string",
            enum: ["16:9", "1:1"],
            default: "16:9",
          },
          resolution: { type: "string", enum: ["1K", "2K"], default: "1K" },
          image_quality: {
            type: "string",
            enum: ["low", "medium", "high"],
            default: "medium",
          },
        },
        tiers: [],
        references: { min: 0, max: 4 },
      },
    },
    me: { id: 1, name: "tester", role: "user" },
    avatars: [],
    workspaces: [{ id: 1, name: "个人", kind: "personal", member_count: 1, revision: 1 }],
    workspace_id: 1,
    legacy_workspace_id: 1,
    jobs: [
      {
        id: 10,
        author: "tester",
        owner: 1,
        kind: "video",
        model: H3,
        prompt: "历史视频",
        status: "done",
        refs: ["img1"],
        seconds: 5,
        created: 1,
        ratio: "16:9",
        quality: 480,
        seed: 777,
      },
    ],
    nodes: [],
    assets: [
      { id: "img1", owner: 1, kind: "ref", w: 100, h: 100 },
      { id: "img2", owner: 1, kind: "ref", w: 100, h: 100 },
      { id: "vid1", owner: 1, kind: "ref_video", w: 100, h: 100, seconds: 5, has_audio: true },
      { id: "aud1", owner: 1, kind: "ref_audio", w: 0, h: 0, seconds: 4 },
    ],
    favorites: [],
    ratios: ["16:9", "9:16", "1:1"],
    sizes: { "16:9": [832, 480, 1280, 720] },
    video_models: { [H3]: H3 },
    audio_models: { "breeze-tts-2": "Breeze TTS 2" },
    model_policy: {
      revision: 1,
      enabled: {
        [H3]: true,
        "breeze-tts-2": true,
        "gpt-image-2.6-sunburst": true,
      },
    },
    model_groups: {},
    model_catalog: {
      [H3]: { provider: "gpu", label: H3 },
      "breeze-tts-2": { provider: "gpu", label: "Breeze TTS 2" },
      "gpt-image-2.6-sunburst": { provider: "images", label: "Sunburst" },
    },
    images: {
      enabled: true,
      configured: true,
      models: { "gpt-image-2.6-sunburst": "Sunburst" },
      default_model: "gpt-image-2.6-sunburst",
      sizes: { "16:9": [1024, 576, 2048, 1152] },
    },
    flow: { configured: false },
    pricing: { items: [], revision: 1 },
    credits: { available: 100, reserved: 0 },
    credit_history: [],
    ...overrides,
  };
}

test("#47 readPrompt preserves line breaks across contentEditable blocks and stays idempotent after paintPrompt", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState();
  const refs = ["img1"];

  const cases: { name: string; build: () => FakeHTMLElement; expected: string }[] = [
    {
      name: "text followed by div",
      build: () => env.el("div", ["第一行", env.el("div", ["第二行"])]),
      expected: "第一行\n第二行",
    },
    {
      name: "text followed by multiple divs",
      build: () =>
        env.el("div", ["第一行", env.el("div", ["第二行"]), env.el("div", ["第三行"])]),
      expected: "第一行\n第二行\n第三行",
    },
    {
      name: "blank line via div>br between lines",
      build: () =>
        env.el("div", [
          "第一行",
          env.el("div", [env.el("br")]),
          env.el("div", ["第三行"]),
        ]),
      expected: "第一行\n\n第三行",
    },
    {
      name: "two consecutive blank lines via div>br",
      build: () =>
        env.el("div", [
          "第一行",
          env.el("div", [env.el("br")]),
          env.el("div", [env.el("br")]),
          env.el("div", ["第四行"]),
        ]),
      expected: "第一行\n\n\n第四行",
    },
    {
      name: "leading empty div>br before second line",
      build: () =>
        env.el("div", [env.el("div", [env.el("br")]), env.el("div", ["第二行"])]),
      expected: "\n第二行",
    },
    {
      name: "empty div without br",
      build: () =>
        env.el("div", ["第一行", env.el("div"), env.el("div", ["第三行"])]),
      expected: "第一行\n\n第三行",
    },
    {
      name: "paragraph blocks with empty paragraph",
      build: () =>
        env.el("div", [
          env.el("p", ["第一行"]),
          env.el("p", [env.el("br")]),
          env.el("p", ["第三行"]),
        ]),
      expected: "第一行\n\n第三行",
    },
    {
      name: "trailing blank line div>br is trimmed",
      build: () =>
        env.el("div", ["第一行", env.el("div", [env.el("br")])]),
      expected: "第一行",
    },
    {
      name: "placeholder trailing br inside divs does not double newlines",
      build: () =>
        env.el("div", [
          env.el("div", ["第一行", env.el("br")]),
          env.el("div", ["第二行", env.el("br")]),
        ]),
      expected: "第一行\n第二行",
    },
    {
      name: "reference token before block element",
      build: () =>
        env.el("div", [
          env.el("span", ["图片1"], { refid: "img1" }),
          env.el("div", ["第二行"]),
        ]),
      expected: "<Picture 1>\n第二行",
    },
    {
      name: "CRLF text normalized to LF",
      build: () => env.el("div", ["第一行\r\n第二行"]),
      expected: "第一行\n第二行",
    },
  ];

  for (const item of cases) {
    const editor = item.build() as unknown as HTMLElement;
    const saved = readPrompt(editor, state, refs);
    assert.equal(saved, item.expected, item.name);

    // Save -> restore (paintPrompt) -> read again must be strictly idempotent.
    const restored = env.el("div") as unknown as HTMLElement;
    paintPrompt(restored, state, refs, saved, false);
    assert.equal(
      readPrompt(restored, state, refs),
      item.expected,
      `${item.name} (after restore)`,
    );
  }

  // Re-editing after restore: append a new <div> line to br-restored DOM.
  const reedited = env.el("div");
  paintPrompt(reedited as unknown as HTMLElement, state, refs, "第一行\n第二行", false);
  reedited.append(env.el("div", ["第三行"]));
  assert.equal(
    readPrompt(reedited as unknown as HTMLElement, state, refs),
    "第一行\n第二行\n第三行",
  );
});

test("#51 readPrompt only converts @图片N when a matching picture ref exists", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState();

  const editor = env.el("div", ["保持 @图片1 和 @图片2 以及 @图片0 和 @图片01"]) as unknown as HTMLElement;

  // No refs at all -> preserve literal @图片N.
  assert.equal(
    readPrompt(editor, state, []),
    "保持 @图片1 和 @图片2 以及 @图片0 和 @图片01",
  );

  // Only non-picture refs -> preserve literal @图片N.
  assert.equal(
    readPrompt(editor, state, ["vid1", "aud1"]),
    "保持 @图片1 和 @图片2 以及 @图片0 和 @图片01",
  );

  // 1 picture ref mixed with video -> only @图片1 becomes <Picture 1>.
  assert.equal(
    readPrompt(editor, state, ["vid1", "img1"]),
    "保持 <Picture 1> 和 @图片2 以及 @图片0 和 @图片01",
  );

  // 2 picture refs -> @图片1 and @图片2 become <Picture 1>/<Picture 2>, @图片0/@图片01 stay literal.
  assert.equal(
    readPrompt(editor, state, ["img1", "vid1", "img2"]),
    "保持 <Picture 1> 和 <Picture 2> 以及 @图片0 和 @图片01",
  );

  // Plain mode (audio or frames) -> never convert @图片N even when refs contain pictures.
  assert.equal(
    readPrompt(editor, state, ["img1", "img2"], true),
    "保持 @图片1 和 @图片2 以及 @图片0 和 @图片01",
  );
});

test("#88 plain mode prevents rendering/reading media chips in audio mode", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState();
  const refs = ["img1", "vid1", "aud1"];

  const editor = env.el("div");
  paintPrompt(
    editor as unknown as HTMLElement,
    state,
    refs,
    "<Picture 1> <Video 1> <Audio 1> 你好",
    false,
  );
  assert.equal(editor.querySelectorAll(".reference-token").length, 3);

  // In plain (audio / frames) mode, no .reference-token chips are rendered.
  paintPrompt(
    editor as unknown as HTMLElement,
    state,
    refs,
    "<Picture 1> <Video 1> <Audio 1> 你好",
    true,
  );
  assert.equal(editor.querySelectorAll(".reference-token").length, 0);
  assert.equal(
    readPrompt(editor as unknown as HTMLElement, state, refs, true),
    "<Picture 1> <Video 1> <Audio 1> 你好",
  );

  // Stale chip elements are ignored when readPrompt runs in plain mode.
  const stale = env.el("div", [
    env.el("span", ["图片1"], { refid: "img1" }),
    " 朗读文本",
  ]);
  assert.equal(
    readPrompt(stale as unknown as HTMLElement, state, refs, true),
    " 朗读文本",
  );
});

test("#88 changeCreation isolates audio draft from video/image drafts and restores seamlessly", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState();

  const base = readDraft(state);
  const videoSession: DraftSession = {
    ...base,
    refs: ["img1", "vid1"],
    parent: 10,
    retainedSeed: 777,
    draft: {
      ...base.draft,
      kind: "video",
      prompt: "<Picture 1> <Video 1> 科幻街景",
      packs: [{ id: "pack-1", revision: 1, media: ["img2"] }],
      seed: "99999999999",
      h3: {
        mode: "reference",
        first_frame: null,
        last_frame: null,
        video_audio: ["vid1"],
      },
    },
  };

  // Video -> Audio: suspend media draft and give audio a clean prompt/refs/packs/seed.
  const audioSession = changeCreation(state, videoSession, "audio");
  assert.equal(audioSession.draft.kind, "audio");
  assert.equal(audioSession.draft.prompt, "");
  assert.deepEqual(audioSession.refs, []);
  assert.deepEqual(activeReferences(audioSession), []);
  assert.deepEqual(packReferences(audioSession), []);
  assert.equal(audioSession.draft.seed, "");
  assert.equal(audioSession.parent, null);
  assert.equal(audioSession.retainedSeed, null);
  assert.equal(audioSession.suspendedAudioDraft, null);
  assert.equal(audioSession.suspendedMediaDraft?.draft.prompt, "<Picture 1> <Video 1> 科幻街景");
  assert.deepEqual(audioSession.suspendedMediaDraft?.refs, ["img1", "vid1"]);
  assert.equal(audioSession.suspendedMediaDraft?.draft.packs?.length, 1);

  // Clicking the same kind is a no-op.
  assert.equal(changeCreation(state, audioSession, "audio"), audioSession);

  // Edit audio prompt, voice description, and seed, then persist and reload.
  const editedAudio: DraftSession = {
    ...audioSession,
    draft: {
      ...audioSession.draft,
      prompt: "欢迎使用弗淼语音生成",
      voiceDescription: "温柔女声",
      seed: "4294967295",
    },
  };
  writeDraft(state, editedAudio);
  const reloadedAudio = readDraft(state);
  assert.equal(reloadedAudio.draft.kind, "audio");
  assert.equal(reloadedAudio.draft.prompt, "欢迎使用弗淼语音生成");
  assert.equal(reloadedAudio.draft.voiceDescription, "温柔女声");
  assert.equal(reloadedAudio.draft.seed, "4294967295");
  assert.equal(reloadedAudio.suspendedMediaDraft?.draft.prompt, "<Picture 1> <Video 1> 科幻街景");

  // Audio -> Video: restore full video draft & suspend audio draft.
  const backToVideo = changeCreation(state, reloadedAudio, "video");
  assert.equal(backToVideo.draft.kind, "video");
  assert.equal(backToVideo.draft.prompt, "<Picture 1> <Video 1> 科幻街景");
  assert.deepEqual(backToVideo.refs, ["img1", "vid1"]);
  assert.equal(backToVideo.draft.packs?.[0]?.id, "pack-1");
  assert.equal(backToVideo.draft.seed, "99999999999");
  assert.equal(backToVideo.parent, 10);
  assert.equal(backToVideo.retainedSeed, 777);
  assert.deepEqual(backToVideo.draft.h3?.video_audio, ["vid1"]);
  assert.equal(backToVideo.suspendedMediaDraft, null);
  assert.equal(backToVideo.suspendedAudioDraft?.draft.prompt, "欢迎使用弗淼语音生成");
  assert.equal(backToVideo.suspendedAudioDraft?.draft.voiceDescription, "温柔女声");
  assert.equal(backToVideo.suspendedAudioDraft?.draft.seed, "4294967295");

  // Snapshots must not nest suspended* properties.
  assert.equal("suspendedMediaDraft" in (backToVideo.suspendedAudioDraft as object), false);
  assert.equal("suspendedAudioDraft" in (backToVideo.suspendedAudioDraft as object), false);

  // Video -> Audio again: restores the saved audio draft.
  const backToAudio = changeCreation(state, backToVideo, "audio");
  assert.equal(backToAudio.draft.kind, "audio");
  assert.equal(backToAudio.draft.prompt, "欢迎使用弗淼语音生成");
  assert.equal(backToAudio.draft.voiceDescription, "温柔女声");
  assert.equal(backToAudio.draft.seed, "4294967295");
  assert.deepEqual(backToAudio.refs, []);

  // Audio -> Image: restores media prompt/refs into image mode and clears parent/retainedSeed.
  const toImage = changeCreation(state, backToAudio, "image");
  assert.equal(toImage.draft.kind, "image");
  assert.equal(toImage.draft.prompt, "<Picture 1> <Video 1> 科幻街景");
  assert.deepEqual(toImage.refs, ["img1", "vid1"]);
  assert.equal(toImage.parent, null);
  assert.equal(toImage.retainedSeed, null);
  assert.equal(toImage.suspendedAudioDraft?.draft.prompt, "欢迎使用弗淼语音生成");

  // Audio without suspendedMediaDraft -> Video: starts with clean prompt/refs/seed.
  const standaloneAudio: DraftSession = {
    ...editedAudio,
    suspendedMediaDraft: null,
  };
  const freshVideo = changeCreation(state, standaloneAudio, "video");
  assert.equal(freshVideo.draft.kind, "video");
  assert.equal(freshVideo.draft.prompt, "");
  assert.deepEqual(freshVideo.refs, []);
  assert.equal(freshVideo.draft.seed, "");
  assert.equal(freshVideo.suspendedAudioDraft?.draft.prompt, "欢迎使用弗淼语音生成");
});

test("#88 readDraft stays compatible with legacy storage drafts and loadJob isolates audio/media", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState();

  // Legacy video draft without suspendedAudioDraft / suspendedMediaDraft fields.
  sessionStorage.setItem(
    "fm-draft-1-workspace-1",
    JSON.stringify({
      draft: { kind: "video", videoModel: H3, prompt: "旧草稿\n第二行", seed: "42" },
      refs: ["img1", "deleted-asset"],
      parent: null,
      retainedSeed: null,
      suspendedImageDraft: null,
      submitId: "legacy-1",
    }),
  );
  const legacyVideo = readDraft(state);
  assert.equal(legacyVideo.draft.prompt, "旧草稿\n第二行");
  assert.deepEqual(legacyVideo.refs, ["img1"]);
  assert.equal(legacyVideo.suspendedAudioDraft, null);
  assert.equal(legacyVideo.suspendedMediaDraft, null);

  // Legacy audio draft that previously leaked refs/packs before the fix.
  sessionStorage.setItem(
    "fm-draft-1-workspace-1",
    JSON.stringify({
      draft: {
        kind: "audio",
        audioModel: "breeze-tts-2",
        prompt: "旧语音",
        packs: [{ id: "pack-1", revision: 1, media: ["img1"] }],
      },
      refs: ["img1"],
      submitId: "legacy-2",
    }),
  );
  const legacyAudio = readDraft(state);
  assert.equal(legacyAudio.draft.kind, "audio");
  assert.equal(legacyAudio.draft.prompt, "旧语音");
  assert.deepEqual(legacyAudio.refs, []);
  assert.deepEqual(legacyAudio.draft.packs, []);
  assert.equal(legacyAudio.suspendedAudioDraft, null);
  assert.equal(legacyAudio.suspendedMediaDraft, null);

  // loadJob switching from video draft to an audio job preserves video draft in suspendedMediaDraft.
  const audioJob: Job = {
    id: 20,
    author: "tester",
    owner: 1,
    kind: "audio",
    model: "breeze-tts-2",
    prompt: "历史语音",
    status: "done",
    refs: ["img1"],
    seconds: 0,
    created: 2,
    ratio: "16:9",
    quality: 480,
    seed: 123,
    audio_settings: { instruction: "沉稳男声" },
  };
  const loadedAudio = loadJob(state, legacyVideo, audioJob);
  assert.equal(loadedAudio.draft.kind, "audio");
  assert.deepEqual(loadedAudio.refs, []);
  assert.equal(loadedAudio.suspendedMediaDraft?.draft.prompt, "旧草稿\n第二行");
  assert.deepEqual(loadedAudio.suspendedMediaDraft?.refs, ["img1"]);
});

test("#90 seedError and normalizeParams enforce model seed minimum and maximum bounds consistently", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState();

  const audioDraft = { ...readDraft(state).draft, kind: "audio" as const, audioModel: "breeze-tts-2" };
  const audioForm = modelForm(state, audioDraft);

  assert.equal(seedError(audioForm, ""), "");
  assert.equal(seedError(audioForm, "0"), "");
  assert.equal(seedError(audioForm, "4294967295"), "");
  assert.equal(seedError(audioForm, "4294967296"), "随机种子需为 0–4294967295 之间的整数");
  assert.equal(
    seedError(audioForm, "99999999999999999999"),
    "随机种子需为 0–4294967295 之间的整数",
  );
  assert.equal(seedError(audioForm, "-1"), "请输入有效的非负整数");
  assert.equal(seedError(audioForm, "12.3"), "请输入有效的非负整数");
  assert.equal(seedError(audioForm, "abc"), "请输入有效的非负整数");

  assert.equal(
    normalizeParams(state, { ...audioDraft, seed: "4294967295" }).seed,
    "4294967295",
  );
  assert.equal(
    normalizeParams(state, { ...audioDraft, seed: "4294967296" }).seed,
    "",
  );
  assert.equal(
    normalizeParams(state, { ...audioDraft, seed: "abc" }).seed,
    "",
  );

  // MiniMax H3 allows up to MAX_SAFE_INTEGER.
  const h3Form = modelForm(state, readDraft(state).draft);
  assert.equal(seedError(h3Form, "9007199254740991"), "");
  assert.equal(
    seedError(h3Form, "9007199254740992"),
    "随机种子需为 0–9007199254740991 之间的整数",
  );

  // Custom minimum/maximum bounds.
  const customForm = {
    fields: { seed: { type: "integer" as const, minimum: 1, maximum: 100 } },
    tiers: [],
    references: { min: 0, max: 0 },
  };
  assert.equal(seedError(customForm, "0"), "随机种子需为 1–100 之间的整数");
  assert.equal(seedError(customForm, "1"), "");
  assert.equal(seedError(customForm, "100"), "");
  assert.equal(seedError(customForm, "101"), "随机种子需为 1–100 之间的整数");

  // Unbounded integer seed (e.g. remote plugin) checks safe non-negative integer.
  const unboundedForm = {
    fields: { seed: { type: "integer" as const } },
    tiers: [],
    references: { min: 0, max: 0 },
  };
  assert.equal(seedError(unboundedForm, "0"), "");
  assert.equal(seedError(unboundedForm, "4294967296"), "");
  assert.equal(seedError(unboundedForm, "9007199254740992"), "请输入有效的非负整数");
});
