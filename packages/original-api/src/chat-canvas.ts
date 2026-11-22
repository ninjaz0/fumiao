import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { requireValue } from "@fumiao/platform/security.js";
import { OriginalLibrary } from "./library.js";
import type { ChatContextInput } from "./chat-draft.js";
import { canvasDocumentJson } from "./canvas-values.js";
/** Read the preserved original document inside the same PostgreSQL transaction.
 * Full canvas mutation/adoption is deliberately a separate, not yet mounted contract. */
export async function chatCanvasContext(
  p: Platform,
  sql: Sql,
  actor: Actor,
  workspace: string,
  input: ChatContextInput,
): Promise<Record<string, any>> {
  if (input === null) return {};
  requireValue(/^[a-f0-9]{32}$/.test(input.project), 404, "画布不存在或已删除");
  const row = await one(
    sql,
    "SELECT * FROM documents WHERE public_id=$1 AND kind='canvas' AND NOT deleted FOR SHARE",
    [input.project],
  );
  requireValue(row, 404, "画布不存在或已删除");
  await new OriginalLibrary(p).access(
    sql,
    actor,
    { kind: "asset", row },
    workspace,
  );
  requireValue(
    row.revision === input.expected_revision,
    409,
    "画布已被其他成员修改。你的修改已保留，请重新载入或下载本地副本。",
  );
  const native = await one(
    sql,
    "SELECT document FROM canvas_documents WHERE project_id=$1",
    [row.id],
  );
  const document = native
    ? canvasDocumentJson(native.document)
    : row.body?.legacyDocument;
  requireValue(
    document && Array.isArray(document.nodes),
    503,
    "原画布文档尚未完成迁移",
  );
  const node = document.nodes.find((n: any) => n.id === input.node);
  requireValue(
    node && ["text", "sticky"].includes(node.type),
    409,
    "这个文本节点已被删除或修改",
  );
  if (!Object.hasOwn(node, "title") || !Object.hasOwn(node, "text"))
    throw new Error("Invalid original canvas node");
  return {
    project: row.public_id,
    node: node.id,
    title: node.title,
    text: node.text,
    writeback: input.writeback,
  };
}
