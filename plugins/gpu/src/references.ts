import { gpuQueue } from "./queue.js";
import { referenceImporter } from "./reference-media.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
export const gpuReferences: ProviderPlugin = {
  ...gpuQueue,
  manifest: {
    ...gpuQueue.manifest,
    version: "1.4.0",
    queue: {
      ...gpuQueue.manifest.queue!,
      timingVersions: ["1.2.0", "1.3.0", "1.4.0"],
    },
    referenceImports: [
      { version: 1, id: "h3", kinds: ["video", "audio"], maxBytes: 96 << 20 },
    ],
  },
  importReference: (input, output, kind, signal) =>
    referenceImporter.import(input, output, kind, signal),
};
