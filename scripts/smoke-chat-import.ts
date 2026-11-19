import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { databaseFixture } from "../tests/helpers/database.js";
import { chatImportTables } from "../tests/helpers/chat-import.js";
import {
  importLegacy,
  legacyId,
  type LegacyExport,
} from "../packages/platform/src/importer.js";
import {
  OriginalIdentity,
  type OriginalActor,
} from "../packages/original-api/src/identity.js";
import { OriginalChats } from "../packages/original-api/src/chats.js";
import { OriginalCredits } from "../packages/original-api/src/credits.js";
import { StudioCatalog } from "../packages/platform/src/catalog.js";
import { ChatExecution } from "../packages/original-api/src/chat-execution.js";
import { chatStreaming } from "../plugins/chat/src/stream.js";
import { one } from "../packages/platform/src/db.js";
import { DomainError } from "../packages/platform/src/security.js";
import { canonical } from "../packages/platform/src/plugins.js";
const f = await databaseFixture(),
  failures: any[] = [];
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/chat-import-fixtures.py", f.directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const data: LegacyExport = JSON.parse(
      await readFile(join(f.directory, "export.json"), "utf8"),
    ),
    oracle = JSON.parse(
      await readFile(join(f.directory, "manifest.json"), "utf8"),
    );
  assert.equal(
    (await stat(join(f.directory, "export.json"))).mode & 0o777,
    0o600,
  );
  const first = await importLegacy(
    f.p,
    data,
    join(f.directory, "runtime/media"),
  );
  assert.equal(
    (await importLegacy(f.p, data, join(f.directory, "runtime/media")))
      .alreadyImported,
    true,
  );
  assert.equal(first.users, 2);
  const actual = await chatImportTables(f.db);
  for (const [name, records] of Object.entries(actual)) {
    const sorted = (rows: unknown[]) => rows.map(canonical).sort();
    assert.deepEqual(sorted(records), sorted(data.tables[name]), name);
  }
  const archives = (
    await f.db.query(
      "SELECT collection,payload,workspace_id FROM legacy_chat_records",
    )
  ).rows;
  for (const name of Object.keys(actual))
    assert.deepEqual(
      archives
        .filter((a) => a.collection === name)
        .map((a) => canonical(JSON.parse(Buffer.from(a.payload).toString())))
        .sort(),
      data.tables[name].map(canonical).sort(),
      name + " raw archive",
    );
  assert.ok(archives.every((a) => a.workspace_id));
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*)::integer AS count FROM documents WHERE kind='chat'",
      )
    ).count,
    0,
  );
  const identity = new OriginalIdentity(f.p),
    actors: OriginalActor[] = [];
  for (const user of data.tables.users)
    actors.push(
      await identity.actor(
        await identity.login(
          { name: user.name, password: "chat-import-fixture" },
          "chat-import",
        ),
      ),
    );
  const credits = new OriginalCredits(f.p);
  for (const account of data.tables.credit_accounts) {
    const expected = data.tables.credit_ledger.filter(
      (l) => l.workspace === account.workspace,
    );
    const ledger = await credits.history(f.db, account.workspace);
    assert.equal(ledger.length, expected.length);
    for (const row of ledger) {
      const source = expected.find((e) => e.id === row.id)!;
      for (const key of [
        "amount",
        "balance",
        "reserved",
        "action",
        "note",
        "chat_turn",
        "job",
        "created",
      ] as const)
        assert.deepEqual(row[key], source[key], "credit " + key);
    }
  }
  const missing = await one(
    f.db,
    "SELECT project_id,project_public_id FROM chat_applications WHERE project_public_id=$1",
    [oracle.deletedCanvas],
  );
  assert.deepEqual(missing, {
    project_id: null,
    project_public_id: oracle.deletedCanvas,
  });
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*)::integer AS count FROM ledger WHERE original_chat_turn IS NOT NULL AND chat_turn_id IS NULL",
      )
    ).count,
    0,
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*)::integer AS count FROM chat_turns WHERE config_snapshot IS NOT NULL OR plugin_id IS NOT NULL OR lease_token IS NOT NULL",
      )
    ).count,
    0,
  );
  // Install the original protocol plugin with equal public catalog/price revisions;
  // only local synthetic credentials are supplied. No provider is ever executed.
  const policy = await one(f.db, "SELECT * FROM studio_policy");
  await f.db.transaction((sql) =>
    new StudioCatalog(f.db).activate(sql, chatStreaming.manifest),
  );
  await f.db.query("UPDATE studio_policy SET revision=$1,price_revision=$2", [
    policy.revision,
    policy.price_revision,
  ]);
  for (const provider of chatStreaming.manifest.chat!.providers) {
    const connection = await f.p.createConnection(actors[0], {
      name: provider.label,
      pluginId: chatStreaming.manifest.id,
      version: chatStreaming.manifest.version,
      config: { ...provider.defaultConfig, apiKey: "sk-fixture-native-chat" },
    });
    await f.db.query("UPDATE connections SET enabled=true WHERE id=$1", [
      connection.id,
    ]);
  }
  let stamp = 0;
  const chats = new OriginalChats(f.p, () => stamp),
    store = new ChatExecution(chats);
  assert.deepEqual(await store.ready(), []);
  assert.equal(await store.recover(), 0);
  const generatedTurns = new Map<string, string>();
  for (const c of oracle.cases) {
    stamp = c.stamp;
    const actor = actors[c.user],
      selected = c.workspace == null ? undefined : String(c.workspace);
    let body: any,
      status = 200;
    try {
      if (c.action === "list")
        body = await chats.list(actor, selected, c.project, c.node);
      else if (c.action === "get")
        body = await chats.get(actor, c.chat, selected);
      else if (c.action === "rename")
        body = await chats.rename(actor, c.chat, c.body, selected);
      else if (c.action === "send")
        body = await chats.send(actor, c.chat, c.body, selected);
      else if (c.action === "stop")
        body = await chats.stop(actor, c.chat, selected);
      else if (c.action === "restore")
        body = await chats.restore(actor, c.chat, selected);
      else if (c.action === "delete")
        body = await chats.remove(actor, c.chat, selected);
      else throw new Error("unknown fixture action");
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      status = e.status;
      body = { detail: e.message };
    }
    try {
      assert.equal(status, c.status);
      if (
        c.action === "send" &&
        status === 200 &&
        !data.tables.chat_turns.some((t) => t.uid === c.body.uid)
      ) {
        assert.match(body.conversation.active_turn, /^[a-f0-9]{32}$/);
        generatedTurns.set(
          body.conversation.active_turn,
          c.expected.conversation.active_turn,
        );
      }
      // All imported identifiers compare literally. Only a newly generated
      // post-import turn UUID differs between the two independent runtimes.
      assert.deepEqual(
        JSON.parse(
          JSON.stringify(body, (key, value) =>
            ["active_turn", "turn"].includes(key)
              ? (generatedTurns.get(value) ?? value)
              : value,
          ),
        ),
        c.expected,
      );
    } catch (error) {
      failures.push({
        action: c.action,
        chat: c.chat,
        error: String(error).slice(0, 8000),
      });
    }
  }
  const newChat = await chats.create(actors[0], {});
  assert.ok(
    (
      await one(
        f.db,
        "SELECT ordinal FROM chat_conversations WHERE public_id=$1",
        [newChat.conversation.id],
      )
    ).ordinal >
      Math.max(...data.tables.conversations.map((c) => c.original_order)),
  );
  const newMessage = await chats.send(actors[0], newChat.conversation.id, {
    uid: "00000000-0000-0000-0000-000000000001",
    model: "deepseek-flash",
    text: "新编号",
    expected_revision: 1,
    price_revision: policy.price_revision,
  });
  assert.ok(
    newMessage.messages[0].id >
      Math.max(...data.tables.chat_messages.map((m) => m.id)),
  );
  await chats.stop(actors[0], newChat.conversation.id);
  const before = await chatImportTables(f.db);
  assert.equal(
    (await importLegacy(f.p, data, "not-read-on-repeat")).alreadyImported,
    true,
  );
  assert.deepEqual(
    await chatImportTables(f.db),
    before,
    "repeated import must not overwrite live changes",
  );
  assert.equal(
    (await one(f.db, "SELECT count(*)::integer AS count FROM chat_outbox"))
      .count,
    0,
  );
  const report = {
    passed: !failures.length,
    records: Object.fromEntries(
      Object.entries(actual).map(([key, value]) => [key, value.length]),
    ),
    scenarios: oracle.cases.length,
    exportGuards: oracle.guards,
    failures,
  };
  await mkdir(".runtime-advanced/chat-import-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/chat-import-parity/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log("Original chat history import:", JSON.stringify(report));
  if (failures.length) process.exitCode = 1;
} finally {
  await f.cleanup();
}
