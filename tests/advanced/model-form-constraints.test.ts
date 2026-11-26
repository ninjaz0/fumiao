import assert from "node:assert/strict";
import test from "node:test";
import {
  choices,
  evaluateFormConstraints,
  formError,
  normalizeForm,
  type ModelForm,
} from "@fumiao/plugin-sdk/model-form.js";
import type { ModelSpec } from "@fumiao/plugin-sdk/index.js";
import { remoteForm } from "@fumiao/plugin-remote/form.js";

const sampleForm: ModelForm = {
  parameterObject: true,
  fields: {
    mode: {
      ...choices(["standard", "pro"], "standard"),
      title: "模式",
      optionLabels: { standard: "标准版", pro: "专业版" },
    },
    resolution: {
      ...choices(["720p", "1080p", "4k"], "720p"),
      title: "分辨率",
      disableWhen: [
        {
          when: { mode: ["standard"] },
          values: ["4k"],
          reason: "仅专业版支持 4K 输出",
        },
      ],
    },
    seconds: {
      ...choices([5, 10], 5),
      title: "时长",
    },
    camera_motion: {
      ...choices(["static", "orbit"], "static"),
      title: "运镜",
      visibleWhen: { mode: ["pro"] },
    },
    audio_track: {
      type: "boolean",
      title: "原生音频",
      default: false,
      disableWhen: [
        {
          when: { mode: ["standard"] },
          reason: "标准版不支持原生音频",
        },
      ],
    },
  },
  required: ["mode", "resolution", "seconds", "camera_motion"],
  combinations: [
    { mode: ["standard"], resolution: ["720p", "1080p"], seconds: [5, 10] },
    { mode: ["pro"], resolution: ["720p", "1080p"], seconds: [5, 10] },
    { mode: ["pro"], resolution: ["4k"], seconds: [5] },
  ],
  tiers: [{ tier: "default", when: {} }],
  references: {
    min: 0,
    max: 4,
    counts: { image: 4, video: 0, audio: 0 },
    conditionalLimits: [
      {
        when: { mode: ["pro"], resolution: ["4k"] },
        max: 2,
        counts: { image: 2 },
        maxSeconds: 5,
        reason: "4K 专业模式最多支持 2 张参考图",
      },
    ],
  },
};

test("evaluateFormConstraints resolves visibleWhen, field/option disableWhen, combinations and conditionalLimits", () => {
  const std = evaluateFormConstraints(sampleForm, {
    mode: "standard",
    resolution: "720p",
    seconds: 5,
  });
  assert.equal(std.fields.camera_motion.visible, false);
  assert.equal(std.fields.audio_track.disabled, true);
  assert.equal(std.fields.audio_track.disabledReason, "标准版不支持原生音频");
  assert.equal(
    std.fields.resolution.disabledOptions[JSON.stringify("4k")],
    "仅专业版支持 4K 输出",
  );
  assert.equal(std.references.max, 4);
  assert.deepEqual(std.references.counts, { image: 4, video: 0, audio: 0 });
  assert.equal(std.references.reason, undefined);

  const pro4k = evaluateFormConstraints(sampleForm, {
    mode: "pro",
    resolution: "4k",
    seconds: 5,
    camera_motion: "orbit",
  });
  assert.equal(pro4k.fields.camera_motion.visible, true);
  assert.equal(pro4k.fields.audio_track.disabled, false);
  assert.equal(pro4k.fields.resolution.disabledOptions[JSON.stringify("4k")], undefined);
  assert.equal(
    pro4k.fields.seconds.incompatibleOptions[JSON.stringify(10)],
    "切换该项将自动调整关联参数",
  );
  assert.equal(pro4k.references.max, 2);
  assert.deepEqual(pro4k.references.counts, { image: 2, video: 0, audio: 0 });
  assert.equal(pro4k.references.maxSeconds, 5);
  assert.equal(pro4k.references.reason, "4K 专业模式最多支持 2 张参考图");
});

test("normalizeForm removes hidden fields, adjusts disabled options and preserves edited parameter priority", () => {
  const normalizedStd = normalizeForm(
    sampleForm,
    {
      mode: "standard",
      resolution: "4k",
      seconds: 10,
      camera_motion: "orbit",
    },
    "mode",
  );
  assert.equal(normalizedStd.mode, "standard");
  assert.notEqual(normalizedStd.resolution, "4k");
  assert.equal("camera_motion" in normalizedStd, false);
  assert.equal(formError(sampleForm, normalizedStd), "");

  const normalizedPro4k = normalizeForm(
    sampleForm,
    {
      mode: "pro",
      resolution: "4k",
      seconds: 10,
    },
    "resolution",
  );
  assert.equal(normalizedPro4k.mode, "pro");
  assert.equal(normalizedPro4k.resolution, "4k");
  assert.equal(normalizedPro4k.seconds, 5);
  assert.equal(normalizedPro4k.camera_motion, "static");
  assert.equal(formError(sampleForm, normalizedPro4k), "");
});

test("formError skips hidden required fields and reports disabled option reasons", () => {
  // camera_motion is required when visible, but hidden in standard mode -> valid!
  assert.equal(
    formError(sampleForm, {
      mode: "standard",
      resolution: "1080p",
      seconds: 10,
    }),
    "",
  );
  // In pro mode, missing camera_motion triggers required error.
  assert.equal(
    formError(sampleForm, {
      mode: "pro",
      resolution: "1080p",
      seconds: 10,
    }),
    "请填写运镜",
  );
  // Selecting disabled option returns its disableWhen reason.
  assert.equal(
    formError(sampleForm, {
      mode: "standard",
      resolution: "4k",
      seconds: 5,
    }),
    "分辨率：仅专业版支持 4K 输出",
  );
});

test("remoteForm compiles x-visibleWhen, x-disableWhen, x-optionLabels, x-uiHint and x-references.conditionalLimits", () => {
  const baseSpec = (inputSchema: Record<string, unknown>): ModelSpec => ({
    id: "dynamic-video",
    label: "动态视频模型",
    kind: "video",
    inputSchema,
    studio: {
      order: 1,
      priceOrder: 1,
      descriptor: { kind: "video", label: "动态视频模型" },
      prices: [
        {
          tier: "default",
          label: "标准",
          amount: 10,
          match: { type: "object", properties: {} },
        },
      ],
    },
  });

  const compiled = remoteForm(
    baseSpec({
      type: "object",
      additionalProperties: false,
      required: ["mode", "resolution"],
      properties: {
        mode: {
          type: "string",
          title: "模式",
          enum: ["fast", "quality"],
          default: "fast",
          "x-optionLabels": { fast: "极速", quality: "高画质" },
        },
        resolution: {
          type: "string",
          title: "分辨率",
          enum: ["720p", "1080p"],
          default: "720p",
          "x-disableWhen": [
            {
              when: { mode: ["fast"] },
              values: ["1080p"],
              reason: "极速模式仅支持 720p",
            },
          ],
        },
        seed: {
          type: "integer",
          title: "种子",
          minimum: 0,
          maximum: 2147483647,
          "x-visibleWhen": { mode: ["quality"] },
          "x-uiHint": "seed",
        },
      },
      "x-references": {
        min: 0,
        max: 4,
        counts: { image: 4, video: 0, audio: 0 },
        conditionalLimits: [
          {
            when: { mode: ["fast"] },
            max: 1,
            counts: { image: 1 },
            reason: "极速模式仅支持 1 张首帧",
          },
        ],
      },
    }),
    true,
  );

  assert.deepEqual(compiled.fields.mode.optionLabels, {
    fast: "极速",
    quality: "高画质",
  });
  assert.equal(compiled.fields.seed.uiHint, "seed");
  assert.deepEqual(compiled.fields.seed.visibleWhen, { mode: ["quality"] });
  assert.equal(compiled.references.conditionalLimits?.length, 1);

  const evalFast = evaluateFormConstraints(compiled, {
    mode: "fast",
    resolution: "720p",
  });
  assert.equal(evalFast.fields.seed.visible, false);
  assert.equal(evalFast.references.max, 1);
  assert.equal(
    evalFast.fields.resolution.disabledOptions[JSON.stringify("1080p")],
    "极速模式仅支持 720p",
  );

  // Rejects unknown field in x-visibleWhen
  assert.throws(
    () =>
      remoteForm(
        baseSpec({
          type: "object",
          additionalProperties: false,
          properties: {
            a: {
              type: "string",
              enum: ["x"],
              "x-visibleWhen": { ghost: ["x"] },
            },
          },
        }),
        true,
      ),
    /无效的参数匹配条件/,
  );

  // Rejects invalid option value in x-disableWhen
  assert.throws(
    () =>
      remoteForm(
        baseSpec({
          type: "object",
          additionalProperties: false,
          properties: {
            a: { type: "string", enum: ["x", "y"] },
            b: {
              type: "string",
              enum: ["1", "2"],
              "x-disableWhen": [
                { when: { a: ["x"] }, values: ["999"], reason: "bad" },
              ],
            },
          },
        }),
        true,
      ),
    /无效的禁用条件选项/,
  );

  // Rejects min > max inside x-references.conditionalLimits
  assert.throws(
    () =>
      remoteForm(
        baseSpec({
          type: "object",
          additionalProperties: false,
          properties: {
            a: { type: "string", enum: ["x"] },
          },
          "x-references": {
            min: 0,
            max: 4,
            conditionalLimits: [{ when: { a: ["x"] }, min: 3, max: 1 }],
          },
        }),
        true,
      ),
    /无效的参考约束范围/,
  );
});
