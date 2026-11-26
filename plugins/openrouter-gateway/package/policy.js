import { pythonJsonText } from "@fumiao/plugin-sdk/json.js";
import { pythonStrip, pythonTruthy } from "@fumiao/plugin-sdk/python-values.js";

const TITLE_SYSTEM =
  "你是对话标题生成器。根据用户的第一句提问和助手回复，总结一个简洁的中文标题（不超过 18 个字），只返回标题本身，不加引号或标点。";

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid object");
  return value;
}

function upstreamModel(provider, model) {
  if (provider === "newapi" && typeof model === "string" && model.startsWith("newapi/"))
    return model.slice("newapi/".length);
  return model;
}

function numberSources(text) {
  const numeric = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const parts = [];
  let copied = 0;
  for (let i = 0; i < text.length; ) {
    const c = text[i++];
    if (c === '"') {
      while (i < text.length) {
        const ch = text[i++];
        if (ch === "\\") i++;
        else if (ch === '"') break;
      }
    } else if (c === "-" || (c >= "0" && c <= "9")) {
      numeric.lastIndex = i - 1;
      const token = numeric.exec(text);
      if (!token) continue;
      if (
        token[0].replace(/^-/, "").length > 4300 &&
        /^-?\d+$/.test(token[0])
      )
        throw Error("Integer string limit");
      parts.push(text.slice(copied, i - 1), JSON.stringify(token[0]));
      copied = i = numeric.lastIndex;
    }
  }
  return pythonJsonText(parts.join("") + text.slice(copied));
}

export default {
  request(kind, input) {
    const headers =
      input.provider === "openrouter"
        ? {
            "HTTP-Referer": "https://fumiao.studio",
            "X-Title": "Fumiao Studio",
          }
        : undefined;
    if (kind === "probe") {
      return headers ? { path: "models", headers } : { path: "models" };
    }
    const model = upstreamModel(input.provider, input.model);
    const body =
      kind === "stream"
        ? {
            model,
            messages: input.messages,
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: 4096,
            ...(input.tools?.length ? { tools: input.tools } : {}),
          }
        : {
            model,
            messages: [
              { role: "system", content: TITLE_SYSTEM },
              {
                role: "user",
                content: `提问：${String(input.question || "").slice(0, 600)}\n回复：${String(input.answer || "").slice(0, 600)}`,
              },
            ],
            stream: false,
            max_tokens: 60,
          };
    return headers
      ? { path: "chat/completions", body, headers }
      : { path: "chat/completions", body };
  },
  event(line) {
    if (!line.startsWith("data:")) return { type: "skip" };
    const data = pythonStrip(line.slice(5));
    if (data === "[DONE]") return { type: "done" };
    let item, sources;
    try {
      item = pythonJsonText(data);
      sources = numberSources(data);
    } catch {
      return { type: "error", code: "format" };
    }
    record(item);
    if (pythonTruthy(item.error)) return { type: "error", code: "upstream" };
    const choices = pythonTruthy(item.choices) ? item.choices : [];
    if (!Array.isArray(choices)) throw Error("Invalid choices");
    const choice = choices.length ? record(choices[0]) : {};
    const delta = record(pythonTruthy(choice.delta) ? choice.delta : {});
    const usage = record(pythonTruthy(item.usage) ? item.usage : {});
    const integers = {};
    for (const key of [
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "prompt_cache_hit_tokens",
      "prompt_cache_miss_tokens",
    ]) {
      if (typeof usage[key] === "number" && /^-?\d+$/.test(sources.usage[key]))
        integers[key] = sources.usage[key];
    }
    const content = delta.content;
    return {
      type: "chunk",
      text: pythonTruthy(content)
        ? typeof content === "number" && !Number.isFinite(content)
          ? true
          : content
        : "",
      reason: choice.finish_reason ?? null,
      usage: integers,
      ...(delta.tool_calls == null ? {} : { toolCalls: delta.tool_calls }),
    };
  },
  title(body) {
    const root = record(pythonJsonText(body));
    const choices = Array.isArray(root.choices) ? root.choices : [];
    const first = choices.length ? record(choices[0]) : {};
    const msg = record(first.message || {});
    return pythonStrip(String(msg.content || ""))
      .replace(/^["'“”「『]+|["'“”」』]+$/g, "")
      .slice(0, 60);
  },
  probe(body, models) {
    const root = record(pythonJsonText(body));
    let data = Object.hasOwn(root, "data") ? root.data : [];
    if (
      data === "" ||
      (data && typeof data === "object" && !Object.keys(data).length)
    )
      data = [];
    if (!Array.isArray(data)) throw Error("Invalid model list");
    const ids = data.map((item) => {
      record(item);
      if (
        !Object.hasOwn(item, "id") ||
        (item.id !== null && typeof item.id === "object")
      )
        throw Error("Invalid model ID");
      return String(item.id);
    });
    if (!ids.length) return "empty";
    const matchable = models.map((m) =>
      m.startsWith("newapi/") ? m.slice("newapi/".length) : m,
    );
    return matchable.some((m) => ids.includes(m)) ? "ok" : "unavailable";
  },
};
