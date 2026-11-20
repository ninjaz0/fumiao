import assert from "node:assert/strict";
import test from "node:test";
import {
  describeSavedService,
  findDuplicateModelIds,
  formatFieldDefault,
  parseFieldValue,
  pluginFieldHint,
} from "../../apps/web/studio/settings-plugins-helpers.js";

const museSchema = {
  configSchema: {
    required: ["baseUrl", "apiKey"],
    properties: {
      baseUrl: { type: "string" },
      apiKey: { type: "string", writeOnly: true },
      artifactOrigins: { type: "array", items: { type: "string" } },
      publicUrl: { type: "string" },
    },
  },
};

test("describeSavedService shows public fields and secret state without exposing secret values", () => {
  const rows = describeSavedService(museSchema, {
    values: {
      baseUrl: "https://muse.internal.example",
      apiKey: "should-never-be-displayed",
      artifactOrigins: ["https://cdn1.example", "https://cdn2.example"],
    },
    configuredFields: ["baseUrl", "apiKey", "artifactOrigins"],
  });

  assert.deepEqual(rows, [
    {
      key: "baseUrl",
      label: "服务地址",
      value: "https://muse.internal.example",
      mono: true,
    },
    {
      key: "apiKey",
      label: "API 密钥",
      value: "已保存（不回显）",
      tone: "ok",
    },
    {
      key: "artifactOrigins",
      label: "允许下载媒体的其他地址",
      value: "https://cdn1.example、https://cdn2.example",
      mono: true,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /should-never-be-displayed/);
});

test("describeSavedService flags missing required fields and hides unset optional fields", () => {
  const rows = describeSavedService(museSchema, {
    values: {},
    configuredFields: [],
  });
  assert.deepEqual(rows, [
    { key: "baseUrl", label: "服务地址", value: "未配置", tone: "warn" },
    { key: "apiKey", label: "API 密钥", value: "未填写", tone: "warn" },
  ]);
});

test("findDuplicateModelIds flags duplicate labels within one plugin and across plugins", () => {
  const samePlugin = findDuplicateModelIds("muse", [
    {
      id: "muse",
      choices: [
        { id: "muse-video", label: "Muse" },
        { id: "muse-image", label: "Muse" },
      ],
    },
  ]);
  assert.deepEqual([...samePlugin], ["muse-video", "muse-image"]);

  const crossPlugin = findDuplicateModelIds("muse", [
    { id: "muse", choices: [{ id: "muse-video", label: "Muse 视频" }] },
    { id: "other", choices: [{ id: "other-video", label: "Muse 视频" }] },
  ]);
  assert.deepEqual([...crossPlugin], ["muse-video"]);
});

test("parseFieldValue and formatFieldDefault handle newline and JSON array inputs for string arrays", () => {
  const field = { type: "array", items: { type: "string" } };
  assert.equal(
    formatFieldDefault(field, ["https://a.example", "https://b.example"]),
    "https://a.example\nhttps://b.example",
  );
  assert.deepEqual(
    parseFieldValue(
      "artifactOrigins",
      field,
      "https://a.example\nhttps://b.example",
    ),
    ["https://a.example", "https://b.example"],
  );
  assert.deepEqual(
    parseFieldValue("artifactOrigins", field, '["https://json.example"]'),
    ["https://json.example"],
  );
  assert.deepEqual(parseFieldValue("values", { type: "array" }, '[1,"two"]'), [
    1,
    "two",
  ]);
  assert.throws(
    () => parseFieldValue("artifactOrigins", field, "[123]"),
    /允许下载媒体的其他地址/,
  );
});

test("pluginFieldHint explains credential retention and origin change accurately", () => {
  assert.match(
    pluginFieldHint("apiKey", { type: "string", writeOnly: true }, true, true)!,
    /留空将沿用.*协议、域名或端口时需重新填写/,
  );
  assert.match(
    pluginFieldHint("publicUrl", { type: "string" }, false, false)!,
    /对外提供访问/,
  );
});
