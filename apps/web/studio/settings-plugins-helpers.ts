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
};

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
