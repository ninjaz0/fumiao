import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { one } from "@fumiao/platform/db.js";
import { Executor } from "@fumiao/platform/executor.js";
import { ModelAccessConnections } from "@fumiao/platform/model-access/connections.js";
import { executeNativeImages } from "@fumiao/platform/model-access/images.js";
import { executeNativeVideos } from "@fumiao/platform/model-access/videos.js";
import type { HttpTransport } from "@fumiao/platform/plugin-host.js";
import { ChatExecution } from "@fumiao/original-api/chat-execution.js";
import { OriginalCanvases } from "@fumiao/original-api/canvases.js";
import { executeChatTool, type FrozenTool } from "@fumiao/original-api/chat-tools.js";
import { OriginalModelAccess } from "@fumiao/original-api/model-access.js";
import { OriginalApiTokens } from "@fumiao/original-api/tokens.js";
import { parseBody, ValidationError } from "@fumiao/original-api/validation.js";
import { OriginalMcpController } from "../../apps/api/src/original-mcp.js";
import { quoteFunded } from "../../apps/web/canvas-editor/chat/useChatQuote.js";
import { quote } from "../../apps/web/studio/state.js";
import { chatsFixture } from "../helpers/chats.js";

test("credits 字段校验同时接受 JSON 十进制数字与十进制字符串，拒绝指数计数法", () => {
  assert.deepEqual(
    parseBody({ amount: 0.25 }, { amount: { kind: "credits", min: 0 } }),
    { amount: "0.25" },
  );
  assert.deepEqual(
    parseBody({ amount: "0.2500" }, { amount: { kind: "credits", min: 0 } }),
    { amount: "0.25" },
  );
  assert.deepEqual(
    parseBody({ amount: 10 }, { amount: { kind: "credits", min: 0 } }),
    { amount: 10 },
  );
  assert.throws(
    () => parseBody({ amount: 1e-7 }, { amount: { kind: "credits", min: 0 } }),
    ValidationError,
  );
});

test("executeChatTool 阻止跨绑定画布与跨工作区画布读写绕过", async (t) => {
  const f = await chatsFixture();
  t.after(f.cleanup);

  // Give admin membership in a second workspace with its own canvas.
  const secondWs = await one(
    f.db,
    "INSERT INTO workspaces(id,name,owner_id,kind) VALUES($1,'第二工作区',$2,'team') RETURNING *",
    [randomUUID(), f.admin.id],
  );
  await f.db.query(
    "INSERT INTO members(workspace_id,user_id) VALUES($1,$2)",
    [secondWs.id, f.admin.id],
  );
  const canvases = new OriginalCanvases(f.p);
  const canvasA1 = await canvases.create(
    f.admin,
    { title: "A1" },
    f.workspace.public_id,
  );
  const canvasA2 = await canvases.create(
    f.admin,
    { title: "A2" },
    f.workspace.public_id,
  );
  const canvasB = await canvases.create(
    f.admin,
    { title: "B" },
    secondWs.public_id,
  );
  await canvases.save(f.admin, canvasB.id, {
    title: "B",
    expected_revision: canvasB.revision,
    document: {
      schemaVersion: 1,
      nodes: [
        {
          id: "text-node",
          type: "text",
          title: "原节点",
          x: 0,
          y: 0,
          width: 320,
          height: 240,
          text: "机密",
          prompt: "",
          narration_text: "",
          color: "none",
          params: {},
        } as any,
      ],
      edges: [],
    },
  });

  const created = await f.chats.create(
    f.admin,
    {},
    f.workspace.public_id,
  );
  const sent = await f.chats.send(
    f.admin,
    created.conversation.id,
    await f.draft(created),
    f.workspace.public_id,
  );
  const turnRow = await f.turn(sent.conversation.active_turn!);
  const lease = randomUUID();
  await f.db.query(
    "UPDATE chat_turns SET state='running',lease_token=$2,lease_until=$3 WHERE id=$1",
    [turnRow.id, lease, f.chats.clock() + 60],
  );

  const store = new ChatExecution(f.chats);
  const baseTool: Omit<FrozenTool, "builtin" | "boundProject"> = {
    plugin: "builtin",
    version: "1.0.0",
    declaration: {
      id: "read_canvas_graph",
      title: "read",
      audience: "member",
      description: "read",
      program: "builtin",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    model: {
      type: "function",
      function: {
        name: "fm_read_canvas_graph",
        description: "read",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
  };
  const call = {
    id: "call_1",
    type: "function" as const,
    function: { name: "fm_read_canvas_graph", arguments: "{}" },
  };

  // 1) Bound conversation cannot read a sibling canvas even in the same workspace.
  const wrongBound = JSON.parse(
    await executeChatTool(
      store,
      turnRow.id,
      lease,
      {
        ...baseTool,
        builtin: "read_canvas_graph",
        boundProject: canvasA1.id,
      },
      call,
      { project_id: canvasA2.id },
      new AbortController().signal,
    ),
  );
  assert.equal(wrongBound.ok, false);
  assert.equal(wrongBound.status, 403);
  assert.match(wrongBound.error, /绑定的画布/);

  // 2) Unbound conversation in workspace A cannot read/propose on workspace B's canvas,
  // even when the same user owns workspace B.
  const crossWsRead = JSON.parse(
    await executeChatTool(
      store,
      turnRow.id,
      lease,
      { ...baseTool, builtin: "read_canvas_graph" },
      call,
      { project_id: canvasB.id },
      new AbortController().signal,
    ),
  );
  assert.equal(crossWsRead.ok, false);
  assert.equal(crossWsRead.status, 403);
  assert.match(crossWsRead.error, /不属于当前对话所在工作区/);

  const crossWsPropose = JSON.parse(
    await executeChatTool(
      store,
      turnRow.id,
      lease,
      { ...baseTool, builtin: "propose_canvas_changes" },
      call,
      {
        project_id: canvasB.id,
        title: "越权提案",
        operations_json: JSON.stringify([
          { op: "update_node", id: "text-node", patch: { text: "篡改" } },
        ]),
      },
      new AbortController().signal,
    ),
  );
  assert.equal(crossWsPropose.ok, false);
  assert.equal(crossWsPropose.status, 403);
  assert.match(crossWsPropose.error, /不属于当前对话所在工作区/);
});

test("内置模型连接默认支持并发执行，且超过 4 小时未拿到成片的重试转为人工核查", async (t) => {
  const f = await chatsFixture();
  t.after(f.cleanup);
  const api = new OriginalModelAccess(f.identity);
  const connections = new ModelAccessConnections(f.db, f.p);

  const conn = await connections.create({
    base_url: "https://1.1.1.1/v1",
    api_key: "synthetic-video-key",
    default_video_protocol: "new-api-videos",
  });
  const connRow = await one(
    f.db,
    "SELECT concurrency FROM connections WHERE id=$1",
    [conn.id],
  );
  assert.ok(
    Number(connRow.concurrency) >= 8,
    `expected builtin concurrency >= 8, got ${connRow.concurrency}`,
  );

  // Publish both a video model and an image model on this connection.
  const videoDraft = randomUUID();
  await connections.saveDraft(videoDraft, {
    expected_revision: 0,
    connection_id: conn.id,
    connection_revision: 1,
    upstream_id: "movie",
    purpose: "video",
    price: "3",
    overrides: {
      durations: [4],
      frame_images: ["first_frame"],
      sizes: ["160x96"],
    },
  });
  const imageDraft = randomUUID();
  await connections.saveDraft(imageDraft, {
    expected_revision: 0,
    connection_id: conn.id,
    connection_revision: 1,
    upstream_id: "paint",
    purpose: "image",
    price: "0.25",
  });
  const pub = await api.publish(f.admin, {
    uid: randomUUID(),
    items: [
      { draft_id: videoDraft, draft_revision: 1, action: "create" },
      { draft_id: imageDraft, draft_revision: 1, action: "create" },
    ],
  });
  const videoModel = pub.items[0].catalog_id;
  const imageModel = pub.items[1].catalog_id;

  const admit = async (kind: "video" | "image", model: string) => {
    const params = kind === "video" ? { seconds: 4 } : {};
    const price_revision = (
      await one(f.db, "SELECT price_revision FROM studio_policy")
    ).price_revision;
    const body =
      kind === "video"
        ? { model, kind: "video", params, refs: [], uid: randomUUID(), prompt: "测试", price_revision }
        : { model, params, uid: randomUUID(), prompt: "测试", price_revision };
    const res = await f.request(
      "POST",
      kind === "video" ? "/api/jobs" : "/api/image-jobs",
      body,
      1,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [res.body.id]);
  };

  // Two video jobs can enter running concurrently without blocking each other at concurrency=1.
  const v1 = await admit("video", videoModel);
  const v2 = await admit("video", videoModel);
  const submitHttp: HttpTransport<string | Uint8Array> = async (url, init) => ({
    status: 200,
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify(
        init.method === "POST"
          ? { id: "vid_" + randomUUID() }
          : { id: url.pathname.split("/").pop(), status: "in_progress" },
      ),
    ),
  });
  const worker = new Executor(f.p, submitHttp);
  await worker.execute(v1.id);
  await worker.execute(v2.id);
  assert.equal((await one(f.db, "SELECT state FROM jobs WHERE id=$1", [v1.id])).state, "running");
  assert.equal((await one(f.db, "SELECT state FROM jobs WHERE id=$1", [v2.id])).state, "running");

  // Backdate v1 beyond 4 hours and verify polling still-in-progress escalates to uncertain.
  await f.db.query(
    "UPDATE jobs SET created_at=now()-interval '5 hours',request_retry_at=NULL WHERE id=$1",
    [v1.id],
  );
  await worker.execute(v1.id);
  const staleVideo = await one(
    f.db,
    "SELECT state,request_uncertain,request_retry_at FROM jobs WHERE id=$1",
    [v1.id],
  );
  assert.equal(staleVideo.state, "uncertain");
  assert.equal(staleVideo.request_uncertain, true);
  assert.equal(staleVideo.request_retry_at, null);

  // Image job with receipt whose external URL download fails after >4h with 0 staged outputs also escalates to uncertain.
  const img = await admit("image", imageModel);
  const leasedImg = await one(
    f.db,
    `UPDATE jobs SET state='finalizing',lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds',
     created_at=now()-interval '5 hours',receipt=$2 WHERE id=$1 RETURNING *`,
    [img.id, JSON.stringify({ outputs: [{ url: "https://1.1.1.1/out.png" }] })],
  );
  await executeNativeImages(
    f.p,
    leasedImg,
    new AbortController().signal,
    async () => ({
      status: 503,
      contentType: "text/plain",
      body: Buffer.from("unavailable"),
    }),
  );
  const staleImg = await one(
    f.db,
    "SELECT state,request_uncertain,request_retry_at FROM jobs WHERE id=$1",
    [img.id],
  );
  assert.equal(staleImg.state, "uncertain");
  assert.equal(staleImg.request_uncertain, true);
  assert.equal(staleImg.request_retry_at, null);
});

test("executeNativeVideos 完成后立即唤醒尾帧子任务并同步 original_view.refs", async (t) => {
  const f = await chatsFixture();
  t.after(f.cleanup);
  const api = new OriginalModelAccess(f.identity);
  const connections = new ModelAccessConnections(f.db, f.p);
  const conn = await connections.create({
    base_url: "https://1.1.1.1/v1",
    api_key: "synthetic-video-key",
    default_video_protocol: "new-api-videos",
  });
  const draftId = randomUUID();
  await connections.saveDraft(draftId, {
    expected_revision: 0,
    connection_id: conn.id,
    connection_revision: 1,
    upstream_id: "movie",
    purpose: "video",
    price: "3",
    overrides: {
      durations: [4],
      frame_images: ["first_frame"],
      sizes: ["160x96"],
    },
  });
  const pub = await api.publish(f.admin, {
    uid: randomUUID(),
    items: [{ draft_id: draftId, draft_revision: 1, action: "create" }],
  });
  const videoModel = pub.items[0].catalog_id;

  const dir = await mkdtemp(join(tmpdir(), "video-tail-fix-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const mp4Path = join(dir, "clip.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x96:rate=25",
    "-t",
    "3.8",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-bf",
    "0",
    "-movflags",
    "+faststart",
    mp4Path,
  ]);
  const mp4Bytes = await readFile(mp4Path);

  const admit = async (prompt: string) => {
    const body = {
      model: videoModel,
      kind: "video",
      params: { seconds: 4 },
      refs: [],
      uid: randomUUID(),
      prompt,
    };
    const quote = await f.request("POST", "/api/estimate", body, 1);
    const res = await f.request(
      "POST",
      "/api/jobs",
      { ...body, price_revision: quote.body.price_revision },
      1,
    );
    assert.equal(res.status, 200);
    return one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [res.body.id]);
  };

  const parent = await admit("父镜头");
  const child = await admit("子镜头");
  await f.db.query(
    "INSERT INTO job_tail_chains(parent_job_id,child_job_id) VALUES($1,$2)",
    [parent.id, child.id],
  );

  const http: HttpTransport<string | Uint8Array> = async (url, init) => {
    if (init.method === "POST") {
      return {
        status: 200,
        contentType: "application/json",
        body: Buffer.from(JSON.stringify({ id: "remote_parent" })),
      };
    }
    if (url.pathname.endsWith("/content")) {
      return { status: 200, contentType: "video/mp4", body: mp4Bytes };
    }
    return {
      status: 200,
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({ id: "remote_parent", status: "completed" }),
      ),
    };
  };

  // Run parent through submission -> completion via executeNativeVideos directly (WITHOUT Executor.recover()).
  const leaseAndRun = async () => {
    const leasedParent = await one(
      f.db,
      `UPDATE jobs SET lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds',
       state=CASE WHEN state='queued' THEN 'dispatching' ELSE state END,request_retry_at=NULL
       WHERE id=$1 RETURNING *`,
      [parent.id],
    );
    await executeNativeVideos(
      f.p,
      leasedParent,
      new AbortController().signal,
      http,
    );
  };
  await leaseAndRun();
  await leaseAndRun();

  const finishedParent = await one(
    f.db,
    "SELECT state FROM jobs WHERE id=$1",
    [parent.id],
  );
  assert.equal(finishedParent.state, "completed");

  const remainingChains = await f.db.query(
    "SELECT 1 FROM job_tail_chains WHERE child_job_id=$1",
    [child.id],
  );
  assert.equal(
    remainingChains.rows.length,
    0,
    "parent completion should immediately wake tail-frame child without waiting for recover()",
  );

  const updatedChild = await one(
    f.db,
    "SELECT input,original_view FROM jobs WHERE id=$1",
    [child.id],
  );
  assert.equal(updatedChild.input.references.length, 1);
  const tailAsset = await one(
    f.db,
    "SELECT public_id FROM assets WHERE id=$1",
    [updatedChild.input.references[0]],
  );
  assert.deepEqual(updatedChild.original_view.refs, [tailAsset.public_id]);
});

test("前端精确积分判断与 MCP get_job_status 返回 exact_price", async (t) => {
  // 1) quote uses exact.available when present instead of rounded integer credits.available
  const stateWithHalfCredit: any = {
    model_forms: {
      "demo-audio": {
        parameterObject: true,
        fields: {},
        tiers: [{ tier: "base", when: {} }],
      },
    },
    pricing: {
      revision: 1,
      items: [{ key: "demo-audio|base", model: "demo-audio", amount: 1 }],
    },
    credits: {
      available: 1, // display-rounded integer would falsely look sufficient
      exact: { available: "0.5", held: "0", balance: "0.5" },
    },
  };
  const draftPrice = quote(
    stateWithHalfCredit,
    { kind: "image", model: "demo-audio", prompt: "hi", params: {} } as any,
  );
  assert.equal(draftPrice.allowed, false);
  assert.match(draftPrice.label, /余额不足/);

  // 2) quoteFunded uses creditUnits accurately
  assert.equal(quoteFunded("0.25", 0, "0.25"), true);
  assert.equal(quoteFunded("0.249999999999", 1, "0.25"), false);

  // 3) MCP get_job_status returns exact_price alongside numeric price
  const f = await chatsFixture();
  t.after(f.cleanup);
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#335577" },
  })
    .png()
    .toBuffer();
  void png;
  const api = new OriginalModelAccess(f.identity);
  const connections = new ModelAccessConnections(f.db, f.p);
  const conn = await connections.create({
    base_url: "https://1.1.1.1/v1",
    api_key: "synthetic-img-key",
  });
  const draftId = randomUUID();
  await connections.saveDraft(draftId, {
    expected_revision: 0,
    connection_id: conn.id,
    connection_revision: 1,
    upstream_id: "paint",
    purpose: "image",
    price: "0.25",
  });
  const pub = await api.publish(f.admin, {
    uid: randomUUID(),
    items: [{ draft_id: draftId, draft_revision: 1, action: "create" }],
  });
  const imageModel = pub.items[0].catalog_id;
  const price_revision = (
    await one(f.db, "SELECT price_revision FROM studio_policy")
  ).price_revision;
  const createdJob = await f.request(
    "POST",
    "/api/image-jobs",
    {
      model: imageModel,
      params: {},
      uid: randomUUID(),
      prompt: "p",
      price_revision,
    },
    1,
  );
  assert.equal(createdJob.status, 200, JSON.stringify(createdJob.body));

  const tokens = new OriginalApiTokens(f.p);
  const issued = await tokens.create(
    f.member,
    {
      name: "mcp-test",
      scopes: ["mcp:use", "job:read"],
    },
    f.memberSpace.public_id,
  );
  const mcp = new OriginalMcpController(f.identity);
  const req: any = {
    headers: {
      authorization: `Bearer ${issued.token}`,
      "x-workspace-id": String(f.memberSpace.public_id),
    },
    get(name: string) {
      return this.headers[name.toLowerCase()];
    },
  };
  let rpcPayload: any;
  const res: any = {
    setHeader() {},
    status() {
      return this;
    },
    json(body: any) {
      rpcPayload = body;
      return this;
    },
  };
  await mcp.handlePost(
    req,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_job_status",
        arguments: { job_id: createdJob.body.id },
      },
    },
    res,
  );
  const statusResult = JSON.parse(rpcPayload.result.content[0].text);
  assert.equal(statusResult.price, 0.25);
  assert.equal(statusResult.exact_price, "0.25");
});
