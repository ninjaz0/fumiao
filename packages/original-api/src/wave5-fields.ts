import type { Fields } from "./validation.js";

export const comfyAnalyzeFields: Fields = {
  workflow: { kind: "dictionary" },
};

export const comfyPublishFields: Fields = {
  spec: { kind: "dictionary" },
  dry_run: { kind: "boolean", strict: false, default: false },
  auto_enable: { kind: "boolean", strict: false, default: false },
};
