import { z } from "zod";
export const chatPolicySchema = z
  .object({
    version: z.literal(1),
    providers: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
            label: z.string().min(1).max(100),
            models: z.array(z.string().min(1).max(180)).min(1).max(100),
            defaultConfig: z.record(z.string(), z.unknown()),
            credentialFallback: z
              .object({
                model: z.string().min(1).max(180),
                field: z.string().min(1).max(80),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type ChatPolicy = z.infer<typeof chatPolicySchema>;
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  config: Record<string, unknown>;
  signal: AbortSignal;
};
/** Malformed upstream values stay distinct from absent fields until the turn
 * executor applies the original failure/refund rules. Never expose these raw events. */
export type ChatChunk = {
  request_id?: string;
  text?: unknown;
  reason?: unknown;
  usage?: Record<string, number | bigint>;
};
export type ChatTitleRequest = {
  model: string;
  question: string;
  answer: string;
  config: Record<string, unknown>;
  signal: AbortSignal;
};
export class ChatReplyError extends Error {}
export class ChatProbeError extends Error {}
