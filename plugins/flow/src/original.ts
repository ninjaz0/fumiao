import { submissionPolicy } from "./studio-policies.js";
import { readFileSync } from "node:fs";
import { flowQueue } from "./queue.js";
import { submitFlow } from "./index.js";
import { type ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
const models: Record<string, any> = JSON.parse(
  readFileSync(new URL("../models.json", import.meta.url), "utf8"),
);
export function createFlowOriginal(
  strip: (value: string) => string = (value) => value.trim(),
): ProviderPlugin {
  return {
    ...flowQueue,
    manifest: {
      ...flowQueue.manifest,
      version: "1.4.0",
      originalSubmission: { version: 1 },
      models: flowQueue.manifest.models.map((m) => ({
        ...m,
        preparedSchema: {
          ...m.inputSchema,
          ...(models[m.id].mode === "extend"
            ? {
                required: ["source_media_id"],
                properties: {
                  source_media_id: {
                    type: "string",
                    minLength: 1,
                    maxLength: 300,
                    pattern: "^[A-Za-z0-9_./:-]+$",
                  },
                },
              }
            : {}),
        },
      })),
      queue: {
        ...flowQueue.manifest.queue!,
        timingVersions: [...flowQueue.manifest.queue!.timingVersions, "1.4.0"],
      },
    },
    originalSubmission: submissionPolicy(strip),
    submit: (e) =>
      submitFlow(e, e.input.params.source_media_id as string | undefined, true),
  };
}
export const flowOriginal = createFlowOriginal();
