import { randomUUID } from "node:crypto";
import { one } from "@fumiao/platform/db.js";
import { chatBytes, chatText } from "@fumiao/platform/chat-values.js";
import type { OriginalChats } from "./chats.js";
import {
  loadActiveWorkspaceSkills,
  snapshotTurnSkills,
  type ActiveSkillSnapshot,
} from "./skills.js";

/** Durable ownership is separate from the original public turn state. A claimed
 * turn is never submitted again: an expired owner is interrupted/refunded. */
export class ChatExecution {
  constructor(
    readonly chats: OriginalChats,
    readonly leaseSeconds = 60,
  ) {}
  get p() {
    return this.chats.p;
  }
  async claim(id: string) {
    return this.p.db.transaction(async (sql) => {
      let turn = await one(sql, "SELECT * FROM chat_turns WHERE id=$1", [id]);
      if (!turn) return null;
      await sql.query(
        "SELECT id FROM chat_conversations WHERE id=$1 FOR UPDATE",
        [turn.conversation_id],
      );
      turn = await one(sql, "SELECT * FROM chat_turns WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      if (turn.state !== "running" || turn.lease_token || turn.started !== null)
        return null;
      const lease = randomUUID();
      await sql.query(
        "UPDATE chat_turns SET lease_token=$2,lease_until=$3 WHERE id=$1",
        [id, lease, this.chats.clock() + this.leaseSeconds],
      );
      const rows = (
        await sql.query(
          `SELECT role,content,state,context FROM chat_messages
        WHERE conversation_id=$1 AND NOT superseded AND public_id <= (SELECT public_id FROM chat_messages WHERE id=$2) ORDER BY public_id`,
          [turn.conversation_id, turn.user_message],
        )
      ).rows;
      let skills: ActiveSkillSnapshot[] = [];
      const hasSnapshots = await one(
        sql,
        "SELECT to_regclass('chat_turn_skill_snapshots') IS NOT NULL AS ok",
      );
      if (hasSnapshots?.ok) {
        const existingSnap = await one(
          sql,
          "SELECT snapshots FROM chat_turn_skill_snapshots WHERE turn_id=$1",
          [id],
        );
        if (existingSnap?.snapshots) {
          skills = existingSnap.snapshots as ActiveSkillSnapshot[];
        } else {
          skills = await loadActiveWorkspaceSkills(sql, turn.workspace_id);
          await snapshotTurnSkills(sql, id, skills);
        }
      }
      return {
        turn,
        lease,
        skills,
        rows: rows.map((r) => ({
          role: r.role as string,
          content: chatText(r.content),
          state: r.state as string,
          context: r.context as string,
        })),
      };
    });
  }
  async start(id: string, lease: string) {
    return !!(await one(
      this.p.db,
      `UPDATE chat_turns SET started=$3 WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_until>$3 AND started IS NULL RETURNING id`,
      [id, lease, this.chats.clock()],
    ));
  }
  async heartbeat(id: string, lease: string) {
    const stamp = this.chats.clock();
    return !!(await one(
      this.p.db,
      `UPDATE chat_turns SET lease_until=$4 WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_until>$3 RETURNING id`,
      [id, lease, stamp, stamp + this.leaseSeconds],
    ));
  }
  async progress(
    id: string,
    lease: string,
    text: string,
    first: number | null,
    requestId = "",
  ) {
    return this.p.db.transaction(async (sql) => {
      const turn = await one(
          sql,
          "SELECT * FROM chat_turns WHERE id=$1 FOR UPDATE",
          [id],
        ),
        stamp = this.chats.clock();
      if (
        !turn ||
        turn.state !== "running" ||
        turn.lease_token !== lease ||
        turn.lease_until <= stamp
      )
        return false;
      await sql.query("UPDATE chat_messages SET content=$2 WHERE id=$1", [
        turn.assistant_message,
        chatBytes(text),
      ]);
      await sql.query(
        "UPDATE chat_turns SET first_token=$2,updated=$3,request_id=CASE WHEN $4!=''::bytea THEN $4 ELSE request_id END WHERE id=$1",
        [id, first, stamp, chatBytes(requestId)],
      );
      return true;
    });
  }
  async recover() {
    const rows = (
      await this.p.db.query(
        "SELECT id FROM chat_turns WHERE state='running' AND lease_until<=$1 ORDER BY lease_until LIMIT 100",
        [this.chats.clock()],
      )
    ).rows;
    let recovered = 0;
    for (const row of rows)
      recovered += Number(
        await this.p.db.transaction(async (sql) => {
          let turn = await one(sql, "SELECT * FROM chat_turns WHERE id=$1", [
            row.id,
          ]);
          if (!turn) return false;
          await sql.query(
            "SELECT id FROM chat_conversations WHERE id=$1 FOR UPDATE",
            [turn.conversation_id],
          );
          turn = await one(
            sql,
            "SELECT * FROM chat_turns WHERE id=$1 FOR UPDATE",
            [row.id],
          );
          if (
            turn.state !== "running" ||
            turn.lease_until === null ||
            turn.lease_until > this.chats.clock()
          )
            return false;
          return this.chats.finishOn(sql, turn.id, {
            state: "interrupted",
            error: "服务重启，回复已停止，积分已退回",
          });
        }),
      );
    return recovered;
  }
  async ready() {
    return (
      await this.p.db.query(
        `SELECT t.id FROM chat_outbox o JOIN chat_turns t ON t.id=o.turn_id
      WHERE t.state='running' AND t.lease_token IS NULL AND t.started IS NULL AND o.available_at<=$1 ORDER BY o.available_at,t.id LIMIT 100`,
        [this.chats.clock()],
      )
    ).rows;
  }
  async dispatched(id: string) {
    const stamp = this.chats.clock();
    await this.p.db.query(
      "UPDATE chat_outbox SET sent_at=$2,available_at=$3 WHERE turn_id=$1",
      [id, stamp, stamp + 5],
    );
  }
  async titleCandidate(id: string) {
    return one(
      this.p.db,
      `SELECT c.id,c.title,m.content FROM chat_turns t JOIN chat_conversations c ON c.id=t.conversation_id
      JOIN chat_messages m ON m.id=t.user_message WHERE t.id=$1 AND t.state='complete' AND c.deleted_at IS NULL AND NOT c.custom_title
      AND m.id=(SELECT id FROM chat_messages WHERE conversation_id=c.id AND role='user' ORDER BY public_id LIMIT 1)`,
      [id],
    );
  }
  async title(candidate: { id: string; title: Uint8Array }, title: string) {
    return !!(await one(
      this.p.db,
      `UPDATE chat_conversations SET title=$2,revision=revision+1
      WHERE id=$1 AND NOT custom_title AND deleted_at IS NULL AND title=$3 RETURNING id`,
      [candidate.id, chatBytes(title), candidate.title],
    ));
  }
}
