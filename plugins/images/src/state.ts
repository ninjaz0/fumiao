import { readFileSync } from "node:fs";
import { imagesEstimate } from "./estimate.js";
import type { ProviderPlugin } from "../../../packages/plugin-sdk/src/index.js";
const sizes = JSON.parse(
  readFileSync(new URL("../sizes.json", import.meta.url), "utf8"),
);
export const imagesState: ProviderPlugin = {
  ...imagesEstimate,
  manifest: {
    ...imagesEstimate.manifest,
    version: "1.6.0",
    queue: {
      ...imagesEstimate.manifest.queue!,
      timingVersions: [
        ...imagesEstimate.manifest.queue!.timingVersions,
        "1.6.0",
      ],
    },
    originalState: {
      version: 1,
      fields: ["images"],
      queueLane: "kind",
      requiresImageEnabled: true,
      outputKinds: { image: "ref" },
    },
  },
  originalState: {
    configured: (c) =>
      typeof c.apiKey === "string" &&
      /^sk-[A-Za-z0-9_-]+$/.test(c.apiKey.trim()),
    configuration: (c) => ({
      images: {
        configured: c.connection?.configured ?? false,
        enabled: c.imageEnabled,
        default_model: "gpt-image-2.6-sunburst",
        models: Object.fromEntries(
          Object.entries(c.catalog)
            .filter(([, m]) => m.kind === "image" && !m.hidden)
            .map(([id, m]) => [id, m.label]),
        ),
        sizes,
      },
    }),
    project: (j) =>
      j.state === "completed"
        ? { width: j.metadata.width, height: j.metadata.height, actual: {} }
        : ["queued", "failed", "cancelled"].includes(j.state)
          ? {}
          : { note: "正在生成图片" },
  },
};
