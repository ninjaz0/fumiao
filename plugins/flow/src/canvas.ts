import { flowLifecycle } from "./lifecycle.js";
import type { ProviderPlugin } from "../../../packages/plugin-sdk/src/index.js";
export const flowCanvas: ProviderPlugin = {
  ...flowLifecycle,
  manifest: {
    ...flowLifecycle.manifest,
    version: "1.10.0",
    queue: {
      ...flowLifecycle.manifest.queue!,
      timingVersions: [
        ...flowLifecycle.manifest.queue!.timingVersions,
        "1.10.0",
      ],
    },
    canvas: {
      version: 1,
      models: flowLifecycle.manifest.models.map((model, index) => ({
        model: model.id,
        kind: model.kind as "image" | "video",
        ...(model.kind === "video" &&
        ["t2v", "omni"].includes(String(model.studio!.descriptor.mode))
          ? { templatePriority: 100 + index }
          : {}),
      })),
    },
  },
};
