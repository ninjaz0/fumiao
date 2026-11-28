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
export const chatQuoteFields: Fields = {
  cid: { kind: "string", max: 32, nullable: true, default: null },
  model: { kind: "string", max: 80 },
  text: { kind: "string", max: 12000, default: "" },
  retry: { kind: "integer", nullable: true, default: null, gt: 0 },
  context,
};
export const chatSendFields: Fields = {
  uid: { kind: "uuid" },
  model: { kind: "string", max: 80 },
  text: { kind: "string", default: "", max: 12000 },
  expected_revision: { kind: "integer", min: 1 },
  price_revision: { kind: "integer", min: 1 },
  route_revision: { kind: "uuid", optional: true },
  max_charge: { kind: "string", max: 34, optional: true },
  max_output_tokens: { kind: "integer", min: 1, optional: true },
  quote_context: { kind: "string", max: 64, optional: true },
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
  price_revision: number | string;
  route_revision?: string;
  max_charge?: string;
  max_output_tokens?: number;
  quote_context?: string;
  retry: number | null;
  context: ChatContextInput;
};
export const parseChatSend = (value: unknown) =>
  parseBody(
    value,
    value && typeof value === "object" && "route_revision" in value
      ? { ...chatSendFields, price_revision: { kind: "uuid" } }
      : chatSendFields,
    true,
  ) as ChatSendInput;
