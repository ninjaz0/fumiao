import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ChatRuntime } from "@fumiao/original-api/chat-runtime.js";
import { ChatExecution } from "@fumiao/original-api/chat-execution.js";
import { Executor } from "@fumiao/platform/executor.js";
import sharp from "sharp";
import { OriginalChats } from "@fumiao/original-api/chats.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { discoverModels } from "@fumiao/platform/model-access/discovery.js";
import { adminSettingsTabs } from "../../apps/web/studio/settings-tabs.js";
import { chatSettingsPath } from "../../apps/web/canvas-editor/chat/guidance.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { databaseFixture } from "../helpers/database.js";

test("全新 Studio 向管理员提供模型接入和清晰的空对话入口", () => {
  assert.ok(adminSettingsTabs.some((key) => String(key) === "modelAccess"));
  assert.equal(
    chatSettingsPath({ studio_plugins: true, model_groups: {} }),
    "/studio?settings=modelAccess",
  );
});

test("完整目录可超过 1 MiB，超出目录预算时保留上次结果", async () => {
  const catalog = Array.from({ length: 477 }, (_, i) => ({
    id: "service/model-" + i,
    description: "Multimodal language model for conversation. ".repeat(68),
    architecture: {
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    },
  }));
  let data = Buffer.from(JSON.stringify({ data: catalog }, null, 2));
  assert.ok(data.length > 1_460_000 && data.length < 1_550_000);
  const read = () =>
    Promise.resolve({
      status: 200,
      contentType: "application/json",
      body: data,
    });
  const result = await discoverModels("https://1.1.1.1/v1", read, () => false);
  assert.equal(result.candidates.length, 477);
  data = Buffer.from(
    JSON.stringify({
      data: [
        { id: "oversized-model", description: "x".repeat(8 * 1024 * 1024) },
      ],
    }),
  );
  const next = await discoverModels(
    "https://1.1.1.1/v1",
    read,
    () => false,
    result,
  );
  assert.equal(next.directories.models, "unavailable");
  assert.equal(next.candidates.length, 477);
  assert.ok(next.candidates.every((c) => c.metadata_status === "stale"));
});

test("试用先报价，在指定工作区按目标线路受理三种模型且同一 UID 只冻结一次", async (t) => {
  const f = await databaseFixture();
  t.after(f.cleanup);
  const identity = new OriginalIdentity(f.p);
  const password = "trial-fixture";
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const cookie = await identity.login({ name: "admin", password }, "test");
  const actor = await identity.actor(cookie);
  await identity.createMember(actor, {
    name: "member",
    nickname: "成员",
    password,
  });
  const memberCookie = await identity.login(
    { name: "member", password },
    "test",
  );
  const workspace = Number(
    (await identity.activeWorkspace(f.db, actor)).public_id,
  );
  const otherWorkspace = Number(
    (await identity.activeWorkspace(f.db, await identity.actor(memberCookie)))
      .public_id,
  );
  const requests: string[] = [];
  const app = await createOriginalApp(f.p, {
    modelAccessHttp: async (url, init) => {
      requests.push(init.method + " " + url.pathname);
      return {
        status: 200,
        body: Buffer.from('{"data":[]}'),
        contentType: "application/json",
      };
    },
  });
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const base = (await app.getUrl()) + "/api/admin/model-access";
  async function call(
    method: string,
    path: string,
    body?: unknown,
    session = cookie,
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Cookie: "fm_session=" + session,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  }
  async function ok(method: string, path: string, body?: unknown) {
    const r = await call(method, path, body);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  }
  const adminSpace = await identity.activeWorkspace(f.db, actor);
  await f.db.query("UPDATE wallets SET balance=100 WHERE workspace_id=$1", [
    adminSpace.id,
  ]);
  const pixel = await sharp({
    create: { width: 128, height: 128, channels: 3, background: "#335577" },
  })
    .png()
    .toBuffer();
  for (const kind of ["chat", "image", "video"]) {
    const replay: { path: string; body: object; result: unknown }[] = [];
    let catalogId = "";
    for (const [index, name] of ["current", "standby"].entries()) {
      const conn = await ok("POST", "/connections", {
        name,
        base_url: "https://1.1.1.1/" + name + "/v1",
        api_key: "fixture-token",
      });
      await ok("POST", "/connections/" + conn.id + "/discover", {
        expected_revision: conn.revision,
      });
      const id = randomUUID();
      await ok("PUT", "/drafts/" + id, {
        expected_revision: 0,
        connection_revision: 1,
        connection_id: conn.id,
        upstream_id: kind + "-" + name,
        purpose: kind,
        ...(kind === "chat"
          ? { chat_prices: { input: "0", output: "1" } }
          : { price: "0.25" }),
        ...(kind === "video"
          ? { overrides: { durations: [4], protocol: "new-api-videos" } }
          : {}),
      });
      const item = index
        ? { action: "standby", expected_revision: 1, catalog_id: catalogId }
        : { action: "create" };
      const reply = await ok("POST", "/publications", {
        uid: randomUUID(),
        items: [{ draft_id: id, draft_revision: 1, ...item }],
      });
      catalogId = reply.items[0].catalog_id;
    }
    const pub = (await ok("GET", "")).publications.find(
      (p: any) => p.catalog_id === catalogId,
    );
    assert.equal(
      requests.every((r) => r.startsWith("GET ")),
      true,
    );
    for (const route of pub.routes) {
      assert.equal(route.directory?.directories.models, "empty");
      assert.equal(route.health, null);
      const path = "/routes/" + route.route_revision_id + "/trial";
      const sample = {
        uid: randomUUID(),
        workspace,
        route_revision: route.route_revision_id,
        price_revision: pub.price_revision_id,
        prompt: "沿海的晨光",
        ...(kind === "video" ? { params: { seconds: 4 } } : {}),
      };
      assert.equal(
        (await call("POST", path + "/quote", sample, memberCookie)).status,
        403,
      );
      assert.equal(
        (
          await call("POST", path + "/quote", {
            ...sample,
            workspace: otherWorkspace,
          })
        ).status,
        403,
      );
      const quote = await ok("POST", path + "/quote", sample);
      assert.equal(
        quote.max_charge,
        kind === "chat" ? "0.004096" : kind === "image" ? "0.25" : "1",
      );
      assert.equal(
        (
          await call("POST", path, {
            ...sample,
            quote: { ...quote, max_charge: "88" },
          })
        ).status,
        409,
      );
      assert.equal(
        (await call("POST", path, { ...sample, quote }, memberCookie)).status,
        403,
      );
      await f.db.query(
        "INSERT INTO model_permissions(workspace_id,model_id,enabled) VALUES($1,$2,false)",
        [adminSpace.id, route.model_id],
      );
      assert.equal(
        (await call("POST", path, { ...sample, quote })).status,
        403,
      );
      await f.db.query(
        "DELETE FROM model_permissions WHERE workspace_id=$1 AND model_id=$2",
        [adminSpace.id, route.model_id],
      );
      const [accepted, repeated] = await Promise.all([
        ok("POST", path, { ...sample, quote }),
        ok("POST", path, { ...sample, quote }),
      ]);
      assert.deepEqual(repeated, accepted);
      replay.push({ path, body: { ...sample, quote }, result: accepted });
      assert.equal(accepted.route_revision, route.route_revision_id);
      assert.deepEqual(await ok("POST", path, { ...sample, quote }), accepted);
      assert.equal(
        (await call("POST", path, { ...sample, prompt: "改变输入", quote }))
          .status,
        409,
      );
      const table = kind === "chat" ? "chat_turns" : "jobs";
      const rows = (
        await f.db.query(
          "SELECT id FROM " + table + " WHERE route_revision_id=$1",
          [route.route_revision_id],
        )
      ).rows;
      assert.equal(rows.length, 1);
      const upstream = route.upstream_id;
      const originPath = upstream.endsWith("-standby")
        ? "/standby/v1/"
        : "/current/v1/";
      if (kind === "chat") {
        const runtime = new ChatRuntime(
          new ChatExecution(new OriginalChats(f.p)),
          {
            nativeHttp: async (url, init) => {
              assert.equal(url.pathname, originPath + "chat/completions");
              assert.equal(JSON.parse(String(init.body)).model, upstream);
              return {
                status: 200,
                contentType: "text/event-stream",
                body: Buffer.from(
                  'data: {"choices":[{"delta":{"content":"晨光"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
                ),
              };
            },
          },
        );
        await runtime.execute(rows[0].id);
        await runtime.close();
      } else {
        const runner = new Executor(f.p, async (url, init) => {
          assert.equal(
            url.pathname,
            originPath + (kind === "image" ? "images/generations" : "videos"),
          );
          if (kind === "image") {
            assert.equal(JSON.parse(String(init.body)).model, upstream);
            return {
              status: 200,
              contentType: "application/json",
              body: Buffer.from(
                JSON.stringify({
                  data: [{ b64_json: pixel.toString("base64") }],
                }),
              ),
            };
          }
          // A definite upstream rejection must settle the real selected video route without a charge.
          return {
            status: 400,
            contentType: "application/json",
            body: Buffer.from('{"error":"unsupported sample"}'),
          };
        });
        await runner.execute(rows[0].id);
      }
      const latest = (await ok("GET", "")).publications
        .find((p: any) => p.catalog_id === catalogId)
        .routes.find(
          (r: any) => r.route_revision_id === route.route_revision_id,
        );
      assert.equal(
        latest.health?.state,
        kind === "chat"
          ? "complete"
          : kind === "image"
            ? "completed"
            : "failed",
      );
      if (kind === "chat") {
        assert.equal(latest.health.missing_usage, 1);
        assert.ok(Date.parse(latest.health.last_missing_usage));
      }
    }
    const price =
      kind === "chat"
        ? {
            kind,
            input: "0",
            output: "0.000001",
            cache_read: null,
            cache_write: "0",
          }
        : { kind, unit: "3.25" };
    await ok("POST", "/publications", {
      uid: randomUUID(),
      items: [
        { action: "price", catalog_id: catalogId, expected_revision: 2, price },
      ],
    });
    const changed = (await ok("GET", "")).publications.find(
      (p: any) => p.catalog_id === catalogId,
    );
    assert.equal(changed.route_revision_id, pub.route_revision_id);
    assert.deepEqual(changed.price, price);
    for (const prior of replay)
      assert.deepEqual(await ok("POST", prior.path, prior.body), prior.result);
    const member = await identity.actor(memberCookie);
    await f.db.query(
      "UPDATE wallets SET balance=100 WHERE workspace_id=(SELECT id FROM workspaces WHERE public_id=$1)",
      [otherWorkspace],
    );
    let normalId;
    if (kind === "chat") {
      const chats = new OriginalChats(f.p);
      const chat = await chats.create(member, { model: catalogId });
      const normal = await chats.quote(member, {
        model: catalogId,
        text: "正常使用",
        cid: chat.conversation.id,
      });
      assert.equal(normal.route_revision, pub.route_revision_id);
      const turn = await chats.send(member, chat.conversation.id, {
        uid: randomUUID(),
        model: catalogId,
        text: "正常使用",
        expected_revision: chat.conversation.revision,
        ...normal,
      });
      normalId = turn.accepted_turn;
    } else {
      const root = await app.getUrl();
      const media = {
        model: catalogId,
        uid: randomUUID(),
        kind,
        prompt: "正常使用",
        ...(kind === "video" ? { params: { seconds: 4 } } : {}),
      };
      const headers = {
        Cookie: "fm_session=" + memberCookie,
        "Content-Type": "application/json",
      };
      const estimate = await fetch(root + "/api/estimate", {
        method: "POST",
        headers,
        body: JSON.stringify(media),
      });
      assert.equal(estimate.status, 200);
      const total = await estimate.json();
      const job = await fetch(
        root + (kind === "image" ? "/api/image-jobs" : "/api/jobs"),
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...media,
            price_revision: total.price_revision,
          }),
        },
      );
      assert.equal(job.status, 200);
      normalId = (await job.json()).id;
    }
    assert.equal(
      (
        await f.db.query(
          "SELECT route_revision_id FROM " +
            (kind === "chat" ? "chat_turns" : "jobs") +
            " WHERE public_id=$1",
          [normalId],
        )
      ).rows[0].route_revision_id,
      pub.route_revision_id,
    );
  }
});

test("选中十个视频沿用一次指定的连接默认格式，保留单个例外和逐项价格", async () => {
  const { draftPayload } =
    await import("../../apps/web/studio/model-access-editor.js");
  const rows = Array.from({ length: 10 }, (_, i) =>
    draftPayload(
      {
        upstream: "video-" + i,
        purpose: "video",
        unit: i === 0 ? "" : "0",
        protocol: i === 9 ? "openrouter-videos" : "",
        durations: i === 9 ? "4, 8, 30" : "4, 8",
      },
      { id: "conn", revision: 2 },
      "new-api-videos",
    ),
  );
  assert.equal(
    rows.filter((r) => r.overrides.protocol === "new-api-videos").length,
    9,
  );
  assert.equal(rows[0].price, null);
  assert.equal(rows[1].price, "0");
  assert.deepEqual(rows[9].overrides.durations, [4, 8, 30]);
  const chat = draftPayload(
    {
      upstream: "chat",
      purpose: "chat",
      input: "100",
      output: "400",
      cache_read: "0",
      cache_write: "",
    },
    { id: "conn", revision: 2 },
    "",
  );
  assert.deepEqual(chat.chat_prices, {
    input: "100",
    output: "400",
    cache_read: "0",
    cache_write: null,
  });
});

test("管理线路按来源展示生效版和最新备选版，历史修订不再占用切换入口", async () => {
  const editor = await import("../../apps/web/studio/model-access-editor.js");
  const rows = [
    { draft_id: "A", draft_revision: 1, route_revision_id: "A1" },
    { draft_id: "B", draft_revision: 1, route_revision_id: "B1" },
    { draft_id: "A", draft_revision: 3, route_revision_id: "A3" },
    { draft_id: "B", draft_revision: 2, route_revision_id: "B2" },
    { draft_id: "A", draft_revision: 2, route_revision_id: "A2" },
  ];
  assert.equal(typeof editor.groupRoutes, "function");
  function displayed(active: string) {
    return editor
      .groupRoutes(rows, active)
      .map(({ active, latest }) => [
        active?.route_revision_id ?? null,
        latest.route_revision_id,
      ]);
  }
  assert.deepEqual(displayed("B2"), [
    ["B2", "B2"],
    [null, "A3"],
  ]);
  assert.deepEqual(displayed("A1"), [
    ["A1", "A3"],
    [null, "B2"],
  ]);
});
