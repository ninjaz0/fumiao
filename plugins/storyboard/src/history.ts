import type { ProviderPlugin } from "../../../packages/plugin-sdk/src/index.js";
/** Completed local composition history only; never admitted as a generation model. */
export const storyboardHistory: ProviderPlugin = {
  manifest: {
    id: "original-storyboard",
    version: "1.0.0",
    contractVersion: 1,
    label: "镜头合成",
    mode: "request",
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    models: [
      {
        id: "storyboard",
        label: "镜头合成",
        kind: "video",
        inputSchema: { type: "object" },
      },
    ],
    timing: {
      version: 1,
      geometry: "native",
      hardware: false,
      scaleSteps: false,
    },
    queue: { version: 1, strategy: "opaque", timingVersions: ["1.0.0"] },
    originalState: { version: 1, fields: [], queueLane: "plugin" },
  },
  timingFeatures() {
    return {
      kind: "video",
      executor: "local",
      model: "storyboard",
      workflow: "compose",
      width: 0,
      height: 0,
      seconds: 0,
      steps: 0,
      video_mode: "compose",
      quality: "",
      refs: 0,
      ref_pixels: 0,
      hardware: "cpu",
      runtime_id: "",
      cold: null,
      profile: {},
    };
  },
  queuePlan() {
    return {};
  },
  originalState: {
    configured: () => true,
    configuration: () => ({}),
    project: (j) => ({
      width: j.metadata.width,
      height: j.metadata.height,
      actual: {},
    }),
  },
  async health() {
    return true;
  },
  async submit() {
    throw new Error("Local compositions use the storyboard execution contract");
  },
};
