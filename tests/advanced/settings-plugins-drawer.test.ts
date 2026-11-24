import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SERVICE_CONCURRENCY,
  buildUpdateSourcePayload,
  describeSavedService,
  findDuplicateModelIds,
  formatFieldDefault,
  formatPluginJsonError,
  offsetToLineColumn,
  parseFieldValue,
  parsePluginFileJson,
  parseServiceConcurrency,
  pluginFieldHint,
  readPluginFile,
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

test("describeSavedService includes service concurrency when present (#68)", () => {
  const rows = describeSavedService(museSchema, {
    values: { baseUrl: "https://muse.internal.example" },
    configuredFields: ["baseUrl", "apiKey"],
    concurrency: 4,
  });
  assert.deepEqual(rows.at(-1), {
    key: "concurrency",
    label: "并行任务上限",
    value: "4 个",
  });
});

test("parseServiceConcurrency defaults blank input and validates integer bounds 1..100 (#68)", () => {
  assert.equal(parseServiceConcurrency(""), DEFAULT_SERVICE_CONCURRENCY);
  assert.equal(parseServiceConcurrency("   ", 6), 6);
  assert.equal(parseServiceConcurrency("1"), 1);
  assert.equal(parseServiceConcurrency("100"), 100);
  assert.equal(parseServiceConcurrency(" 12 "), 12);

  for (const invalid of ["0", "101", "-1", "2.5", "1e2", "abc"]) {
    assert.throws(
      () => parseServiceConcurrency(invalid),
      /请检查「并行任务数量」：需填写 1–100 的整数/,
    );
  }
});

test("readPluginFile distinguishes file read failure from JSON syntax errors with line/column (#59)", async () => {
  await assert.rejects(
    () =>
      readPluginFile({
        text: () => Promise.reject(new Error("NotReadableError")),
      }),
    /无法读取插件文件/,
  );

  const trailingCommaJson = '{\n  "id": "muse",\n  "version": "1.0.0",\n}';
  await assert.rejects(
    () =>
      readPluginFile({
        text: () => Promise.resolve(trailingCommaJson),
      }),
    (err: unknown) => {
      assert(err instanceof Error);
      assert.doesNotMatch(err.message, /无法读取插件文件/);
      assert.match(err.message, /插件文件 JSON 格式错误（第 4 行第 1 列）/);
      assert.match(err.message, /双引号|尾逗号/);
      return true;
    },
  );
});

test("offsetToLineColumn and formatPluginJsonError handle LF/CRLF offsets, Firefox positions and redact snippets (#59)", () => {
  const crlfSource = '{\r\n  "id": "muse",\r\n  "version": 1.0.0\r\n}';
  assert.deepEqual(offsetToLineColumn(crlfSource, 0), { line: 1, column: 1 });
  assert.deepEqual(offsetToLineColumn(crlfSource, 36), { line: 3, column: 17 });

  assert.equal(
    formatPluginJsonError(
      '{\n  "id": "muse",\n}',
      new SyntaxError("Unexpected token } in JSON at position 18"),
    ),
    '插件文件 JSON 格式错误（第 3 行第 1 列）：意外的符号 "}"（请检查是否存在缺失的属性值或多余的尾逗号）',
  );

  assert.equal(
    formatPluginJsonError(
      '{\n  "id": "muse",\n}',
      new SyntaxError(
        "JSON.parse: expected double-quoted property name at line 3 column 1 of the JSON data",
      ),
    ),
    "插件文件 JSON 格式错误（第 3 行第 1 列）：属性名须使用双引号（请检查是否存在多余的尾逗号）",
  );

  assert.equal(
    formatPluginJsonError("   \n  ", new SyntaxError("Unexpected end of JSON input")),
    "插件文件 JSON 格式错误：文件内容为空",
  );

  const secretLeakAttempt = formatPluginJsonError(
    'API_KEY=sk-secret-value',
    new SyntaxError(
      'Unexpected token \'A\', "API_KEY=sk-secret-value" is not valid JSON',
    ),
  );
  assert.doesNotMatch(secretLeakAttempt, /sk-secret-value/);
  assert.equal(
    secretLeakAttempt,
    "插件文件 JSON 格式错误：包含无效的字面量或符号（键名与字符串须使用双引号）",
  );

  // Regression: V8 snippet containing "at position 8" or "at line 2 column 5" must NOT be mistaken for engine position
  assert.throws(
    () => parsePluginFileJson("at position 8"),
    (err: unknown) => {
      assert(err instanceof Error);
      assert.equal(
        err.message,
        "插件文件 JSON 格式错误：包含无效的字面量或符号（键名与字符串须使用双引号）",
      );
      assert.doesNotMatch(err.message, /第\s*\d+\s*行/);
      assert.doesNotMatch(err.message, /at position 8/);
      return true;
    },
  );

  assert.throws(
    () => parsePluginFileJson("at line 2 column 5 of the JSON data"),
    (err: unknown) => {
      assert(err instanceof Error);
      assert.doesNotMatch(err.message, /第\s*\d+\s*行/);
      assert.doesNotMatch(err.message, /line 2 column 5/);
      return true;
    },
  );

  // Trailing non-whitespace after valid JSON uses V8 "after JSON at position N" suffix
  assert.throws(
    () => parsePluginFileJson('{"id": "muse"} trailing'),
    /插件文件 JSON 格式错误（第 1 行第 16 列）：JSON 根结构后存在多余内容/,
  );

  // Unknown syntax messages fall back to fixed copy and never echo parser snippets
  const unknownParserMsg = formatPluginJsonError(
    '{"id": "muse"}',
    new SyntaxError('Custom parser failed near "secret_snippet" at position 4'),
  );
  assert.equal(
    unknownParserMsg,
    "插件文件 JSON 格式错误：请检查文件内容是否为合法 JSON",
  );

  const unknownWithV8Suffix = formatPluginJsonError(
    '{\n  "id": "muse"\n}',
    new SyntaxError(
      "Future V8 reason in JSON at position 4 (line 2 column 3)",
    ),
  );
  assert.equal(
    unknownWithV8Suffix,
    "插件文件 JSON 格式错误（第 2 行第 3 列）：请检查文件内容是否为合法 JSON",
  );

  const safariLeakAttempt = formatPluginJsonError(
    '{"apiKey": superSecretToken}',
    new SyntaxError('JSON Parse error: Unexpected identifier "superSecretToken"'),
  );
  assert.doesNotMatch(safariLeakAttempt, /superSecretToken/);
  assert.equal(
    safariLeakAttempt,
    "插件文件 JSON 格式错误：包含无效的字面量或符号（键名与字符串须使用双引号）",
  );

  assert.throws(
    () => parsePluginFileJson('["not-an-object"]'),
    /根节点须为 JSON 对象/,
  );
  assert.deepEqual(parsePluginFileJson('{"id":"muse"}'), { id: "muse" });
});

test("buildUpdateSourcePayload retains saved token when blank and uses savedUrl on explicit clear (#70)", () => {
  const retained = buildUpdateSourcePayload({
    url: " https://updates.example.com/update.json ",
    token: "",
  });
  assert.deepEqual(retained, { url: "https://updates.example.com/update.json" });
  assert.equal(Object.hasOwn(retained, "token"), false);

  const whitespaceRetained = buildUpdateSourcePayload({
    url: "https://updates.example.com/update.json",
    token: "   ",
  });
  assert.equal(Object.hasOwn(whitespaceRetained, "token"), false);

  assert.deepEqual(
    buildUpdateSourcePayload({
      url: "https://updates.example.com/update.json",
      token: " ghp_readonly_token ",
    }),
    {
      url: "https://updates.example.com/update.json",
      token: "ghp_readonly_token",
    },
  );

  for (const uncommittedDraftUrl of [
    "",
    "not-a-valid-url",
    "https://uncommitted.example.com/other.json",
  ]) {
    assert.deepEqual(
      buildUpdateSourcePayload({
        savedUrl: "https://updates.example.com/update.json",
        url: uncommittedDraftUrl,
        token: "ignored-draft",
        clearToken: true,
      }),
      {
        url: "https://updates.example.com/update.json",
        token: "",
      },
    );
  }
});
