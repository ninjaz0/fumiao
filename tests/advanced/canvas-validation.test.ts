import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCanvasDocument,
  parseCanvasSave,
} from "../../packages/original-api/src/canvas-draft.js";
import {
  validateCanvasDocument,
  type CanvasValidationResources,
} from "../../packages/original-api/src/canvas-validation.js";
import { CanvasModels } from "../../packages/platform/src/canvas-models.js";
import { DomainError } from "../../packages/platform/src/security.js";
import { ValidationError } from "../../packages/original-api/src/validation.js";
import { museCanvas } from "../../plugins/muse/src/canvas.js";
import { flowCanvas } from "../../plugins/flow/src/canvas.js";
import { gpuCanvas } from "../../plugins/gpu/src/canvas.js";
import { imagesCanvas } from "../../plugins/images/src/canvas.js";
const rules = [museCanvas, flowCanvas, gpuCanvas, imagesCanvas].flatMap(
    (p) => p.manifest.canvas!.models,
  ),
  models = new CanvasModels(rules);
const node = (id: string, type = "image", other: any = {}) => ({
  id,
  type,
  x: 0,
  y: 0,
  ...other,
});
const resourceCalls: string[] = [];
const resources: CanvasValidationResources = {
  async media(key) {
    resourceCalls.push(key);
    return undefined;
  },
  async pack() {
    throw new DomainError(404, "内容不存在或无权访问");
  },
  async voice() {
    return undefined;
  },
  async active() {
    return false;
  },
};
test("Canvas parser preserves null-vs-empty shots, Unicode, literal booleans and rejects prototype-shaped extras", () => {
  assert.deepEqual(parseCanvasDocument({}), {
    schemaVersion: 1,
    nodes: [],
    edges: [],
  });
  assert.deepEqual(parseCanvasDocument({ shots: [] }), {
    schemaVersion: 1,
    nodes: [],
    edges: [],
    shots: [],
  });
  const saved = parseCanvasSave({
    expected_revision: "2",
    title: "保留\u0000😀",
    document: {
      schemaVersion: true,
      nodes: [
        node("n", "text", {
          x: "1_0.5",
          text: "原文 /media/" + "a".repeat(32) + "\u0000",
          use_media: "off",
        }),
      ],
    },
  });
  assert.equal(saved.title, "保留\u0000😀");
  assert.equal(saved.expected_revision, 2);
  assert.equal(saved.document.nodes[0].x, 10.5);
  assert.equal(saved.document.nodes[0].use_media, false);
  assert.equal(
    saved.document.nodes[0].text,
    "原文 /media/" + "a".repeat(32) + "\u0000",
  );
  for (const key of ["__proto__", "constructor", "toString"]) {
    const body = JSON.parse(
      JSON.stringify({ nodes: [] }).replace(
        '"nodes":[]',
        '"nodes":[],"' + key + '":1',
      ),
    );
    assert.throws(
      () => parseCanvasDocument(body),
      (e: unknown) =>
        e instanceof ValidationError &&
        e.detail.some(
          (d) => d.type === "extra_forbidden" && d.loc.at(-1) === key,
        ),
    );
  }
  for (const bad of [
    node("bad\n"),
    node("n", "image", { x: "Infinity" }),
    node("n", "image", { params: { seed: 2 ** 53 } }),
  ])
    assert.throws(() => parseCanvasDocument({ nodes: [bad] }), ValidationError);
});
test("Graph checks preserve the source precedence, DAG sharing and nine-image limit", async () => {
  resourceCalls.length = 0;
  const validate = (nodes: any[], edges: any[] = [], shots?: string[]) =>
    validateCanvasDocument(
      parseCanvasDocument({ nodes, edges, ...(shots ? { shots } : {}) }),
      models,
      resources,
    );
  await assert.rejects(
    validate(
      [
        node("n", "video", { params: { h3_refs: ["a".repeat(32)] } }),
        node("n"),
      ],
      [],
      ["missing"],
    ),
    /节点或连线标识重复/,
  );
  assert.deepEqual(resourceCalls, []);
  await assert.rejects(
    validate(
      [node("n", "text", { params: { h3_refs: ["a".repeat(32)] } })],
      [],
      ["n"],
    ),
    /镜头列表只能包含不同的视频节点/,
  );
  assert.deepEqual(resourceCalls, []);
  const edges = [
    ["a", "b"],
    ["a", "c"],
    ["b", "d"],
    ["c", "d"],
  ].map(([source, target], i) => ({ id: "e" + i, source, target }));
  assert.deepEqual(
    await validate(
      ["a", "b", "c", "d"].map((id) => node(id)),
      edges,
    ),
    [],
  );
  await assert.rejects(
    validate(
      ["a", "b", "c", "d"].map((id) => node(id)),
      [...edges, { id: "cycle", source: "d", target: "a" }],
    ),
    /参考连线不能形成循环/,
  );
  await assert.rejects(
    validate(
      ["a", "b", "c", "d"].map((id) => node(id)),
      [...edges, { id: "dup", source: "a", target: "b" }],
    ),
    /参考连线重复/,
  );
  for (const count of [9, 10]) {
    const refs = Array.from({ length: count }, (_, i) => node("ref" + i));
    const result = validate(
      [...refs, node("v", "video")],
      refs.map((n, i) => ({ id: "e" + i, source: n.id, target: "v" })),
    );
    if (count === 9) assert.deepEqual(await result, []);
    else await assert.rejects(result, /每个节点最多连接 9 张参考图片/);
  }
  assert.deepEqual(
    await validate(
      [node("__proto__", "text"), node("constructor")],
      [{ id: "e", source: "__proto__", target: "constructor" }],
    ),
    [],
  );
});
test("Reference checks keep cross-role duplicates, stale pack selection, source authorization order and active-job semantics", async () => {
  const key = "a".repeat(32),
    calls: string[] = [];
  const r: CanvasValidationResources = {
    async media(k) {
      calls.push("media:" + k);
      return {
        kind: "ref",
        async authorize() {
          calls.push("authorize-media");
        },
      };
    },
    async pack(k) {
      calls.push("pack:" + k);
    },
    async voice(n, id) {
      calls.push(n + ":" + id);
      return {
        result: key,
        async authorize() {
          calls.push("authorize-voice");
        },
      };
    },
    async active(n, id, kind) {
      calls.push([n, id, kind].join(":"));
      return true;
    },
  };
  const image = parseCanvasDocument({
    nodes: [
      node("n", "image", {
        media_id: key,
        active_job: 1,
        asset_packs: [{ id: key, revision: 999 }],
        params: {
          h3_refs: [key, key],
          h3: {
            mode: "frames",
            first_frame: key,
            last_frame: key,
            video_audio: ["b".repeat(32)],
          },
        },
      }),
    ],
  });
  assert.deepEqual(await validateCanvasDocument(image, models, r), [
    { node: "n", media: key },
    { node: "n", media: key },
  ]);
  assert.deepEqual(calls, [
    "media:" + key,
    "authorize-media",
    "pack:" + key,
    "media:" + key,
    "authorize-media",
    "n:1:image",
  ]);
  calls.length = 0;
  const video = parseCanvasDocument({
    nodes: [node("n", "video", { narration_job: 2, narration_pending: 2 })],
  });
  assert.deepEqual(await validateCanvasDocument(video, models, r), [
    { node: "n", media: key },
  ]);
  assert.deepEqual(calls, ["voice:n:2", "authorize-voice"]);
  const denied: CanvasValidationResources = {
    ...r,
    async media() {
      return {
        kind: "ref",
        async authorize() {
          throw new DomainError(404, "内容不存在或无权访问");
        },
      };
    },
  };
  await assert.rejects(validateCanvasDocument(image, models, denied), {
    status: 404,
    message: "内容不存在或无权访问",
  });
  const wrongKind: CanvasValidationResources = {
    ...denied,
    async media() {
      return {
        kind: "video",
        async authorize() {
          throw new Error("must not reveal permissions before the kind check");
        },
      };
    },
  };
  await assert.rejects(validateCanvasDocument(image, models, wrongKind), {
    status: 400,
    message: "参考素材不存在",
  });
});
test("Template flags require an own entry even for a plugin named like an Object prototype property", () => {
  const special = new CanvasModels([
    ...rules,
    { model: "constructor", kind: "video", templatePriority: 999 },
  ]);
  assert.equal(special.template({}), "");
  assert.equal(special.template({ constructor: true }), "constructor");
});
test("Partial canvas model catalog allows manual sticky/text/blank nodes while preserving strict model and resource checks", async () => {
  const partial = new CanvasModels([], true);
  assert.deepEqual(
    await validateCanvasDocument(
      parseCanvasDocument({
        nodes: [
          node("s", "sticky", { text: "便签内容", color: "yellow" }),
          node("t", "text", { text: "纯文本" }),
          node("i", "image"),
          node("v", "video"),
        ],
        edges: [{ id: "e1", source: "t", target: "v" }],
      }),
      partial,
      resources,
    ),
    [],
  );
  await assert.rejects(
    validateCanvasDocument(
      parseCanvasDocument({
        nodes: [node("v", "video", { params: { model: "muse-video" } })],
      }),
      partial,
      resources,
    ),
    { status: 400, message: "节点模型与生成类型不匹配" },
  );
  await assert.rejects(
    validateCanvasDocument(
      parseCanvasDocument({
        nodes: [
          node("s", "sticky", {
            asset_packs: [{ id: "a".repeat(32), revision: 1 }],
          }),
        ],
      }),
      partial,
      resources,
    ),
    { status: 404, message: "内容不存在或无权访问" },
  );
});
