import { submissionPolicy } from "./studio-policies.js";
import { museClock } from "./clock.js";
import { type ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
export function createMuseOriginal(
  strip: (value: string) => string = (value) => value.trim(),
): ProviderPlugin {
  return {
    ...museClock,
    manifest: {
      ...museClock.manifest,
      version: "1.5.0",
      originalSubmission: { version: 1 },
      queue: {
        ...museClock.manifest.queue!,
        timingVersions: [...museClock.manifest.queue!.timingVersions, "1.5.0"],
      },
    },
    originalSubmission: submissionPolicy(strip),
  };
}
export const museOriginal = createMuseOriginal();
