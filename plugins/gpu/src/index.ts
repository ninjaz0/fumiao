import {
  ProviderError,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
export const videoQualities = [480, 768];
export const videoSeconds = [5, 10, 15];
export const gpu: ProviderPlugin = {
  manifest: {
    id: "gpu",
    version: "1.0.0",
    contractVersion: 1,
    label: "GPU 工作节点",
    mode: "pull",
    configSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    models: [
      {
        id: "MiniMax H3",
        label: "MiniMax H3",
        kind: "video",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          "x-references": { types: ["image"], max: 4 },
          properties: {
            ratio: {
              type: "string",
              enum: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
              default: "16:9",
            },
            quality: { type: "integer", enum: videoQualities, default: 480 },
            seconds: { type: "integer", enum: videoSeconds, default: 5 },
            sampling_steps: {
              type: "integer",
              enum: [4, 16, 20, 32, 50],
              default: 20,
            },
            seed: { type: "integer", minimum: 0, maximum: 9007199254740991 },
          },
        },
      },
      {
        id: "breeze-tts-2",
        label: "Breeze TTS 2",
        kind: "audio",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          "x-references": { max: 0 },
          properties: {
            instruction: { type: "string", maxLength: 300 },
            seed: { type: "integer", minimum: 0, maximum: 4294967295 },
          },
        },
      },
    ],
  },
  async health() {
    return true;
  },
  async submit() {
    throw new ProviderError("等待 GPU 节点主动领取", "retryable");
  },
};
