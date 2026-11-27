import { randomUUID } from "node:crypto";
import { chatSettingsFixture } from "./chat-settings.js";
import { OriginalChats } from "@fumiao/original-api/chats.js";
import {
  OriginalIdentity,
  type OriginalActor,
} from "@fumiao/original-api/identity.js";
import { one } from "@fumiao/platform/db.js";
export async function chatsFixture(throughMigration?: string) {
  const f = await chatSettingsFixture(throughMigration);
  try {
    await f.reset({
      deepseek: "sk-fixture-native-chat",
      openai: "sk-fixture-native-chat",
    });
    await f.db.query("UPDATE wallets SET balance=100,held=0");
    const identity = new OriginalIdentity(f.p),
      member = (await one(
        f.db,
        "SELECT * FROM users WHERE name='member'",
      )) as OriginalActor;
    let stamp = 1800000000.25;
    const chats = new OriginalChats(f.p, () => stamp);
    const workspace = await identity.activeWorkspace(f.db, f.admin),
      memberSpace = await identity.activeWorkspace(f.db, member);
    return {
      ...f,
      identity,
      member,
      chats,
      workspace,
      memberSpace,
      setTime(value: number) {
        stamp = value;
      },
      async draft(snapshot: any, extra: Record<string, unknown> = {}) {
        return {
          uid: randomUUID(),
          model: "deepseek-flash",
          text: "问题",
          expected_revision: snapshot.conversation.revision,
          price_revision: (
            await one(f.db, "SELECT price_revision FROM studio_policy")
          ).price_revision,
          ...extra,
        };
      },
      async turn(publicId: string) {
        return one(f.db, "SELECT * FROM chat_turns WHERE public_id=$1", [
          publicId,
        ]);
      },
      async canvas(
        owner = f.admin,
        space = workspace,
        nodes: any[] = [
          {
            id: "text-node",
            type: "text",
            title: "原节点",
            text: "保留原文😀",
          },
        ],
      ) {
        return one(
          f.db,
          `INSERT INTO documents(id,workspace_id,owner_id,kind,title,body) VALUES($1,$2,$3,'canvas','画布',$4) RETURNING *`,
          [
            randomUUID(),
            space.id,
            owner.id,
            JSON.stringify({
              legacyDocument: { schemaVersion: 1, nodes, edges: [] },
            }),
          ],
        );
      },
    };
  } catch (error) {
    await f.cleanup();
    throw error;
  }
}
