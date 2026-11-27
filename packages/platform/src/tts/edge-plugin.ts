import { randomUUID } from "node:crypto";
import {
  OriginalSubmissionError,
  ProviderError,
  type Manifest,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
import type { ModelForm } from "@fumiao/plugin-sdk/model-form.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import { one } from "../db.js";
import type { Platform } from "../platform.js";
import {
  EDGE_TTS_VOICE_IDS,
  EDGE_TTS_VOICE_LABELS,
  EdgeTtsError,
  synthesizeEdgeTts,
  type EdgeWebSocketFactory,
} from "./edge-tts.js";

export const edgeTtsForm: ModelForm = {
  parameterObject: true,
  canvas: true,
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
      endpoint: { type: "string", maxLength: 500 },
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
  originalSubmission: { version: 1 },
  originalState: { version: 1, fields: [], queueLane: "kind" },
};

export function createEdgeTtsPlugin(
  wsFactory?: EdgeWebSocketFactory,
): ProviderPlugin {
  return {
    manifest: edgeTtsManifest,
    modelForm: () => edgeTtsForm,
    health: async () => typeof WebSocket === "function" || !!wsFactory,
    originalSubmission: {
      validate(draft, stage) {
        if (stage === "before-packs") {
          const text = pythonStrip(draft.prompt);
          if (!text || [...text].length > 2000) {
            throw new OriginalSubmissionError(
              "Edge TTS 合成文本需为 1–2000 字",
              400,
            );
          }
        }
      },
      namespace() {
        return "-edge-tts";
      },
      plan() {
        return {
          namespace: "-edge-tts",
          parentKind: "any",
          refs: [],
          roles: [],
          missing: { status: 400, message: "" },
        };
      },
      async prepare(draft) {
        const rawParams = (draft.params ?? {}) as Record<string, unknown>;
        const voice =
          typeof rawParams.voice === "string" &&
          EDGE_TTS_VOICE_IDS.includes(rawParams.voice)
            ? rawParams.voice
            : "zh-CN-XiaoxiaoNeural";
        const rate =
          typeof rawParams.rate === "string" && rawParams.rate.trim()
            ? rawParams.rate.trim()
            : "+0%";
        const pitch =
          typeof rawParams.pitch === "string" && rawParams.pitch.trim()
            ? rawParams.pitch.trim()
            : "+0Hz";
        // Tolerantly ignore historic `draft.instruction` / `rawParams.instruction` payloads.
        return {
          params: {
            voice,
            rate,
            pitch,
          },
          references: [],
          view: {
            ratio: "",
            quality: null,
            seconds: null,
            sampling_steps: null,
            seed: null,
            width: null,
            height: null,
            image_quality: null,
            audio_settings: { voice, rate, pitch },
            h3_inputs: null,
            refs: [],
          },
        };
      },
    },
    originalState: {
      configured: () => true,
      configuration: () => ({}),
      project: () => ({}),
    },
    async submit(e) {
      const params = e.input.params ?? {};
      const voice =
        (typeof params.voice === "string" && params.voice) ||
        (typeof e.config.defaultVoice === "string" && e.config.defaultVoice) ||
        "zh-CN-XiaoxiaoNeural";
      const rate = typeof params.rate === "string" ? params.rate : "+0%";
      const pitch = typeof params.pitch === "string" ? params.pitch : "+0Hz";
      const endpoint =
        typeof e.config.endpoint === "string" && e.config.endpoint.trim()
          ? e.config.endpoint.trim()
          : undefined;
      try {
        const { mime, bytes } = await synthesizeEdgeTts(
          { text: e.input.prompt, voice, rate, pitch, endpoint },
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
      } catch (err) {
        if (err instanceof EdgeTtsError && err.code === "aborted") {
          throw err;
        }
        const detail =
          err instanceof Error && err.message ? err.message : "Edge TTS 连接失败";
        // Edge TTS is a 0-credit free provider: a clean pre-artifact connection/handshake
        // failure should finish in `failed` with a diagnosable message (allowing immediate
        // user retry or engine switching) instead of leaving the job stuck in `uncertain`.
        throw new ProviderError(
          `${detail}。请稍后重试，或切换其他可用语音模型（管理员可在「设置 → 插件」导入商业语音插件）`,
          "rejected",
        );
      }
    },
  };
}

export const edgeTtsPlugin: ProviderPlugin = createEdgeTtsPlugin();

/**
 * F029 + Q3: Idempotently installs and enables the built-in zero-key Edge TTS plugin,
 * catalog model, free price tier (0 credits), model form, and default connection on startup
 * so a fresh isolated Studio environment can narrate and compose audio out-of-the-box.
 * Respects any existing admin-customized or disabled Edge TTS connection/policy.
 */
export async function ensureBuiltinEdgeTts(
  p: Platform,
  options?: { endpoint?: string; defaultVoice?: string },
): Promise<{ connectionId: string; modelId: string }> {
  p.registry.registerBuiltin(edgeTtsPlugin);
  return p.db.transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock(73241901)");
    const tables = await one(
      sql,
      `SELECT to_regclass('studio_catalog') IS NOT NULL AS sc,
              to_regclass('plugin_versions') IS NOT NULL AS pv`,
    );
    if (!tables?.sc || !tables?.pv) {
      return { connectionId: "", modelId: "" };
    }

    await sql.query(
      `INSERT INTO plugin_versions(id, version, manifest)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id, version) DO UPDATE SET manifest = EXCLUDED.manifest`,
      [
        edgeTtsManifest.id,
        edgeTtsManifest.version,
        JSON.stringify(edgeTtsManifest),
      ],
    );
    const hasForms = await one(
      sql,
      "SELECT to_regclass('plugin_model_forms') IS NOT NULL AS ok",
    );
    if (hasForms?.ok) {
      await sql.query(
        `INSERT INTO plugin_model_forms(plugin_id, plugin_version, forms)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (plugin_id, plugin_version) DO UPDATE SET forms = EXCLUDED.forms`,
        [
          edgeTtsManifest.id,
          edgeTtsManifest.version,
          JSON.stringify({ "edge-tts": edgeTtsForm }),
        ],
      );
    }

    const descriptor = {
      kind: "audio",
      label: "Edge TTS（免费神经语音）",
      provider: "edge-tts",
    };
    await sql.query(
      `INSERT INTO studio_catalog(id, plugin_id, plugin_version, descriptor, runtime, position, price_position, hidden)
       VALUES ('edge-tts', $1, $2, $3::jsonb, '{}'::jsonb, 90, 900, FALSE)
       ON CONFLICT (id) DO UPDATE
         SET plugin_id = EXCLUDED.plugin_id,
             plugin_version = EXCLUDED.plugin_version,
             descriptor = EXCLUDED.descriptor`,
      [edgeTtsManifest.id, edgeTtsManifest.version, JSON.stringify(descriptor)],
    );

    const hasPrices = await one(
      sql,
      "SELECT to_regclass('studio_prices') IS NOT NULL AS ok",
    );
    if (hasPrices?.ok) {
      await sql.query(
        `INSERT INTO studio_prices(key, model_id, tier, label, position, matcher, amount)
         VALUES ('edge-tts|free', 'edge-tts', 'free', '免费兜底合成', 900, '{"type":"object","properties":{}}'::jsonb, 0)
         ON CONFLICT (key) DO NOTHING`,
      );
    }

    const hasPolicy = await one(
      sql,
      "SELECT to_regclass('studio_policy') IS NOT NULL AS ok",
    );
    if (hasPolicy?.ok) {
      await sql.query(
        `UPDATE studio_policy
            SET flags = CASE WHEN flags ? 'edge-tts' THEN flags ELSE flags || '{"edge-tts":true}'::jsonb END
          WHERE singleton`,
      );
    }

    const existingConn = await one(
      sql,
      `SELECT id FROM connections
        WHERE plugin_id = 'edge-tts' AND NOT removed
        ORDER BY enabled DESC, id ASC
        LIMIT 1`,
    );
    let connId = existingConn ? String(existingConn.id) : "";
    const configPayload: Record<string, string> = {};
    if (options?.defaultVoice) configPayload.defaultVoice = options.defaultVoice;
    if (options?.endpoint) configPayload.endpoint = options.endpoint;

    if (!connId) {
      connId = randomUUID();
      await sql.query(
        `INSERT INTO connections(id, name, plugin_id, plugin_version, config, enabled)
         VALUES ($1, 'Edge TTS 内置免费配音', 'edge-tts', '1.0.0', $2, TRUE)`,
        [connId, p.vault.seal(configPayload)],
      );
    } else if (options?.endpoint || options?.defaultVoice) {
      await sql.query(
        `UPDATE connections SET config = $2, revision = revision + 1 WHERE id = $1`,
        [connId, p.vault.seal(configPayload)],
      );
    }

    const existingModel = await one(
      sql,
      `SELECT id FROM models WHERE connection_id = $1 AND catalog_id = 'edge-tts' LIMIT 1`,
      [connId],
    );
    let modelId = existingModel ? String(existingModel.id) : "";
    const inputSchema = edgeTtsManifest.models[0].inputSchema;
    if (!modelId) {
      modelId = randomUUID();
      await sql.query(
        `INSERT INTO models(id, connection_id, catalog_id, provider_model, label, kind, schema, enabled)
         VALUES ($1, $2, 'edge-tts', 'edge-tts', 'Edge TTS（免费神经语音）', 'audio', $3::jsonb, TRUE)`,
        [modelId, connId, JSON.stringify(inputSchema)],
      );
    } else {
      await sql.query(
        `UPDATE models SET schema = $2::jsonb WHERE id = $1 AND schema IS DISTINCT FROM $2::jsonb`,
        [modelId, JSON.stringify(inputSchema)],
      );
    }

    return { connectionId: connId, modelId };
  });
}
