import { imagesSettings } from "./settings.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
export const imagesCanvas: ProviderPlugin = {
  ...imagesSettings,
  manifest: {
    ...imagesSettings.manifest,
    version: "1.9.0",
    queue: {
      ...imagesSettings.manifest.queue!,
      timingVersions: [
        ...imagesSettings.manifest.queue!.timingVersions,
        "1.9.0",
      ],
    },
    canvas: {
      version: 1,
      models: [
        {
          model: "gpt-image-2.6-sunburst",
          kind: "image",
          defaultForKind: true,
        },
      ],
    },
  },
};
