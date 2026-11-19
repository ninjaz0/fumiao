import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium, expect } from "@playwright/test";
import { Queue, QueueEvents, Worker } from "bullmq";
import sharp from "sharp";
import { one } from "../packages/platform/src/db.js";
import { Executor } from "../packages/platform/src/executor.js";
import { wavFixture } from "../tests/helpers/timing.js";
import {
  assertStudio,
  compare,
  open,
  pair,
  request,
  settings,
  setTab,
  tab,
} from "./studio-settings-browser.js";
import { json, settingsFixture } from "./studio-settings-fixture.js";

assert.ok(
  process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL,
  "Use isolated PostgreSQL and Redis via TEST_DATABASE_URL and TEST_REDIS_URL",
);
const redis = new URL(process.env.TEST_REDIS_URL);
const connection = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  db: Number(redis.pathname.slice(1) || 0),
  username: redis.username || undefined,
  password: redis.password || undefined,
  ...(redis.protocol === "rediss:" ? { tls: {} } : {}),
};
const queueName = "studio-member-" + randomUUID();
const artifacts = resolve(".runtime-advanced/studio-member-lifecycle");
const audioModel = "breeze-tts-2";
const revoked = { detail: "实例凭据已撤销" };
const removed = "接入成员已移除，等待其他实例";
const secret = () => randomBytes(32).toString("base64url");
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const wav = wavFixture();
for (let i = 44; i < wav.length; i += 2) wav.writeInt16LE(1100, i);
const png = await sharp({
  create: { width: 32, height: 32, channels: 3, background: "#75a4bf" },
})
  .png()
  .toBuffer();

const fixture = await settingsFixture({ nodes: true });
const executor = new Executor(fixture.platform);
const queue = new Queue(queueName, { connection });
const events = new QueueEvents(queueName, { connection });
const worker = new Worker<{ id: string }>(
  queueName,
  async ({ data }) => executor.execute(data.id),
  { connection },
);
const sqlite = new DatabaseSync(fixture.sqlitePath);
sqlite.exec("PRAGMA busy_timeout=5000");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let step = "start";

try {
  await mkdir(artifacts, { recursive: true });
  await events.waitUntilReady();
  browser = await chromium.launch({ args: ["--disable-partial-raster"] });
  sqlite.exec("UPDATE credit_prices SET amount=10");
  await fixture.platform.db.query("UPDATE studio_prices SET amount=10");
  const reports = [];
  for (const [name, backend] of Object.entries(fixture.backends)) {
    const native = name === "nest";
    const errors: string[] = [];
    const adminPages = await pair(
      browser,
      errors,
      backend,
      "admin",
      1440,
      "light",
    );
    try {
      async function http(
        path: string,
        options: {
          cookie?: string;
          method?: string;
          workspace?: number;
          headers?: Record<string, string>;
          body?: object | Uint8Array | ReadableStream<Uint8Array> | string;
        } = {},
      ) {
        const { cookie, headers, body, workspace, method } = options;
        const response = await fetch(backend.web + path, {
          method: method ?? (body === undefined ? "GET" : "POST"),
          headers: {
            Origin: backend.web,
            ...(cookie ? { Cookie: cookie } : {}),
            ...(workspace ? { "X-Workspace-Id": String(workspace) } : {}),
            ...(body === undefined
              ? {}
              : {
                  "Content-Type":
                    body instanceof Uint8Array || body instanceof ReadableStream
                      ? "application/octet-stream"
                      : "application/json",
                }),
            ...headers,
          },
          body:
            body instanceof Uint8Array
              ? new Uint8Array(body)
              : body instanceof ReadableStream || typeof body === "string"
                ? body
                : body && JSON.stringify(body),
          duplex: "half",
          signal: AbortSignal.timeout(20000),
          redirect: "manual",
        } as RequestInit);
        assert.equal(response.headers.get("x-fumiao-web"), "next", path);
        if (native)
          assert.equal(
            response.headers.get("x-settings-fixture"),
            "nest",
            path,
          );
        return response;
      }
      const read = (cookie: string, workspace?: number) =>
        http("/api/state", { cookie, workspace }).then(json);
      const memberAccount = (await read(backend.member)).me;
      const login = () =>
        http("/api/login", {
          body: { name: memberAccount.name, password: backend.memberPassword },
        });
      const secondLogin = await login();
      await json(secondLogin);
      const secondSession = secondLogin.headers
        .get("set-cookie")!
        .split(";")[0];
      step = name + " team and private assets";
      const { id: team } = await json<{ id: number }>(
        await http("/api/workspaces", {
          cookie: backend.admin,
          body: { name: "节点归属验收", members: [memberAccount.id] },
        }),
      );
      const { code } = await json<{ code: string }>(
        await http("/api/invite-codes", {
          cookie: backend.admin,
          body: { name: "合成验收邀请", team_id: team },
        }),
      );
      const registration = await http("/api/register", {
        body: {
          name: "lifecycle-observer",
          nickname: "验收成员",
          password: secret(),
          code,
        },
      });
      await json(registration);
      const observer = registration.headers.get("set-cookie")!.split(";")[0];
      assert.equal((await read(observer)).workspace_id, team);
      const credit = 100;
      if (native) {
        const space = await one(
          fixture.platform.db,
          "SELECT id FROM workspaces WHERE public_id=$1",
          [team],
        );
        await fixture.platform.db.transaction((sql) =>
          fixture.platform.credit(
            sql,
            space.id,
            credit,
            randomUUID(),
            "recharge",
          ),
        );
      } else {
        const adminId = (await read(backend.admin)).me.id;
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          sqlite
            .prepare("UPDATE credit_accounts SET balance=? WHERE workspace=?")
            .run(credit, team);
          sqlite
            .prepare(
              "INSERT INTO credit_ledger(workspace,actor,action,amount,balance,reserved,created) VALUES(?,?,'recharge',?,?,0,unixepoch())",
            )
            .run(team, adminId, credit, credit);
          sqlite.exec("COMMIT");
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      }
      const upload = (workspace: number) =>
        http("/api/assets", {
          cookie: backend.member,
          workspace,
          body: png,
        }).then(json<{ id: string }>);
      const shared = await upload(team);
      const privateFile = await upload(fixture.personal);
      const media = (
        id: string,
        cookie: string,
        headers?: Record<string, string>,
      ) => http("/media/" + id, { cookie, headers });
      const sharedBefore = Buffer.from(
        await (await media(shared.id, observer)).arrayBuffer(),
      );
      assert.equal((await media(privateFile.id, backend.member)).status, 200);
      assert.equal((await media(privateFile.id, backend.admin)).status, 404);

      step = name + " node enrollment and assignments";
      const admin = { cookie: backend.admin, workspace: team };
      const member = { cookie: backend.member, workspace: team };
      async function pairing(label: string, owner = member) {
        const { command } = await json<{ command: string }>(
          await http("/api/pairs", {
            ...owner,
            body: { name: label, models: [audioModel] },
          }),
        );
        assert.match(command, / [A-Za-z0-9_-]{43}$/);
        return command.split(" ").at(-1)!;
      }
      type Agent = { id: number; token: string; code: string };
      type Assignment = { id: number; ticket: string; attempts: number };
      const auth = (agent: Agent) => ({
        Authorization: "Bearer " + agent.token,
      });
      async function paired(label: string, owner = member) {
        const code = await pairing(label, owner);
        const token = secret();
        await json(
          await http("/agent/enroll", { body: { code, secret: token } }),
        );
        const registration = await json<{ id: number }>(
          await http("/agent/registration", {
            headers: { Authorization: "Bearer " + token },
          }),
        );
        return { id: registration.id, token, code };
      }
      const beat = (agent: Agent, ticket = "") =>
        http("/agent/heartbeat", {
          headers: auth(agent),
          body: { stage: "ready", ready_models: [audioModel], ticket },
        });
      const claim = async (agent: Agent, id: number, attempts: number) => {
        const { job } = await json<{ job: Assignment }>(
          await http("/agent/claim", {
            method: "POST",
            headers: auth(agent),
          }),
        );
        assert.equal(job?.id, id);
        assert.equal(job.attempts, attempts);
        assert.match(job.ticket, /^[A-Za-z0-9_-]{43}$/);
        return job;
      };
      async function submit(prompt: string, owner = admin) {
        const path = "/api/audio-jobs";
        const body = {
          uid: randomUUID(),
          model: audioModel,
          prompt,
          seed: 9,
        };
        const job = await json<{ id: number }>(
          await http(path, { ...owner, body }),
        );
        assert.deepEqual(await json(await http(path, { ...owner, body })), job);
        return job.id;
      }
      const assignedRequest = (
        agent: Agent,
        job: Assignment,
        part: string,
        options: Parameters<typeof http>[1] = {},
      ) =>
        http(`/agent/jobs/${job.id}/${part}`, {
          ...options,
          headers: {
            ...auth(agent),
            "X-Job-Ticket": job.ticket,
            ...options.headers,
          },
        });
      const result = (
        agent: Agent,
        job: Assignment,
        bytes: Buffer,
        body: Uint8Array | ReadableStream<Uint8Array> = bytes,
      ) =>
        assignedRequest(agent, job, "result", {
          method: "PUT",
          body,
          headers: {
            "X-SHA256": digest(bytes),
          },
        });
      const stop = (agent: Agent) =>
        http(`/api/nodes/${agent.id}/stop`, { ...admin, method: "POST" }).then(
          json,
        );
      const resume = (agent: Agent) =>
        http(`/api/nodes/${agent.id}/resume`, {
          ...admin,
          method: "POST",
        }).then(json);
      const ordinary = await paired("本机配对 A");
      const secondPair = await paired("本机配对 B");
      const dormant = await pairing("未兑换配对");
      const thirdPair = await paired("本机配对 C");
      const fourthPair = await paired("本机配对 D");
      const survivor = await paired("本机接替配对", {
        cookie: observer,
        workspace: team,
      });
      for (const agent of [ordinary, secondPair, thirdPair, fourthPair])
        await json(await beat(agent));
      const work = await claim(
        ordinary,
        await submit("成员已完成作品", member),
        1,
      );
      const audio = (
        await json<{ id: string }>(await result(ordinary, work, wav))
      ).id;
      const completed = await claim(
        thirdPair,
        await submit("管理员已完成作品"),
        1,
      );
      const output = (
        await json<{ id: string }>(await result(thirdPair, completed, wav))
      ).id;
      assert.deepEqual(await json(await result(thirdPair, completed, wav)), {
        ok: true,
        id: output,
      });

      const onSecondAttempt = async (a: Agent, b: Agent, prompt: string) => {
        const id = await submit(prompt);
        const first = await claim(a, id, 1);
        await stop(a);
        const second = await claim(b, id, 2);
        assert.notEqual(first.ticket, second.ticket);
        await resume(a);
        return second;
      };
      const pairSecond = await onSecondAttempt(
        ordinary,
        secondPair,
        "普通节点第二轮中断",
      );
      const otherSecond = await onSecondAttempt(
        thirdPair,
        fourthPair,
        "另一实例第二轮中断",
      );
      const pairFirst = await claim(
        ordinary,
        await submit("普通节点首轮中断"),
        1,
      );
      const otherFirst = await claim(
        thirdPair,
        await submit("另一实例首轮中断"),
        1,
      );
      await json(await beat(survivor));
      const independent = await claim(
        survivor,
        await submit("以其他节点执行的成员作品", member),
        1,
      );
      const interrupted = [
        [ordinary, pairFirst],
        [secondPair, pairSecond],
        [thirdPair, otherFirst],
        [fourthPair, otherSecond],
      ] as const;
      for (const [agent, assignment] of interrupted) {
        assert.equal(
          (await json<{ held: boolean }>(await beat(agent, assignment.ticket)))
            .held,
          true,
        );
        assert.deepEqual(
          await json(await assignedRequest(agent, assignment, "receipt")),
          { delivered: false },
        );
      }

      step = name + " deletion from Studio";
      const now = new Date();
      await Promise.all(
        adminPages.map(async ({ page, react }) => {
          await page.clock.setFixedTime(now);
          await open(page, "/studio", react, team);
          await expect(page.locator(".composer-estimate")).not.toBeEmpty();
          await page.locator('nav [data-nav="library"]').click();
          await page.getByRole("tab", { name: "语音", exact: true }).click();
          await expect(page.locator(`#job-${completed.id}`)).toBeVisible();
        }),
      );
      const libraryDate = await adminPages[0].page
        .locator("#library-grid h2")
        .first()
        .innerText();
      await compare(
        artifacts,
        name + "-team-library",
        adminPages.map(({ page }) => page),
        libraryDate,
      );
      await Promise.all(
        adminPages.map(async ({ page }) => {
          await settings(page);
          await setTab(page, "team");
        }),
      );
      const page = adminPages[native ? 1 : 0].page;
      const memberPath = "/api/users/" + memberAccount.id;
      assert.deepEqual(
        await json(
          await http(memberPath, { ...member, method: "DELETE" }),
          403,
        ),
        { detail: "需要管理员权限" },
      );
      const uploadStream = new TransformStream<Uint8Array, Uint8Array>();
      const writer = uploadStream.writable.getWriter();
      const delayed = result(ordinary, pairFirst, wav, uploadStream.readable);
      // Observe the real phase change before deleting while the request is open.
      try {
        await writer.write(new Uint8Array(wav.subarray(0, 64)));
        await expect
          .poll(async () =>
            native
              ? (
                  await one(
                    fixture.platform.db,
                    "SELECT r.phase FROM job_runs r JOIN jobs j ON j.id=r.job WHERE j.public_id=$1 ORDER BY r.id DESC LIMIT 1",
                    [pairFirst.id],
                  )
                )?.phase
              : sqlite
                  .prepare(
                    "SELECT phase FROM job_runs WHERE job=? ORDER BY id DESC LIMIT 1",
                  )
                  .get(pairFirst.id)?.phase,
          )
          .toBe("uploading");
        await page
          .locator(`[data-act="delete-member"][data-id="${memberAccount.id}"]`)
          .click();
        const deleted = await request(page, memberPath, "DELETE", () =>
          page.locator("#confirm").click(),
        );
        assert.equal(deleted.status(), 200, await deleted.text());
        assert.deepEqual(await deleted.json(), { ok: true });
        await writer.write(new Uint8Array(wav.subarray(64)));
        await writer.close();
        assert.deepEqual(await json(await delayed, 403), revoked);
      } finally {
        await writer.abort().catch(() => {});
        await delayed.catch(() => {});
      }
      assert.deepEqual(
        await json(
          await http(memberPath, { ...admin, method: "DELETE", body: "{" }),
          404,
        ),
        { detail: "成员不存在" },
      );
      await expect(
        page.locator(
          `[data-act="delete-member"][data-id="${memberAccount.id}"]`,
        ),
      ).toHaveCount(0);
      for (const [code, token] of [
        [dormant, secret()],
        [ordinary.code, ordinary.token],
      ]) {
        assert.deepEqual(
          await json(
            await http("/agent/enroll", { body: { code, secret: token } }),
            403,
          ),
          { detail: "配对码已过期或无效" },
        );
      }
      assert.deepEqual(await json(await login(), 401), {
        detail: "用户名或密码有误",
      });
      assert.deepEqual(
        await json(await media(privateFile.id, backend.member), 401),
        { detail: "请先登录" },
      );
      assert.deepEqual(
        await json(await http("/api/state", { cookie: secondSession }), 401),
        { detail: "请先登录" },
      );
      assert.equal((await media(privateFile.id, backend.admin)).status, 404);
      assert.deepEqual(
        Buffer.from(await (await media(shared.id, observer)).arrayBuffer()),
        sharedBefore,
      );
      assert.deepEqual(
        Buffer.from(await (await media(audio, observer)).arrayBuffer()),
        wav,
      );
      const range = await media(output, observer, { Range: "bytes=0-31" });
      assert.equal(range.status, 206);
      assert.deepEqual(
        Buffer.from(await range.arrayBuffer()),
        wav.subarray(0, 32),
      );
      for (const [agent, assignment] of interrupted) {
        for (const call of [
          () => http("/agent/registration", { headers: auth(agent) }),
          () => beat(agent, assignment.ticket),
          () =>
            http("/agent/claim", {
              method: "POST",
              headers: auth(agent),
            }),
          () => assignedRequest(agent, assignment, "receipt"),
          () =>
            assignedRequest(agent, assignment, "error", {
              body: { stage: "error", detail: "迟到的错误" },
            }),
          () => result(agent, assignment, wav),
        ])
          assert.deepEqual(await json(await call(), 403), revoked);
      }
      assert.deepEqual(
        await json(await result(thirdPair, completed, wav), 403),
        revoked,
      );

      step = name + " jobs and ledger after removal";
      if (native) await executor.recover();
      const state = await json<{
        jobs: {
          id: number;
          status: string;
          attempts: number;
          node: number | null;
          note: string;
          author: string;
          result: string;
        }[];
        credits: { available: number; reserved: number };
        credit_history: { job: number; action: string }[];
        nodes: { id: number }[];
      }>(await http("/api/state", admin));
      const summary = [];
      assert.deepEqual(
        [state.credits.available, state.credits.reserved],
        [50, 30],
      );
      assert.equal(
        state.jobs.find(({ id }) => id === work.id)?.author,
        "已删除成员",
      );
      assert.equal(state.jobs.find(({ id }) => id === work.id)?.result, audio);
      assert.equal(
        state.jobs.find(({ id }) => id === completed.id)?.result,
        output,
      );
      for (const [agent, assignment] of interrupted) {
        const job = state.jobs.find(({ id }) => id === assignment.id)!;
        const { status, attempts, node, note } = job;
        const entries = state.credit_history
          .filter(({ job }) => job === assignment.id)
          .map(({ action }) => action);
        assert.deepEqual(
          [status, attempts, node, note, entries],
          [
            attempts === 1 ? "queued" : "failed",
            assignment.attempts,
            null,
            removed,
            attempts === 1 ? ["reserve"] : ["refund", "reserve"],
          ],
        );
        assert.ok(!state.nodes.some(({ id }) => id === agent.id));
        const durable = native
          ? await one(
              fixture.platform.db,
              `SELECT j.remote_id AS node,j.original_gpu_ticket AS ticket,
              j.lease_token,j.lease_until AS lease,j.request_uncertain,n.control,n.queue_state->>'stage' AS stage,
              (SELECT count(*)::int FROM fmworker_rewards WHERE job_number=j.public_id) AS rewards,
              (SELECT count(*)::int FROM job_assets WHERE job_id=j.id AND role='output') AS outputs,
              (SELECT status FROM job_runs WHERE job=j.id ORDER BY id DESC LIMIT 1) AS run_status
              FROM jobs j CROSS JOIN gpu_nodes n WHERE j.public_id=$1 AND n.public_id=$2`,
              [assignment.id, agent.id],
            )
          : sqlite
              .prepare(
                `SELECT j.node,j.ticket,j.lease,n.control,n.stage,
              (SELECT count(*) FROM fm_rewards WHERE job=j.id) AS rewards,
              CASE WHEN j.result IS NULL THEN 0 ELSE 1 END AS outputs,
              (SELECT status FROM job_runs WHERE job=j.id ORDER BY id DESC LIMIT 1) AS run_status
              FROM jobs j CROSS JOIN nodes n WHERE j.id=? AND n.id=?`,
              )
              .get(assignment.id, agent.id);
        assert.deepEqual(
          { ...durable },
          {
            node: null,
            ticket: null,
            lease: null,
            control: "removed",
            stage: "offline",
            rewards: 0,
            outputs: 0,
            run_status: "interrupted",
            ...(native ? { lease_token: null, request_uncertain: false } : {}),
          },
        );
        summary.push([status, attempts, node, note, entries]);
      }
      step = name + " reclaims and GPU settings";
      const unaffected = state.jobs.find(({ id }) => id === independent.id)!;
      assert.deepEqual(
        [unaffected.status, unaffected.node, unaffected.author],
        ["running", survivor.id, "已删除成员"],
      );
      assert.equal(
        (
          await json<{ held: boolean }>(
            await beat(survivor, independent.ticket),
          )
        ).held,
        true,
      );
      const independentResult = await json<{ id: string }>(
        await result(survivor, independent, wav),
      );
      assert.equal((await media(independentResult.id, observer)).status, 200);
      for (const assignment of [pairFirst, otherFirst]) {
        if (native) {
          const pending = await one(
            fixture.platform.db,
            "SELECT id FROM jobs WHERE public_id=$1",
            [assignment.id],
          );
          assert.ok(
            !(await executor.queueReady()).some(({ id }) => id === pending.id),
          );
          const queued = await queue.add("execute", { id: pending.id });
          await queued.waitUntilFinished(events, 10000);
        }
        const retry = await claim(survivor, assignment.id, 2);
        assert.notEqual(retry.ticket, assignment.ticket);
        assert.deepEqual(
          await json(
            await assignedRequest(survivor, assignment, "receipt"),
            409,
          ),
          { detail: "该任务已由其他实例接管或已结束" },
        );
        const delivered = await json<{ id: string }>(
          await result(survivor, retry, wav),
        );
        assert.equal((await media(delivered.id, observer)).status, 200);
        assert.deepEqual(await json(await result(survivor, retry, wav)), {
          ok: true,
          id: delivered.id,
        });
      }
      const settled = await json<typeof state>(await http("/api/state", admin));
      assert.deepEqual(
        [settled.credits.available, settled.credits.reserved],
        [50, 0],
      );
      for (const { id } of [
        work,
        completed,
        independent,
        pairFirst,
        otherFirst,
      ]) {
        assert.deepEqual(
          settled.credit_history
            .filter(({ job }) => job === id)
            .map(({ action }) => action),
          ["spend", "reserve"],
        );
      }
      assert.ok(
        !settled.credit_history.some(({ action }) => action === "contribution"),
      );
      await setTab(adminPages[1].page, "gpu");
      await expect(tab(adminPages[1].page, "gpu")).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(
        adminPages[1].page.getByRole("heading", {
          name: "GPU 实例",
          exact: true,
        }),
      ).toBeVisible();
      assert.equal(
        new URL(adminPages[1].page.url()).searchParams.get("workspace"),
        String(team),
      );
      await assertStudio(adminPages[1].page, true);
      assert.deepEqual(errors, []);
      reports.push({
        jobs: summary,
        wallet: [state.credits.available, state.credits.reserved],
      });
    } finally {
      await Promise.all(adminPages.map(({ context }) => context.close()));
    }
  }
  assert.deepEqual(reports[1], reports[0]);
  console.log(
    "PASS pinned Python vs Next/Nest member deletion, assets, sessions, paired leases, idempotent settlement and refunds, mid-upload fencing and GPU settings",
  );
} catch (error) {
  console.error("Studio member lifecycle failed at", step);
  throw error;
} finally {
  sqlite.close();
  await browser?.close();
  await worker.close();
  await events.close();
  await queue.obliterate();
  await queue.close();
  await fixture.cleanup();
}
