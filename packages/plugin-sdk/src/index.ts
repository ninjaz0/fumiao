import type { ModelForm } from "./model-form.js";
import { z } from "zod";
import {
  canvasPolicySchema,
  canvasSubmissionPolicySchema,
  type CanvasPolicy,
  type CanvasSubmissionPolicy,
} from "./canvas.js";
export * from "./canvas.js";
import {
  chatPolicySchema,
  type ChatPolicy,
  type ChatRequest,
  type ChatChunk,
  type ChatTitleRequest,
} from "./chat.js";
export * from "./chat.js";
import {
  originalImageSettingsSchema,
  type OriginalImageSettingsPolicy,
} from "./settings.js";
export * from "./settings.js";
import { requestLifecycleSchema, type RequestLifecycle } from "./lifecycle.js";
export * from "./lifecycle.js";
import {
  artifactDownloadPolicySchema,
  type ArtifactDownloadPolicy,
  type ArtifactDownloadRequest,
} from "./download.js";
export * from "./download.js";
import {
  originalStatePolicySchema,
  type OriginalStatePolicy,
  type OriginalState,
} from "./state.js";
export * from "./state.js";
import {
  estimatePolicySchema,
  type EstimatePolicy,
  type OriginalEstimate,
} from "./estimate.js";
export * from "./estimate.js";
import {
  originalPolicySchema,
  type OriginalPolicy,
  type OriginalSubmission,
} from "./original.js";
export * from "./original.js";
import {
  preparationPolicySchema,
  artifactValidationPolicySchema,
  type PreparationPolicy,
  type ArtifactValidationPolicy,
  type PreparationRequest,
  type PreparationAsset,
  type PreparedInput,
  type ArtifactJob,
  type ArtifactReceipt,
  type ArtifactProgress,
  type ArtifactResult,
} from "./preparation.js";
export * from "./preparation.js";
import {
  referenceImportSchema,
  type ReferenceImport,
  type ReferenceKind,
  type ReferenceResult,
} from "./references.js";
export * from "./references.js";
import {
  queuePolicySchema,
  type QueuePolicy,
  type QueuePlanner,
  type QueueNode,
  type QueueJob,
  type QueueHealth,
  type QueueAdmission,
} from "./queue.js";
export * from "./queue.js";
import {
  timingPolicySchema,
  type TimingPolicy,
  type TimingContext,
  type TimingFeatures,
  type TimingReport,
  type ProviderClockReport,
} from "./timing.js";
export * from "./timing.js";

export type Kind = "image" | "video" | "audio" | "chat";
export interface StudioModel {
  order: number;
  priceOrder: number;
  descriptor: Record<string, unknown> & {
    kind: Kind;
    label: string;
    family?: string;
    family_label?: string;
    hidden?: boolean;
  };
  runtime?: Record<string, unknown>;
  prices: {
    tier: string;
    label: string;
    amount: number | null;
    match: Record<string, unknown>;
  }[];
}
export interface ModelSpec {
  id: string;
  label: string;
  kind: Kind;
  inputSchema: Record<string, unknown>;
  preparedSchema?: Record<string, unknown>;
  hidden?: boolean;
  studio?: StudioModel;
}
export interface Manifest {
  canvas?: CanvasPolicy;
  canvasSubmission?: CanvasSubmissionPolicy;
  chat?: ChatPolicy;
  id: string;
  version: string;
  contractVersion: 1;
  label: string;
  mode: "request" | "pull";
  configSchema: Record<string, unknown>;
  models: ModelSpec[];
  timing?: TimingPolicy;
  queue?: QueuePolicy;
  referenceImports?: ReferenceImport[];
  inputPreparation?: PreparationPolicy;
  artifactValidation?: ArtifactValidationPolicy;
  originalSubmission?: OriginalPolicy;
  originalEstimate?: EstimatePolicy;
  originalState?: OriginalStatePolicy;
  artifactDownload?: ArtifactDownloadPolicy;
  requestLifecycle?: RequestLifecycle;
  originalImageSettings?: OriginalImageSettingsPolicy;
}
export interface Input {
  prompt: string;
  params: Record<string, unknown>;
  references: { id: string; mime: string; url: string }[];
}
export interface Execution {
  mapResult?: (raw: unknown) => unknown;
  mappedRequest?: { path: string; body?: unknown };
  jobId: string;
  idempotencyKey: string;
  model: string;
  kind: Kind;
  input: Input;
  config: Record<string, unknown>;
  signal: AbortSignal;
  /** Optional server-validated progress sink; never sent to an upstream API. */
  reportTiming?(report: TimingReport): Promise<void>;
  reportProviderClock?(report: ProviderClockReport): Promise<void>;
  reportProviderNote?(note: string): Promise<void>;
}
export interface Artifact {
  url: string;
  mime?: string;
}
export type Receipt =
  | { state: "pending"; remoteId: string }
  | {
      state: "completed";
      artifacts: Artifact[];
      text?: string;
      usage?: Record<string, unknown>;
      /** Opaque original response accounting; never a remote task identifier. */
      providerResponse?: { version: 1; requestId: string; usageJson: string };
    }
  | { state: "failed"; error: string };
export interface ProviderPlugin {
  inspectService?(
    config: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ ready: boolean; models?: string[] }>;
  modelForm?(model: ModelSpec): ModelForm;
  chatProvider?(config: Record<string, unknown>): string | undefined;
  chatConfigured?(config: Record<string, unknown>): boolean;
  chatConfigure?(
    config: Record<string, unknown>,
    key: string,
  ): Record<string, unknown>;
  chatStream?(request: ChatRequest): AsyncIterable<ChatChunk>;
  chatTitle?(request: ChatTitleRequest): Promise<string>;
  chatProbe?(
    config: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void>;
  checkOriginalSettings?(
    config: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void>;
  downloadArtifact?(
    request: ArtifactDownloadRequest,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
  originalState?: OriginalState;
  originalEstimate?: OriginalEstimate;
  manifest: Manifest;
  originalSubmission?: OriginalSubmission;
  referenceIds?(input: PreparationRequest): string[];
  prepareInput?(
    input: PreparationRequest,
    assets: PreparationAsset[],
  ): PreparedInput;
  validateArtifact?(
    job: ArtifactJob,
    bytes: Uint8Array,
    receipt: ArtifactReceipt,
    signal: AbortSignal,
    progress?: ArtifactProgress,
  ): Promise<ArtifactResult>;
  importReference?(
    input: string,
    output: string,
    kind: ReferenceKind,
    signal: AbortSignal,
  ): Promise<ReferenceResult>;
  queuePlan?: QueuePlanner;
  claimEligible?(node: QueueNode, job: QueueJob, stamp: number): boolean;
  queueHealth?(
    config: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<QueueHealth>;
  requestCapacity?(context: QueueAdmission): number | null;
  timingFeatures?(context: TimingContext): TimingFeatures;
  health(
    config: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<boolean>;
  submit(execution: Execution): Promise<Receipt>;
  inspect?(execution: Execution, remoteId: string): Promise<Receipt>;
  cancel?(execution: Execution, remoteId: string): Promise<boolean>;
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public certainty: "rejected" | "uncertain" | "retryable",
  ) {
    super(message);
  }
}
export const modelSchema = z.object({
  id: z.string().min(1).max(180),
  label: z.string().min(1).max(100),
  kind: z.enum(["image", "video", "audio", "chat"]),
  inputSchema: z.record(z.string(), z.unknown()),
  preparedSchema: z.record(z.string(), z.unknown()).optional(),
  hidden: z.boolean().optional(),
  studio: z
    .object({
      order: z.number().int().nonnegative(),
      priceOrder: z.number().int().nonnegative(),
      descriptor: z
        .object({
          kind: z.enum(["image", "video", "audio", "chat"]),
          label: z.string().min(1),
          family: z.string().min(1).optional(),
          family_label: z.string().min(1).optional(),
          hidden: z.boolean().optional(),
        })
        .catchall(z.unknown()),
      runtime: z.record(z.string(), z.unknown()).optional(),
      prices: z
        .array(
          z.object({
            tier: z.string().min(1).max(100),
            label: z.string().min(1).max(200),
            amount: z.number().int().min(0).max(1000000000).nullable(),
            match: z.record(z.string(), z.unknown()),
          }),
        )
        .min(1)
        .max(1000),
    })
    .optional(),
});
export const manifestSchema = z.object({
  canvas: canvasPolicySchema.optional(),
  canvasSubmission: canvasSubmissionPolicySchema.optional(),
  chat: chatPolicySchema.optional(),
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  contractVersion: z.literal(1),
  label: z.string().min(1).max(100),
  mode: z.enum(["request", "pull"]),
  configSchema: z.record(z.string(), z.unknown()),
  models: z.array(modelSchema).min(1).max(500),
  timing: timingPolicySchema.optional(),
  queue: queuePolicySchema.optional(),
  referenceImports: z.array(referenceImportSchema).min(1).max(8).optional(),
  inputPreparation: preparationPolicySchema.optional(),
  artifactValidation: artifactValidationPolicySchema.optional(),
  originalSubmission: originalPolicySchema.optional(),
  originalEstimate: estimatePolicySchema.optional(),
  originalState: originalStatePolicySchema.optional(),
  artifactDownload: artifactDownloadPolicySchema.optional(),
  requestLifecycle: requestLifecycleSchema.optional(),
  originalImageSettings: originalImageSettingsSchema.optional(),
});
export const connectionSchema = {
  type: "object",
  required: ["baseUrl", "apiKey"],
  additionalProperties: false,
  properties: {
    baseUrl: { type: "string", pattern: "^https?://" },
    apiKey: { type: "string", minLength: 1, writeOnly: true },
    artifactOrigins: {
      type: "array",
      maxItems: 20,
      items: { type: "string", pattern: "^https://" },
    },
  },
};
export async function requestJson(
  execution: Execution,
  path: string,
  body?: unknown,
): Promise<any> {
  const url = new URL(
    path,
    String(execution.config.baseUrl).replace(/\/$/, "") + "/",
  );
  if (
    url.origin !== new URL(String(execution.config.baseUrl)).origin ||
    url.username ||
    url.password
  )
    throw new ProviderError("请求地址必须属于已配置的服务", "rejected");
  try {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: execution.signal,
      headers: {
        Authorization: `Bearer ${execution.config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": execution.idempotencyKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok)
      throw new ProviderError(
        `提供方返回 HTTP ${response.status}`,
        body !== undefined &&
          response.status < 500 &&
          ![408, 409].includes(response.status)
          ? "rejected"
          : "uncertain",
      );
    if (!response.body) throw new ProviderError("提供方响应为空", "uncertain");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body as any) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024)
        throw new ProviderError("提供方响应超过限制", "uncertain");
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("提供方请求结果待确认", "uncertain");
  }
}
export async function inspectModelList(
  config: Record<string, unknown>,
  signal: AbortSignal,
) {
  try {
    const response = await fetch(
      String(config.baseUrl).replace(/\/$/, "") + "/v1/models",
      {
        signal,
        redirect: "error",
        headers: { Authorization: "Bearer " + config.apiKey },
      },
    );
    if (!response.ok) return { ready: false };
    if (!response.body) return { ready: true };
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 256 * 1024) return { ready: true };
        chunks.push(value);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8")).data;
      return Array.isArray(data) && data.every((m) => typeof m?.id === "string")
        ? { ready: true, models: data.map((m) => String(m.id)) }
        : { ready: true };
    } catch {
      return { ready: true };
    } finally {
      await reader.cancel();
    }
  } catch {
    return { ready: false };
  }
}
export async function health(
  config: Record<string, unknown>,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${String(config.baseUrl).replace(/\/$/, "")}/v1/models`,
      {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal,
        redirect: "error",
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export const receiptSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("pending"),
    remoteId: z.string().min(1).max(500),
  }),
  z.object({ state: z.literal("failed"), error: z.string().max(500) }),
  z.object({
    state: z.literal("completed"),
    artifacts: z
      .array(
        z.object({
          url: z.string().max(180000000),
          mime: z.string().optional(),
        }),
      )
      .max(8),
    text: z.string().max(1000000).optional(),
    usage: z.record(z.string(), z.unknown()).optional(),
    providerResponse: z
      .object({
        version: z.literal(1),
        requestId: z.string().max(65536),
        usageJson: z.string().max(64 * 1024 * 1024),
      })
      .strict()
      .optional(),
  }),
]);
