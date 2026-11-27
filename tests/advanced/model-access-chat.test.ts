import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ChatExecution } from "@fumiao/original-api/chat-execution.js";
import { ChatRuntime } from "@fumiao/original-api/chat-runtime.js";
import { one } from "@fumiao/platform/db.js";
import { computeScopeSpend } from "@fumiao/platform/budgets.js";
import { chatsFixture } from "../helpers/chats.js";
import { OriginalModelAccess } from "@fumiao/original-api/model-access.js";

const price = {
  kind: "chat" as const,
  input: "100",
  output: "400",
  cache_read: "20",
  cache_write: null,
};
const rawUsage = {
  prompt_tokens: 10000,
  completion_tokens: 500,
  prompt_tokens_details: { cached_tokens: 7000, cache_write_tokens: 1000 },
};
test("缓存别名、缺失与四项精确实扣", async () => {
  const { normalizeChatUsage, chatBill } =
    await import("@fumiao/platform/model-access/chat.js");
  const usage = normalizeChatUsage(rawUsage);
  assert.deepEqual(usage, {
    input: 2000n,
    cacheRead: 7000n,
    cacheWrite: 1000n,
    output: 500n,
  });
  const bill = chatBill(price, [usage], "10", "complete");
  assert.deepEqual(
    bill.lines.map((x) => x.subtotal),
    ["0.2", "0.14", "0.1", "0.2"],
  );
  assert.equal(bill.charged, "0.64");
  assert.equal(
    chatBill({ ...price, cache_write: "0" }, [usage], "10", "complete").lines[2]
      .subtotal,
    "0",
  );
  assert.equal(chatBill(price, [null], "10", "complete").charged, "0");
  assert.equal(
    normalizeChatUsage({ ...rawUsage, prompt_cache_hit_tokens: 6999 }),
    null,
  );
  assert.deepEqual(
    normalizeChatUsage({
      ...rawUsage,
      prompt_cache_hit_tokens: 7000,
      prompt_cache_miss_tokens: 3000,
    }),
    usage,
  );
  assert.deepEqual(
    normalizeChatUsage({
      prompt_cache_hit_tokens: 7000,
      prompt_cache_miss_tokens: 3000,
      completion_tokens: 500,
    }),
    { input: 3000n, cacheRead: 7000n, cacheWrite: 0n, output: 500n },
  );
  assert.equal(
    normalizeChatUsage({ ...rawUsage, completion_tokens: -1 }),
    null,
  );
});

test("正式 HTTP 报价后冻结上游、执行真实对话协议，按回执结清并保留历史", async (t) => {
  const f = await chatsFixture();
  t.after(f.cleanup);
  const api = new OriginalModelAccess(f.identity);
  const conn = await api.create(f.admin, {
    base_url: "https://1.1.1.1/v1",
    api_key: "synthetic-only",
  });
  const draft_id = randomUUID();
  await api.saveDraft(f.admin, draft_id, {
    expected_revision: 0,
    connection_id: conn.id,
    connection_revision: 1,
    upstream_id: "upstream-chat",
    purpose: "chat",
    chat_prices: { input: "100", output: "400", cache_read: "20" },
  });
  const published = await api.publish(f.admin, {
    uid: randomUUID(),
    items: [{ draft_id, draft_revision: 1, action: "create" }],
  });
  const model = published.items[0].catalog_id;
  async function call(path: string, body?: unknown, actor = 0) {
    const r = await f.request(body ? "POST" : "GET", path, body, actor);
    return { status: r.status, data: r.body };
  }
  const created = await f.chats.create(f.admin, { model: "deepseek-flash" });
  const cid = created.conversation.id;
  const legacy = await f.chats.send(f.admin, cid, await f.draft(created));
  await f.chats.finish((await f.turn(legacy.conversation.active_turn)).id, {
    state: "complete",
    text: "固定价回复",
  });
  const before = await f.chats.get(f.admin, cid);
  const quote = await call("/api/chat/quote", { cid, model, text: "测试" });
  assert.equal(quote.status, 200, JSON.stringify(quote.data));
  const body = {
    ...quote.data,
    expected_revision: before.conversation.revision,
    uid: randomUUID(),
    text: "测试",
    model,
  };
  const sent = await call("/api/chats/" + cid + "/messages", body);
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(
    (await call("/api/chats/" + cid + "/messages", body)).status,
    200,
  );
  const turn = await f.turn(sent.data.conversation.active_turn);
  await api.edit(f.admin, conn.id, { expected_revision: 1, enabled: false });
  const requests: any[] = [];
  const runtime = new ChatRuntime(new ChatExecution(f.chats), {
    nativeHttp: async (url, init) => {
      assert.equal(url.href, "https://1.1.1.1/v1/chat/completions");
      const payload = JSON.parse(String(init.body));
      requests.push(payload);
      assert.equal(payload.model, "upstream-chat");
      assert.equal(payload.max_tokens, quote.data.max_output_tokens);
      assert.equal(payload.messages.at(-2).content, "固定价回复");
      return {
        status: 200,
        contentType: "text/event-stream",
        body: Buffer.from(
          [
            {
              usage: { prompt_tokens: 20, completion_tokens: 1 },
              choices: [{ delta: { content: "交付" }, finish_reason: "stop" }],
            },
            { choices: [], usage: rawUsage },
          ]
            .map((e) => "data: " + JSON.stringify(e) + "\r\n\r\n")
            .join("") + "data: [DONE]\r\n\r\n",
        ),
      };
    },
  });
  await runtime.execute(turn.id);
  await runtime.close();
  assert.equal(requests.length, 1);
  const bills = (await call("/api/chats/" + cid + "/bills")).data.bills;
  assert.deepEqual(
    bills.map((b: any) => [b.kind, b.charged]),
    [
      ["fixed", "1"],
      ["token", "0.64"],
    ],
  );
  assert.equal(bills[0].usage, null);
  assert.equal(bills[1].held, quote.data.max_charge);
  const ledger = await f.db.query(
    "SELECT action,amount::text,held_snapshot::text FROM ledger WHERE chat_turn_id=$1 ORDER BY action",
    [turn.id],
  );
  assert.equal(ledger.rows.length, 2);
  assert.equal(ledger.rows[1].amount, "0.640000000000");
  assert.equal(ledger.rows[1].held_snapshot, "0.000000000000");
  assert.ok(
    [403, 404].includes(
      (await call("/api/chats/" + cid + "/bills", undefined, 1)).status,
    ),
  );
});

async function setupNative(
  t: test.TestContext,
  options: {
    free?: boolean;
    tools?: boolean;
    json?: boolean;
    credential?: string;
  } = {},
) {
  const f = await chatsFixture();
  t.after(f.cleanup);
  const api = new OriginalModelAccess(f.identity);
  const conn = await api.create(f.admin, {
    base_url: "https://1.1.1.1/chat",
    api_key: options.credential ?? "synthetic-only",
  });
  const draft_id = randomUUID();
  const prices = options.free
    ? { input: "0", output: "0" }
    : { input: "100", output: "400", cache_read: "20" };
  await api.saveDraft(f.admin, draft_id, {
    expected_revision: 0,
    connection_id: conn.id,
    connection_revision: 1,
    upstream_id: "gateway-model",
    purpose: "chat",
    chat_prices: prices,
    overrides: {
      tools: options.tools ?? false,
      chat_response: options.json ? "json" : "stream",
    },
  });
  const published = await api.publish(f.admin, {
    uid: randomUUID(),
    items: [{ draft_id, draft_revision: 1, action: "create" }],
  });
  return { ...f, model: published.items[0].catalog_id };
}
test("工具轮次使用冻结技能和真实工具结果，缺失回执按次免收，自动标题由平台支付", async (t) => {
  const f = await setupNative(t, { tools: true, json: true });
  const created = await f.request("POST", "/api/canvases", {
    title: "验收画布",
  });
  assert.equal(created.status, 200);
  const canvas = await one(f.db, "SELECT * FROM documents WHERE public_id=$1", [
    created.body.id,
  ]);
  const context = {
    project: canvas.public_id,
    expected_revision: canvas.revision,
  };
  const spec = { text: "请整理镜头", model: f.model, context };
  const first = await f.chats.quote(f.admin, { ...spec, cid: null });
  const conversation = (
    await f.chats.create(f.admin, { model: f.model, context })
  ).conversation;
  const uid = randomUUID();
  const body = {
    ...spec,
    ...first,
    uid,
    expected_revision: conversation.revision,
  };
  await f.db.query(
    "INSERT INTO workspace_skills(id,public_id,workspace_id,owner_id,slug,name,body_md) VALUES($1,'skill',$2,$3,'test','镜头','取景规范')",
    [randomUUID(), f.workspace.id, f.admin.id],
  );
  await assert.rejects(
    f.chats.send(f.admin, conversation.id, body),
    /报价已更新/,
  );
  const quote = await f.chats.quote(f.admin, { ...spec, cid: conversation.id });
  const sent = await f.chats.send(f.admin, conversation.id, {
    ...body,
    ...quote,
  });
  const turn = await f.turn(sent.conversation.active_turn);
  assert.equal(
    (await computeScopeSpend(f.db, "project", canvas.public_id, "total")).exact
      .held,
    quote.max_charge,
  );
  assert.equal(
    (await computeScopeSpend(f.db, "workspace", f.workspace.id, "total")).exact
      .held,
    quote.max_charge,
  );
  await f.db.query("UPDATE workspace_skills SET body_md='受理后修改'");
  const payloads: any[] = [];
  const runtime = new ChatRuntime(new ChatExecution(f.chats), {
    nativeHttp: async (_url, init) => {
      const p = JSON.parse(String(init.body));
      payloads.push(p);
      let message: any,
        reason = "stop",
        usage: unknown;
      if (payloads.length === 1) {
        assert.match(p.messages[0].content, /取景规范/);
        assert.equal(p.stream, false);
        assert.ok(
          p.tools.some(
            (tool: any) => tool.function.name === "fm_read_canvas_graph",
          ),
        );
        message = {
          tool_calls: [
            {
              id: "read",
              type: "function",
              function: { name: "fm_read_canvas_graph", arguments: "{}" },
            },
          ],
        };
        reason = "tool_calls";
      } else if (payloads.length === 2) {
        assert.equal(p.messages.at(-1).role, "tool");
        assert.ok(JSON.parse(p.messages.at(-1).content).ok);
        assert.ok(p.max_tokens < payloads[0].max_tokens);
        message = { content: "工具完成" };
        usage = rawUsage;
      } else {
        message = { content: "分镜标题" };
        usage = { prompt_tokens: 999999, completion_tokens: 100 };
      }
      return {
        status: 200,
        contentType: "application/json",
        body: Buffer.from(
          JSON.stringify({
            usage,
            choices: [{ message, finish_reason: reason }],
          }),
        ),
      };
    },
  });
  await runtime.execute(turn.id);
  await runtime.close();
  const snapshot = await f.chats.get(f.admin, conversation.id);
  assert.equal(
    snapshot.messages.at(-1)?.state,
    "complete",
    JSON.stringify(snapshot.messages.at(-1)),
  );
  assert.equal(snapshot.conversation.title, "分镜标题");
  assert.equal(payloads.length, 3);
  const bill = (await f.chats.bills(f.admin, conversation.id)).bills[0];
  assert.equal(bill.charged, "0.64");
  assert.equal(bill.calls.length, 2);
  assert.match(bill.calls[0].reason, /未计费/);
  assert.deepEqual(
    (await computeScopeSpend(f.db, "project", canvas.id, "total")).exact,
    { held: "0", spent: "0.64", committed: "0.64" },
  );
});

test("零价零余额、失效租约与停止，重试后旧账单仍可读", async (t) => {
  const f = await setupNative(t, { free: true, json: true });
  await f.db.query("UPDATE wallets SET balance=0");
  const cid = (await f.chats.create(f.admin, { model: f.model })).conversation
    .id;
  const exec = new ChatExecution(f.chats);
  async function send(retry?: number) {
    const draft = {
      cid,
      model: f.model,
      ...(retry ? { retry } : { text: "零元回复" }),
    };
    const quote = await f.chats.quote(f.admin, draft);
    assert.equal(quote.max_charge, "0");
    const sent = await f.chats.send(f.admin, cid, {
      model: f.model,
      text: "text" in draft ? draft.text : "",
      retry: retry ?? null,
      ...quote,
      expected_revision: (await f.chats.get(f.admin, cid)).conversation
        .revision,
      uid: randomUUID(),
    });
    return f.turn(sent.conversation.active_turn);
  }
  const first = await send();
  const claim = await exec.claim(first.id);
  f.setTime(1800001000);
  assert.equal(
    await f.chats.finish(
      first.id,
      { state: "complete", text: "晚到" },
      claim!.lease,
    ),
    false,
  );
  assert.equal(await exec.recover(), 1);
  const stopped = await send(
    (await f.chats.get(f.admin, cid)).messages.at(-1)!.id,
  );
  await f.chats.stop(f.admin, cid);
  assert.equal(await f.chats.finish(stopped.id, { state: "complete" }), false);
  const retry = await send(
    (await f.chats.get(f.admin, cid)).messages.at(-1)!.id,
  );
  const runtime = new ChatRuntime(exec, {
    nativeHttp: async () => ({
      status: 200,
      contentType: "application/json",
      body: Buffer.from(
        '{"choices":[{"message":{"content":"已交付"},"finish_reason":"stop"}]}',
      ),
    }),
  });
  await runtime.execute(retry.id);
  await runtime.close();
  const bills = (await f.chats.bills(f.admin, cid)).bills;
  assert.deepEqual(
    bills.map((b) => [b.state, b.charged, b.superseded]),
    [
      ["interrupted", "0", true],
      ["stopped", "0", true],
      ["complete", "0", false],
    ],
  );
  assert.equal(bills[2].calls[0].usage, null);
  assert.equal(
    (await f.chats.get(f.admin, cid)).messages.at(-1)?.content,
    "已交付",
  );
});

test("预算在预留前原子核算，工具第二次推理在额度用尽时不发送", async (t) => {
  const f = await setupNative(t, { tools: true, json: true });
  const created = await f.request("POST", "/api/canvases", { title: "预算" });
  const context = {
    project: created.body.id,
    expected_revision: created.body.revision,
  };
  const spec = { text: "整理画布", model: f.model, context };
  const a = await f.chats.create(f.admin, { model: f.model, context });
  const b = await f.chats.create(f.admin, { model: f.model, context });
  const quote = await f.chats.quote(f.admin, { ...spec, cid: null });
  await f.db.query(
    "INSERT INTO budget_policies(scope_type,scope_id,period,mode,cap_limit) VALUES('project',$1,'total','cap',$2)",
    [context.project, quote.max_charge],
  );
  const accepted = await Promise.allSettled(
    [a, b].map(({ conversation }) =>
      f.chats.send(f.admin, conversation.id, {
        ...spec,
        ...quote,
        uid: randomUUID(),
        expected_revision: conversation.revision,
      }),
    ),
  );
  assert.equal(accepted.filter((v) => v.status === "fulfilled").length, 1);
  const denied = accepted.find((v) => v.status === "rejected");
  assert.equal(denied?.reason.status, 402);
  const ok = accepted.find((v) => v.status === "fulfilled")!.value.conversation;
  const turn = await f.turn(ok.active_turn);
  let requests = 0;
  const runtime = new ChatRuntime(new ChatExecution(f.chats), {
    nativeHttp: async () => {
      requests++;
      return {
        status: 200,
        contentType: "application/json",
        body: Buffer.from(
          JSON.stringify({
            usage: { prompt_tokens: 999999, completion_tokens: 1 },
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  tool_calls: [
                    {
                      id: "read",
                      type: "function",
                      function: {
                        name: "fm_read_canvas_graph",
                        arguments: "{}",
                      },
                    },
                  ],
                },
              },
            ],
          }),
        ),
      };
    },
  });
  await runtime.execute(turn.id);
  await runtime.close();
  assert.equal(requests, 1);
  const message = (await f.chats.get(f.admin, ok.id)).messages.at(-1)!;
  assert.equal(message.state, "failed");
  assert.match(message.error!, /额度/);
  const bill = (await f.chats.bills(f.admin, ok.id)).bills[0];
  assert.equal(bill.charged, "0");
  assert.equal(bill.waived, "100.0003");
  assert.deepEqual(
    (await computeScopeSpend(f.db, "project", context.project, "total")).exact,
    { spent: "0", held: "0", committed: "0" },
  );
});

test("缓存时长与累计别名去重、精确封顶与余额/线路上限", async () => {
  const { chatBill, chatLimit, normalizeChatUsage } =
    await import("@fumiao/platform/model-access/chat.js");
  const { creditUnits } = await import("@fumiao/platform/credit-amount.js");
  const normalized = normalizeChatUsage({
    ...rawUsage,
    cache_creation: {
      ephemeral_5m_input_tokens: 400,
      ephemeral_1h_input_tokens: 600,
    },
  });
  assert.deepEqual(normalized, normalizeChatUsage(rawUsage));
  assert.equal(
    normalizeChatUsage({
      ...rawUsage,
      cache_creation: {
        ephemeral_5m_input_tokens: 401,
        ephemeral_1h_input_tokens: 600,
      },
    }),
    null,
  );
  assert.equal(normalizeChatUsage({ ...rawUsage, total_tokens: 10000 }), null);
  assert.equal(normalizeChatUsage({ ...rawUsage, input_tokens: 9999 }), null);
  assert.deepEqual(
    normalizeChatUsage({
      input_tokens: 10000,
      output_tokens: 500,
      input_tokens_details: rawUsage.prompt_tokens_details,
    }),
    normalized,
  );
  assert.equal(
    normalizeChatUsage({
      input_tokens: 10000,
      output_tokens: 500,
      cache_read_input_tokens: 7000,
    }),
    null,
  );
  assert.deepEqual(
    normalizeChatUsage({
      prompt_tokens: "9007199254740993",
      completion_tokens: 0,
    }),
    { input: 9007199254740993n, cacheRead: 0n, cacheWrite: 0n, output: 0n },
  );
  const bill = chatBill(
    price,
    [normalized, normalized, null],
    "0.800000000001",
    "complete",
  );
  assert.equal(bill.charged, "0.800000000001");
  assert.equal(bill.waived, "0.479999999999");
  const msg = [{ role: "user" as const, content: "hello" }];
  assert.equal(
    chatLimit(
      { ...price, output: "0" },
      { max_completion_tokens: 5000 },
      msg,
      [],
      creditUnits("1"),
    ).max_output_tokens,
    5000,
  );
  assert.equal(
    chatLimit(price, { max_completion_tokens: 52 }, msg, [], creditUnits("100"))
      .max_output_tokens,
    52,
  );
  const tight = chatLimit(
    { ...price, input: "0", cache_read: "0" },
    {},
    msg,
    [],
    creditUnits("0.0008"),
  );
  assert.deepEqual(tight, { max_output_tokens: 2, max_charge: "0.0008" });
});

test("原生正文、跨片段字段、工具和标题在写入前阻止凭据回显", async (t) => {
  const f = await setupNative(t, { free: true, tools: true });
  const canvas = await f.request("POST", "/api/canvases", { title: "测试" });
  const context = {
    project: canvas.body.id,
    expected_revision: canvas.body.revision,
  };
  for (const mode of [
    "stream",
    "json",
    "reason",
    "tools",
    "escapedArgs",
    "name",
    "id",
    "title",
    "safe",
  ]) {
    await t.test(mode, async () => {
      const conversation = (
        await f.chats.create(f.admin, { model: f.model, context })
      ).conversation;
      const spec = { model: f.model, context, text: "合成测试" };
      const quote = await f.chats.quote(f.admin, {
        ...spec,
        cid: conversation.id,
      });
      const accepted = await f.chats.send(f.admin, conversation.id, {
        ...spec,
        ...quote,
        expected_revision: conversation.revision,
        uid: randomUUID(),
      });
      const turn = await f.turn(accepted.conversation.active_turn);
      const store = new ChatExecution(f.chats);
      let exposed = false,
        calls = 0;
      const progress = store.progress.bind(store);
      const key = "synthetic-only";
      store.progress = async (...args) => {
        exposed ||= args[2].includes(key) || args[2].endsWith(key.slice(0, 6));
        return progress(...args);
      };
      const runtime = new ChatRuntime(store, {
        nativeHttp: async () => {
          calls++;
          const frame = (
            delta: unknown,
            finish_reason: string | null = null,
          ) => ({ choices: [{ delta, finish_reason }] });
          const json = (content: string, finish_reason = "stop") => ({
            status: 200,
            contentType: "application/json",
            body: Buffer.from(
              JSON.stringify({
                choices: [{ message: { content }, finish_reason }],
              }),
            ),
          });
          if (mode === "json" || (mode === "title" && calls === 2))
            return json(key);
          if (mode === "reason") return json("正常", key);
          if (mode === "safe" || mode === "title" || calls > 1)
            return json("正常");
          const fragments =
            mode === "escapedArgs"
              ? [
                  frame(
                    {
                      tool_calls: [
                        {
                          id: "graph",
                          index: 0,
                          type: "function",
                          function: {
                            name: "fm_read_canvas_graph",
                            arguments:
                              '{"project_id":"\\u0073' + key.slice(1) + '"}',
                          },
                        },
                      ],
                    },
                    "tool_calls",
                  ),
                ]
              : mode === "name" || mode === "id"
                ? [
                    frame({
                      tool_calls: [
                        {
                          id: mode === "id" ? key.slice(0, 6) : "graph",
                          index: 0,
                          type: "function",
                          function: {
                            name:
                              mode === "name"
                                ? key.slice(0, 6)
                                : "fm_read_canvas_graph",
                            arguments: "{}",
                          },
                        },
                      ],
                    }),
                    frame(
                      {
                        tool_calls: [
                          {
                            index: 0,
                            ...(mode === "id"
                              ? { id: key.slice(6) }
                              : { function: { name: key.slice(6) } }),
                          },
                        ],
                      },
                      "tool_calls",
                    ),
                  ]
                : mode === "tools"
                  ? [
                      frame({
                        tool_calls: [
                          {
                            id: "graph",
                            index: 0,
                            type: "function",
                            function: {
                              name: "fm_read_canvas_graph",
                              arguments: '{"project_id":"' + key.slice(0, 6),
                            },
                          },
                        ],
                      }),
                      frame(
                        {
                          tool_calls: [
                            {
                              index: 0,
                              function: { arguments: key.slice(6) + '"}' },
                            },
                          ],
                        },
                        "tool_calls",
                      ),
                    ]
                  : [
                      frame({ content: "正常" }),
                      frame({ content: key.slice(0, 6) }),
                      frame({ content: key.slice(6) }, "stop"),
                    ];
          return {
            status: 200,
            contentType: "text/event-stream",
            body: Buffer.from(
              fragments
                .map((v) => "data: " + JSON.stringify(v) + "\n\n")
                .join(""),
            ),
          };
        },
        monotonic: (() => {
          let time = 0;
          return () => ++time;
        })(),
      });
      await runtime.execute(turn.id);
      await runtime.close();
      const result = await f.chats.get(f.admin, conversation.id);
      assert.equal(
        exposed,
        false,
        "progress contained a credential or an unconfirmed suffix",
      );
      assert.equal(
        JSON.stringify(result).includes(key),
        false,
        "member-visible snapshot contained credential",
      );
      const ok = ["title", "safe"].includes(mode);
      assert.equal(result.messages.at(-1)?.state, ok ? "complete" : "failed");
      assert.equal(calls, ok ? 2 : 1);
      if (mode === "stream")
        assert.equal(result.messages.at(-1)?.content, "正常");
      if (mode === "safe") assert.equal(result.conversation.title, "正常");
    });
  }
});

test("058 旧画布预留与历史实扣在 059 升级后仍占用项目预算", async (t) => {
  const f = await chatsFixture("058_model_access_publications.sql");
  t.after(f.cleanup);
  const a = await f.canvas(),
    b = await f.canvas(),
    other = await f.canvas(f.member, f.memberSpace);
  const context = { project: a.public_id, expected_revision: a.revision };
  async function legacy(
    raw: string,
    link: Array<[string, number]>,
    complete = true,
  ) {
    const view = await f.chats.create(f.admin, {});
    const sent = await f.chats.send(
      f.admin,
      view.conversation.id,
      await f.draft(view),
    );
    const turn = await f.turn(sent.conversation.active_turn);
    await f.db.query("UPDATE chat_messages SET context=$2 WHERE id=$1", [
      turn.user_message,
      raw,
    ]);
    for (const [project, offset] of link)
      await f.db.query("INSERT INTO canvas_chat_links VALUES($1,'',$2,$3)", [
        project,
        turn.conversation_id,
        turn.created + offset,
      ]);
    if (complete)
      await f.chats.finish(turn.id, { state: "complete", text: "历史" });
    return turn;
  }
  const spent = await legacy(
    JSON.stringify({ project: a.public_id, text: "旧\u0000文本" }),
    [],
  );
  await f.db.query(
    "UPDATE ledger SET chat_turn_id=NULL WHERE chat_turn_id=$1",
    [spent.id],
  );
  const held = await legacy(
    "{}",
    [
      [a.id, -1],
      [b.id, 10],
    ],
    false,
  );
  const ambiguous = await legacy("{}", [
    [a.id, -1],
    [b.id, -1],
  ]);
  const invalid = await legacy("{malformed", []);
  const foreign = await legacy(
    JSON.stringify({ project: other.public_id }),
    [],
  );
  const { migrate } = await import("@fumiao/platform/db.js");
  await migrate(f.db);
  const charges = await f.db.query(
    "SELECT turn_id,project_id FROM chat_charges",
  );
  const attribution = Object.fromEntries(
    charges.rows.map((r) => [r.turn_id, r.project_id]),
  );
  assert.deepEqual(
    [spent, held, ambiguous, invalid, foreign].map((r) => attribution[r.id]),
    [a.id, a.id, null, null, null],
  );
  assert.deepEqual(
    (await computeScopeSpend(f.db, "project", a.id, "total")).exact,
    { held: "1", spent: "1", committed: "2" },
  );
  await f.db.query(
    "INSERT INTO budget_policies(scope_type,scope_id,period,mode,cap_limit) VALUES('project',$1,'total','cap',2)",
    [a.public_id],
  );
  const next = await f.chats.create(f.admin, { context });
  await assert.rejects(
    f.chats.send(
      f.admin,
      next.conversation.id,
      await f.draft(next, { context }),
    ),
    /预算上限/,
  );
  await f.chats.finish(held.id, { state: "complete", text: "完成" });
  assert.deepEqual(
    (await computeScopeSpend(f.db, "project", a.public_id, "total")).exact,
    { held: "0", spent: "2", committed: "2" },
  );
});

test("旧库画布链接与受理同一时间戳时只回填可证明的项目", async (t) => {
  const f = await chatsFixture("058_model_access_publications.sql");
  t.after(f.cleanup);
  const a = await f.canvas(),
    b = await f.canvas();
  const stamp = 1800000000.25;
  const cases = [
    {
      name: "受理后首次建立同时间戳链接",
      before: [],
      tied: [b],
      expected: null,
    },
    { name: "已有明确链接", before: [[a, -1]], tied: [], expected: a.id },
    {
      name: "最新已知链接与同时间戳链接冲突",
      before: [[a, -1]],
      tied: [b],
      expected: null,
    },
    {
      name: "仅最近的两种可能时间均指向同一项目",
      before: [
        [a, -2],
        [b, -1],
      ],
      tied: [b],
      expected: b.id,
    },
    {
      name: "同时间戳链接不能消除之前的归属歧义",
      before: [
        [a, -1],
        [b, -1],
      ],
      tied: [b],
      expected: null,
    },
    {
      name: "显式当轮项目优先",
      before: [],
      tied: [b],
      explicit: a,
      expected: a.id,
    },
  ] as const;
  const turns: string[] = [];
  for (const scenario of cases) {
    f.setTime(stamp - 5);
    const view = await f.chats.create(f.admin, {});
    const conversation = await one(
      f.db,
      "SELECT id FROM chat_conversations WHERE public_id=$1",
      [view.conversation.id],
    );
    let node = 0;
    const link = (project: typeof a, time: number) =>
      f.db.query(
        "INSERT INTO canvas_chat_links(project_id,node,conversation_id,created) VALUES($1,$2,$3,$4)",
        [project.id, "node-" + node++, conversation.id, time],
      );
    for (const [project, offset] of scenario.before)
      await link(project, stamp + offset);
    f.setTime(stamp);
    const extra =
      "explicit" in scenario
        ? {
            context: {
              project: scenario.explicit.public_id,
              expected_revision: scenario.explicit.revision,
            },
          }
        : {};
    const sent = await f.chats.send(
      f.admin,
      view.conversation.id,
      await f.draft(view, extra),
    );
    const turn = await f.turn(sent.conversation.active_turn);
    for (const project of scenario.tied) await link(project, turn.created);
    await f.chats.finish(turn.id, { state: "complete", text: "历史" });
    turns.push(turn.id);
  }
  const { migrate } = await import("@fumiao/platform/db.js");
  await migrate(f.db);
  const { rows } = await f.db.query(
    "SELECT turn_id,project_id FROM chat_charges",
  );
  const projects = new Map(rows.map((r) => [r.turn_id, r.project_id]));
  for (const [i, scenario] of cases.entries())
    await t.test(scenario.name, () =>
      assert.equal(projects.get(turns[i]), scenario.expected),
    );
});

test("原样重传已受理的画布请求可跨自动保存修订和零可用余额", async (t) => {
  const f = await setupNative(t);
  const canvas = await f.request("POST", "/api/canvases", { title: "重传" });
  const context = {
    project: canvas.body.id,
    expected_revision: canvas.body.revision,
  };
  const spec = { model: f.model, text: "保留请求", context };
  const base = await f.chats.create(f.admin, { model: f.model, context });
  const cid = base.conversation.id;
  const quote = await f.chats.quote(f.admin, { ...spec, cid });
  await f.db.query("UPDATE wallets SET balance=$2 WHERE workspace_id=$1", [
    f.workspace.id,
    quote.max_charge,
  ]);
  const body = {
    ...spec,
    ...quote,
    uid: randomUUID(),
    expected_revision: base.conversation.revision,
  };
  const original = await f.chats.send(f.admin, cid, body);
  await f.db.query(
    "UPDATE documents SET revision=revision+1 WHERE public_id=$1",
    [context.project],
  );
  const wallet = await one(
    f.db,
    "SELECT (balance-held)=0 AS empty FROM wallets WHERE workspace_id=$1",
    [f.workspace.id],
  );
  assert.ok(wallet.empty);
  await assert.rejects(
    f.chats.send(f.admin, cid, {
      ...body,
      context: { ...context, expected_revision: context.expected_revision + 1 },
    }),
    { status: 409 },
  );
  assert.deepEqual(await f.chats.send(f.admin, cid, body), original);
  const turn = await f.turn(original.conversation.active_turn);
  assert.equal(
    (
      await one(
        f.db,
        "SELECT COUNT(*)::int AS n FROM ledger WHERE chat_turn_id=$1",
        [turn.id],
      )
    ).n,
    1,
  );
  await f.chats.finish(turn.id, {
    state: "complete",
    text: "完成",
    calls: [{ input: 3n, cacheRead: 0n, cacheWrite: 0n, output: 1n }],
  });
  const replay = await f.chats.send(f.admin, cid, body);
  assert.equal(
    (replay as { accepted_turn?: string }).accepted_turn,
    turn.public_id,
  );
  assert.equal((await f.chats.bills(f.admin, cid)).bills.length, 1);
  assert.equal(
    (
      await one(
        f.db,
        "SELECT COUNT(*)::int AS n FROM ledger WHERE chat_turn_id=$1 AND action='spend'",
        [turn.id],
      )
    ).n,
    1,
  );
});

test("项目历史只沿用受理时最近的有效用户来源，旧库 hold 和 spend 升级后合计", async (t) => {
  const f = await chatsFixture("058_model_access_publications.sql");
  t.after(f.cleanup);
  const a = await f.canvas(),
    b = await f.canvas();
  const view = await f.chats.create(f.admin, {}),
    cid = view.conversation.id;
  async function send(project?: typeof a, finish = true) {
    const snapshot = await f.chats.get(f.admin, cid);
    const sent = await f.chats.send(
      f.admin,
      cid,
      await f.draft(
        snapshot,
        project
          ? {
              context: {
                project: project.public_id,
                expected_revision: project.revision,
              },
            }
          : {},
      ),
    );
    const turn = await f.turn(sent.conversation.active_turn);
    if (finish)
      await f.chats.finish(turn.id, { state: "complete", text: "旧回复" });
    return turn;
  }
  const empty = await send(),
    sourceA = await send(a),
    spent = await send(),
    sourceB = await send(b),
    held = await send(undefined, false);
  assert.equal(
    (await one(f.db, "SELECT count(*)::int AS n FROM canvas_chat_links")).n,
    0,
  );
  // Same-second ordering follows the original message sequence, never a future turn.
  // Exercise an installation which already ran the initial 059 schema before
  // receiving its independent project backfill.
  const initial = "059_model_access_chat.sql";
  const schema = await readFile("migrations/" + initial, "utf8");
  await f.db.transaction(async (sql) => {
    await sql.query(schema);
    await sql.query("INSERT INTO schema_migrations(version) VALUES($1)", [
      initial,
    ]);
  });
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*)::int AS n FROM chat_charges WHERE project_id IS NOT NULL",
      )
    ).n,
    0,
  );
  const { migrate } = await import("@fumiao/platform/db.js");
  await migrate(f.db);
  await migrate(f.db);
  const charges = (
    await f.db.query("SELECT turn_id,project_id FROM chat_charges")
  ).rows;
  const projects = new Map(charges.map((r) => [r.turn_id, r.project_id]));
  assert.deepEqual(
    [empty, sourceA, spent, sourceB, held].map((r) => projects.get(r.id)),
    [null, a.id, a.id, b.id, b.id],
  );
  assert.deepEqual(
    (await computeScopeSpend(f.db, "project", a.id, "total")).exact,
    { held: "0", spent: "2", committed: "2" },
  );
  assert.deepEqual(
    (await computeScopeSpend(f.db, "project", b.id, "total")).exact,
    { held: "1", spent: "1", committed: "2" },
  );
  await f.db.query(
    "INSERT INTO budget_policies(scope_type,scope_id,period,mode,cap_limit) VALUES('project',$1,'total','cap',2)",
    [b.public_id],
  );
  const fresh = await f.chats.create(f.admin, {});
  await assert.rejects(
    f.chats.send(
      f.admin,
      fresh.conversation.id,
      await f.draft(fresh, {
        context: { project: b.public_id, expected_revision: b.revision },
      }),
    ),
    /预算上限/,
  );
  await f.chats.finish(held.id, { state: "complete", text: "完成" });
  assert.deepEqual(
    (await computeScopeSpend(f.db, "project", b.id, "total")).exact,
    { held: "0", spent: "2", committed: "2" },
  );
});

test("旧固定价重放准确返回原回合，旧分镜消息来源按当前工作区授权", async (t) => {
  const f = await chatsFixture();
  t.after(f.cleanup);
  const chat = await f.chats.create(f.admin, {}),
    cid = chat.conversation.id;
  const { OriginalCanvases } = await import("@fumiao/original-api/canvases.js");
  const canvases = new OriginalCanvases(f.p);
  const canvas = await canvases.create(f.admin, { title: "固定价写回" });
  const saved = await canvases.save(f.admin, canvas.id, {
    title: canvas.title,
    expected_revision: canvas.revision,
    document: {
      nodes: [{ id: "draft", type: "text", text: "原文", x: 0, y: 0 }],
    },
  });
  const context = {
    project: canvas.id,
    node: "draft",
    expected_revision: saved.revision,
    writeback: true,
  };
  const original = await f.draft(chat, { context });
  const first = await f.request(
    "POST",
    "/api/chats/" + cid + "/messages",
    original,
  );
  assert.equal(first.status, 200);
  const turn = await f.turn(first.body.conversation.active_turn);
  await f.chats.finish(turn.id, { state: "complete", text: "原分镜" });
  const snapshot = await f.chats.get(f.admin, cid);
  const second = await f.chats.send(
    f.admin,
    cid,
    await f.draft(snapshot, { text: "下一条", context }),
  );
  await f.chats.finish((await f.turn(second.conversation.active_turn)).id, {
    state: "complete",
    text: "不应写入下一轮",
  });
  const third = await f.chats.send(
    f.admin,
    cid,
    await f.draft(await f.chats.get(f.admin, cid)),
  );
  await f.chats.finish((await f.turn(third.conversation.active_turn)).id, {
    state: "failed",
    text: "稍后再试",
  });
  const replay = await f.request(
    "POST",
    "/api/chats/" + cid + "/messages",
    original,
  );
  const message = snapshot.messages.at(-1)!.id;
  await t.test("受理与重传", () => {
    assert.equal(first.body.accepted_turn, turn.public_id);
    assert.equal(replay.body.accepted_turn, turn.public_id);
    assert.equal(
      replay.body.messages.find(
        (m: any) => m.turn === replay.body.accepted_turn,
      ).id,
      message,
    );
  });
  await t.test("确认原助手与画布修订，过期重放不覆盖画布", async () => {
    const reply = replay.body.messages.find(
      (m: any) => m.turn === replay.body.accepted_turn,
    );
    assert.equal(reply.id, message);
    const apply = {
      uid: randomUUID(),
      project: canvas.id,
      node: context.node,
      expected_revision: context.expected_revision,
      mode: "replace",
      expected_text: "原文",
      message: reply.id,
    };
    const result = await f.request(
      "POST",
      "/api/chats/" + cid + "/apply",
      apply,
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.document.nodes[0].text, "原分镜");
    const stale = await f.request("POST", "/api/chats/" + cid + "/apply", {
      ...apply,
      uid: randomUUID(),
    });
    assert.equal(stale.status, 409);
    assert.equal(
      (await canvases.get(f.admin, canvas.id)).document.nodes[0].text,
      "原分镜",
    );
    assert.equal(
      (await one(f.db, "SELECT count(*)::int AS n FROM chat_applications")).n,
      1,
    );
  });
  await t.test(
    "跨会话按准确助手消息取来源，其他工作区和非成功消息不可读",
    async () => {
      const other = await f.chats.create(f.admin, {});
      assert.notEqual(other.conversation.id, cid);
      const path = "/api/chat/messages/" + message + "/source";
      assert.deepEqual((await f.request("GET", path)).body, {
        cid,
        message,
        content: "原分镜",
      });
      assert.equal((await f.request("GET", path, undefined, 1)).status, 404);
      assert.equal(
        (await f.request("GET", path + "?workspace=" + f.memberSpace.public_id))
          .status,
        403,
      );
      for (const id of [
        snapshot.messages[0].id,
        replay.body.messages.at(-1).id,
        "bad",
      ])
        assert.equal(
          (await f.request("GET", "/api/chat/messages/" + id + "/source"))
            .status,
          404,
        );
      await f.chats.remove(f.admin, cid);
      assert.equal((await f.request("GET", path)).status, 404);
    },
  );
});

test("原生画布建议在写入前校验业务对象，拒绝时没有提案或画布变动", async (t) => {
  const f = await setupNative(t, { free: true, tools: true, json: true });
  const canvas = (
    await f.request("POST", "/api/canvases", { title: "建议校验" })
  ).body;
  const context = { project: canvas.id, expected_revision: canvas.revision };
  const { turnTools, executeChatTool } =
    await import("@fumiao/original-api/chat-tools.js");
  const spec = { model: f.model, text: "提议添加文字", context };
  const created = await f.chats.create(f.admin, { model: f.model, context });
  const cid = created.conversation.id,
    quote = await f.chats.quote(f.admin, { ...spec, cid });
  const sent = await f.chats.send(f.admin, cid, {
    ...spec,
    ...quote,
    expected_revision: created.conversation.revision,
    uid: randomUUID(),
  });
  const turn = await f.turn(sent.conversation.active_turn),
    store = new ChatExecution(f.chats),
    claim = await store.claim(turn.id);
  const tool = (await turnTools(f.db, turn.id, canvas.id)).get(
    "fm_propose_canvas_changes",
  )!;
  const operation = {
    op: "add_node",
    temp_id: "node",
    type: "text",
    text: "普通合成文字",
  };
  const args = {
    title: "测试建议",
    summary: "测试摘要",
    operations_json: JSON.stringify([operation]),
  };
  const call = {
    type: "function" as const,
    id: "test",
    function: {
      name: "fm_propose_canvas_changes",
      arguments: JSON.stringify(args),
    },
  };
  // Inject a rejecting policy over harmless data; this checks the write boundary
  // without asking any provider to emit a credential.
  let checked: unknown;
  const verify = (value: unknown) => {
    checked = value;
    throw new Error("拒绝合成样本");
  };
  await assert.rejects(
    executeChatTool(
      store,
      turn.id,
      claim!.lease,
      tool,
      call,
      args,
      AbortSignal.timeout(5000),
      verify,
    ),
  );
  assert.deepEqual(checked, {
    project_id: canvas.id,
    title: args.title,
    summary: args.summary,
    operations: [operation],
  });
  assert.equal(
    (await one(f.db, "SELECT count(*)::int AS n FROM canvas_proposals")).n,
    0,
  );
  assert.equal(
    (await f.request("GET", "/api/canvases/" + canvas.id)).body.revision,
    canvas.revision,
  );
  const accepted = await executeChatTool(
    store,
    turn.id,
    claim!.lease,
    tool,
    call,
    args,
    AbortSignal.timeout(5000),
  );
  assert.equal(JSON.parse(accepted).ok, true);
  assert.equal(
    (await one(f.db, "SELECT count(*)::int AS n FROM canvas_proposals")).n,
    1,
  );
});

test("原生执行器把同一凭据校验带入正规化后的提案，普通提案可正常交付", async (t) => {
  // The proposed node omits coordinates. The proposal service supplies zeros as
  // defaults, providing a synthetic policy match without an upstream echo.
  for (const guarded of [true, false])
    await t.test(guarded ? "拒绝" : "交付", async (t) => {
      const f = await setupNative(t, {
        free: true,
        tools: true,
        json: true,
        credential: guarded ? "0" : "ordinary-fixture",
      });
      const canvas = (
        await f.request("POST", "/api/canvases", { title: "原生建议" })
      ).body;
      const context = {
        project: canvas.id,
        expected_revision: canvas.revision,
      };
      const spec = { model: f.model, text: "生成建议", context };
      const cid = (await f.chats.create(f.admin, { model: f.model, context }))
        .conversation.id;
      const quote = await f.chats.quote(f.admin, { ...spec, cid });
      const accepted = await f.chats.send(f.admin, cid, {
        ...spec,
        ...quote,
        expected_revision: 1,
        uid: randomUUID(),
      });
      let requests = 0;
      const runtime = new ChatRuntime(new ChatExecution(f.chats), {
        nativeHttp: async () => {
          const first = ++requests === 1;
          const message = first
            ? {
                tool_calls: [
                  {
                    type: "function",
                    id: "suggest",
                    function: {
                      name: "fm_propose_canvas_changes",
                      arguments: JSON.stringify({
                        title: "正常建议",
                        operations_json: JSON.stringify([
                          { op: "add_node", type: "text", temp_id: "draft" },
                        ]),
                      }),
                    },
                  },
                ],
              }
            : { content: "已完成" };
          return {
            status: 200,
            contentType: "application/json",
            body: Buffer.from(
              JSON.stringify({
                choices: [
                  { message, finish_reason: first ? "tool_calls" : "stop" },
                ],
              }),
            ),
          };
        },
      });
      t.after(() => runtime.close());
      await runtime.execute(
        (await f.turn(accepted.conversation.active_turn)).id,
      );
      assert.equal(
        (await f.chats.get(f.admin, cid)).messages.at(-1)?.state,
        guarded ? "failed" : "complete",
      );
      assert.equal(
        (await one(f.db, "SELECT count(*)::int AS n FROM canvas_proposals")).n,
        guarded ? 0 : 1,
      );
      assert.equal(
        (await f.request("GET", "/api/canvases/" + canvas.id)).body.revision,
        canvas.revision,
      );
    });
});
