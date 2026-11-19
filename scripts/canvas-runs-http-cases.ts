import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Backend, request as send } from "./smoke-canvas-rest.js";
import type { canvasesFixture } from "../tests/helpers/canvases.js";
import { activateCanvasRunPlugins } from "../tests/helpers/canvas-runs.js";
import { gpuText } from "../plugins/gpu/src/text.js";
import { museText } from "../plugins/muse/src/text.js";
import { flowText } from "../plugins/flow/src/text.js";
import { imagesText } from "../plugins/images/src/text.js";

type Path = (backend: Backend) => string;
type Options = Parameters<typeof send>[3];
type Context = {
  f: Awaited<ReturnType<typeof canvasesFixture>>;
  original: Backend;
  target: Backend;
  runtime: string;
  python: string;
  team: string;
  personal: string;
  memberSpace: string;
  request: typeof send;
  compare: (
    label: string,
    method: string,
    path: Path | string,
    status: number,
    options?: Options,
    alias?: string,
  ) => Promise<any>;
  project: (alias: string, suffix?: string) => Path;
  checks: string[];
};

export async function verifyCanvasRunsHttp({
  f,
  original,
  target,
  runtime,
  python,
  team,
  personal,
  memberSpace,
  request,
  compare,
  project,
  checks,
}: Context) {
  const backends = [original, target];
  const data = join(runtime, "data");
  function sqlite(sql: string, parameters: unknown[] = []) {
    return JSON.parse(
      execFileSync(
        python,
        [
          "-c",
          "import json,sqlite3,sys\nwith sqlite3.connect(sys.argv[1]) as db:\n" +
            "    print(json.dumps(db.execute(sys.argv[2],json.loads(sys.argv[3])).fetchall()))",
          join(data, "studio.sqlite"),
          sql,
          JSON.stringify(parameters),
        ],
        { encoding: "utf8" },
      ),
    );
  }

  let providerRequests = 0;
  const provider = createServer((_req, res) => {
    providerRequests++;
    res
      .writeHead(503, { "Content-Type": "application/json" })
      .end('{"error":"fixture"}');
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const providerUrl =
    "http://127.0.0.1:" + (provider.address() as AddressInfo).port;
  try {
    await activateCanvasRunPlugins(f, providerUrl, [
      gpuText,
      museText,
      flowText,
      imagesText,
    ]);
    await Promise.all([
      writeFile(join(data, ".dispatch-paused"), ""),
      writeFile(
        join(data, "muse.env"),
        `FUMIAO_MUSE_URL=${providerUrl}\nFUMIAO_MUSE_KEY=canvas-fixture\n`,
      ),
      writeFile(
        join(data, "flow.env"),
        `FUMIAO_FLOW_URL=${providerUrl}\nFUMIAO_FLOW_KEY=canvas-fixture\n`,
      ),
    ]);
    sqlite("UPDATE credit_prices SET amount=2");
    sqlite("UPDATE settings SET value='17' WHERE key='credit_price_revision'");
    sqlite("UPDATE credit_accounts SET balance=100");
    await f.db.query("UPDATE studio_prices SET amount=2");
    await f.db.query("UPDATE studio_policy SET price_revision=17");
    await f.db.query("UPDATE wallets SET balance=100");

    const admin = { actor: "admin" } as const;
    const member = { actor: "member" } as const;
    const json = { contentType: "application/json" };
    const params = { seed: Number.MAX_SAFE_INTEGER };
    const video = {
      id: "v",
      type: "video",
      x: 0,
      y: 0,
      prompt: "\uFEFF画面 \0🎬\u0085",
      params,
      narration_text: "\u0085 旁白 \0🎙 \u0085",
      narration_instruction: "\u0085 自然 \u0085",
    };
    const muse = {
      id: "m",
      type: "video",
      x: 0,
      y: 0,
      prompt: "\uFEFFMuse \0",
      params: {
        model: "muse-video",
        seconds: 6,
        fast_mode: true,
      },
    };
    const image = {
      id: "i",
      type: "image",
      x: 0,
      y: 0,
      prompt: "图片",
      params: { model: "muse-image" },
    };
    for (const [alias, workspace] of [
      ["run-personal", personal],
      ["run-other", personal],
      ["run-team", team],
    ]) {
      await compare(
        "create " + alias,
        "POST",
        "/api/canvases",
        200,
        {
          ...admin,
          workspace,
          body: { title: alias },
        },
        alias,
      );
      await compare("save " + alias, "PUT", project(alias, "/document"), 200, {
        ...admin,
        body: {
          expected_revision: 1,
          title: alias,
          document: { nodes: [video, muse, image] },
        },
      });
    }

    const list = project("run-personal", "/runs");
    const path = (operation: string, alias = "run-personal", node = "v") =>
      project(alias, "/nodes/" + node + "/" + operation);
    const run = path("runs"),
      batch = path("candidates"),
      voice = path("narration");
    const valid = (uid = randomUUID()) => ({
      uid,
      expected_revision: 2,
      price_revision: 17,
    });

    await compare("runs list requires login", "GET", list, 401);
    await compare("runs list method precedes decoding", "POST", list, 405, {
      ...json,
      raw: "{",
    });
    await compare("runs list ignores selected workspace", "GET", list, 200, {
      ...admin,
      workspace: "invalid",
    });
    await compare("runs list checks private canvas", "GET", list, 404, member);
    for (const [operation, endpoint] of [
      ["runs", run],
      ["candidates", batch],
      ["narration", voice],
    ] as const) {
      await compare(
        operation + " origin precedes malformed JSON",
        "POST",
        endpoint,
        403,
        {
          ...json,
          raw: "{",
          origin: "https://forbidden.invalid",
        },
      );
      await compare(operation + " rejects HEAD", "HEAD", endpoint, 405);
      await compare(
        operation + " slash redirects before reading body",
        "POST",
        "/api/canvases/missing/nodes/v/" + operation + "/?x=1",
        307,
        {
          ...json,
          raw: "{",
        },
      );
      await compare(
        operation + " JSON syntax precedes auth",
        "POST",
        endpoint,
        422,
        { ...json, raw: '{"uid":' },
      );
      await compare(
        operation + " required body precedes auth",
        "POST",
        endpoint,
        422,
      );
      await compare(
        operation + " field validation precedes auth",
        "POST",
        endpoint,
        422,
        {
          body: { expected_revision: 0, uid: "bad", extra: false },
        },
      );
      await compare(
        operation + " valid form requires login",
        "POST",
        endpoint,
        401,
        {
          body: valid(),
          contentType: "application/vnd.fumiao+json",
        },
      );
      await compare(
        operation + " validation precedes project access",
        "POST",
        endpoint,
        422,
        { ...member, body: {} },
      );
      await compare(
        operation + " denies private canvas",
        "POST",
        endpoint,
        404,
        { ...member, body: valid() },
      );
      await compare(
        operation + " treats node as opaque",
        "POST",
        path(operation, "run-personal", "%00"),
        400,
        {
          ...admin,
          body: valid(),
        },
      );
    }

    await compare("candidate false literal", "POST", batch, 422, {
      body: { ...valid(), count: false },
    });
    await compare("candidate string literal", "POST", batch, 422, {
      body: { ...valid(), count: "2" },
    });
    await compare(
      "integral float literal and lax revision",
      "POST",
      batch,
      401,
      {
        ...json,
        raw: `{"uid":"${randomUUID()}","expected_revision":"+02.00","price_revision":null,"count":2.0}`,
      },
    );
    await compare(
      "too-large float is an integer validation error",
      "POST",
      run,
      422,
      {
        ...json,
        raw: `{"uid":"${randomUUID()}","expected_revision":1e30}`,
      },
    );
    await compare(
      "nonfinite revision error matches original encoding",
      "POST",
      voice,
      500,
      {
        ...json,
        raw: `{"uid":"${randomUUID()}","expected_revision":NaN}`,
      },
    );
    const large = "9007199254740993";
    const rawRejection = `{"uid":"${randomUUID()}","expected_revision":-${large},"extra":{"count":${large}}}`;
    await compare(
      "large integers in nested validation errors",
      "POST",
      run,
      422,
      { ...json, raw: rawRejection },
    );
    for (const backend of backends) {
      const rejected = await request(backend, "POST", run(backend), {
        ...json,
        raw: rawRejection,
      });
      assert.match(rejected.text, new RegExp(`"input":-${large}(?:,|})`));
      assert.match(rejected.text, new RegExp(`"count":${large}}`));
    }
    checks.push("raw validation error contains exact integer tokens");
    for (const revision of [large, `"${large}"`, "9223372036854775808"]) {
      const raw = `{"uid":"${randomUUID()}","expected_revision":${revision}}`;
      await compare(
        "large revision reaches auth " + revision,
        "POST",
        run,
        401,
        { ...json, raw },
      );
      await compare(
        "large revision reaches optimistic conflict " + revision,
        "POST",
        run,
        409,
        { ...admin, ...json, raw },
      );
    }
    const price = await compare(
      "large price revision reaches billing",
      "POST",
      run,
      409,
      {
        ...admin,
        ...json,
        raw: `{"uid":"${randomUUID()}","expected_revision":2,"price_revision":${large}}`,
      },
    );
    assert.deepEqual(price, {
      detail: "积分价格已更新，请确认新价格后重新提交",
    });
    const preBilling = await compare(
      "node validation precedes stale price",
      "POST",
      path("runs", "run-personal", "missing"),
      400,
      {
        ...admin,
        body: { ...valid(), price_revision: 999 },
      },
    );
    assert.deepEqual(preBilling, { detail: "请选择图片或视频节点" });

    async function ledger() {
      const pg = async (statement: string) =>
        (await f.db.query(statement)).rows.map((r) =>
          Object.values(r).map(Number),
        );
      const wallets = await pg(
        "SELECT w.public_id,balance,held FROM wallets b JOIN workspaces w ON w.id=b.workspace_id ORDER BY w.public_id",
      );
      assert.deepEqual(
        wallets,
        sqlite(
          "SELECT workspace,balance,reserved FROM credit_accounts ORDER BY workspace",
        ),
      );
      const counts = await pg(`SELECT
        (SELECT count(*) FROM jobs) AS jobs,
        (SELECT count(*) FROM canvas_job_links) AS links,
        (SELECT count(*) FROM canvas_run_batches) AS batches,
        (SELECT count(*) FROM outbox) AS outbox,
        (SELECT count(*) FROM ledger WHERE action='hold') AS holds`);
      assert.deepEqual(
        counts,
        sqlite(`SELECT
        (SELECT count(*) FROM jobs), (SELECT count(*) FROM canvas_job_links),
        (SELECT count(*) FROM canvas_run_batches), (SELECT count(*) FROM credit_charges),
        (SELECT count(*) FROM credit_ledger WHERE action='reserve')`),
      );
      return { wallets, counts: counts[0] };
    }
    const held = async (wid: string) =>
      (await ledger()).wallets.find(([id]) => id === Number(wid))!.slice(1);
    const before = await ledger();
    assert.deepEqual(before.counts, [0, 0, 0, 0, 0]);

    async function runRace(
      label: string,
      attempts: { endpoint: Path; options: Options }[],
      statuses: number[],
    ) {
      const results = await Promise.all(
        backends.map(async (backend) => {
          const responses = await Promise.all(
            attempts.map(({ endpoint, options }) =>
              request(backend, "POST", endpoint(backend), options),
            ),
          );
          assert.deepEqual(
            responses.map((response) => response.status).sort(),
            statuses,
            label,
          );
          return responses.map((response) => response.body);
        }),
      );
      checks.push(label);
      return results;
    }

    const batchBody = { ...valid(), count: 2 };
    sqlite("UPDATE credit_accounts SET balance=3 WHERE workspace=?", [
      personal,
    ]);
    await f.db.query("UPDATE wallets SET balance=3 WHERE workspace_id=$1", [
      f.workspace.id,
    ]);
    const failed = await compare(
      "second candidate rolls back the batch",
      "POST",
      batch,
      409,
      { ...admin, body: batchBody },
    );
    assert.deepEqual(failed, { detail: "当前空间积分不足，需要 2 积分" });
    assert.deepEqual((await ledger()).counts, before.counts);
    assert.deepEqual(await held(personal), [3, 0]);
    sqlite("UPDATE credit_accounts SET balance=100 WHERE workspace=?", [
      personal,
    ]);
    await f.db.query("UPDATE wallets SET balance=100 WHERE workspace_id=$1", [
      f.workspace.id,
    ]);
    const batchRace = await runRace(
      "concurrent same-UID batch retries create one pair",
      [
        { endpoint: batch, options: { ...admin, body: batchBody } },
        { endpoint: batch, options: { ...admin, body: batchBody } },
      ],
      [200, 200],
    );
    for (const [index, [first, second]] of batchRace.entries()) {
      assert.deepEqual(first, second);
      assert.deepEqual(
        { ...first, ids: first.ids.length },
        { ids: 2, count: 2, credits: 4 },
      );
      assert.notEqual(first.ids[0], first.ids[1]);
      const replay = await request(
        backends[index],
        "POST",
        batch(backends[index]),
        {
          ...admin,
          body: { ...batchBody, expected_revision: 1, price_revision: 999 },
        },
      );
      assert.deepEqual(replay.body, first);
    }
    await compare("candidate UID cannot change count", "POST", batch, 409, {
      ...admin,
      body: { ...batchBody, count: true },
    });
    await compare(
      "queued candidates make ordinary generation busy",
      "POST",
      run,
      409,
      { ...admin, body: valid() },
    );
    assert.deepEqual(await held(personal), [100, 4]);

    const voiceBody = valid();
    const speech = await runRace(
      "concurrent same-UID narration reserves once",
      [
        { endpoint: voice, options: { ...admin, body: voiceBody } },
        { endpoint: voice, options: { ...admin, body: voiceBody } },
      ],
      [200, 200],
    );
    for (const [index, [first, second]] of speech.entries()) {
      assert.deepEqual(first, second);
      const backend = backends[index];
      assert.deepEqual(
        (
          await request(backend, "POST", voice(backend), {
            ...admin,
            body: { ...voiceBody, expected_revision: 1, price_revision: 999 },
          })
        ).body,
        first,
      );
    }
    await compare(
      "narration UID is bound to the original canvas",
      "POST",
      path("narration", "run-other"),
      409,
      { ...admin, body: voiceBody },
    );
    await compare(
      "a fresh narration UID competes for the same node",
      "POST",
      voice,
      409,
      { ...admin, body: valid() },
    );
    assert.deepEqual(await held(personal), [100, 6]);

    const teamRun = path("runs", "run-team", "%6d");
    const teamBody = valid();
    const generation = await runRace(
      "concurrent member generation retries use the canvas workspace",
      [
        {
          endpoint: teamRun,
          options: { ...member, workspace: memberSpace, body: teamBody },
        },
        {
          endpoint: teamRun,
          options: { ...member, workspace: "invalid", body: teamBody },
        },
      ],
      [200, 200],
    );
    for (const [first, second] of generation) assert.deepEqual(first, second);
    const museSpec = museText.manifest;
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT plugin_id,plugin_version FROM jobs WHERE provider_model='muse-video'",
        )
      ).rows,
      [{ plugin_id: museSpec.id, plugin_version: museSpec.version }],
    );
    assert.deepEqual(await held(team), [100, 2]);
    assert.deepEqual(await held(memberSpace), [100, 0]);

    const conflictPath = path("runs", "run-other");
    const competition = await runRace(
      "same-node generation with distinct UIDs has one winner",
      [
        { endpoint: conflictPath, options: { ...admin, body: valid() } },
        { endpoint: conflictPath, options: { ...admin, body: valid() } },
      ],
      [200, 409],
    );
    for (const responses of competition)
      assert.deepEqual(
        responses.find((response) => response.detail),
        { detail: "这个节点还有生成任务，请等待完成" },
      );
    assert.deepEqual(await held(personal), [100, 8]);
    assert.deepEqual((await ledger()).counts, [5, 5, 1, 5, 5]);

    const listed = [];
    for (const [index, backend] of backends.entries()) {
      const response = await request(backend, "GET", list(backend), {
        ...admin,
        workspace: team,
      });
      assert.equal(response.status, 200);
      assert.equal(response.type, "application/json");
      const { runs } = response.body;
      assert.deepEqual(
        runs.map((r: any) => r.id),
        [speech[index][0].id, ...batchRace[index][0].ids.slice().reverse()],
      );
      const [audio, second, first] = runs;
      assert.equal(audio.canvas_node, "voice:v");
      assert.equal(audio.prompt, "旁白 \0🎙");
      assert.deepEqual(audio.inputs, {
        text: video.narration_text,
        instruction: video.narration_instruction,
        revision: 2,
      });
      assert.equal(audio.batch, null);
      assert.ok(
        Number.isSafeInteger(audio.seed) &&
          audio.seed >= 0 &&
          audio.seed < 2 ** 31,
      );
      assert.deepEqual([second.seed, first.seed], [0, Number.MAX_SAFE_INTEGER]);
      assert.equal(first.prompt, "\uFEFF画面 \0🎬");
      assert.equal(second.prompt, first.prompt);
      assert.deepEqual(
        [second.batch, first.batch],
        [2, 1].map((index) => ({ uid: batchBody.uid, index, count: 2 })),
      );
      assert.ok(
        runs.every(
          (r: any, i: number) =>
            r.status === "queued" &&
            r.node === null &&
            r.eta &&
            r.timing === null &&
            Number.isInteger(r.created) &&
            Number.isInteger(r.updated) &&
            (i === 0 || r.link_id < runs[i - 1].link_id),
        ),
      );
      listed.push(
        runs.map(({ id, link_id, created, updated, seed, ...fields }: any) => ({
          ...fields,
          seed: fields.kind === "audio" ? "<random>" : seed,
        })),
      );
    }
    assert.deepEqual(listed[1], listed[0]);
    checks.push(
      "runs list exposes ordered candidates, integer seeds, narration inputs and timing",
    );
    const teamLists = await Promise.all(
      backends.map((backend) =>
        request(backend, "GET", project("run-team", "/runs")(backend), {
          ...member,
          workspace: personal,
        }),
      ),
    );
    for (const response of teamLists) {
      assert.equal(response.status, 200);
      assert.equal(response.body.runs.length, 1);
      assert.equal(response.body.runs[0].model, "muse-video");
      assert.equal(response.body.runs[0].sampling_steps, 20);
      assert.equal(response.body.runs[0].prompt, muse.prompt);
    }
    assert.deepEqual(
      (await f.db.query("SELECT original_view FROM jobs WHERE kind='audio'"))
        .rows[0].original_view.audio_settings,
      { instruction: "自然" },
    );
    checks.push(
      "lossless versioned adapters preserve NUL and Python whitespace on HTTP submissions",
    );

    // Archived canvas input bytes can contain a Python integer even though new
    // seed requests are bounded. Verify the wire token without parsing it as Number.
    const archived = `{"params":{"legacy":${large}}}`;
    sqlite(
      "UPDATE canvas_job_links SET inputs=?,id=CAST(? AS INTEGER) WHERE job=?",
      [archived, large, speech[0][0].id],
    );
    await f.db.query(
      "UPDATE canvas_job_links SET inputs=$1,id=$3 WHERE job_id=(SELECT id FROM jobs WHERE public_id=$2)",
      [Buffer.from(archived), speech[1][0].id, large],
    );
    for (const backend of backends) {
      const response = await request(backend, "GET", list(backend), admin);
      assert.equal(response.status, 200);
      assert.ok(response.text.includes(archived));
      assert.ok(response.text.includes(`"link_id":${large}`));
    }
    checks.push("runs list serializes exact archived input integers");

    // Mimic a local completion and refund so both native ledgers exercise their
    // settlement path. There is no dispatch or real provider/payment call.
    sqlite(
      "UPDATE jobs SET status=CASE WHEN id=? THEN 'done' ELSE 'failed' END",
      [speech[0][0].id],
    );
    await f.db.transaction(async (sql) => {
      for (const job of (await sql.query("SELECT * FROM jobs FOR UPDATE")).rows)
        await f.p.settle(
          sql,
          job,
          Number(job.public_id) === speech[1][0].id ? "completed" : "failed",
        );
    });
    assert.deepEqual(await held(personal), [98, 0]);
    assert.deepEqual(await held(team), [100, 0]);
    checks.push("settlement spends one hold and refunds remaining holds");

    const collisionBody = valid();
    const collisions = await runRace(
      "same owner cannot reuse a run UID across canvases",
      [
        { endpoint: run, options: { ...admin, body: collisionBody } },
        { endpoint: conflictPath, options: { ...admin, body: collisionBody } },
      ],
      [200, 409],
    );
    for (const responses of collisions)
      assert.deepEqual(
        responses.find((response) => response.detail),
        {
          detail: "这次提交已处理，请刷新画布",
        },
      );

    const imageBatch = path("candidates", "run-other", "i");
    const imageBody = valid();
    const imageResults = await runRace(
      "default candidate count submits an image",
      [
        { endpoint: imageBatch, options: { ...admin, body: imageBody } },
        {
          endpoint: imageBatch,
          options: { ...admin, body: { ...imageBody, count: true } },
        },
      ],
      [200, 200],
    );
    for (const [index, [created, replayed]] of imageResults.entries()) {
      assert.deepEqual(created, replayed);
      assert.deepEqual(
        { ...created, ids: created.ids.length },
        { ids: 1, count: 1, credits: 2 },
      );
      const backend = backends[index];
      const response = await request(
        backend,
        "GET",
        project("run-other", "/runs")(backend),
        admin,
      );
      assert.equal(response.status, 200);
      const imageRun = response.body.runs[0];
      assert.equal(imageRun.id, created.ids[0]);
      assert.equal(imageRun.kind, "image");
      assert.equal(imageRun.model, "muse-image");
    }
    assert.deepEqual(await held(personal), [98, 4]);
    assert.equal(providerRequests, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
