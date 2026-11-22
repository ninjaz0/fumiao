import {
  connectionSchema,
  health,
  requestJson,
  ProviderError,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
export const chat: ProviderPlugin = {
  manifest: {
    id: "compatible-chat",
    version: "1.0.0",
    contractVersion: 1,
    label: "OpenAI 兼容对话",
    mode: "request",
    configSchema: connectionSchema,
    models: ["gpt-4.1", "deepseek-flash"].map((id) => ({
      id,
      label: id,
      kind: "chat",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        "x-references": { max: 0 },
        properties: {
          history: {
            type: "array",
            maxItems: 50,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["role", "content"],
              properties: {
                role: { type: "string", enum: ["user", "assistant", "system"] },
                content: { type: "string", maxLength: 16000 },
              },
            },
          },
          temperature: { type: "number", minimum: 0, maximum: 2, default: 1 },
        },
      },
    })),
  },
  health,
  async submit(e) {
    const data = await requestJson(e, "v1/chat/completions", {
      model: e.model,
      messages: [
        ...(Array.isArray(e.input.params.history)
          ? e.input.params.history
          : []),
        { role: "user", content: e.input.prompt },
      ],
      stream: false,
      temperature: e.input.params.temperature,
    });
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text)
      throw new ProviderError("对话返回结果无效", "uncertain");
    return { state: "completed", artifacts: [], text, usage: data.usage || {} };
  },
};
