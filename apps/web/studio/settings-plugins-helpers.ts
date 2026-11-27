export type PluginConfigField = {
  title?: string;
  description?: string;
  type?: string;
  items?: { type?: string };
  enum?: unknown[];
  writeOnly?: boolean;
};

export type PluginServiceSnapshot = {
  values: Record<string, unknown>;
  configuredFields: string[];
  concurrency?: number;
};

export const DEFAULT_SERVICE_CONCURRENCY = 1;
export const CAPACITY_SERVICE_CONCURRENCY = 16;
export const MIN_SERVICE_CONCURRENCY = 1;
export const MAX_SERVICE_CONCURRENCY = 100;

export function defaultServiceConcurrency(plugin?: {
  defaultConcurrency?: number;
}): number {
  const value = plugin?.defaultConcurrency;
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= MIN_SERVICE_CONCURRENCY &&
    value <= MAX_SERVICE_CONCURRENCY
  ) {
    return value;
  }
  return DEFAULT_SERVICE_CONCURRENCY;
}

export type PluginSchemaSnapshot = {
  configSchema: {
    properties?: Record<string, PluginConfigField>;
    required?: string[];
  };
};

export type SavedFieldSummary = {
  key: string;
  label: string;
  value: string;
  mono?: boolean;
  tone?: "ok" | "warn" | "muted";
};

export const pluginFieldLabels: Record<string, string> = {
  publicUrl: "服务公开地址",
  baseUrl: "服务地址",
  provider: "提供方",
  apiKey: "API 密钥",
  artifactOrigins: "允许下载媒体的其他地址",
};

export const pluginFieldLabel = (key: string, field: PluginConfigField = {}) =>
  field.title || pluginFieldLabels[key] || key;

export const isStringArrayField = (field: PluginConfigField = {}) =>
  field.type === "array" && field.items?.type === "string";

export function pluginFieldHint(
  key: string,
  field: PluginConfigField,
  editing: boolean,
  configured: boolean,
): string | undefined {
  if (field.description) return field.description;
  switch (key) {
    case "baseUrl":
      return "服务接口根地址（http:// 或 https://）。";
    case "apiKey":
      return editing && configured
        ? "已加密保存且不回显，留空将沿用当前密钥；更换服务地址的协议、域名或端口时需重新填写。"
        : "服务端加密保存，提交后不再回显。";
    case "publicUrl":
      return "填写服务对外提供访问的地址（http:// 或 https://）。";
    case "artifactOrigins":
      return (
        "可选。允许服务端下载成品的其他 https:// 域名，可每行填写一个或使用 JSON 数组。" +
        (editing && configured ? "留空将沿用已保存地址。" : "")
      );
    case "provider":
      return editing
        ? "当前连接的提供方不可直接切换；如需其他提供方，请点击「添加服务」新建连接。"
        : "选择该服务连接对应的上游提供方。";
    default:
      if (field.writeOnly)
        return editing && configured
          ? "已加密保存且不回显，留空将沿用当前值。"
          : "敏感字段，提交后不再回显。";
      if (isStringArrayField(field))
        return "每行填写一项，或输入 JSON 字符串数组。";
      return undefined;
  }
}

export function formatFieldDefault(
  field: PluginConfigField,
  value: unknown,
): string {
  if (value === undefined) return "";
  if (isStringArrayField(field) && Array.isArray(value))
    return value.map(String).join("\n");
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function parseFieldValue(
  key: string,
  field: PluginConfigField,
  raw: string,
): unknown {
  if (!field.type || field.type === "string") return raw;
  if (isStringArrayField(field)) {
    if (raw.startsWith("[")) {
      const parsed = JSON.parse(raw);
      if (
        !Array.isArray(parsed) ||
        parsed.some((item) => typeof item !== "string")
      )
        throw new Error(`请检查「${pluginFieldLabel(key, field)}」的格式`);
      return parsed;
    }
    return raw
      .split(/[\n,，]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return JSON.parse(raw);
}

export function parseServiceConcurrency(
  raw: string,
  fallback = DEFAULT_SERVICE_CONCURRENCY,
): number {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `请检查「并行任务数量」：需填写 ${MIN_SERVICE_CONCURRENCY}–${MAX_SERVICE_CONCURRENCY} 的整数`,
    );
  }
  const value = Number(trimmed);
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_SERVICE_CONCURRENCY ||
    value > MAX_SERVICE_CONCURRENCY
  ) {
    throw new Error(
      `请检查「并行任务数量」：需填写 ${MIN_SERVICE_CONCURRENCY}–${MAX_SERVICE_CONCURRENCY} 的整数`,
    );
  }
  return value;
}

export function offsetToLineColumn(
  source: string,
  offset: number,
): { line: number; column: number } {
  const limit = Math.max(0, Math.min(Math.trunc(offset), source.length));
  let line = 1;
  let column = 1;
  for (let i = 0; i < limit; i++) {
    const ch = source[i];
    if (ch === "\r") {
      if (source[i + 1] === "\n") continue;
      line++;
      column = 1;
    } else if (ch === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

const DEFAULT_JSON_SYNTAX_SUMMARY = "请检查文件内容是否为合法 JSON";

const V8_POSITION_SUFFIX_RE =
  /^([A-Za-z0-9 ,':[\]{}()_-]+?)\s+(?:in|after) JSON at position (\d+)(?: \(line \d+ column \d+\))?$/;
const FIREFOX_POSITION_SUFFIX_RE =
  /^JSON\.parse:\s+([^"]+?)\s+at line (\d+) column (\d+) of the JSON data$/;

function summarizeJsonSyntaxReason(reason: string): string {
  if (!reason) return DEFAULT_JSON_SYNTAX_SUMMARY;

  const tokenMatch =
    /^unexpected token\s+('(?:[^'\\]|\\.)*'|\S+)(?:,\s*[\s\S]*\bis not valid json)?\.?$/i.exec(
      reason,
    );
  if (tokenMatch) {
    const rawToken = tokenMatch[1];
    const token =
      rawToken.length >= 2 && rawToken.startsWith("'") && rawToken.endsWith("'")
        ? rawToken.slice(1, -1)
        : rawToken;
    switch (token) {
      case "\uFEFF":
        return "文件开头包含不可见 BOM 字符";
      case "]":
        return '意外的符号 "]"（请检查是否存在多余的尾逗号或缺失的值）';
      case "}":
        return '意外的符号 "}"（请检查是否存在缺失的属性值或多余的尾逗号）';
      case ",":
        return '意外的符号 ","（请检查是否存在缺失的值或连续逗号）';
      case ":":
        return '意外的符号 ":"';
      case "{":
        return '意外的符号 "{"';
      case "[":
        return '意外的符号 "["';
      case "'":
        return "包含单引号（JSON 键名与字符串须使用双引号）";
      case "/":
        return "JSON 标准不支持注释（请移除注释内容）";
      default:
        return "包含无效的字面量或符号（键名与字符串须使用双引号）";
    }
  }

  if (/^expected double-quoted property name$/i.test(reason))
    return "属性名须使用双引号（请检查是否存在多余的尾逗号）";
  if (/^expected property name or '\}'$/i.test(reason))
    return '缺少属性名或右花括号 "}"（请检查键名双引号或多余逗号）';
  if (/^expected ':'(?: after property name)?$/i.test(reason))
    return '属性名后缺少冒号 ":"';
  if (/^expected ',' or '\}'(?: after property value| in object)?$/i.test(reason))
    return '属性值后缺少逗号 "," 或右花括号 "}"';
  if (/^expected ',' or '\]'(?: after array element| in array)?$/i.test(reason))
    return '数组元素后缺少逗号 "," 或右方括号 "]"';
  if (/^unterminated string\b/i.test(reason))
    return "字符串未闭合（缺少结尾双引号）";
  if (
    /^(?:unexpected end of json input|unexpected eof|end of data\b[\s\S]*|unterminated object\b[\s\S]*|unterminated array\b[\s\S]*)$/i.test(
      reason,
    )
  )
    return "JSON 内容未完整闭合（意外到达文件末尾）";
  if (/^unexpected non-whitespace character(?:\s+after json(?:\s+data)?)?$/i.test(reason))
    return "JSON 根结构后存在多余内容";
  if (/^(?:unexpected number|no number after minus sign\b|expected digit\b)/i.test(reason))
    return "数字格式无效";
  if (/^unexpected string$/i.test(reason))
    return "字符串位置无效（请检查上一项末尾是否缺少逗号）";
  if (/^(?:unexpected identifier\b|unexpected character\b)/i.test(reason))
    return "包含无效的字面量或符号（键名与字符串须使用双引号）";
  if (/^bad control character in string literal$/i.test(reason))
    return "字符串中包含未转义的控制字符";
  if (/^bad (?:escaped character|unicode escape)\b/i.test(reason))
    return "字符串中包含无效的转义序列";

  return DEFAULT_JSON_SYNTAX_SUMMARY;
}

export function formatPluginJsonError(source: string, error: unknown): string {
  if (!source.trim()) {
    return "插件文件 JSON 格式错误：文件内容为空";
  }
  const rawMessage = (
    error instanceof Error ? error.message : String(error ?? "")
  ).trim();
  const v8Match = V8_POSITION_SUFFIX_RE.exec(rawMessage);
  const firefoxMatch = v8Match
    ? null
    : FIREFOX_POSITION_SUFFIX_RE.exec(rawMessage);
  const location = v8Match
    ? offsetToLineColumn(source, Number(v8Match[2]))
    : firefoxMatch
      ? { line: Number(firefoxMatch[2]), column: Number(firefoxMatch[3]) }
      : null;
  const reason = v8Match
    ? v8Match[1].trim()
    : firefoxMatch
      ? firefoxMatch[1].trim()
      : rawMessage
          .replace(/^JSON\.parse:\s*/i, "")
          .replace(/^JSON Parse error:\s*/i, "")
          .trim();
  const summary = summarizeJsonSyntaxReason(reason);
  const prefix = location
    ? `插件文件 JSON 格式错误（第 ${location.line} 行第 ${location.column} 列）`
    : "插件文件 JSON 格式错误";
  return `${prefix}：${summary}`;
}

export function parsePluginFileJson(source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(formatPluginJsonError(source, error));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("插件文件 JSON 格式错误：根节点须为 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

export async function readPluginFile(file: {
  text: () => Promise<string>;
}): Promise<Record<string, unknown>> {
  let source: string;
  try {
    source = await file.text();
  } catch {
    throw new Error("无法读取插件文件，请确认文件可访问后重试");
  }
  return parsePluginFileJson(source);
}

export function buildUpdateSourcePayload(
  input:
    | {
        url: string;
        token?: string;
        clearToken?: false;
      }
    | {
        savedUrl: string | null;
        url?: string;
        token?: string;
        clearToken: true;
      },
): { url: string | null; token?: string } {
  if (input.clearToken) {
    return { url: input.savedUrl?.trim() || null, token: "" };
  }
  const normalizedUrl = input.url.trim() || null;
  const normalizedToken = (input.token ?? "").trim();
  return {
    url: normalizedUrl,
    ...(normalizedToken ? { token: normalizedToken } : {}),
  };
}

export function describeSavedService(
  plugin: PluginSchemaSnapshot,
  service: PluginServiceSnapshot,
): SavedFieldSummary[] {
  const properties = plugin.configSchema.properties || {};
  const requiredKeys = new Set(plugin.configSchema.required || []);
  const rows: SavedFieldSummary[] = [];
  for (const [key, field] of Object.entries(properties)) {
    const required = requiredKeys.has(key);
    const configured = service.configuredFields.includes(key);
    const publicValue = service.values[key];
    if (field.writeOnly) {
      if (configured || required) {
        rows.push({
          key,
          label: pluginFieldLabel(key, field),
          value: configured ? "已保存（不回显）" : "未填写",
          tone: configured ? "ok" : "warn",
        });
      }
      continue;
    }
    if (publicValue !== undefined) {
      const text = Array.isArray(publicValue)
        ? publicValue.length
          ? publicValue.map(String).join("、")
          : "未设置"
        : String(publicValue);
      rows.push({
        key,
        label: pluginFieldLabel(key, field),
        value: text,
        mono:
          key === "baseUrl" ||
          key === "publicUrl" ||
          key === "artifactOrigins" ||
          key === "provider",
      });
      continue;
    }
    if (configured) {
      rows.push({
        key,
        label: pluginFieldLabel(key, field),
        value: "已保存（不回显）",
        tone: "ok",
      });
      continue;
    }
    if (required) {
      rows.push({
        key,
        label: pluginFieldLabel(key, field),
        value: "未配置",
        tone: "warn",
      });
    }
  }
  if (service.concurrency !== undefined) {
    rows.push({
      key: "concurrency",
      label: "并行任务上限",
      value: `${service.concurrency} 个`,
    });
  }
  return rows;
}

export const modelKindLabels = {
  image: "图片",
  video: "视频",
  audio: "语音",
  chat: "对话",
} as const;

export function findDuplicateModelIds(
  currentPluginId: string,
  allPlugins: { id: string; choices: { id: string; label: string }[] }[],
): Set<string> {
  const current = allPlugins.find((p) => p.id === currentPluginId);
  if (!current) return new Set();
  return new Set(
    current.choices
      .filter(
        (m) =>
          current.choices.some(
            (other) => other.id !== m.id && other.label === m.label,
          ) ||
          allPlugins.some(
            (other) =>
              other.id !== currentPluginId &&
              other.choices.some((c) => c.id !== m.id && c.label === m.label),
          ),
      )
      .map((m) => m.id),
  );
}
