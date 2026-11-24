import { z } from "zod";
import type { TimingReport } from "./timing.js";
export const preparationPolicySchema = z
  .object({ version: z.literal(1) })
  .strict();
export type PreparationPolicy = z.infer<typeof preparationPolicySchema>;
export type PreparationRequest = {
  model: string;
  kind: string;
  prompt: string;
  params: Record<string, any>;
  references: string[];
  hasReferencePacks: boolean;
};
/** Only authorized metadata, never object keys, credentials, or database handles. */
export type PreparationAsset = {
  id: string;
  role: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  reference?: {
    seconds: number;
    fps: number;
    has_audio: boolean;
    name: string;
  };
};
export const preparedInputSchema = z
  .object({
    params: z.record(z.string(), z.unknown()),
    references: z.array(z.string().uuid()).max(12),
  })
  .strict();
export type PreparedInput = z.infer<typeof preparedInputSchema>;
export { InputPreparationError } from "./submission-errors.js";
const outputMessage = z.string().min(1).max(300);
export const providerMediaPolicySchema = z
  .object({
    version: z.literal(3),
    errors: z
      .object({
        imageFormat: outputMessage,
        imageDecode: outputMessage,
        video: outputMessage,
        audio: outputMessage.optional(),
        failed: outputMessage,
        recovering: outputMessage.optional(),
      })
      .strict(),
  })
  .strict();
export type ProviderMediaPolicy = z.infer<typeof providerMediaPolicySchema>;
export const artifactValidationPolicySchema = z.union([
  z.object({ version: z.union([z.literal(1), z.literal(2)]) }).strict(),
  providerMediaPolicySchema,
]);
export type ArtifactValidationPolicy = z.infer<
  typeof artifactValidationPolicySchema
>;
export type ArtifactReceipt = { sha256?: string; report?: string };
export type ArtifactJob = {
  recovering?: boolean;
  model: string;
  kind: string;
  params: Record<string, any>;
  references: string[];
};
export type ArtifactProgress = (
  phase: "uploading" | "validating",
) => Promise<void>;
export type ArtifactResult = {
  metadata: Record<string, any> & { mime: string };
  timing?: TimingReport["timing"];
};
export class ArtifactValidationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 422 | 503 = 422,
  ) {
    super(message);
  }
}
