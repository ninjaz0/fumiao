import {
  chatPayload,
  chatTitlePayload,
  chatTitleResult,
  record,
} from "@fumiao/plugin-chat/policy.js";
import { pythonJsonText } from "@fumiao/plugin-sdk/json.js";
import { pythonStrip, pythonTruthy } from "@fumiao/plugin-sdk/python-values.js";

// QuickJS lacks the JSON.parse reviver's source argument. This parallel tree
// keeps each numeric token's spelling, including values beyond 2^53 and 1.0.
// Only consult leaves already parsed as numbers in the original tree.
function numberSources(text) {
  const numeric = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const parts = [];
  let copied = 0;
  for (let i = 0; i < text.length;) {
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
      if (token[0].replace(/^-/, "").length > 4300 && /^-?\d+$/.test(token[0]))
        throw Error("Integer string limit");
      parts.push(text.slice(copied, i - 1), JSON.stringify(token[0]));
      copied = i = numeric.lastIndex;
    }
  }
  return pythonJsonText(parts.join("") + text.slice(copied));
}

export default {
  request(kind, input) {
    if (kind === "probe") return { path: "models" };
    const request = { ...input, config: { provider: input.provider } };
    return {
      path: "chat/completions",
      body:
        kind === "stream"
          ? {
              ...chatPayload(request),
              ...(input.tools?.length ? { tools: input.tools } : {}),
            }
          : chatTitlePayload(request),
    };
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
    // Non-string truthy text must still trigger the turn executor's failure.
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
    return chatTitleResult(pythonJsonText(body));
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
      return item.id;
    });
    return !ids.length
      ? "empty"
      : models.some((m) => ids.includes(m))
        ? "ok"
        : "unavailable";
  },
};
