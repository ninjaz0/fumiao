import { z } from "zod";
import type { PackageFile } from "./package-file.js";

export type ComfyApiNode = {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
  [key: string]: unknown;
};

export type ComfyWorkflowApiJson = Record<string, ComfyApiNode>;

export const microAppInputBindSchema = z
  .object({
    nodeId: z.string().min(1).max(64),
    inputKey: z.string().min(1).max(80),
    template: z.string().max(400).optional(),
  })
  .strict();

export const microAppInputSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z0-9_]{1,40}$/),
    label: z.string().min(1).max(60),
    type: z.enum([
      "prompt",
      "negative_prompt",
      "text",
      "number",
      "integer",
      "boolean",
      "select",
      "image",
      "video",
      "audio",
      "seed",
    ]),
    required: z.boolean().default(false),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    options: z.array(z.string().min(1).max(80)).max(32).optional(),
    bind: z.array(microAppInputBindSchema).min(1).max(16),
  })
  .strict();

export const modelDependencySchema = z
  .object({
    nodeId: z.string().min(1).max(64),
    loader: z.string().min(1).max(120),
    filename: z.string().min(1).max(260),
  })
  .strict();

/** F037: Declarative `app.json` ComfyUI Micro-App Contract (compiles to standard .fmplugin.json per Q4). */
export const microAppSpecSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    slug: z.string().regex(/^[a-z][a-z0-9-]{1,47}$/),
    version: z
      .string()
      .regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/)
      .default("1.0.0"),
    name: z.string().trim().min(1).max(60),
    description: z.string().max(400).default(""),
    kind: z.enum(["image", "video", "audio"]),
    modelKey: z.string().min(1).max(120).optional(),
    peakVramGb: z.number().positive().max(512).default(16),
    credits: z.number().int().min(0).max(10000).default(2),
    workflowApiJson: z.record(
      z.string(),
      z
        .object({
          class_type: z.string().min(1),
          inputs: z.record(z.string(), z.unknown()),
        })
        .passthrough(),
    ),
    inputs: z.array(microAppInputSchema).min(1).max(32),
    modelDependencies: z.array(modelDependencySchema).default([]),
    smokeTestCase: z
      .object({
        prompt: z.string().min(1).max(500),
        params: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  })
  .strict();

export type MicroAppSpec = z.infer<typeof microAppSpecSchema>;
export type MicroAppInput = z.infer<typeof microAppInputSchema>;
export type ModelDependency = z.infer<typeof modelDependencySchema>;

export type InferredWorkflowAnalysis = {
  outputKind: "image" | "video" | "audio";
  outputNodes: string[];
  inputs: MicroAppInput[];
  modelDependencies: ModelDependency[];
  suggestedModelKey: string;
  warnings: string[];
};

const SAMPLER_CLASSES = new Set([
  "KSampler",
  "KSamplerAdvanced",
  "SamplerCustom",
  "SamplerCustomAdvanced",
  "WanVideoSampler",
  "LTXVSampler",
  "HunyuanVideoSampler",
]);

const PROMPT_NODE_CLASSES = new Set([
  "CLIPTextEncode",
  "CLIPTextEncodeFlux",
  "CLIPTextEncodeSDXL",
  "T5TextEncode",
  "WanVideoTextEncode",
  "LTXVPromptEncode",
  "StringMultiline",
  "PrimitiveString",
]);

const MODEL_LOADER_KEYS: Record<string, string[]> = {
  CheckpointLoaderSimple: ["ckpt_name"],
  UNETLoader: ["unet_name"],
  DiffusionModelLoader: ["model_name"],
  WanVideoModelLoader: ["model"],
  DualCLIPLoader: ["clip_name1", "clip_name2"],
  CLIPLoader: ["clip_name"],
  VAELoader: ["vae_name"],
  LoraLoader: ["lora_name"],
  LoraLoaderModelOnly: ["lora_name"],
};

function isNodeLink(value: unknown): value is [string, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    (typeof value[0] === "string" || typeof value[0] === "number") &&
    typeof value[1] === "number"
  );
}

/**
 * F008: Static reverse-consumer-graph BFS over ComfyUI API JSON.
 * Automatically infers positive/negative prompts, reference media inputs,
 * key sampler/latent parameters, output kind, and model dependencies.
 */
export function inferComfyWorkflowSlots(
  rawGraph: unknown,
): InferredWorkflowAnalysis {
  if (!rawGraph || typeof rawGraph !== "object" || Array.isArray(rawGraph)) {
    throw new Error("ComfyUI 工作流 JSON 必须是节点字典对象");
  }
  const graph = rawGraph as ComfyWorkflowApiJson;
  const entries = Object.entries(graph).filter(
    ([, node]) =>
      node &&
      typeof node === "object" &&
      typeof node.class_type === "string" &&
      node.inputs &&
      typeof node.inputs === "object",
  );
  if (!entries.length) {
    throw new Error("未在 JSON 中找到有效的 ComfyUI API 节点（需包含 class_type 与 inputs）");
  }

  // Build consumer adjacency list: producerId -> [{ consumerId, inputKey }]
  const consumers = new Map<string, { consumerId: string; inputKey: string }[]>();
  for (const [consumerId, node] of entries) {
    for (const [inputKey, val] of Object.entries(node.inputs)) {
      if (isNodeLink(val)) {
        const producerId = String(val[0]);
        const list = consumers.get(producerId) ?? [];
        list.push({ consumerId, inputKey });
        consumers.set(producerId, list);
      }
    }
  }

  // BFS from a candidate prompt node to see whether it feeds sampler `positive` or `negative`
  const classifyConditioningRole = (
    startId: string,
  ): "positive" | "negative" | "unknown" => {
    const visited = new Set<string>([startId]);
    const queue: string[] = [startId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const edge of consumers.get(cur) ?? []) {
        const targetNode = graph[edge.consumerId];
        if (!targetNode) continue;
        if (
          SAMPLER_CLASSES.has(targetNode.class_type) ||
          targetNode.class_type.toLowerCase().includes("sampler")
        ) {
          if (edge.inputKey === "positive" || edge.inputKey === "conditioning")
            return "positive";
          if (edge.inputKey === "negative") return "negative";
        }
        if (edge.inputKey === "positive") return "positive";
        if (edge.inputKey === "negative") return "negative";
        if (!visited.has(edge.consumerId)) {
          visited.add(edge.consumerId);
          queue.push(edge.consumerId);
        }
      }
    }
    return "unknown";
  };

  const outputNodes: string[] = [];
  let outputKind: "image" | "video" | "audio" = "image";
  const modelDependencies: ModelDependency[] = [];
  const inputs: MicroAppInput[] = [];
  const warnings: string[] = [];
  let hasPositive = false;
  let hasNegative = false;
  let imgIndex = 0;
  let vidIndex = 0;
  let audIndex = 0;

  for (const [nodeId, node] of entries) {
    const cls = node.class_type;
    const title = node._meta?.title || cls;

    // 1. Detect output nodes & outputKind
    if (
      cls === "VHS_VideoCombine" ||
      cls === "SaveVideo" ||
      cls === "SaveAnimatedWEBP" ||
      cls.includes("VideoCombine")
    ) {
      outputNodes.push(nodeId);
      outputKind = "video";
    } else if (cls === "SaveAudio" || cls === "SaveAudioMP3" || cls.includes("SaveAudio")) {
      outputNodes.push(nodeId);
      outputKind = "audio";
    } else if (cls === "SaveImage" || cls === "PreviewImage") {
      outputNodes.push(nodeId);
    }

    // 2. Detect model dependencies
    const loaderKeys = MODEL_LOADER_KEYS[cls];
    if (loaderKeys) {
      for (const lk of loaderKeys) {
        const fname = node.inputs[lk];
        if (typeof fname === "string" && fname.trim()) {
          modelDependencies.push({ nodeId, loader: cls, filename: fname.trim() });
        }
      }
    }

    // 3. Detect Positive / Negative prompt slots via reverse consumer BFS
    const textKey =
      typeof node.inputs.text === "string"
        ? "text"
        : typeof node.inputs.prompt === "string"
          ? "prompt"
          : typeof node.inputs.positive_prompt === "string"
            ? "positive_prompt"
            : null;
    if (
      textKey &&
      (PROMPT_NODE_CLASSES.has(cls) || cls.toLowerCase().includes("textencode"))
    ) {
      const role = classifyConditioningRole(nodeId);
      const lowerTitle = title.toLowerCase();
      const isNeg =
        role === "negative" ||
        lowerTitle.includes("negative") ||
        lowerTitle.includes("反向") ||
        lowerTitle.includes("负向");
      if (isNeg && !hasNegative) {
        hasNegative = true;
        inputs.push({
          key: "negative_prompt",
          label: "负向提示词",
          type: "negative_prompt",
          required: false,
          default: String(node.inputs[textKey] ?? ""),
          bind: [{ nodeId, inputKey: textKey }],
        });
      } else if (!hasPositive) {
        hasPositive = true;
        inputs.push({
          key: "prompt",
          label: "正向提示词",
          type: "prompt",
          required: true,
          default: String(node.inputs[textKey] ?? ""),
          bind: [{ nodeId, inputKey: textKey }],
        });
      }
    }

    // 4. Detect reference media inputs
    if (cls === "LoadImage" && typeof node.inputs.image === "string") {
      imgIndex++;
      inputs.push({
        key: imgIndex === 1 ? "ref_image" : `ref_image_${imgIndex}`,
        label: imgIndex === 1 ? "参考图片" : `参考图片 ${imgIndex}`,
        type: "image",
        required: false,
        default: node.inputs.image,
        bind: [{ nodeId, inputKey: "image" }],
      });
    } else if (
      (cls === "VHS_LoadVideo" || cls === "LoadVideo") &&
      (typeof node.inputs.video === "string" ||
        typeof node.inputs.file === "string")
    ) {
      vidIndex++;
      const ik = typeof node.inputs.video === "string" ? "video" : "file";
      inputs.push({
        key: vidIndex === 1 ? "ref_video" : `ref_video_${vidIndex}`,
        label: vidIndex === 1 ? "参考视频" : `参考视频 ${vidIndex}`,
        type: "video",
        required: false,
        default: String(node.inputs[ik]),
        bind: [{ nodeId, inputKey: ik }],
      });
    } else if (
      cls === "LoadAudio" &&
      (typeof node.inputs.audio === "string" ||
        typeof node.inputs.file === "string")
    ) {
      audIndex++;
      const ik = typeof node.inputs.audio === "string" ? "audio" : "file";
      inputs.push({
        key: audIndex === 1 ? "ref_audio" : `ref_audio_${audIndex}`,
        label: audIndex === 1 ? "参考音频" : `参考音频 ${audIndex}`,
        type: "audio",
        required: false,
        default: String(node.inputs[ik]),
        bind: [{ nodeId, inputKey: ik }],
      });
    }

    // 5. Detect sampler parameters (seed, steps, cfg)
    if (SAMPLER_CLASSES.has(cls) || cls.toLowerCase().includes("sampler")) {
      if (
        (typeof node.inputs.seed === "number" ||
          typeof node.inputs.noise_seed === "number") &&
        !inputs.some((i) => i.key === "seed")
      ) {
        const sk = typeof node.inputs.seed === "number" ? "seed" : "noise_seed";
        inputs.push({
          key: "seed",
          label: "随机种子",
          type: "seed",
          required: false,
          default: Number(node.inputs[sk]),
          min: 0,
          max: 2_147_483_647,
          bind: [{ nodeId, inputKey: sk }],
        });
      }
      if (
        typeof node.inputs.steps === "number" &&
        !inputs.some((i) => i.key === "steps")
      ) {
        inputs.push({
          key: "steps",
          label: "采样步数",
          type: "integer",
          required: false,
          default: Number(node.inputs.steps),
          min: 1,
          max: 100,
          bind: [{ nodeId, inputKey: "steps" }],
        });
      }
      if (
        typeof node.inputs.cfg === "number" &&
        !inputs.some((i) => i.key === "cfg")
      ) {
        inputs.push({
          key: "cfg",
          label: "引导系数 (CFG)",
          type: "number",
          required: false,
          default: Number(node.inputs.cfg),
          min: 1,
          max: 20,
          bind: [{ nodeId, inputKey: "cfg" }],
        });
      }
    }

    // 6. Detect dimensions on EmptyLatent* nodes
    if (
      cls.startsWith("Empty") &&
      cls.includes("Latent") &&
      typeof node.inputs.width === "number" &&
      typeof node.inputs.height === "number" &&
      !inputs.some((i) => i.key === "width")
    ) {
      inputs.push(
        {
          key: "width",
          label: "宽度",
          type: "integer",
          required: false,
          default: Number(node.inputs.width),
          min: 256,
          max: 2048,
          bind: [{ nodeId, inputKey: "width" }],
        },
        {
          key: "height",
          label: "高度",
          type: "integer",
          required: false,
          default: Number(node.inputs.height),
          min: 256,
          max: 2048,
          bind: [{ nodeId, inputKey: "height" }],
        },
      );
    }
  }

  if (!hasPositive) {
    warnings.push("未自动检测到正向提示词节点，请手动指定绑定槽位");
  }
  if (!outputNodes.length) {
    warnings.push("未检测到 SaveImage / VHS_VideoCombine / SaveAudio 输出节点");
  }

  const primaryDep = modelDependencies[0]?.filename ?? "";
  const suggestedModelKey = primaryDep
    ? primaryDep
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .slice(0, 60)
    : `comfy-${outputKind}-workflow`;

  return {
    outputKind,
    outputNodes,
    inputs,
    modelDependencies,
    suggestedModelKey,
    warnings,
  };
}

export function resolveMicroAppPluginId(slug: string): string {
  return slug.startsWith("comfy-") ? slug : `comfy-${slug}`;
}

export function resolveMicroAppModelKey(spec: Pick<MicroAppSpec, "slug" | "version" | "modelKey">): string {
  return spec.modelKey || `${resolveMicroAppPluginId(spec.slug)}@${spec.version}`;
}

/** Applies runtime prompt/params/references onto a cloned ComfyUI API workflow graph. */
export function applyMicroAppInputs(
  spec: MicroAppSpec,
  runtime: {
    prompt?: string;
    params?: Record<string, unknown>;
    uploadedRefs?: Record<string, string>;
  },
): { workflow: ComfyWorkflowApiJson; modelKey: string } {
  const workflow: ComfyWorkflowApiJson = JSON.parse(
    JSON.stringify(spec.workflowApiJson),
  );
  const params = runtime.params ?? {};
  const refs = runtime.uploadedRefs ?? {};

  for (const input of spec.inputs) {
    let value: unknown;
    if (input.type === "prompt") {
      value = runtime.prompt ?? params[input.key] ?? input.default;
    } else if (
      input.type === "image" ||
      input.type === "video" ||
      input.type === "audio"
    ) {
      value = refs[input.key] ?? params[input.key] ?? input.default;
    } else {
      value = params[input.key] ?? input.default;
    }
    if (value === undefined || value === null || value === "") continue;

    for (const binding of input.bind) {
      const targetNode = workflow[binding.nodeId];
      if (!targetNode || !targetNode.inputs) continue;
      targetNode.inputs[binding.inputKey] = binding.template
        ? binding.template.replaceAll("{{value}}", String(value))
        : value;
    }
  }

  return {
    workflow,
    modelKey: resolveMicroAppModelKey(spec),
  };
}

export type CompiledNodeClient = {
  "install.sh": string;
  "agent.tgz": string;
  "agent.tgz.sha256": string;
};

/**
 * Q4: Compiles a validated MicroAppSpec (`app.json` / visual slot mapper output)
 * into a standard versioned immutable `.fmplugin.json` pull node-pool package!
 */
export function buildMicroAppPackageFile(
  rawSpec: unknown,
  nodeClient?: CompiledNodeClient,
): PackageFile {
  const spec = microAppSpecSchema.parse(rawSpec);
  const pluginId = spec.slug.startsWith("comfy-")
    ? spec.slug
    : `comfy-${spec.slug}`;
  const modelId = spec.slug;
  const modelKey = spec.modelKey || `${pluginId}@${spec.version}`;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  let maxImageRefs = 0;
  let maxVideoRefs = 0;
  let maxAudioRefs = 0;

  for (const inp of spec.inputs) {
    if (inp.type === "prompt") continue;
    if (inp.type === "image") {
      maxImageRefs++;
      continue;
    }
    if (inp.type === "video") {
      maxVideoRefs++;
      continue;
    }
    if (inp.type === "audio") {
      maxAudioRefs++;
      continue;
    }
    if (inp.required) required.push(inp.key);
    if (inp.type === "integer" || inp.type === "seed") {
      properties[inp.key] = {
        type: "integer",
        title: inp.label,
        ...(inp.default !== undefined ? { default: inp.default } : {}),
        ...(inp.min !== undefined ? { minimum: inp.min } : {}),
        ...(inp.max !== undefined ? { maximum: inp.max } : {}),
        ...(inp.type === "seed" ? { "x-uiHint": "seed" } : {}),
      };
    } else if (inp.type === "number") {
      properties[inp.key] = {
        type: "number",
        title: inp.label,
        ...(inp.default !== undefined ? { default: inp.default } : {}),
        ...(inp.min !== undefined ? { minimum: inp.min } : {}),
        ...(inp.max !== undefined ? { maximum: inp.max } : {}),
        "x-uiHint": "slider",
      };
    } else if (inp.type === "boolean") {
      properties[inp.key] = {
        type: "boolean",
        title: inp.label,
        ...(inp.default !== undefined ? { default: inp.default } : {}),
      };
    } else if (inp.type === "select" && inp.options?.length) {
      properties[inp.key] = {
        type: "string",
        title: inp.label,
        enum: inp.options,
        ...(inp.default !== undefined ? { default: inp.default } : {}),
      };
    } else {
      properties[inp.key] = {
        type: "string",
        title: inp.label,
        maxLength: 2000,
        ...(inp.default !== undefined ? { default: inp.default } : {}),
        ...(inp.type === "negative_prompt" ? { "x-uiHint": "textarea" } : {}),
      };
    }
  }

  const maxRefs = maxImageRefs + maxVideoRefs + maxAudioRefs;
  const outputMime =
    spec.kind === "video"
      ? "video/mp4"
      : spec.kind === "audio"
        ? "audio/wav"
        : "image/png";

  const embeddedConfig = JSON.stringify({
    modelId,
    modelKey,
    kind: spec.kind,
    peakVramGb: spec.peakVramGb,
    outputMime,
    inputs: spec.inputs,
    workflowApiJson: spec.workflowApiJson,
  });

  // Expression returning the 5 required NodePoolProgram hooks for QuickJS sandbox evaluation.
  const program = `(() => {
  const APP = ${embeddedConfig};
  return {
    capabilities(report) {
      const ready = Boolean(report && (report.ready === true || (Array.isArray(report.ready_models) && report.ready_models.includes(APP.modelId))));
      const out = { ready_models: ready ? [APP.modelId] : [] };
      if (report && typeof report.loaded_model_key === "string") out.loaded_model_key = report.loaded_model_key;
      if (report && Number.isInteger(report.vram_total_mb) && report.vram_total_mb > 0) out.vram_total_mb = report.vram_total_mb;
      if (report && Number.isInteger(report.vram_free_mb) && report.vram_free_mb >= 0) out.vram_free_mb = report.vram_free_mb;
      return out;
    },
    eligible(node, job) {
      return Array.isArray(node.ready_models) && node.ready_models.includes(job.model) && job.kind === APP.kind;
    },
    dispatch(job) {
      const workflow = JSON.parse(JSON.stringify(APP.workflowApiJson));
      const params = (job.input && job.input.params) || {};
      const refs = (job.input && Array.isArray(job.input.references)) ? job.input.references : [];
      const mediaUploads = [];
      let refCursor = 0;
      for (const inp of APP.inputs) {
        let val;
        if (inp.type === "prompt") {
          val = (job.input && job.input.prompt) || inp.default;
        } else if (inp.type === "image" || inp.type === "video" || inp.type === "audio") {
          const assetKey = refs[refCursor++];
          if (assetKey) {
            for (const b of inp.bind) {
              mediaUploads.push({ asset: assetKey, nodeId: b.nodeId, inputKey: b.inputKey, kind: inp.type });
            }
            continue;
          }
          val = inp.default;
        } else {
          val = params[inp.key] !== undefined ? params[inp.key] : inp.default;
        }
        if (val === undefined || val === null || val === "") continue;
        for (const b of inp.bind) {
          if (workflow[b.nodeId] && workflow[b.nodeId].inputs) {
            workflow[b.nodeId].inputs[b.inputKey] = b.template ? b.template.replaceAll("{{value}}", String(val)) : val;
          }
        }
      }
      return {
        modelKey: APP.modelKey,
        peakVramGb: APP.peakVramGb,
        outputKind: APP.kind,
        prompt: (job.input && job.input.prompt) || "",
        workflow,
        mediaUploads,
      };
    },
    receipt(job, report) {
      return job.kind === APP.kind && Boolean(report && typeof report.prompt_id === "string" && report.prompt_id.length > 0);
    },
    artifactRules() {
      return { mime: APP.outputMime, maxBytes: 64 * 1024 * 1024 };
    },
  };
})()`;

  const nodesPageProgram = `{
  view(input) {
    return {
      schema: 1,
      title: ${JSON.stringify(`${spec.name} 节点`)},
      blocks: [
        {
          type: "form",
          id: "pair",
          title: "接入 ComfyUI 工作机",
          fields: [
            { name: "name", type: "text", label: "实例名称" },
            {
              name: "models",
              type: "multiselect",
              label: "模型",
              required: true,
              options: [{ value: ${JSON.stringify(modelId)}, label: ${JSON.stringify(spec.name)} }],
              value: [${JSON.stringify(modelId)}]
            }
          ],
          submit: { action: "pair", label: "生成接入命令" }
        },
        {
          type: "list",
          empty: "暂无 ComfyUI 工作机",
          rows: input.nodes.nodes.map(n => ({
            id: n.id,
            title: n.name,
            status: n.stage,
            detail: n.detail,
            actions: [
              { action: n.control === "active" ? "drain" : "resume", label: n.control === "active" ? "排空" : "恢复", target: n.id },
              { action: "remove", label: "移除", target: n.id }
            ]
          }))
        }
      ]
    };
  }
}`;

  return {
    format: 1,
    id: pluginId,
    label: spec.name,
    version: spec.version,
    adapterVersion: spec.version,
    contributes: {
      version: 1,
      nodePools: { version: 1 },
      hostCapabilities: ["nodes", "media"],
      settingsPages: [
        {
          id: "nodes",
          title: `${spec.name.slice(0, 24)} 节点`,
          icon: "gpu",
          audience: "admin",
          group: "services",
          order: 500,
          visibleWhen: "installed",
          scopes: ["nodes"],
          actions: [
            { id: "pair", kind: "host", operation: "nodes.pair" },
            { id: "drain", kind: "host", operation: "nodes.drain" },
            { id: "resume", kind: "host", operation: "nodes.resume" },
            { id: "remove", kind: "host", operation: "nodes.remove" },
          ],
          program: nodesPageProgram,
        },
      ],
    },
    manifest: {
      id: pluginId,
      label: spec.name,
      version: spec.version,
      contractVersion: 1,
      mode: "pull",
      originalSubmission: { version: 3 },
      configSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      models: [
        {
          id: modelId,
          label: spec.name,
          kind: spec.kind,
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties,
            ...(required.length ? { required } : {}),
            ...(spec.kind === "audio"
              ? {}
              : { "x-references": { max: Math.min(9, maxRefs) } }),
          },
          studio: {
            order: 900,
            priceOrder: 900,
            descriptor: {
              kind: spec.kind,
              label: spec.name,
            },
            prices: [
              {
                tier: "standard",
                label: "标准",
                amount: spec.credits,
                match: { type: "object" },
              },
            ],
          },
        },
      ],
    },
    program,
    ...(nodeClient ? { nodeClient } : {}),
  };
}
