import test from "node:test";
import assert from "node:assert/strict";
import { databaseFixture } from "../helpers/database.js";
import { chatImportDraft, chatImportTables } from "../helpers/chat-import.js";
import {
  importLegacy,
  legacyId,
} from "@fumiao/platform/importer.js";
import { validateChatImport } from "@fumiao/platform/import-chats.js";
import { OriginalChats } from "@fumiao/original-api/chats.js";
import { ChatExecution } from "@fumiao/original-api/chat-execution.js";
import {
  OriginalIdentity,
  type OriginalActor,
} from "@fumiao/original-api/identity.js";
import { one } from "@fumiao/platform/db.js";
import { canonical } from "@fumiao/platform/plugins.js";

test("Native chat import preserves sparse identities, private history, raw text, settled charges and orphaned adoption audits", async () => {
  const f = await databaseFixture(),
    data = chatImportDraft();
  try {
    await importLegacy(f.p, data, f.directory);
    assert.equal(
      (await importLegacy(f.p, data, f.directory)).alreadyImported,
      true,
    );
    const rows = await chatImportTables(f.db);
    for (const [key, records] of Object.entries(rows))
      assert.deepEqual(
        records.map(canonical).sort(),
        data.tables[key].map(canonical).sort(),
        key,
      );
    const chats = new OriginalChats(f.p),
      identity = new OriginalIdentity(f.p);
    const admin = (await one(
        f.db,
        "SELECT * FROM users WHERE public_id=7",
      )) as OriginalActor,
      member = (await one(
        f.db,
        "SELECT * FROM users WHERE public_id=42",
      )) as OriginalActor;
    assert.equal(identity.profile(admin).id, 7);
    const cid = data.tables.conversations[0].id,
      deleted = data.tables.conversations[1].id;
    const view = await chats.get(admin, cid);
    assert.equal(view.conversation.title, "保留\0😀");
    assert.equal(view.messages[1].usage, '{"total_tokens": 9007199254740993}');
    await assert.rejects(chats.get(member, cid), { status: 404 });
    await assert.rejects(chats.get(admin, deleted), { status: 404 });
    await assert.rejects(chats.get(member, deleted), /对话已删除/);
    await chats.restore(member, deleted);
    assert.equal(
      (await chats.get(member, deleted)).messages[1].state,
      "stopped",
    );
    assert.deepEqual(await new ChatExecution(chats).ready(), []);
    assert.equal(await new ChatExecution(chats).recover(), 0);
    for (const t of data.tables.chat_turns)
      assert.equal(
        await chats.finish(legacyId(data.source, "chat-turn", t.id), {
          state: "complete",
          text: "late",
        }),
        false,
      );
    const ledger = await one(
      f.db,
      "SELECT count(*)::integer AS count FROM ledger WHERE chat_turn_id IS NOT NULL",
    );
    assert.equal(ledger.count, 4);
    const raw = (
      await f.db.query(
        "SELECT collection,payload,workspace_id FROM legacy_chat_records",
      )
    ).rows;
    for (const [key, records] of Object.entries(rows))
      assert.deepEqual(
        raw
          .filter((r) => r.collection === key)
          .map((r) => canonical(JSON.parse(Buffer.from(r.payload).toString())))
          .sort(),
        records.map(canonical).sort(),
      );
    assert.ok(raw.every((r) => r.workspace_id));
    assert.equal(
      (await one(f.db, "SELECT count(*)::integer AS count FROM sessions"))
        .count,
      0,
    );
    const application = await one(
      f.db,
      "SELECT * FROM chat_applications WHERE project_id IS NULL",
    );
    assert.equal(application.project_public_id, "d".repeat(32));
    await f.db.query("DELETE FROM documents WHERE public_id=$1", [
      "c".repeat(32),
    ]);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::integer AS count FROM chat_applications WHERE project_id IS NULL",
        )
      ).count,
      2,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::integer AS count FROM canvas_chat_links",
        )
      ).count,
      0,
    );
    const newChat = await chats
      .create(admin, { model: "deepseek-flash" })
      .catch((e) => {
        assert.match(e.message, /未知对话模型/);
        return null;
      });
    assert.equal(
      newChat,
      null,
      "archived turns never install or configure a live provider",
    );
    await f.db.query(
      "SELECT nextval(pg_get_serial_sequence('chat_messages','public_id'))",
    );
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT nextval(pg_get_serial_sequence('chat_messages','public_id')) AS id",
          )
        ).id,
      ),
      87,
    );
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT nextval(pg_get_serial_sequence('chat_conversations','ordinal')) AS id",
          )
        ).id,
      ),
      16,
    );
    const before = await chatImportTables(f.db);
    await importLegacy(f.p, data, "unused-on-repeat");
    assert.deepEqual(await chatImportTables(f.db), before);
  } finally {
    await f.cleanup();
  }
});

test("Incomplete, active, cross-space or inconsistent chat exports fail before object copying or SQL writes", async () => {
  const f = await databaseFixture();
  try {
    let copies = 0;
    f.p.storage.put = async () => {
      copies++;
      throw new Error("must not copy");
    };
    const changes: [string, (d: ReturnType<typeof chatImportDraft>) => void][] =
      [
        [
          "old export",
          (d) => {
            delete d.chatVersion;
          },
        ],
        [
          "missing turns",
          (d) => {
            delete d.tables.chat_turns;
          },
        ],
        [
          "missing applications",
          (d) => {
            delete d.tables.chat_applications;
          },
        ],
        [
          "running",
          (d) => {
            d.tables.chat_turns[0].state = "running";
          },
        ],
        [
          "held charge",
          (d) => {
            d.tables.credit_chat_charges[0].state = "held";
          },
        ],
        [
          "missing charge",
          (d) => {
            d.tables.credit_chat_charges.pop();
          },
        ],
        [
          "wrong settlement",
          (d) => {
            d.tables.credit_chat_charges[0].state = "refunded";
          },
        ],
        [
          "wrong amount",
          (d) => {
            d.tables.credit_chat_charges[0].amount = 99;
          },
        ],
        [
          "duplicate settlement",
          (d) => {
            d.tables.credit_ledger.push({
              ...d.tables.credit_ledger[1],
              id: 99,
            });
          },
        ],
        [
          "missing reserve",
          (d) => {
            d.tables.credit_ledger.shift();
          },
        ],
        [
          "missing wallet",
          (d) => {
            d.tables.credit_accounts.shift();
          },
        ],
        [
          "cross-space",
          (d) => {
            d.tables.conversations[0].workspace = 85;
          },
        ],
        [
          "reply crosses conversation",
          (d) => {
            d.tables.chat_messages[1].reply_to = 80;
          },
        ],
        [
          "application crosses conversation",
          (d) => {
            d.tables.chat_applications[0].message = 85;
          },
        ],
        [
          "link crosses space",
          (d) => {
            d.tables.canvas_chat_links[0].conversation = "b".repeat(32);
          },
        ],
        [
          "duplicate uid",
          (d) => {
            d.tables.chat_turns[1].uid = d.tables.chat_turns[0].uid;
          },
        ],
        [
          "duplicate order",
          (d) => {
            d.tables.conversations[1].original_order = 11;
          },
        ],
        [
          "unsafe message id",
          (d) => {
            d.tables.chat_messages[1].id = Number.MAX_SAFE_INTEGER + 1;
          },
        ],
        [
          "invalid context",
          (d) => {
            d.tables.chat_messages[0].context = "[]";
          },
        ],
        [
          "isolated surrogate",
          (d) => {
            d.tables.chat_messages[0].content = "\ud800";
          },
        ],
        [
          "unexpected credentials",
          (d) => {
            d.tables.chat_turns[0].api_key = "private-do-not-import";
          },
        ],
      ];
    for (const [name, change] of changes) {
      const draft = chatImportDraft();
      change(draft);
      await assert.rejects(
        importLegacy(f.p, draft, "missing-objects"),
        (error) =>
          (error as any).status === 400 || (error as any).status === 409,
        name,
      );
      assert.equal(
        (await one(f.db, "SELECT count(*)::integer AS count FROM users")).count,
        0,
        name,
      );
      assert.equal(
        (
          await one(
            f.db,
            "SELECT count(*)::integer AS count FROM legacy_imports",
          )
        ).count,
        0,
        name,
      );
    }
    assert.equal(copies, 0);
    const nil = chatImportDraft();
    nil.tables.chat_turns[0].uid = "00000000-0000-0000-0000-000000000000";
    assert.doesNotThrow(() => validateChatImport(nil.tables, nil.chatVersion));
  } finally {
    await f.cleanup();
  }
});

test("Chat import rolls back the complete identity/history/wallet unit after a late database failure and can safely retry", async () => {
  const f = await databaseFixture(),
    data = chatImportDraft();
  try {
    await f.db
      .query(`CREATE FUNCTION reject_chat_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.chat_turn_id IS NOT NULL THEN RAISE EXCEPTION 'fixture late ledger failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_chat_ledger BEFORE INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION reject_chat_ledger();`);
    await assert.rejects(
      importLegacy(f.p, data, f.directory),
      /fixture late ledger failure/,
    );
    for (const table of [
      "users",
      "wallets",
      "documents",
      "chat_conversations",
      "chat_messages",
      "chat_turns",
      "chat_charges",
      "chat_applications",
      "legacy_chat_records",
      "legacy_imports",
    ])
      assert.equal(
        (await one(f.db, `SELECT count(*)::integer AS count FROM ${table}`))
          .count,
        0,
        table,
      );
    await f.db.query("DROP TRIGGER reject_chat_ledger ON ledger");
    await Promise.all([
      importLegacy(f.p, data, f.directory),
      importLegacy(f.p, data, f.directory),
    ]);
    assert.equal(
      (await one(f.db, "SELECT count(*)::integer AS count FROM chat_turns"))
        .count,
      2,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::integer AS count FROM ledger WHERE chat_turn_id IS NOT NULL",
        )
      ).count,
      4,
    );
    assert.equal(
      (await importLegacy(f.p, data, f.directory)).alreadyImported,
      true,
    );
    const changed = structuredClone(data);
    changed.tables.chat_messages[0].content += " edited";
    await assert.rejects(importLegacy(f.p, changed, f.directory), /内容已变化/);
  } finally {
    await f.cleanup();
  }
});

test("SQLite imports before and after 059 attribute the same settled chat charges without repeating spend", async () => {
  const project = "c".repeat(32);
  const other = "1".repeat(32);
  type Draft = ReturnType<typeof chatImportDraft>;
  const context = (d: Draft, value: string) => {
    d.tables.chat_messages[0].context = value;
  };
  const link = (d: Draft, target: string, created: number) =>
    d.tables.canvas_chat_links.push({
      ...d.tables.canvas_chat_links[0],
      project: target,
      node: "linked-" + created,
      created,
    });
  const cases: [string, (d: Draft) => void, string | null][] = [
    [
      "explicit project takes priority over a prior link",
      (d) => {
        context(d, JSON.stringify({ project, text: "\0" }));
        link(d, other, 8);
      },
      project,
    ],
    [
      "an empty message inherits the earlier original user context",
      (d) => {
        context(d, "{}");
        d.tables.chat_messages.push({
          ...d.tables.chat_messages[0],
          id: 40,
          context: JSON.stringify({ project: other }),
        });
      },
      other,
    ],
    [
      "a single causally earlier canvas",
      (d) => {
        link(d, project, 8);
      },
      project,
    ],
    ["only a later canvas", () => {}, null],
    [
      "only a canvas tied with admission",
      (d) => {
        link(d, project, 10.25);
      },
      null,
    ],
    [
      "different projects before and at admission",
      (d) => {
        link(d, project, 8);
        link(d, other, 10.25);
      },
      null,
    ],
    [
      "duplicate explicit key cannot fall back to a linked canvas",
      (d) => {
        context(d, `{"project":"${other}","project":"${project}"}`);
        link(d, project, 8);
      },
      null,
    ],
    [
      "escaped duplicate explicit key cannot claim a receipt",
      (d) => context(d, `{"\\u0070roject":"${project}","project":"${project}"}`),
      null,
    ],
    [
      "cross-workspace project cannot fall back to a linked canvas",
      (d) => {
        Object.assign(d.tables.canvas_projects[1], {
          workspace: 85,
          owner: 42,
          last_editor: 42,
        });
        context(d, JSON.stringify({ project: other }));
        link(d, project, 8);
      },
      null,
    ],
  ];
  const backfill = "059_model_access_chat_project_backfill.sql";
  const { migrate } = await import("@fumiao/platform/db.js");
  for (const [name, change, expected] of cases) {
    for (const version of ["055_workspace_script_documents.sql", backfill]) {
      const f = await databaseFixture(version);
      try {
        const d = chatImportDraft();
        d.tables.canvas_projects.push({
          ...d.tables.canvas_projects[0],
          id: other,
        });
        change(d);
        await importLegacy(f.p, d, f.directory);
        if (version !== backfill) await migrate(f.db);
        assert.equal(
          (await importLegacy(f.p, d, f.directory)).alreadyImported,
          true,
        );
        const row = await one(
          f.db,
          `SELECT d.public_id, c.amount::numeric = 1 AS original_amount,
          (SELECT count(*)::integer FROM ledger l WHERE l.chat_turn_id=c.turn_id AND l.action='spend') AS spends
          FROM chat_charges c LEFT JOIN documents d ON d.id=c.project_id WHERE c.state='spent'`,
        );
        assert.deepEqual(
          row,
          { public_id: expected, original_amount: true, spends: 1 },
          name + " at " + version,
        );
        const admin = (await one(
          f.db,
          "SELECT * FROM users WHERE public_id=7",
        )) as OriginalActor;
        const chats = new OriginalChats(f.p);
        const message = String(d.tables.chat_turns[0].assistant_message);
        for (const target of [project, other]) {
          if (expected === target) {
            const source = await chats.replySource(
              admin,
              message,
              undefined,
              target,
            );
            assert.equal(source.bill?.charged, "1", name);
          } else {
            await assert.rejects(
              chats.replySource(admin, message, undefined, target),
              { status: 404 },
              name,
            );
          }
        }
      } finally {
        await f.cleanup();
      }
    }
  }
});
