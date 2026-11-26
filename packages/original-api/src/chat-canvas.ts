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
  const hasRefs =
    Boolean(input.script_ids?.length) || Boolean(input.node_ids?.length);
  let resolvedNode: { id: string; title: string; text: string } | null = null;
  if (input.node || input.writeback) {
    const node = document.nodes.find((n: any) => n.id === input.node);
    if (input.writeback) {
      requireValue(
        node && ["text", "sticky"].includes(node.type),
        409,
        "这个文本节点已被删除或修改",
      );
    } else if (input.node) {
      requireValue(node, 409, "这个文本节点已被删除或修改");
      if (!hasRefs) {
        requireValue(
          ["text", "sticky"].includes(node.type),
          409,
          "这个文本节点已被删除或修改",
        );
      }
    }
    if (node && ["text", "sticky"].includes(node.type)) {
      if (!Object.hasOwn(node, "title") || !Object.hasOwn(node, "text"))
        throw new Error("Invalid original canvas node");
      resolvedNode = {
        id: node.id,
        title: node.title,
        text: node.text,
      };
    } else if (node) {
      resolvedNode = {
        id: String(node.id),
        title: String(node.title ?? ""),
        text: String(node.text || node.prompt || ""),
      };
    }
  }

  const baseResult: Record<string, any> = {
    project: row.public_id,
    node: resolvedNode ? resolvedNode.id : "",
    title: resolvedNode ? resolvedNode.title : String(row.title ?? ""),
    text: resolvedNode ? resolvedNode.text : "",
    writeback: input.writeback,
  };

  if (hasRefs) {
    const references: { kind: "script" | "node"; label: string; content: string }[] = [];
    let budget = 8000;

    if (input.script_ids?.length) {
      const uniqueIds = [...new Set(input.script_ids.filter(Boolean))].slice(0, 6);
      if (uniqueIds.length) {
        const { rows: scriptRows } = await sql.query(
          `SELECT public_id, path, body_md
             FROM workspace_script_documents
            WHERE workspace_id=$1
              AND public_id = ANY($2::text[])
              AND entry_type='file'
              AND NOT deleted`,
          [workspace, uniqueIds],
        );
        const byPublicId = new Map(
          scriptRows.map((r: any) => [String(r.public_id), r]),
        );
        for (const sid of uniqueIds) {
          const sRow = byPublicId.get(sid);
          if (!sRow || budget <= 0) continue;
          const slice = String(sRow.body_md ?? "").slice(0, Math.min(3000, budget));
          if (!slice) continue;
          references.push({
            kind: "script",
            label: String(sRow.path),
            content: slice,
          });
          budget -= slice.length;
        }
      }
    }

    if (input.node_ids?.length) {
      const uniqueNodeIds = [...new Set(input.node_ids.filter(Boolean))].slice(0, 6);
      for (const nid of uniqueNodeIds) {
        if (budget <= 0) break;
        const targetNode = document.nodes.find((n: any) => n.id === nid);
        if (!targetNode) continue;
        const rawContent = String(targetNode.text || targetNode.prompt || "");
        const slice = rawContent.slice(0, Math.min(2000, budget));
        references.push({
          kind: "node",
          label: String(targetNode.title || targetNode.id),
          content: slice,
        });
        budget -= slice.length;
      }
    }

    if (references.length > 0) {
      baseResult.references = references;
    }
  }

  return baseResult;
}
