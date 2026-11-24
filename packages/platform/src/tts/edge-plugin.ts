import type { Manifest, ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import type { ModelForm } from "@fumiao/plugin-sdk/model-form.js";
import {
  EDGE_TTS_VOICE_IDS,
  EDGE_TTS_VOICE_LABELS,
  synthesizeEdgeTts,
  type EdgeWebSocketFactory,
} from "./edge-tts.js";

const edgeTtsForm: ModelForm = {
  parameterObject: true,
  fields: {
    voice: {
      type: "string",
      title: "声线",
      enum: EDGE_TTS_VOICE_IDS,
      default: "zh-CN-XiaoxiaoNeural",
      optionLabels: EDGE_TTS_VOICE_LABELS,
    },
    rate: {
      type: "string",
      title: "语速",
      enum: ["-30%", "-15%", "+0%", "+15%", "+30%"],
      default: "+0%",
      optionLabels: {
        "-30%": "很慢 (-30%)",
        "-15%": "偏慢 (-15%)",
        "+0%": "标准",
        "+15%": "偏快 (+15%)",
        "+30%": "很快 (+30%)",
      },
    },
    pitch: {
      type: "string",
      title: "音调",
      enum: ["-15Hz", "-5Hz", "+0Hz", "+5Hz", "+15Hz"],
      default: "+0Hz",
      optionLabels: {
        "-15Hz": "低沉 (-15Hz)",
        "-5Hz": "偏低 (-5Hz)",
        "+0Hz": "标准",
        "+5Hz": "偏高 (+5Hz)",
        "+15Hz": "高亢 (+15Hz)",
      },
    },
    instruction: {
      type: "string",
      title: "备注",
      maxLength: 300,
    },
  },
  tiers: [{ tier: "free", when: {} }],
  references: { min: 0, max: 0 },
};

export const edgeTtsManifest: Manifest = {
  id: "edge-tts",
  label: "Edge TTS（免费兜底配音）",
  version: "1.0.0",
  contractVersion: 1,
  mode: "request",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      defaultVoice: { type: "string", enum: EDGE_TTS_VOICE_IDS },
    },
  },
  models: [
    {
      id: "edge-tts",
      label: "Edge TTS（免费神经语音）",
      kind: "audio",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          voice: { type: "string", enum: EDGE_TTS_VOICE_IDS },
          rate: { type: "string" },
          pitch: { type: "string" },
          instruction: { type: "string", maxLength: 300 },
        },
      },
      studio: {
        order: 90,
        priceOrder: 900,
        descriptor: {
          kind: "audio",
          label: "Edge TTS（免费神经语音）",
          provider: "edge-tts",
        },
        prices: [
          {
            tier: "free",
            label: "免费兜底合成",
            amount: 0,
            match: { type: "object", properties: {} },
          },
        ],
      },
    },
  ],
  canvasSubmission: {
    version: 1,
    models: [
      {
        model: "edge-tts",
        kind: "audio",
        defaultForKind: false,
      },
    ],
  },
};

export function createEdgeTtsPlugin(
  wsFactory?: EdgeWebSocketFactory,
): ProviderPlugin {
  return {
    manifest: edgeTtsManifest,
    modelForm: () => edgeTtsForm,
    health: async () => typeof WebSocket === "function" || !!wsFactory,
    async submit(e) {
      const params = e.input.params ?? {};
      const voice =
        (typeof params.voice === "string" && params.voice) ||
        (typeof e.config.defaultVoice === "string" && e.config.defaultVoice) ||
        "zh-CN-XiaoxiaoNeural";
      const rate = typeof params.rate === "string" ? params.rate : "+0%";
      const pitch = typeof params.pitch === "string" ? params.pitch : "+0Hz";
      const { mime, bytes } = await synthesizeEdgeTts(
        { text: e.input.prompt, voice, rate, pitch },
        e.signal,
        wsFactory,
      );
      return {
        state: "completed",
        artifacts: [
          {
            mime,
            url: `data:${mime};base64,${bytes.toString("base64")}`,
          },
        ],
      };
    },
  };
}

export const edgeTtsPlugin: ProviderPlugin = createEdgeTtsPlugin();
