import { parseBody, type Fields } from "./validation.js";
export const chatContextFields: Fields = {
  project: { kind: "string", max: 80 },
  node: { kind: "string", max: 80, default: "" },
  expected_revision: { kind: "integer", min: 1 },
  writeback: { kind: "boolean", strict: false, default: false },
  script_ids: { kind: "strings", max: 6, optional: true },
  node_ids: { kind: "strings", max: 6, optional: true },
};
const context = {
  kind: "object" as const,
  nullable: true,
  default: null,
  fields: chatContextFields,
  extra: true,
};
export const chatCreateFields: Fields = {
  model: { kind: "string", optional: true, max: 80 },
  context,
};
export const chatRenameFields: Fields = {
  title: { kind: "string", min: 1, max: 80 },
  expected_revision: { kind: "integer", min: 1 },
};
export const chatSendFields: Fields = {
  uid: { kind: "uuid" },
  model: { kind: "string", max: 80 },
  text: { kind: "string", default: "", max: 12000 },
  expected_revision: { kind: "integer", min: 1 },
  price_revision: { kind: "integer", min: 1 },
  retry: { kind: "integer", nullable: true, default: null, gt: 0 },
  context,
};
export const chatApplyFields: Fields = {
  uid: { kind: "uuid" },
  message: { kind: "integer", gt: 0 },
  project: { kind: "string", max: 80 },
  expected_revision: { kind: "integer", min: 1 },
  mode: { kind: "literal", values: ["new", "replace"], default: "new" },
  node: { kind: "string", default: "", max: 80 },
  expected_text: { kind: "string", default: "", max: 12000 },
};
export type ChatContextInput = {
  project: string;
  node: string;
  expected_revision: number;
  writeback: boolean;
  script_ids?: string[];
  node_ids?: string[];
} | null;
export type ChatSendInput = {
  uid: string;
  model: string;
  text: string;
  expected_revision: number;
  price_revision: number;
  retry: number | null;
  context: ChatContextInput;
};
export const parseChatSend = (value: unknown) =>
  parseBody(value, chatSendFields, true) as ChatSendInput;
