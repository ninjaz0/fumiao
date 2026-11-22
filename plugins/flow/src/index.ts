import { readFileSync } from "node:fs";
import {
  connectionSchema,
  health,
  ProviderError,
  type ProviderPlugin,
  type ModelSpec,
  type Execution,
  type Receipt,
} from "@fumiao/plugin-sdk/index.js";
const catalog = JSON.parse(
  readFileSync(new URL("../models.json", import.meta.url), "utf8"),
) as Record<string, any>;
export const flow: ProviderPlugin = {
  manifest: {
    id: "flow",
    version: "1.0.0",
    contractVersion: 1,
    label: "Flow",
    mode: "request",
    configSchema: connectionSchema,
    models: Object.entries(catalog).map(([id, spec]): ModelSpec => ({
      id,
      label: spec.label,
      kind: spec.kind,
      hidden:
        !id.startsWith("flow:veo-3.1-quality") &&
        !id.startsWith("flow:omni-1.2-flash"),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        "x-references": {
          types: ["image"],
          min: spec.min_refs,
          max: spec.max_refs,
        },
        properties: {},
      },
    })),
  },
  health,
  submit: (e) => submitFlow(e),
};
export async function submitFlow(
  e: Execution,
  sourceMediaId?: string,
  captureMediaId = false,
): Promise<Receipt> {
  const spec = catalog[e.model];
  if (!spec) throw new ProviderError("Flow 模型不存在", "rejected");
  if (
    e.input.references.length < spec.min_refs ||
    e.input.references.length > spec.max_refs
  )
    throw new ProviderError("参考素材数量不符合模型要求", "rejected");
  if (e.input.references.some((ref) => !ref.mime.startsWith("image/")))
    throw new ProviderError("此 Flow 插件模型需要图片参考素材", "rejected");
  const content: any[] = [
    { type: "text", text: e.input.prompt },
    ...e.input.references.map((ref) => ({
      type: "image_url",
      image_url: { url: ref.url },
    })),
  ];
  if (sourceMediaId)
    content.push({
      type: "image_url",
      image_url: { url: "extend://" + sourceMediaId },
    });
  let response: Response;
  try {
    response = await fetch(
      `${String(e.config.baseUrl).replace(/\/$/, "")}/v1/chat/completions`,
      {
        method: "POST",
        redirect: "error",
        signal: e.signal,
        headers: {
          Authorization: `Bearer ${e.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: spec.upstream,
          messages: [{ role: "user", content }],
          stream: true,
        }),
      },
    );
  } catch {
    throw new ProviderError("Flow 提交结果待确认", "uncertain");
  }
  if (!response.ok)
    throw new ProviderError(
      `Flow 返回 HTTP ${response.status}`,
      response.status < 500 ? "rejected" : "uncertain",
    );
  let buffer = "",
    text = "",
    size = 0;
  const decoder = new TextDecoder();
  try {
    for await (const chunk of response.body as any) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) throw new Error("Response too large");
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        const event = JSON.parse(raw);
        if (event.error) throw new Error("Provider failed");
        for (const choice of event.choices || [])
          text += (choice.delta || choice.message)?.content || "";
      }
    }
    buffer += decoder.decode();
    if (
      buffer.trim().startsWith("data:") &&
      buffer.slice(5).trim() !== "[DONE]"
    ) {
      const event = JSON.parse(buffer.slice(5).trim());
      if (event.error) throw new Error("Provider failed");
      for (const choice of event.choices || [])
        text += (choice.delta || choice.message)?.content || "";
    }
  } catch {
    throw new ProviderError("Flow 流中断，生成结果待确认", "uncertain");
  }
  const match =
    text.match(/<video\b[^>]*\bsrc=["']([^"']+)/) ||
    text.match(/!\[[^\]]*\]\(([^\s)]+)\)/);
  const url = match?.[1] || text.match(/https?:\/\/[^\s<>"')]+/g)?.at(-1);
  if (!url) throw new ProviderError("Flow 未返回成品地址", "uncertain");
  return {
    state: "completed",
    artifacts: [{ url: url.replaceAll("&amp;", "&") }],
    ...(captureMediaId
      ? {
          usage: {
            flow_media_id:
              text.match(
                /\bdata-media-id=["\']([A-Za-z0-9_./:-]{1,300})["\']/,
              )?.[1] ?? null,
          },
        }
      : {}),
  };
}
