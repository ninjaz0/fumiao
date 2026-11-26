import type { Fields } from "./validation.js";

export const MAX_SCRIPT_BYTES = 512 * 1024;
export const SCRIPT_DOC_KINDS = [
  "outline",
  "script",
  "assets",
  "shotlist",
  "notes",
];

export const scriptCreateFields: Fields = {
  path: { kind: "string", min: 1, max: 240 },
  entry_type: {
    kind: "literal",
    values: ["file", "directory"],
    default: "file",
  },
  doc_kind: {
    kind: "literal",
    values: SCRIPT_DOC_KINDS,
    default: "script",
  },
  body_md: { kind: "string", max: MAX_SCRIPT_BYTES, default: "" },
  template: {
    kind: "literal",
    values: ["blank", "outline", "script", "assets", "shotlist"],
    nullable: true,
    default: null,
  },
  canvas_id: { kind: "string", max: 64, nullable: true, default: null },
  series_id: { kind: "string", max: 64, nullable: true, default: null },
};

export const scriptSuiteFields: Fields = {
  folder: { kind: "string", max: 120, default: "" },
  project_title: { kind: "string", min: 1, max: 80, default: "新短剧企划" },
  canvas_id: { kind: "string", max: 64, nullable: true, default: null },
  series_id: { kind: "string", max: 64, nullable: true, default: null },
};

export const scriptUpdateFields: Fields = {
  expected_revision: { kind: "integer", min: 1, exactInteger: true },
  path: { kind: "string", min: 1, max: 240, optional: true },
  doc_kind: { kind: "literal", values: SCRIPT_DOC_KINDS, optional: true },
  body_md: { kind: "string", max: MAX_SCRIPT_BYTES, optional: true },
  canvas_id: { kind: "string", max: 64, nullable: true, optional: true },
  series_id: { kind: "string", max: 64, nullable: true, optional: true },
};

export const scriptSearchFields: Fields = {
  query: { kind: "string", min: 1, max: 240 },
  case_sensitive: { kind: "boolean", strict: false, default: false },
};

export const scriptReplaceFields: Fields = {
  replacements: {
    kind: "list",
    min: 1,
    max: 100,
    item: {
      kind: "object",
      fields: {
        id: { kind: "string", min: 1, max: 64 },
        expected_revision: { kind: "integer", min: 1, exactInteger: true },
        expected_text: { kind: "string", max: MAX_SCRIPT_BYTES },
        next_text: { kind: "string", max: MAX_SCRIPT_BYTES },
      },
    },
  },
};
