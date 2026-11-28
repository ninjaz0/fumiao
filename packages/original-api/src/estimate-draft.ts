import type { Fields } from "./validation.js";
import { h3Field } from "./drafts.js";
export const estimateFields: Fields = {
  params: { kind: "dictionary", optional: true },
  model: { kind: "string", default: "" },
  kind: { kind: "string", default: "video" },
  ratio: { kind: "string", default: "16:9" },
  quality: { kind: "integer", default: 480 },
  seconds: { kind: "integer", default: 5 },
  sampling_steps: { kind: "literal", values: [4, 16, 20, 32, 50], default: 20 },
  resolution: { kind: "string", default: "1K" },
  image_quality: { kind: "string", default: "medium" },
  refs: { kind: "strings", default: [], max: 12 },
  h3: h3Field,
  text_chars: { kind: "integer", default: 1, min: 1, max: 300 },
  language: { kind: "string", default: "zh" },
  audio_instruction: { kind: "string", default: "", max: 300 },
};
