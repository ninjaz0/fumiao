import { z } from "zod";
const note = z.string().max(500);
const lifecycleV1 = z
  .object({
    version: z.literal(1),
    honorImageEnabled: z.boolean(),
    cancelDisabled: z.boolean(),
    notes: z
      .object({
        submitting: note,
        unavailable: note,
        inputFailed: note,
        saveFailed: note,
        unknownSubmission: note,
        disabled: note,
      })
      .strict(),
  })
  .strict();
const lifecycleV2 = lifecycleV1
  .extend({
    version: z.literal(2),
    notes: lifecycleV1.shape.notes.extend({
      unavailable: note.nullable(),
      inputUnavailable: note,
      submitFailed: note,
      recoverySaveFailed: note,
    }),
    referenceKinds: z.array(z.string().min(1).max(32)).min(1).max(8),
    queueOrder: z.literal("fifo"),
    progressUpdatesHealth: z.boolean(),
    recordCancelledRun: z.boolean(),
    preferFinalizing: z.boolean(),
  })
  .strict();
const lifecycleV3 = lifecycleV2
  .extend({
    version: z.literal(3),
    requireConfigured: z.boolean(),
    atomicReferences: z.boolean(),
    resumeAccepted: z.boolean(),
    cancelOnlyWhenAvailable: z.boolean(),
    /** Null delegates timeout enforcement to the local adapter's idle timer. */
    executionDeadlineMs: z.number().int().min(1).max(86_400_000).nullable(),
  })
  .strict();
export const requestLifecycleSchema = z.discriminatedUnion("version", [
  lifecycleV1,
  lifecycleV2,
  lifecycleV3,
]);
export type RequestLifecycle = z.infer<typeof requestLifecycleSchema>;
export const requestDispositionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("retry"),
      note,
      delaySeconds: z.number().finite().min(0).max(3600),
    })
    .strict(),
  z.object({ action: z.literal("poll") }).strict(),
  z
    .object({
      action: z.literal("fail"),
      note,
      interrupted: z.boolean().optional(),
      uncertain: z.boolean().optional(),
    })
    .strict(),
]);
export type RequestDisposition = z.infer<typeof requestDispositionSchema>;
export class RequestLifecycleError extends Error {
  constructor(readonly disposition: RequestDisposition) {
    super("Provider request lifecycle");
  }
}
