import assert from "node:assert/strict";
import test from "node:test";
import {
  createReferenceToken,
  paintPrompt,
  readPrompt,
  reindexPrompt,
} from "../../apps/web/studio/prompt.js";
import {
  activeReferences,
  addImages,
  assignFrame,
  changeCreation,
  changeH3Mode,
  checkImages,
  chooseModel,
  generationRequest,
  H3,
  hasDraftPacks,
  imageToVideoDraft,
  isH3,
  loadJob,
  mergeAssetPackAssets,
  modelForm,
  normalizeParams,
  packReferences,
  pruneDraftPacks,
  pruneDraftAssets,
  readDraft,
  removeDraftPack,
  referenceIssue,
  seedError,
  submittedDraft,
  syncDraftReferences,
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

test("image to video assigns the first frame in frame mode", (t) => {
  t.after(installFakeEnv().restore);
  const state = makeState();
  const previous = readDraft(state);
  previous.draft.kind = "video";
  previous.draft.videoModel = H3;
  previous.draft.h3 = { mode: "frames" };
  const next = imageToVideoDraft(state, previous, "img1");
  assert.equal(next.draft.h3?.first_frame, "img1");
  assert.deepEqual(next.refs, []);
  assert.equal(previous.draft.h3.first_frame, undefined);
  previous.draft.h3 = {
    mode: "frames",
    first_frame: "img2",
    last_frame: "img2",
  };
  const replacement = imageToVideoDraft(state, previous, "img1");
  assert.equal(replacement.draft.h3?.first_frame, "img1");
  assert.equal(replacement.draft.h3?.last_frame, "img2");
});

test("image to video retains references outside frame mode", (t) => {
  t.after(installFakeEnv().restore);
  const state = makeState();
  const previous = readDraft(state);
  previous.draft.h3 = { mode: "reference" };
  const next = imageToVideoDraft(state, previous, "img1");
  assert.deepEqual(next.refs, ["img1"]);
  assert.equal(next.draft.kind, "video");
  assert.equal(next.draft.prompt, "");
  assert.equal(next.parent, null);
  assert.equal(next.retainedSeed, null);
});

test("image to video preserves the unsent audio script and clears stale media", (t) => {
  t.after(installFakeEnv().restore);
  const state = makeState();
  const previous = changeCreation(state, readDraft(state), "audio");
  previous.draft.prompt = "这段语音草稿还没有发送。";
  previous.draft.voiceDescription = "温柔自然，语速舒缓";
  const next = imageToVideoDraft(state, previous, "img1");
  assert.equal(next.suspendedAudioDraft?.draft.prompt, previous.draft.prompt);
  assert.equal(next.suspendedMediaDraft, null);
  assert.equal(next.draft.prompt, "");
  const restored = changeCreation(state, next, "audio");
  assert.equal(restored.draft.prompt, previous.draft.prompt);
  assert.equal(restored.draft.voiceDescription, previous.draft.voiceDescription);
  const again = imageToVideoDraft(state, next, "img2");
  assert.deepEqual(again.suspendedAudioDraft, next.suspendedAudioDraft);
});

test("image to video validates frame images", (t) => {
  t.after(installFakeEnv().restore);
  const state = makeState();
  const previous = readDraft(state);
  previous.draft.kind = "video";
  previous.draft.videoModel = H3;
  previous.draft.h3 = { mode: "frames" };
  assert.throws(() => imageToVideoDraft(state, previous, "vid1"), /只接收图片/);
  previous.draft.h3.last_frame = "img2";
  state.assets.find((asset) => asset.id === "img2")!.w = 200;
  assert.throws(() => imageToVideoDraft(state, previous, "img1"), /比例相同/);
});

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

test("deleted assets are removed from restored H3 frames and saved references", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState();
  const base = readDraft(state);
  const snapshot = {
    ...base,
    draft: {
      ...base.draft,
      kind: "video" as const,
      videoModel: H3,
      h3: {
        mode: "frames" as const,
        first_frame: "img1",
        last_frame: "img2",
        video_audio: ["vid1", "aud1"],
      },
      h3ReferenceDraft: {
        refs: ["img1", "img2", "vid1"],
        prompt: "<Picture 1> <Picture 2> <Video 1>",
        packs: [],
        video_audio: ["vid1", "aud1"],
      },
    },
  };
  writeDraft(state, { ...snapshot, suspendedMediaDraft: snapshot });
  assert.equal(pruneDraftAssets(state, snapshot), snapshot);
  const refreshedState = { ...state, assets: [] };
  const refreshed = pruneDraftAssets(refreshedState, snapshot);
  assert.deepEqual(activeReferences(refreshed), []);
  assert.equal(referenceIssue(refreshedState, refreshed), "");
  const request = generationRequest(refreshedState, refreshed);
  for (const id of ["img1", "img2", "vid1", "aud1"])
    assert.equal(JSON.stringify(request.body).includes(JSON.stringify(id)), false);
  assert.equal(referenceIssue(state, snapshot), "");
  const restored = readDraft({
    ...state,
    assets: state.assets.filter((a) => ["img2", "aud1"].includes(a.id)),
  });
  for (const draft of [restored.draft, restored.suspendedMediaDraft!.draft]) {
    assert.equal(draft.h3?.first_frame, null);
    assert.equal(draft.h3?.last_frame, "img2");
    assert.deepEqual(draft.h3?.video_audio, ["aud1"]);
    assert.deepEqual(draft.h3ReferenceDraft?.refs, ["img2"]);
    assert.deepEqual(draft.h3ReferenceDraft?.video_audio, ["aud1"]);
  }
  const empty = readDraft({ ...state, assets: [] });
  assert.deepEqual(activeReferences(empty), []);
  assert.equal(empty.draft.h3?.last_frame, null);
  assert.deepEqual(empty.draft.h3?.video_audio, []);
});

test("switching away from H3 keeps both frame slots for the return to H3", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState();
  const muse = "muse-video";
  state.model_forms[muse] = {
    fields: {},
    tiers: [],
    references: { min: 0, max: 3, counts: { image: 3, video: 0, audio: 0 } },
  };
  const select = (session: DraftSession, model: string) => ({
    ...session,
    draft: normalizeParams(state, chooseModel(session.draft, model)),
  });
  let session = readDraft(state);
  session.draft.prompt = "科幻街景";
  session = changeH3Mode(state, session, "frames");
  session = assignFrame(state, session, "img1", "first_frame");
  session = assignFrame(state, session, "img2", "last_frame");
  const expected = session.draft.h3;

  assert.deepEqual(select(session, H3).draft.h3, expected);

  const other = select(session, muse);
  assert.equal(other.draft.h3, undefined);
  assert.deepEqual(activeReferences(other), []);
  const request = generationRequest(state, other);
  assert.equal("h3" in request.body, false);
  assert.doesNotMatch(JSON.stringify(request.body), /img[12]/);

  writeDraft(state, other);
  const restored = select(readDraft(state), H3);
  assert.deepEqual(restored.draft.h3, expected);
  assert.deepEqual(activeReferences(restored), ["img1", "img2"]);
  assert.equal(restored.draft.prompt, "科幻街景");

  // Removing the last frame while Muse is active must not restore its stale ID.
  state.assets = state.assets.filter(({ id }) => id !== "img2");
  const refreshedOther = pruneDraftAssets(state, other);
  assert.equal(refreshedOther.draft.suspendedH3Frames?.last_frame, null);
  assert.equal(other.draft.suspendedH3Frames?.last_frame, "img2");
  assert.deepEqual(select(other, H3).draft.h3, { ...expected, last_frame: null });
  const afterDeletion = select(readDraft(state), H3);
  assert.deepEqual(afterDeletion.draft.h3, { ...expected, last_frame: null });
  assert.deepEqual(activeReferences(afterDeletion), ["img1"]);
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

test("restoring a saved reference draft removes deleted image tokens and renumbers survivors", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState();
  const session = readDraft(state);
  // Existing drafts have only the ordered IDs, without saved media types.
  sessionStorage.setItem(
    "fm-draft-1-workspace-1",
    JSON.stringify({
      ...session,
      refs: ["img1", "img2"],
      draft: {
        ...session.draft,
        prompt: "Start <Picture 1>; end <Picture 2>.",
      },
    }),
  );

  const next = makeState({ assets: state.assets.filter(({ id }) => id !== "img1") });
  const restored = readDraft(next);
  assert.deepEqual(restored.refs, ["img2"]);
  assert.equal(restored.draft.prompt, "Start ; end <Picture 1>.");
  assert.equal(generationRequest(next, restored).body.prompt, restored.draft.prompt);

  writeDraft(next, restored);
  assert.equal(readDraft(next).draft.prompt, restored.draft.prompt);
});

test("restoring a saved draft uses the deleted reference's original media type", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState();
  const session = readDraft(state);
  writeDraft(state, {
    ...session,
    refs: ["vid1", "img1", "aud1"],
    draft: {
      ...session.draft,
      prompt: "<Picture 1> with <Video 1> and <Audio 1>",
    },
  });

  const next = makeState({ assets: state.assets.filter(({ id }) => id === "img1") });
  const restored = readDraft(next);
  assert.deepEqual(restored.refs, ["img1"]);
  assert.equal(restored.draft.prompt, "<Picture 1> with  and ");
});

test("saving an audio edit preserves reference types for a suspended video draft", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState();
  const session = readDraft(state);
  const audio = changeCreation(
    state,
    {
      ...session,
      refs: ["vid1", "img1"],
      draft: { ...session.draft, prompt: "<Picture 1> with <Video 1>" },
    },
    "audio",
  );
  writeDraft(state, audio);

  const next = makeState({ assets: state.assets.filter(({ id }) => id !== "vid1") });
  writeDraft(next, {
    ...audio,
    draft: { ...audio.draft, voiceDescription: "旁白" },
  });

  const restoredAudio = readDraft(next);
  assert.equal(restoredAudio.draft.voiceDescription, "旁白");
  const restoredVideo = changeCreation(next, restoredAudio, "video");
  assert.deepEqual(restoredVideo.refs, ["img1"]);
  assert.equal(restoredVideo.draft.prompt, "<Picture 1> with ");
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

test("#46 mergeAssetPackAssets preserves locally uploaded assets when a stale load finishes later", () => {
  // Stale load returned empty list after local upload succeeded.
  assert.deepEqual(
    mergeAssetPackAssets([], [{ id: "uploaded-1" }]),
    [{ id: "uploaded-1" }],
  );

  // Deduplicates by id while keeping newly uploaded items at the front.
  assert.deepEqual(
    mergeAssetPackAssets(
      [{ id: "old-1" }, { id: "uploaded-1" }, { id: "old-2" }],
      [{ id: "uploaded-2" }, { id: "uploaded-1" }],
    ),
    [
      { id: "uploaded-2" },
      { id: "uploaded-1" },
      { id: "old-1" },
      { id: "old-2" },
    ],
  );
});

test("#86 packReferences aligns prompt chips, @图片N conversion, and reindexing with backend expansion order", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState({
    assets: [
      { id: "img1", owner: 1, kind: "ref", w: 100, h: 100 },
      { id: "img2", owner: 1, kind: "ref", w: 100, h: 100 },
      { id: "img3", owner: 1, kind: "ref", w: 100, h: 100 },
      { id: "vid1", owner: 1, kind: "ref_video", w: 100, h: 100, seconds: 5, has_audio: true },
    ],
  });

  const base = readDraft(state);
  const packOnlySession: DraftSession = {
    ...base,
    refs: [],
    draft: {
      ...base.draft,
      kind: "video",
      packs: [{ id: "pack-a", name: "主角 A", revision: 1, media: ["img1", "img2"] }],
      prompt: "让 <Picture 1> 和 <Picture 2> 同框",
    },
  };

  const refs = packReferences(packOnlySession);
  assert.deepEqual(refs, ["img1", "img2"]);

  // Painting & reading with packReferences renders chips for pack-only references.
  const editor = env.el("div");
  paintPrompt(
    editor as unknown as HTMLElement,
    state,
    refs,
    packOnlySession.draft.prompt,
    false,
  );
  const tokens = editor.querySelectorAll(".reference-token");
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0].dataset.refid, "img1");
  assert.equal(tokens[1].dataset.refid, "img2");
  assert.equal(readPrompt(editor as unknown as HTMLElement, state, refs, false), "让 <Picture 1> 和 <Picture 2> 同框");

  // Creating a token for a pack image labels it with its effective picture index.
  const created = createReferenceToken(state, refs, "img2") as unknown as FakeHTMLElement;
  assert.equal(created.dataset.refid, "img2");
  assert.equal(created.childNodes[created.childNodes.length - 1]?.textContent, "图片2");

  // Literal @图片N matches against packReferences count (converts 1 & 2, keeps 3 literal).
  const literalEditor = env.el("div", ["参考 @图片1 @图片2 @图片3"]);
  assert.equal(
    readPrompt(literalEditor as unknown as HTMLElement, state, refs, false),
    "参考 <Picture 1> <Picture 2> @图片3",
  );

  // Mixing direct video + direct image + overlapping pack matches generation.ts expansion order.
  const mixedSession: DraftSession = {
    ...packOnlySession,
    refs: ["vid1", "img3"],
    draft: {
      ...packOnlySession.draft,
      packs: [
        { id: "pack-a", name: "主角 A", revision: 1, media: ["img3", "img1"] },
        { id: "pack-b", name: "场景 B", revision: 1, media: ["img2"] },
      ],
    },
  };
  assert.deepEqual(packReferences(mixedSession), ["vid1", "img3", "img1", "img2"]);

  // Adding a direct image while a pack is imported shifts existing pack <Picture N> tags.
  const shiftedSession = syncDraftReferences(
    state,
    state,
    packOnlySession,
    { ...packOnlySession, refs: ["img3"] },
  );
  assert.deepEqual(packReferences(shiftedSession), ["img3", "img1", "img2"]);
  assert.equal(shiftedSession.draft.prompt, "让 <Picture 2> 和 <Picture 3> 同框");

  // Removing the direct ref shifts pack references back cleanly.
  const unshifted = syncDraftReferences(
    state,
    state,
    shiftedSession,
    { ...shiftedSession, refs: [] },
  );
  assert.equal(unshifted.draft.prompt, "让 <Picture 1> 和 <Picture 2> 同框");
});

test("#84 removeDraftPack and pruneDraftPacks clean deleted packs, reindex prompts, and tolerate refresh edge cases", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState({
    assets: [
      { id: "img1", owner: 1, kind: "ref", w: 100, h: 100 },
      { id: "img2", owner: 1, kind: "ref", w: 100, h: 100 },
      { id: "img3", owner: 1, kind: "ref", w: 100, h: 100 },
    ],
  });

  const base = readDraft(state);
  const session: DraftSession = {
    ...base,
    refs: ["img1"],
    draft: {
      ...base.draft,
      kind: "video",
      prompt: "<Picture 1> 和 <Picture 2> 在 <Picture 3> 中",
      packs: [
        { id: "pack-1", revision: 1, media: ["img2"] },
        { id: "pack-2", name: "场景 B", revision: 2, media: ["img3"] },
      ],
      h3ReferenceDraft: {
        refs: [],
        prompt: "镜头 <Picture 1> 到 <Picture 2>",
        packs: [
          { id: "pack-1", revision: 1, media: ["img2"] },
          { id: "pack-2", name: "场景 B", revision: 2, media: ["img3"] },
        ],
        video_audio: [],
      },
    },
    suspendedMediaDraft: {
      draft: {
        ...base.draft,
        kind: "video",
        prompt: "挂起 <Picture 1> 和 <Picture 2>",
        packs: [
          { id: "pack-1", revision: 1, media: ["img2"] },
          { id: "pack-2", name: "场景 B", revision: 2, media: ["img3"] },
        ],
      },
      refs: [],
      parent: null,
      retainedSeed: null,
      submitId: "media-1",
    },
  };

  assert.equal(hasDraftPacks(session), true);

  // Direct removal from references popover removes only from active draft and reindexes prompt.
  const removedActiveOnly = removeDraftPack(state, session, "pack-1");
  assert.deepEqual(
    removedActiveOnly.draft.packs?.map((p) => p.id),
    ["pack-2"],
  );
  assert.equal(removedActiveOnly.draft.prompt, "<Picture 1> 和  在 <Picture 2> 中");
  assert.equal(removedActiveOnly.suspendedMediaDraft?.draft.packs?.length, 2);

  // Server-side pack deletion (allSnapshots: true) scrubs active, h3ReferenceDraft, and suspended drafts.
  const deletedEverywhere = removeDraftPack(state, session, "pack-1", {
    allSnapshots: true,
  });
  assert.deepEqual(
    deletedEverywhere.draft.packs?.map((p) => p.id),
    ["pack-2"],
  );
  assert.equal(deletedEverywhere.draft.prompt, "<Picture 1> 和  在 <Picture 2> 中");
  assert.deepEqual(
    deletedEverywhere.draft.h3ReferenceDraft?.packs.map((p) => p.id),
    ["pack-2"],
  );
  assert.equal(deletedEverywhere.draft.h3ReferenceDraft?.prompt, "镜头  到 <Picture 1>");
  assert.deepEqual(
    deletedEverywhere.suspendedMediaDraft?.draft.packs?.map((p) => p.id),
    ["pack-2"],
  );
  assert.equal(deletedEverywhere.suspendedMediaDraft?.draft.prompt, "挂起  和 <Picture 1>");

  // pruneDraftPacks (refresh validation) removes missing packs, hydrates missing name, and preserves revision.
  const liveAfterDelete = new Map([
    ["pack-2", { id: "pack-2", name: "场景 B（已更新）" }],
  ]);
  const pruned = pruneDraftPacks(state, state, session, liveAfterDelete);
  assert.deepEqual(
    pruned.draft.packs?.map((p) => ({ id: p.id, revision: p.revision, name: p.name })),
    [{ id: "pack-2", revision: 2, name: "场景 B" }],
  );
  assert.equal(pruned.draft.prompt, "<Picture 1> 和  在 <Picture 2> 中");
  assert.equal(pruned.suspendedMediaDraft?.draft.prompt, "挂起  和 <Picture 1>");

  // Hydrates missing name on a legacy pack while leaving revision/prompt untouched.
  const liveAll = new Map([
    ["pack-1", { id: "pack-1", name: "主角 A" }],
    ["pack-2", { id: "pack-2", name: "场景 B" }],
  ]);
  const hydrated = pruneDraftPacks(state, state, session, liveAll);
  assert.equal(hydrated.draft.packs?.[0]?.name, "主角 A");
  assert.equal(hydrated.draft.packs?.[0]?.revision, 1);
  assert.equal(hydrated.draft.prompt, session.draft.prompt);

  // Second prune with no changes returns the exact same session reference (no unnecessary persist).
  assert.equal(pruneDraftPacks(state, state, hydrated, liveAll), hydrated);

  // Removing a pack whose image also exists in direct refs preserves the direct ref tag.
  const overlapping: DraftSession = {
    ...base,
    refs: ["img1"],
    draft: {
      ...base.draft,
      prompt: "<Picture 1> 主体",
      packs: [{ id: "pack-overlap", name: "重叠包", revision: 1, media: ["img1"] }],
    },
  };
  const afterOverlapRemove = removeDraftPack(state, overlapping, "pack-overlap");
  assert.deepEqual(afterOverlapRemove.draft.packs, []);
  assert.equal(afterOverlapRemove.draft.prompt, "<Picture 1> 主体");

  // reindexPrompt preserves non-matching literal tags and plain mode text.
  assert.equal(
    reindexPrompt(state, state, "<Picture 1> <Picture 9> <Picture 01>", ["img1"], [], false),
    " <Picture 9> <Picture 01>",
  );
  assert.equal(
    reindexPrompt(state, state, "<Picture 1> 朗读", ["img1"], [], true),
    "<Picture 1> 朗读",
  );
});

test("#94 checkImages and addImages return clear guidance in audio mode and zero-reference models", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const state = makeState({
    model_forms: {
      ...makeState().model_forms,
      "flow-t2v": {
        fields: { ratio: { type: "string", enum: ["16:9"], default: "16:9" } },
        tiers: [],
        references: { min: 0, max: 0 },
      },
      "no-pic-model": {
        fields: { ratio: { type: "string", enum: ["16:9"], default: "16:9" } },
        tiers: [],
        references: { min: 0, max: 3, counts: { image: 0, video: 3, audio: 0 } },
      },
    },
    video_models: {
      ...makeState().video_models,
      "flow-t2v": "Flow T2V",
      "no-pic-model": "No Pic",
    },
    model_policy: {
      revision: 1,
      enabled: {
        [H3]: true,
        "breeze-tts-2": true,
        "gpt-image-2.6-sunburst": true,
        "flow-t2v": true,
        "no-pic-model": true,
      },
    },
    model_catalog: {
      ...makeState().model_catalog,
      "flow-t2v": { provider: "gpu", label: "Flow T2V" },
      "no-pic-model": { provider: "gpu", label: "No Pic" },
    },
  });

  const base = readDraft(state);

  // Audio generation mode: clear actionable guidance, never "最多选择 0 张参考图片".
  const audioSession = changeCreation(state, base, "audio");
  assert.throws(
    () => checkImages(state, audioSession, ["img1"]),
    { message: "当前语音生成不支持参考图片，请先切换为视频生成或图片生成" },
  );
  assert.throws(
    () => addImages(state, audioSession, ["img1"]),
    { message: "当前语音生成不支持参考图片，请先切换为视频生成或图片生成" },
  );

  // Non-audio model with references.max === 0.
  const zeroMaxSession: DraftSession = {
    ...base,
    draft: { ...base.draft, kind: "video", videoModel: "flow-t2v", h3: undefined },
  };
  assert.throws(
    () => checkImages(state, zeroMaxSession, ["img1"]),
    { message: "当前模型不支持参考图片，请先切换支持参考图的模型" },
  );

  // Non-audio model with counts.image === 0.
  const zeroPicSession: DraftSession = {
    ...base,
    draft: { ...base.draft, kind: "video", videoModel: "no-pic-model", h3: undefined },
  };
  assert.throws(
    () => checkImages(state, zeroPicSession, ["img1"]),
    { message: "当前模型不支持参考图片，请先切换支持参考图的模型" },
  );

  // Model supporting references still adds valid images and reports positive limit when exceeded.
  const imageSession = changeCreation(state, base, "image");
  const added = addImages(state, imageSession, ["img1"]);
  assert.deepEqual(added.refs, ["img1"]);
  assert.throws(
    () =>
      checkImages(state, imageSession, ["img2"], [
        "img1",
        "img-a",
        "img-b",
        "img-c",
      ]),
    { message: "最多选择 4 张参考图片，请先移除部分图片" },
  );
});

test("submittedDraft keeps an image-only video model out of H3 reference mode", (t) => {
  const env = installFakeEnv();
  t.after(() => env.restore());
  const base = makeState();
  const state = makeState({
    model_forms: {
      ...base.model_forms,
      "muse-video": {
        fields: { ratio: { type: "string", enum: ["16:9", "9:16"], default: "16:9" } },
        tiers: [],
        references: { min: 0, max: 9 },
      },
    },
    video_models: { ...base.video_models, "muse-video": "Muse" },
    model_policy: {
      revision: 1,
      enabled: { ...base.model_policy.enabled, "muse-video": true },
    },
    model_catalog: {
      ...base.model_catalog,
      "muse-video": { provider: "muse", label: "Muse" },
    },
  });
  const session = readDraft(state);

  const muse = {
    ...session,
    refs: ["img1"],
    draft: {
      ...normalizeParams(state, chooseModel(session.draft, "muse-video")),
      prompt: "Muse 视频",
    },
  };
  assert.equal(isH3(muse.draft), false);
  const museReset = submittedDraft(muse);
  assert.deepEqual(museReset.refs, []);
  assert.equal(museReset.draft.prompt, "");
  assert.equal(museReset.draft.videoModel, "muse-video");
  assert.equal(museReset.draft.h3, undefined);
  assert.equal(isH3(museReset.draft), false);

  const h3 = {
    ...session,
    draft: changeH3Mode(state, session, "frames").draft,
  };
  const h3Reset = submittedDraft(h3);
  assert.equal(isH3(h3Reset.draft), true);
  assert.equal(h3Reset.draft.h3?.mode, "frames");
  assert.equal(h3Reset.draft.h3?.first_frame, null);
});
