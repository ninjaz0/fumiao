import {
  connectionSchema,
  health,
  ProviderError,
  type ProviderPlugin,
  type Execution,
  type Receipt,
} from "../../../packages/plugin-sdk/src/index.js";
export const images: ProviderPlugin = {
  manifest: {
    id: "compatible-images",
    version: "1.0.0",
    contractVersion: 1,
    label: "OpenAI 兼容图片",
    mode: "request",
    configSchema: connectionSchema,
    models: [
      {
        id: "gpt-image-2.6-sunburst",
        label: "GPT Image（原平台模型）",
        kind: "image",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          "x-references": { types: ["image"], max: 8 },
          properties: {
            size: {
              type: "string",
              pattern: "^[0-9]{3,4}x[0-9]{3,4}$",
              default: "1024x1024",
            },
            quality: {
              type: "string",
              enum: ["low", "medium", "high", "auto"],
              default: "medium",
            },
          },
        },
      },
    ],
  },
  health,
  submit: (e) => submitImages(e),
};
export async function submitImages(
  e: Execution,
  safetyIdentifier?: string,
): Promise<Receipt> {
  const payload = {
    ...(safetyIdentifier ? { safety_identifier: safetyIdentifier } : {}),
    model: e.model,
    prompt: e.input.prompt,
    n: 1,
    size: e.input.params.size || "1024x1024",
    quality: e.input.params.quality || "medium",
    output_format: "png",
  };
  let body: string | FormData = JSON.stringify(payload);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${e.config.apiKey}`,
    "Idempotency-Key": e.idempotencyKey,
  };
  if (e.input.references.length) {
    body = new FormData();
    for (const [key, value] of Object.entries(payload))
      body.set(key, String(value));
    for (const [index, ref] of e.input.references.entries()) {
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(ref.url))
        throw new ProviderError("图片参考格式不支持", "rejected");
      const bytes = Buffer.from(ref.url.split(",")[1], "base64");
      body.append(
        "image[]",
        new Blob([bytes], { type: ref.mime }),
        `reference-${index}.${ref.mime.split("/")[1]}`,
      );
    }
  } else headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(
      new URL(
        "v1/images/" + (e.input.references.length ? "edits" : "generations"),
        String(e.config.baseUrl).replace(/\/$/, "") + "/",
      ),
      { method: "POST", body, headers, signal: e.signal, redirect: "error" },
    );
    if (!response.ok)
      throw new ProviderError(
        `图片提供方返回 HTTP ${response.status}`,
        response.status < 500 && ![408, 409].includes(response.status)
          ? "rejected"
          : "uncertain",
      );
    if (!response.body) throw new Error("Empty result");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body as any) {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) throw new Error("Image response too large");
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (!Array.isArray(data.data) || data.data.length !== 1)
      throw new Error("Invalid image response");
    const result = data.data[0];
    const url = result.b64_json
      ? "data:image/png;base64," + result.b64_json
      : result.url;
    if (typeof url !== "string") throw new Error("Missing image");
    return {
      state: "completed",
      artifacts: [{ url }],
      usage: data.usage || {},
    };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError("图片生成结果待确认", "uncertain");
  }
}
