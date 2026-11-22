import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import { gpuNative } from "./native.js";
import { submissionPolicy } from "./submission-policy.js";
export function createGpuOriginal(
  strip?: (value: string) => string,
): ProviderPlugin {
  return {
    ...gpuNative,
    manifest: {
      ...gpuNative.manifest,
      version: "1.6.0",
      originalSubmission: { version: 1 },
      queue: {
        ...gpuNative.manifest.queue!,
        timingVersions: [...gpuNative.manifest.queue!.timingVersions, "1.6.0"],
      },
    },
    originalSubmission: submissionPolicy(strip),
  };
}
export const gpuOriginal = createGpuOriginal();
