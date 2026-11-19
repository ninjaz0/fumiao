import { randomUUID } from "node:crypto";
import type { Actor, Platform } from "../../platform/src/platform.js";
import { one } from "../../platform/src/db.js";
import { requireValue } from "../../platform/src/security.js";
import { chatText } from "../../platform/src/chat-values.js";
import { OriginalChats } from "./chats.js";
import { OriginalCanvases, canvasConflict } from "./canvases.js";
import { chatApplyFields } from "./chat-draft.js";
import { parseBody, ValidationError } from "./validation.js";
import { parseCanvasDocument } from "./canvas-draft.js";
import { canvasDocumentBytes, canvasDocumentJson } from "./canvas-values.js";

export class ChatAdoptionDocumentError extends Error {
  constructor() {
    super("Internal Server Error");
  }
}

function parseAdoptionDocument(value: unknown) {
  try {
    return parseCanvasDocument(value);
  } catch (error) {
    // The original checks the stored and generated document inside the route.
    if (error instanceof ValidationError) throw new ChatAdoptionDocumentError();
    throw error;
  }
}

/** Transactional adoption into the original canvas document. */
export class OriginalChatApplications {
  constructor(
    readonly p: Platform,
    readonly clock = () => Date.now() / 1000,
  ) {}
  async apply(actor: Actor, cid: string, value: unknown, selected?: string) {
    const body = parseBody(value, chatApplyFields, true);
    const chats = new OriginalChats(this.p),
      canvases = new OriginalCanvases(this.p, this.clock);
    return this.p.db.transaction(async (sql) => {
      const workspace = await chats.identity.activeWorkspace(
        sql,
        actor,
        selected,
      );
      // Match turn admission's conversation-before-canvas lock order. Recheck
      // deletion after a concurrent conversation mutation commits.
      const chat = await chats.access(sql, actor, cid, workspace.id, {
        lock: true,
      });
      requireValue(
        /^[a-f0-9]{32}$/.test(body.project),
        404,
        "画布不存在或已删除",
      );
      const project = await canvases.project(sql, actor, body.project, true);
      await canvases.library.access(
        sql,
        actor,
        { kind: "asset", row: project },
        chat.workspace_id,
      );
      // Serialize globally scoped UIDs even when concurrent requests target different canvases.
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "chat-apply:" + body.uid,
      ]);
      const old = await one(
        sql,
        `SELECT a.*,m.public_id AS message_number FROM chat_applications a JOIN chat_messages m ON m.id=a.message_id WHERE a.uid=$1`,
        [body.uid],
      );
      if (old) {
        requireValue(
          old.owner_id === actor.id &&
            old.conversation_id === chat.id &&
            Number(old.message_number) === body.message &&
            old.project_public_id === project.public_id &&
            old.mode === body.mode,
          409,
          "该采用标识已使用",
        );
        return {
          ...canvases.publicProject(project, actor),
          applied_node: old.node,
        };
      }
      requireValue(
        project.revision === body.expected_revision,
        409,
        canvasConflict,
      );
      const message = await one(
        sql,
        "SELECT * FROM chat_messages WHERE public_id=$1 AND conversation_id=$2 AND role='assistant' AND state='complete'",
        [body.message, chat.id],
      );
      requireValue(message, 409, "请等待回复完成后再采用");
      const text = chatText(message.content);
      requireValue(
        [...text].length <= 12000,
        400,
        "回复超过单个文本节点的长度上限，请让 AI 缩短后再采用",
      );
      let document = parseAdoptionDocument(
        canvasDocumentJson(project.document),
      );
      const target = document.nodes.find((n) => n.id === body.node);
      let nid: string;
      if (body.mode === "replace") {
        requireValue(
          target && ["text", "sticky"].includes(target.type),
          409,
          "文本节点已不存在",
        );
        requireValue(
          target.text === body.expected_text,
          409,
          "节点文字已经更新，请重新查看后再采用",
        );
        target.text = text;
        nid = target.id;
      } else {
        nid = randomUUID().replaceAll("-", "");
        const x = Math.min(
          99000,
          target
            ? target.x + target.width + 48
            : (document.nodes.length
                ? Math.max(...document.nodes.map((n) => n.x + n.width))
                : -368) + 48,
        );
        document = parseAdoptionDocument({
          ...document,
          nodes: [
            ...document.nodes,
            {
              id: nid,
              type: "text",
              title: "AI 写作",
              text,
              x,
              y: target?.y ?? 0,
              width: 360,
              height: 320,
            },
          ],
        });
      }
      await canvases.references(sql, actor, project, document);
      const stamp = Math.floor(this.clock());
      await sql.query(
        "UPDATE canvas_documents SET document=$2,updated=$3,last_editor=$4 WHERE project_id=$1",
        [project.id, canvasDocumentBytes(document), stamp, actor.id],
      );
      await sql.query(
        "UPDATE documents SET revision=revision+1,updated_at=to_timestamp($2) WHERE id=$1",
        [project.id, stamp],
      );
      await canvases.nodes(sql, project.id, document);
      await sql.query(
        "INSERT INTO canvas_chat_links(project_id,node,conversation_id,created) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [project.id, nid, chat.id, this.clock()],
      );
      await sql.query(
        "INSERT INTO chat_applications(uid,owner_id,conversation_id,message_id,project_id,node,mode,created,project_public_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          body.uid,
          actor.id,
          chat.id,
          message.id,
          project.id,
          nid,
          body.mode,
          this.clock(),
          project.public_id,
        ],
      );
      return {
        ...canvases.publicProject(
          await canvases.project(sql, actor, body.project),
          actor,
        ),
        applied_node: nid,
      };
    });
  }
}
