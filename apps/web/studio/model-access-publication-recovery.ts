import type { PublicationItem } from "@fumiao/web-compat/model-access.js";
import { ApiError } from "../canvas/api";
import type { AdminRequest } from "./settings-admin";

export type PublicationOperation = { uid: string; items: PublicationItem[] };
type ReceiptStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;
const prefix = (user: number) => `studio-model-publication:${user}:`;

export function recoverablePublications(
  storage: ReceiptStorage,
  user: number,
): PublicationOperation[] {
  const result: PublicationOperation[] = [];
  const scope = prefix(user);
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(scope)) continue;
    try {
      const op = JSON.parse(
        storage.getItem(key) ?? "null",
      ) as PublicationOperation | null;
      if (
        op &&
        scope + op.uid === key &&
        Array.isArray(op.items) &&
        op.items.length
      )
        result.push(op);
    } catch {
      /* Ignore an unreadable local record. */
    }
  }
  return result;
}

export async function sendPublication(
  storage: ReceiptStorage,
  user: number,
  operation: PublicationOperation,
  request: AdminRequest,
) {
  const key = prefix(user) + operation.uid;
  storage.setItem(key, JSON.stringify(operation));
  try {
    const receipt = (await request(
      "/api/admin/model-access/publications",
      operation,
    )) as { items?: { catalog_id: string; revision: number }[] } | null;
    if (
      !Array.isArray(receipt?.items) ||
      receipt.items.length !== operation.items.length ||
      receipt.items.some((i) => !i?.catalog_id || !(i.revision > 0))
    )
      throw new Error("未收到完整的发布回执");
    storage.removeItem(key);
    return receipt;
  } catch (error) {
    if (
      error instanceof ApiError &&
      [400, 404, 409, 422].includes(error.status)
    )
      storage.removeItem(key);
    throw error;
  }
}
