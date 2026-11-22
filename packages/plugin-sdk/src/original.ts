import { z } from "zod";
import type { PreparationAsset } from "./preparation.js";

/** Built-in adapters (v1), legacy remote fields (v2), and model-defined parameters (v3). */
export const originalPolicySchema = z.discriminatedUnion("version", [
  z.object({ version: z.literal(1) }).strict(),
  z.object({ version: z.literal(2) }).strict(),
  z.object({ version: z.literal(3) }).strict(),
  z
    .object({
      version: z.literal(4),
      studioDigest: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      version: z.literal(5),
      studioDigest: z.string().regex(/^[a-f0-9]{64}$/),
      stream: z.literal("sse").optional(),
      artifactOrigins: z.array(z.string().max(200)).max(16).optional(),
    })
    .strict(),
]);
export type OriginalPolicy = z.infer<typeof originalPolicySchema>;
export type OriginalDraft = {
  kind: "video" | "image" | "audio";
  model: string;
  prompt: string;
  uid: string;
  refs: string[];
  asset_packs: { id: string; revision: number }[];
  parent: number | null;
  price_revision: number | null;
  provided: string[];
  [key: string]: any;
};
export type OriginalTask = {
  id: number;
  model: string;
  kind: string;
  state: string;
  params: Record<string, any>;
  view: Record<string, any>;
  metadata: Record<string, any>;
};
export type OriginalReference = PreparationAsset & { publicId: string };
export type OriginalPlan = {
  namespace: string;
  refs: string[];
  roles: string[];
  missing: { status: 400 | 404; message: string };
  parentKind: "any" | "video" | "image" | "audio";
  source?: number;
  referenceBytes?: { max: number; message: string };
  admission?: {
    models: string[];
    owner?: number;
    global?: number;
    message: string;
  };
  requireConfigured?: string;
};
export type OriginalPrepared = {
  params: Record<string, any>;
  references: string[];
  view: Record<string, any>;
};
export interface OriginalSubmission {
  namespace(draft: OriginalDraft): string;
  validate(
    draft: OriginalDraft,
    phase: "before-packs" | "before-retry" | "prepare",
  ): void;
  plan(draft: OriginalDraft): OriginalPlan;
  prepare(
    draft: OriginalDraft,
    resources: {
      references: OriginalReference[];
      owner: { id: number; site: string };
      parent?: OriginalTask;
      source?: OriginalTask;
      /** Core-owned checks preserve the provider's original validation order. */
      capacity(): Promise<void>;
      admit(): Promise<void>;
    },
  ): Promise<OriginalPrepared>;
}
export {
  OriginalSubmissionError,
  originalParent,
} from "./submission-errors.js";
