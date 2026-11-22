import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { databaseFixture } from "../helpers/database.js";
import {
  chatToolProvider,
  toolTestOrigin,
} from "../helpers/chat-tool-provider.js";
import { one } from "@fumiao/platform/db.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import { StudioPackages } from "@fumiao/platform/studio-packages.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalChats } from "@fumiao/original-api/chats.js";
import { ChatExecution } from "@fumiao/original-api/chat-execution.js";
import { ChatRuntime } from "@fumiao/original-api/chat-runtime.js";
import { turnTools } from "@fumiao/original-api/chat-tools.js";

const load = async (path: string) =>
  JSON.parse(await readFile("plugins/" + path, "utf8"));
async function setup(
  t: test.TestContext,
  filename = "compatible-chat/compatible-chat.fmplugin.json",
) {
  const f = await databaseFixture();
  t.after(f.cleanup);
  const provider = chatToolProvider();
  f.p.registry = new PluginRegistry(undefined, [], provider.send);
  await f.p.registry.initializeStudio(f.db, false);
  const identity = new OriginalIdentity(f.p);
  const credentials = { name: "admin", password: randomUUID() };
  await identity.bootstrap({ ...credentials, nickname: "验收" });
  const actor = await identity.actor(
    await identity.login(credentials, "tools"),
  );
  const packages = new StudioPackages(f.p);
  const pkg = await load(filename);
  await packages.install(actor, pkg);
  await f.p.createConnection(
    actor,
    {
      name: "fixture",
      pluginId: pkg.id,
      version: pkg.adapterVersion,
      config: {
        provider: "openai",
        baseUrl: toolTestOrigin + "/v1",
        apiKey: "synthetic-credential",
      },
    },
    true,
  );
  await packages.change(actor, pkg.id, 1, "enable");
  const tool = await load(
    "example-reading-time/example-reading-time.fmplugin.json",
  );
  const chats = new OriginalChats(f.p);
  const admit = async (user = actor) => {
    const view = await chats.create(user, {});
    const result = await chats.send(user, view.conversation.id, {
      uid: randomUUID(),
      expected_revision: view.conversation.revision,
      price_revision: (
        await one(f.db, "SELECT price_revision FROM studio_policy")
      ).price_revision,
      model: "gpt-4.1",
      text: "请估算旁白时长",
    });
    const turn = await one(
      f.db,
      "SELECT * FROM chat_turns WHERE public_id=$1",
      [result.conversation.active_turn],
    );
    return { turn, conversation: view.conversation.id };
  };
  const execute = async (id: string) => {
    const a = new ChatRuntime(new ChatExecution(chats)),
      b = new ChatRuntime(new ChatExecution(chats));
    try {
      await Promise.all([a.execute(id), b.execute(id)]);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  };
  await f.db.query("UPDATE wallets SET balance=100");
  return {
    ...f,
    identity,
    actor,
    packages,
    tool,
    pkg,
    chats,
    provider,
    admit,
    execute,
  };
}

test("accepted tools retain their enabled release through removal, fragmented calls resume the model and one wallet charge settles", async (t) => {
  const f = await setup(t);
  const other = await f.admit();
  await f.packages.install(f.actor, f.tool);
  await f.packages.change(f.actor, f.tool.id, 1, "enable");
  const { turn, conversation } = await f.admit();
  assert.equal((await turnTools(f.db, other.turn.id)).size, 0);
  assert.equal((await turnTools(f.db, turn.id)).size, 1);
  await f.packages.change(f.actor, f.tool.id, 2, "remove");
  await f.execute(turn.id);
  const reply = (await f.chats.get(f.actor, conversation)).messages[1];
  assert.equal(reply.state, "complete", JSON.stringify(reply));
  assert.equal(reply.content, "旁白预计 2 秒。");
  assert.match(reply.usage, /9007199254741008/);
  assert.match(reply.usage, /"prompt_tokens": 16/);
  const [initial, continued] = f.provider.streams;
  assert.equal(initial.tools.length, 1);
  assert.equal(
    initial.tools[0].function.parameters.additionalProperties,
    false,
  );
  assert.equal(JSON.stringify(initial.tools).includes("program"), false);
  const [call, result] = continued.messages.slice(-2);
  assert.equal(
    call.tool_calls[0].function.name,
    initial.tools[0].function.name,
  );
  assert.equal(result.tool_call_id, call.tool_calls[0].id);
  assert.equal(result.role, "tool");
  assert.deepEqual(JSON.parse(result.content), {
    characters: 8,
    charactersPerMinute: 240,
    estimatedSeconds: 2,
  });
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*)::int AS n FROM ledger WHERE chat_turn_id=$1",
        [turn.id],
      )
    ).n,
    2,
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*)::int AS n FROM studio_plugin_audit WHERE page_id='chat' AND target=$1 AND outcome='succeeded'",
        [turn.id],
      )
    ).n,
    1,
  );
  await f.execute(other.turn.id);
  assert.equal(f.provider.streams.at(-1)?.tools, undefined);
  assert.equal((await turnTools(f.db, (await f.admit()).turn.id)).size, 0);
});

test("tool schemas and audience are enforced; malformed, unknown and repeated calls refund once", async (t) => {
  const f = await setup(t);
  const decl = f.tool.contributes.chatTools[0];
  decl.audience = "admin";
  await assert.rejects(
    f.packages.preview(f.actor, {
      ...f.tool,
      contributes: { version: 1, chatTools: [decl, decl] },
    }),
  );
  await assert.rejects(
    f.packages.preview(f.actor, {
      ...f.tool,
      contributes: {
        version: 1,
        chatTools: [
          { ...decl, parameters: { ...decl.parameters, required: ["ghost"] } },
        ],
      },
    }),
  );
  await f.packages.install(f.actor, f.tool);
  await f.packages.change(f.actor, f.tool.id, 1, "enable");
  const credentials = { name: "reader", password: randomUUID() };
  await f.identity.createMember(f.actor, { ...credentials, nickname: "成员" });
  const member = await f.identity.actor(
    await f.identity.login(credentials, "tools"),
  );
  await f.db.query("UPDATE wallets SET balance=100");
  assert.equal(
    (await turnTools(f.db, (await f.admit(member)).turn.id)).size,
    0,
  );
  for (const mode of ["bad-arguments", "unknown", "repeat"] as const) {
    f.provider.setMode(mode);
    const { turn, conversation } = await f.admit();
    await f.execute(turn.id);
    const reply = (await f.chats.get(f.actor, conversation)).messages[1];
    assert.equal(reply.state, "failed");
    assert.match(reply.error ?? "", /工具/);
    assert.equal(
      (
        await one(f.db, "SELECT state FROM chat_charges WHERE turn_id=$1", [
          turn.id,
        ])
      ).state,
      "refunded",
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::int AS n FROM studio_plugin_audit WHERE page_id='chat' AND target=$1",
          [turn.id],
        )
      ).n,
      mode === "repeat" ? 1 : 0,
    );
  }
  const revoked = await f.admit();
  await f.db.query("UPDATE users SET role='member' WHERE id=$1", [f.actor.id]);
  f.provider.setMode("normal");
  await f.execute(revoked.turn.id);
  assert.equal(
    (
      await one(f.db, "SELECT state FROM chat_charges WHERE turn_id=$1", [
        revoked.turn.id,
      ])
    ).state,
    "refunded",
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*)::int AS n FROM studio_plugin_audit WHERE target=$1",
        [revoked.turn.id],
      )
    ).n,
    0,
  );
});

test("upgrading the signed-in service from sandbox 2.0 retains pending plain chat and enables tools on new turns", async (t) => {
  const f = await setup(
    t,
    "compatible-chat/package/legacy-2.0.0.fmplugin.json",
  );
  await f.packages.install(f.actor, f.tool);
  await f.packages.change(f.actor, f.tool.id, 1, "enable");
  const old = await f.admit();
  const next = await load("compatible-chat/compatible-chat.fmplugin.json");
  const installed = (await f.packages.list(f.actor)).find(
    (p) => p.id === next.id,
  )!;
  await f.packages.install(f.actor, next, installed.revision);
  const current = await f.admit();
  assert.equal(old.turn.plugin_version, "2.0.0");
  assert.equal(current.turn.plugin_version, next.adapterVersion);
  assert.equal((await turnTools(f.db, old.turn.id)).size, 0);
  assert.equal((await turnTools(f.db, current.turn.id)).size, 1);
  await f.execute(old.turn.id);
  assert.equal(f.provider.streams.length, 1);
  assert.equal(f.provider.streams[0].tools, undefined);
  assert.equal(
    (await f.chats.get(f.actor, old.conversation)).messages[1].content,
    "普通对话",
  );
  await f.execute(current.turn.id);
  assert.equal(
    (await f.chats.get(f.actor, current.conversation)).messages[1].content,
    "旁白预计 2 秒。",
  );
});

test("invalid tool output rolls back workspace writes and audits without retaining the script", async (t) => {
  const f = await setup(t);
  f.tool.contributes.hostCapabilities = ["data"];
  f.tool.contributes.chatTools[0].program =
    '({ async run(args, context, host) { await host.data.put("draft",args.script); return {invalid:true}; } })';
  await f.packages.install(f.actor, f.tool);
  await f.packages.change(f.actor, f.tool.id, 1, "enable");
  const { turn, conversation } = await f.admit();
  await f.execute(turn.id);
  assert.equal(
    (await f.chats.get(f.actor, conversation)).messages[1].state,
    "failed",
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*)::int AS n FROM studio_plugin_data WHERE plugin_id=$1",
        [f.tool.id],
      )
    ).n,
    0,
  );
  const audit = await one(
    f.db,
    "SELECT outcome,detail FROM studio_plugin_audit WHERE target=$1",
    [turn.id],
  );
  assert.equal(audit.outcome, "failed");
  assert.match(JSON.stringify(audit.detail), /data.put/);
  assert.equal(JSON.stringify(audit.detail).includes("海面日出"), false);
});
