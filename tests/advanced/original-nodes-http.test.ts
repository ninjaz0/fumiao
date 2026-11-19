import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import test from "node:test";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { StudioCatalog } from "../../packages/platform/src/catalog.js";
import { one } from "../../packages/platform/src/db.js";
import { GpuGateway } from "../../packages/platform/src/gpu.js";
import { Executor } from "../../packages/platform/src/executor.js";
import { importLegacy } from "../../packages/platform/src/importer.js";
import type { Actor } from "../../packages/platform/src/platform.js";
import { hash, secret } from "../../packages/platform/src/security.js";
import { flowText } from "../../plugins/flow/src/text.js";
import { gpuText } from "../../plugins/gpu/src/text.js";
import { imagesText } from "../../plugins/images/src/text.js";
import { museText } from "../../plugins/muse/src/text.js";
import { databaseFixture } from "../helpers/database.js";

const site = "http://localhost:3000";
const python =
  process.env.STUDIO_PYTHON ??
  resolve(".runtime-advanced/original/.venv/bin/python");
const exec = promisify(execFile);
const models = ["breeze-tts-2", "MiniMax H3"];
const asBearer = (token: string) => ({ Authorization: "Bearer " + token });
type User = "admin" | "member" | "observer";
type Side = {
  url: string;
  cookies: Partial<Record<User, string>>;
  native: boolean;
};
type Options = {
  method?: string;
  user?: User;
  json?: unknown;
  body?: string | Uint8Array<ArrayBuffer>;
  headers?: Record<string, string>;
};

async function http(side: Side, path: string, options: Options = {}) {
  const res = await fetch(side.url + path, {
    method:
      options.method ??
      (Object.hasOwn(options, "json") || options.body ? "POST" : "GET"),
    headers: {
      ...(options.user ? { Cookie: side.cookies[options.user]! } : {}),
      ...(Object.hasOwn(options, "json")
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
    body:
      options.body ??
      (Object.hasOwn(options, "json")
        ? JSON.stringify(options.json)
        : undefined),
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  const body = res.headers.get("content-type")?.includes("application/json")
    ? await res.json()
    : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body, headers: res.headers };
}

function audio() {
  const bytes = Buffer.alloc(44 + 24_000);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24);
  bytes.writeUInt32LE(48_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 44; i < bytes.length; i += 2)
    bytes.writeInt16LE(Math.round(1024 * Math.sin(i / 17)), i);
  return bytes;
}

test(
  "ordinary paired node management and the serial and parallel worker protocol match pinned HTTP",
  {
    skip: !process.env.STUDIO_PYTHON && !existsSync(python),
    timeout: 90_000,
  },
  async () => {
    const f = await databaseFixture();
    const password = secret();
    const savedSite = process.env.PUBLIC_URL;
    const savedPause = process.env.ORIGINAL_GPU_DISPATCH_PAUSE_FILE;
    process.env.PUBLIC_URL = site;
    const oracle = spawn(
      python,
      ["scripts/node-management-oracle.py", f.directory],
      {
        env: { ...process.env, NODE_TEST_PASSWORD: password },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let oracleError = "";
    oracle.stderr.on("data", (chunk) => {
      oracleError += chunk.toString();
    });
    const oracleClosed = once(oracle, "close").catch(() => {});
    let app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
    const gateway = new GpuGateway(f.p);
    try {
      delete process.env.ORIGINAL_GPU_DISPATCH_PAUSE_FILE;
      const until = Date.now() + 10_000;
      const portFile = join(f.directory, "node-oracle-port");
      while (!existsSync(portFile)) {
        assert.ok(
          Date.now() < until && oracle.exitCode === null,
          oracleError || "original oracle did not start",
        );
        await delay(25);
      }
      const old: Side = {
        url: "http://127.0.0.1:" + (await readFile(portFile, "utf8")),
        cookies: {},
        native: false,
      };
      const exported = await readFile(
        join(f.directory, "node-export.json"),
        "utf8",
      );
      const archive = JSON.parse(exported);
      assert.deepEqual(archive.tables.node_pair_names, [{ label: "弗淼004" }]);
      assert.equal(Object.hasOwn(archive.tables, "pairs"), false);
      assert.equal(Object.hasOwn(archive.tables.nodes[0], "key"), false);
      await f.p.registry.installBuiltins(f.db);
      await importLegacy(f.p, archive, f.directory);
      const admin = (await one(
        f.db,
        "SELECT * FROM users WHERE role='admin'",
      )) as Actor;
      const catalog = new StudioCatalog(f.db);
      for (const plugin of [gpuText, flowText, imagesText, museText])
        await f.db.transaction((sql) => catalog.activate(sql, plugin.manifest));
      const connection = await f.p.createConnection(admin, {
        name: "Loopback mock nodes",
        pluginId: gpuText.manifest.id,
        version: gpuText.manifest.version,
        config: {},
      });
      const connectionId = connection.id;
      await f.p.updateConnection(admin, connectionId, {
        revision: 1,
        enabled: true,
        concurrency: 2,
      });
      app = await createOriginalApp(f.p);
      await app.listen(0, "127.0.0.1");
      const native: Side = {
        url: await app.getUrl(),
        cookies: {},
        native: true,
      };
      const sides = [old, native];
      for (const side of sides)
        for (const user of ["admin", "member", "observer"] as const) {
          const login = await http(side, "/api/login", {
            json: { name: user, password },
          });
          assert.equal(login.status, 200);
          side.cookies[user] = login.headers.getSetCookie()[0].split(";")[0];
        }

      async function same(
        path: string,
        options: Options = {},
        status = 200,
        expected?: unknown,
      ) {
        const [legacy, target] = await Promise.all(
          sides.map((side) => http(side, path, options)),
        );
        assert.equal(legacy.status, status, path);
        assert.equal(target.status, legacy.status, path);
        assert.deepEqual(target.body, legacy.body, path);
        if (expected !== undefined)
          assert.deepEqual(target.body, expected, path);
        return target.body;
      }
      async function pair(
        side: Side,
        json: unknown = {},
        user: User = "member",
      ) {
        const before = Math.floor(Date.now() / 1000);
        const result = await http(side, "/api/pairs", { user, json });
        assert.equal(result.status, 200);
        const { command, expires, name, models: chosen } = result.body;
        assert.deepEqual(Object.keys(result.body).sort(), [
          "command",
          "expires",
          "models",
          "name",
        ]);
        assert.ok(
          Number.isInteger(expires) &&
            expires >= before + 1800 &&
            expires <= Math.floor(Date.now() / 1000) + 1800,
        );
        const pattern =
          /^curl -fsSL http:\/\/localhost:3000\/connect\/install\.sh -o \/tmp\/fumiao-install\.sh && FUMIAO_SITE=http:\/\/localhost:3000 bash \/tmp\/fumiao-install\.sh --models=([a-z0-9,-]+) ([A-Za-z0-9_-]{43})$/;
        const match = pattern.exec(command);
        assert.ok(match, "installation command shape");
        assert.equal(result.headers.get("cache-control"), "private, no-store");
        return { code: match[2], slugs: match[1], models: chosen, name };
      }
      async function enroll(side: Side, code: string, token: string) {
        return http(side, "/agent/enroll", { json: { code, secret: token } });
      }
      async function sqlite(statement: string) {
        await exec(python, [
          "-c",
          "import sqlite3,sys; con=sqlite3.connect(sys.argv[1]); con.execute(sys.argv[2]); con.commit()",
          join(f.directory, "sqlite", "studio.sqlite"),
          statement,
        ]);
      }
      const member = { user: "member" as const };
      const administrator = { user: "admin" as const };
      const nodePath = (id: number, action: string) =>
        "/api/nodes/" + id + "/" + action;
      await same("/api/pairs/default-name", {}, 401, { detail: "请先登录" });
      await same("/api/pairs", { json: {} }, 401);
      await same("/api/pairs", { ...member, json: { models: [] } }, 400);
      await same(
        "/api/pairs",
        { ...member, json: { models: ["unknown"] } },
        400,
      );
      await same("/api/pairs", { ...member, json: { models: [1] } }, 422);
      await same(
        "/api/pairs",
        { ...member, json: { name: "长".repeat(46) } },
        422,
      );
      await same("/api/pairs", { ...member, json: { name: "弗淼004" } }, 409);
      await same(
        "/api/pairs",
        { ...member, json: {}, headers: { Origin: "http://127.0.0.1:1" } },
        403,
      );
      await same("/api/pairs", member, 405);
      await same("/api/pairs/default-name", member, 200, { name: "弗淼007" });
      await same("/api/pairs/default-name", administrator, 200, {
        name: "弗淼007",
      });
      for (const file of ["install.sh", "agent.tgz", "agent.tgz.sha256"])
        await same("/connect/" + file);
      await same("/connect/setup.sh", {}, 404);
      await same("/agent/registration", {}, 401);
      await same("/agent/registration", { headers: asBearer(secret()) }, 403);
      await same(
        "/agent/enroll",
        { json: { code: secret(), secret: secret() + "aa" } },
        403,
      );
      const shortSecret = secret().slice(4);
      const invalid = await http(native, "/agent/enroll", {
        json: { code: secret(), secret: shortSecret },
      });
      assert.equal(invalid.status, 422);
      assert.equal(JSON.stringify(invalid.body).includes(shortSecret), false);

      const bindings = await Promise.all(
        sides.map(async (side) => {
          const issued = await pair(side, {
            name: "\u3000",
            models: [...models, models[0]],
            deadline: 1,
          });
          assert.deepEqual(
            { name: issued.name, models: issued.models, slugs: issued.slugs },
            {
              name: "弗淼007",
              models,
              slugs: "breeze-tts-2,minimax-h3",
            },
          );
          const tokens = [secret(), secret()];
          const attempts = await Promise.all(
            tokens.map((token) => enroll(side, issued.code, token)),
          );
          assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 403]);
          const winner = attempts.findIndex((r) => r.status === 200);
          assert.deepEqual(attempts[winner].body, { ok: true, models });
          assert.deepEqual(attempts[1 - winner].body, {
            detail: "配对码已使用",
          });
          const token = tokens[winner];
          const receipt = await http(side, "/agent/registration", {
            headers: asBearer(token),
          });
          assert.equal(receipt.status, 200);
          assert.equal(
            receipt.body.paired_code_hash === hash(issued.code),
            true,
          );
          assert.deepEqual(
            { ...receipt.body, paired_code_hash: undefined },
            {
              id: 18,
              models,
              control: "active",
              paired_code_hash: undefined,
            },
          );
          // Expiry applies to invitations, while an accepted invitation is a receipt.
          const expired = await pair(side, { name: "expired-unused" });
          assert.deepEqual(expired.models, ["MiniMax H3"]);
          if (side.native) {
            await f.db.query(
              "UPDATE gpu_pairings SET expires_at=now()-interval '1 second' WHERE label IN ('弗淼007','expired-unused')",
            );
            const persisted = await one(
              f.db,
              "SELECT p.token,n.token_hash FROM gpu_pairings p JOIN gpu_nodes n ON n.id=p.claimed_node_id WHERE p.label='弗淼007'",
            );
            assert.equal(
              persisted.token === hash(issued.code) &&
                persisted.token_hash === hash(token),
              true,
            );
          } else {
            await sqlite(
              "UPDATE pairs SET expires=0 WHERE label IN ('弗淼007','expired-unused')",
            );
          }
          assert.equal(
            (await enroll(side, expired.code, secret())).status,
            403,
          );
          assert.equal((await enroll(side, issued.code, token)).status, 200);
          const duplicate = await pair(side, { name: "other", models });
          assert.equal((await enroll(side, duplicate.code, token)).status, 500);
          const secondToken = secret();
          assert.equal(
            (await enroll(side, duplicate.code, secondToken)).status,
            200,
          );
          const autoNames = await Promise.all(
            Array.from({ length: 5 }, () => pair(side)),
          );
          assert.deepEqual(autoNames.map((p) => p.name).sort(), [
            "弗淼008",
            "弗淼009",
            "弗淼010",
            "弗淼011",
            "弗淼012",
          ]);
          return {
            first: { token, code: issued.code },
            second: { token: secondToken, code: duplicate.code },
          };
        }),
      );

      const advanced = await gateway.pair(admin, { connectionId });
      assert.equal((await enroll(native, advanced.code, secret())).status, 403);
      const original = await pair(native, { name: "protocol boundary" });
      let incompatible = false;
      try {
        await gateway.enroll({
          code: original.code,
          name: "protocol boundary",
          models,
        });
      } catch (error) {
        incompatible = (error as { status?: number }).status === 403;
      }
      assert.equal(incompatible, true);
      await same("/api/pairs/default-name", administrator, 200, {
        name: "弗淼013",
      });
      for (const side of sides)
        assert.equal((await pair(side, { name: " 弗淼099 " })).name, "弗淼099");
      await same("/api/pairs/default-name", administrator, 200, {
        name: "弗淼100",
      });
      await same("/api/nodes/invalid/stop", { json: {} }, 422);
      await same(nodePath(18, "stop"), { json: {} }, 401);
      await same(nodePath(18, "stop"), { ...member, json: {} }, 403);
      await same(nodePath(18, "unknown"), { ...administrator, json: {} }, 400);
      await same(nodePath(17, "resume"), { ...administrator, json: {} }, 404);
      await same(nodePath(19, "drain"), {
        ...administrator,
        body: "ignored",
        method: "POST",
      });
      await same(nodePath(19, "resume"), { ...administrator, json: {} });

      async function state(side: Side, user: User) {
        const result = await http(side, "/api/state", { user });
        assert.equal(result.status, 200, "state for " + user);
        return result.body;
      }
      const projectNodes = (data: any) =>
        data.nodes.map(({ lastseen, ...n }: any) => {
          assert.ok(
            Number.isInteger(lastseen) &&
              Math.abs(data.server_time - lastseen) < 75,
          );
          return n;
        });
      for (const user of ["admin", "member", "observer"] as const) {
        const states = await Promise.all(
          sides.map((side) => state(side, user)),
        );
        assert.deepEqual(projectNodes(states[0]), projectNodes(states[1]));
        const nodes = projectNodes(states[1]);
        assert.deepEqual(
          nodes.map((n: any) => n.id),
          user === "observer" ? [] : [19, 18],
        );
        for (const node of nodes)
          assert.deepEqual(Object.keys(node).sort(), [
            "contributor",
            "control",
            "detail",
            "id",
            "models",
            "name",
            "owner",
            "profile",
            "ready_models",
            "stage",
          ]);
      }
      await Promise.all([
        sqlite("UPDATE nodes SET lastseen=unixepoch()-76 WHERE id=19"),
        f.db.query(
          "UPDATE gpu_nodes SET last_seen=now()-interval '76 seconds' WHERE public_id=19",
        ),
      ]);
      for (const side of sides) {
        const data = await state(side, "member");
        assert.equal(data.nodes.find((n: any) => n.id === 19).stage, "offline");
      }

      const agentOptions = (token: string, ticket?: string, lane?: string) => ({
        ...asBearer(token),
        ...(ticket ? { "X-Job-Ticket": ticket } : {}),
        ...(lane ? { "X-Model-Lane": lane } : {}),
      });
      async function ready(side: Side, token: string) {
        const response = await http(side, "/agent/heartbeat", {
          headers: asBearer(token),
          json: { stage: "ready", ready_models: models },
        });
        assert.deepEqual(response.body, {
          control: "active",
          held: false,
          protocol: 2,
          execution_mode: "serial",
        });
      }
      async function claim(side: Side, token: string, lane?: string) {
        const response = await http(side, "/agent/claim", {
          headers: agentOptions(token, undefined, lane),
          method: "POST",
        });
        assert.equal(response.status, 200);
        return response.body;
      }
      const jobPath = (id: number, endpoint: string) =>
        `/agent/jobs/${id}/${endpoint}`;
      async function submit() {
        const body = { uid: randomUUID(), prompt: "本地测试", seed: 42 };
        const { id } = await same("/api/audio-jobs", {
          ...administrator,
          json: body,
        });
        await same("/api/audio-jobs", { ...administrator, json: body }, 200, {
          id,
        });
        return id;
      }
      async function checkJob(
        id: number,
        expected: {
          status: string;
          attempts: number;
          node: number | null;
          note: string;
        },
        credits: number[],
        actions: string[],
      ) {
        for (const side of sides) {
          const s = await state(side, "admin");
          const j = s.jobs.find((job: any) => job.id === id);
          assert.ok(j, "public job number was retained");
          assert.deepEqual(
            {
              status: j.status,
              attempts: j.attempts,
              node: j.node,
              note: j.note,
            },
            expected,
          );
          assert.deepEqual([s.credits.balance, s.credits.reserved], credits);
          assert.deepEqual(
            s.credit_history
              .filter((entry: any) => entry.job === id)
              .map((entry: any) => entry.action)
              .sort(),
            actions,
          );
        }
      }
      await Promise.all(
        sides.map((side, i) => ready(side, bindings[i].first.token)),
      );
      const id = await submit();
      const claims = await Promise.all(
        sides.map(
          async (side, i) => (await claim(side, bindings[i].first.token)).job,
        ),
      );
      assert.deepEqual(
        claims.map((j) => j.id),
        [id, id],
      );
      await same(nodePath(18, "drain"), { ...administrator, json: {} });
      for (const [index, side] of sides.entries()) {
        const registration = await http(side, "/agent/registration", {
          headers: asBearer(bindings[index].first.token),
        });
        assert.equal(registration.body.control, "draining");
      }
      await same(nodePath(18, "%73top"), { ...administrator, json: {} });
      await checkJob(
        id,
        {
          status: "queued",
          attempts: 1,
          node: null,
          note: "管理员已断开实例",
        },
        [100, 1],
        ["reserve"],
      );
      for (const [index, side] of sides.entries())
        assert.equal(
          (await claim(side, bindings[index].first.token)).job,
          null,
        );
      await same(nodePath(18, "resume"), { ...administrator, json: {} });
      const retries = await Promise.all(
        sides.map(
          async (side, i) => (await claim(side, bindings[i].first.token)).job,
        ),
      );
      assert.deepEqual(
        retries.map((j) => j.id),
        [id, id],
      );
      assert.equal(
        retries.every((j, i) => j.ticket !== claims[i].ticket),
        true,
      );
      for (const [index, side] of sides.entries()) {
        const stale = await http(side, jobPath(id, "receipt"), {
          headers: agentOptions(
            bindings[index].first.token,
            claims[index].ticket,
          ),
        });
        assert.deepEqual(
          [stale.status, stale.body],
          [409, { detail: "该任务已由其他实例接管或已结束" }],
        );
      }
      await assert.rejects(gateway.claim(bindings[1].first.token), {
        status: 401,
      });
      await same(nodePath(18, "remove"), { ...administrator, json: {} });
      await checkJob(
        id,
        {
          status: "failed",
          attempts: 2,
          node: null,
          note: "管理员已断开实例",
        },
        [100, 0],
        ["refund", "reserve"],
      );
      await same(nodePath(18, "resume"), { ...administrator, json: {} }, 404);
      assert.deepEqual(
        (
          await f.db.query(
            "SELECT status FROM job_runs WHERE job=$1 ORDER BY id",
            [
              (await one(f.db, "SELECT id FROM jobs WHERE public_id=$1", [id]))
                .id,
            ],
          )
        ).rows.map((r) => r.status),
        ["interrupted", "interrupted"],
      );
      for (const [index, side] of sides.entries()) {
        const first = bindings[index].first;
        const registration = await http(side, "/agent/registration", {
          headers: asBearer(first.token),
        });
        assert.equal(registration.status, 403);
        assert.deepEqual((await enroll(side, first.code, first.token)).body, {
          detail: "实例接入已撤销，请获取新的接入命令",
        });
      }

      await Promise.all(
        sides.map((side, i) => ready(side, bindings[i].second.token)),
      );
      const completed = await submit();
      const delivered = await Promise.all(
        sides.map(
          async (side, i) => (await claim(side, bindings[i].second.token)).job,
        ),
      );
      assert.deepEqual(
        delivered.map((j) => j.id),
        [completed, completed],
      );
      await same(nodePath(19, "drain"), { ...administrator, json: {} });
      const wav = audio();
      const sha256 = createHash("sha256").update(wav).digest("hex");
      const resultPath = "/agent/jobs/" + completed + "/result";
      const delivery = (side: Side, index: number, body = wav) =>
        http(side, resultPath, {
          method: "PUT",
          body,
          headers: {
            ...agentOptions(
              bindings[index].second.token,
              delivered[index].ticket,
            ),
            "X-SHA256": sha256,
            "Content-Type": "audio/wav",
          },
        });
      for (const [index, side] of sides.entries()) {
        const transaction = f.db.transaction;
        let lostCommit = false;
        if (side.native)
          f.db.transaction = async (run) => {
            let published = false;
            const result = await transaction((sql) =>
              run({
                query: async (statement, params) => {
                  if (statement.startsWith("INSERT INTO job_assets"))
                    published = true;
                  return sql.query(statement, params);
                },
              }),
            );
            if (published) {
              lostCommit = true;
              throw new Error("synthetic dropped commit acknowledgement");
            }
            return result;
          };
        let responses;
        try {
          responses = await Promise.all([
            delivery(side, index),
            delivery(side, index),
          ]);
        } finally {
          f.db.transaction = transaction;
        }
        const [first, second] = responses;
        assert.equal(lostCommit, side.native);
        assert.equal(first.status, 200);
        assert.deepEqual(first.body, second.body);
        assert.match(first.body.id, /^[0-9a-f]{32}$/);
        assert.deepEqual(
          (await http(side, "/media/" + first.body.id, administrator)).body,
          wav,
        );
        assert.deepEqual(
          await delivery(side, index, Buffer.from("ignored")).then(
            (r) => r.body,
          ),
          first.body,
        );
        const receipt = await http(side, jobPath(completed, "receipt"), {
          headers: agentOptions(
            bindings[index].second.token,
            delivered[index].ticket,
          ),
        });
        assert.deepEqual(receipt.body, { delivered: true });
      }
      await checkJob(
        completed,
        { status: "done", attempts: 1, node: 19, note: "" },
        [99, 0],
        ["reserve", "spend"],
      );
      for (const [index, side] of sides.entries()) {
        const registration = await http(side, "/agent/registration", {
          headers: asBearer(bindings[index].second.token),
        });
        assert.equal(registration.body.control, "paused");
      }
      await same(nodePath(19, "remove"), { ...administrator, json: {} });
      await checkJob(
        completed,
        { status: "done", attempts: 1, node: 19, note: "" },
        [99, 0],
        ["reserve", "spend"],
      );
      for (const side of sides) {
        const s = await state(side, "member");
        assert.equal(s.credits.balance, 0);
        assert.equal(
          s.credit_history.some(
            (entry: any) => entry.action === "contribution",
          ),
          false,
        );
      }
      // Use the same wire fields as worker.py, with local hardware descriptors
      // and private inputs created through the real workspace API.
      const video = "MiniMax H3",
        voice = "breeze-tts-2";
      const credentials = await Promise.all(
        sides.map(async (side) => {
          const caller = secret(),
            stranger = secret();
          const paired = await pair(side, { name: "parallel", models });
          const other = await pair(
            side,
            { name: "other station", models },
            "observer",
          );
          assert.equal((await enroll(side, paired.code, caller)).status, 200);
          assert.equal((await enroll(side, other.code, stranger)).status, 200);
          const registration = await http(side, "/agent/registration", {
            headers: asBearer(caller),
          });
          return { caller, stranger, nodeId: registration.body.id };
        }),
      );
      type AgentCall = Options & {
        ticket?: string;
        lane?: string;
        foreign?: boolean;
      };
      async function agentEach(path: string, options: AgentCall = {}) {
        return Promise.all(
          sides.map((side, i) =>
            http(side, "/agent/" + path, {
              ...options,
              headers: {
                ...agentOptions(
                  options.foreign
                    ? credentials[i].stranger
                    : credentials[i].caller,
                  options.ticket,
                  options.lane,
                ),
                ...options.headers,
              },
            }),
          ),
        );
      }
      async function agentSame(
        path: string,
        options: AgentCall,
        status: number,
        body: unknown,
      ) {
        for (const response of await agentEach(path, options))
          assert.deepEqual(
            [response.status, response.body],
            [status, body],
            path,
          );
      }
      const hardware = {
        gpu_name: "AMD MI300X",
        backend: "rocm",
        vram_gib: 192,
        ram_gib: 200,
        available_gpus: 1,
        used_gpus: 1,
      };
      const laneBudget = (gpu: number, ram: number) => ({
        backend: "rocm",
        device: 0,
        gpu_total_gib: 192,
        gpu_budget_gib: gpu,
        ram_budget_gib: ram,
      });
      const execution_plan = {
        mode: "parallel",
        policy: "gpu-budget-v1",
        lanes: { [video]: laneBudget(128, 128), [voice]: laneBudget(12, 20) },
        reserve_vram_gib: { "0": 16 },
        reserve_ram_gib: 32,
        ram_total_gib: 200,
      };
      const beatResult = (held = false, control = "active") => ({
        held,
        control,
        protocol: 2,
        execution_mode: "parallel",
      });
      const laneBeat = (lane: string, options: object = {}): AgentCall => ({
        lane,
        json: {
          stage: "ready",
          lane_model: lane,
          ready_models: [lane],
          runtime_id: "lane-" + lane,
          profile: hardware,
          model_profiles: { [lane]: hardware },
          ...(lane === video ? { video_steps: [4, 16, 20, 32, 50] } : {}),
          ...options,
        },
      });
      await same("/agent/heartbeat", { json: {} }, 422);
      await same("/agent/heartbeat", { json: { stage: "ready" } }, 401);
      await same(
        "/agent/claim",
        { method: "POST", headers: asBearer(secret()) },
        403,
      );
      await same("/agent/jobs/invalid/result", { method: "PUT" }, 422);
      await agentSame("heartbeat", { json: { stage: "invalid" } }, 400, {
        detail: "状态无效",
      });
      await agentSame("claim", { method: "POST", lane: video }, 409, {
        detail: "服务器当前只允许单通道执行",
      });
      await agentSame(
        "heartbeat",
        {
          json: {
            stage: "preparing",
            execution_plan: { ...execution_plan, ram_total_gib: 70 },
          },
        },
        400,
        { detail: "并发系统内存不足" },
      );
      await agentSame(
        "heartbeat",
        {
          json: {
            stage: "preparing",
            execution_plan,
            workflow: "h3-v6-native-inputs-turbo4",
            profile: hardware,
            runtime_id: "parent-1",
            ready_models: [],
          },
        },
        200,
        beatResult(),
      );
      await agentSame(
        "heartbeat",
        laneBeat(voice, { video_steps: [20] }),
        400,
        { detail: "通道不能修改视频能力" },
      );
      await agentSame(
        "heartbeat",
        laneBeat(voice, {
          model_profiles: { [video]: hardware, [voice]: hardware },
        }),
        400,
        { detail: "并发通道只能上报自己的模型环境" },
      );
      await agentSame("claim", { method: "POST", lane: "unknown" }, 400, {
        detail: "执行通道未授权",
      });
      await agentSame("heartbeat", laneBeat(video), 200, beatResult());
      await agentSame(
        "heartbeat",
        laneBeat(voice, { can_accept: false, detail: "等待显存" }),
        200,
        beatResult(),
      );

      const png = await sharp({
        create: { width: 64, height: 64, channels: 3, background: "#36a978" },
      })
        .png()
        .toBuffer();
      async function inputFor(user: User) {
        return Promise.all(
          sides.map(async (side) => {
            const r = await http(side, "/api/assets", {
              user,
              body: Buffer.from(png),
              headers: { "Content-Type": "image/png" },
            });
            assert.equal(r.status, 200);
            return r.body.id as string;
          }),
        );
      }
      const refs = await inputFor("admin"),
        unrelated = await inputFor("member");
      const videoUid = randomUUID();
      const videos = await Promise.all(
        sides.map(async (side, i) => {
          assert.equal(
            (
              await http(side, "/api/jobs", {
                ...administrator,
                json: {
                  uid: videoUid,
                  prompt: "blocked",
                  refs: [unrelated[i]],
                  seed: 55,
                },
              })
            ).status,
            404,
          );
          const r = await http(side, "/api/jobs", {
            ...administrator,
            json: {
              uid: videoUid,
              model: video,
              prompt: "本地视频",
              refs: [refs[i]],
              seed: 55,
              sampling_steps: 4,
              h3: { mode: "reference" },
            },
          });
          assert.equal(r.status, 200, JSON.stringify(r.body));
          return r.body.id as number;
        }),
      );
      assert.equal(videos[0], videos[1]);
      const speech = await submit();
      await agentSame("claim", { method: "POST" }, 200, {
        job: null,
        protocol: 2,
      });
      await agentSame("claim", { method: "POST", lane: voice }, 200, {
        job: null,
        protocol: 2,
      });
      await agentSame("heartbeat", laneBeat(voice), 200, beatResult());
      const pauseFiles = [
        join(f.directory, "sqlite", ".dispatch-paused"),
        join(f.directory, "native-paused"),
      ];
      process.env.ORIGINAL_GPU_DISPATCH_PAUSE_FILE = pauseFiles[1];
      await Promise.all(pauseFiles.map((file) => writeFile(file, "")));
      await agentSame("claim", { method: "POST", lane: voice }, 200, {
        job: null,
        protocol: 2,
      });
      await Promise.all(pauseFiles.map((file) => unlink(file)));
      const jobs = await Promise.all(
        sides.map(async (side, i) => {
          const token = credentials[i].caller;
          const results = await Promise.all([
            claim(side, token, video),
            claim(side, token, voice),
          ]);
          assert.deepEqual(
            results.map((r) => Object.keys(r)),
            [["job"], ["job"]],
          );
          const [v, a] = results.map((r) => r.job);
          assert.notEqual(v.ticket, a.ticket);
          assert.deepEqual(v.refs, [refs[i]]);
          assert.equal(v.h3_inputs.files[0].id, refs[i]);
          assert.equal(v.id, videos[i]);
          assert.equal(a.id, speech);
          for (const j of [v, a]) {
            assert.deepEqual(Object.keys(j).sort(), [
              "attempts",
              "audio_settings",
              "h3_inputs",
              "height",
              "id",
              "kind",
              "model",
              "prompt",
              "quality",
              "refs",
              "sampling_steps",
              "seconds",
              "seed",
              "ticket",
              "width",
            ]);
            assert.match(j.ticket, /^[A-Za-z0-9_-]{43}$/);
            assert.deepEqual(await claim(side, token, j.model), {
              job: j,
              protocol: 2,
            });
          }
          return { v, a };
        }),
      );
      const canonical = (job: any, ref: string) =>
        JSON.parse(
          JSON.stringify(job, (key, value) =>
            key === "ticket" ? "$ticket" : value === ref ? "$asset" : value,
          ),
        );
      for (const lane of ["v", "a"] as const)
        assert.deepEqual(
          canonical(jobs[0][lane], refs[0]),
          canonical(jobs[1][lane], refs[1]),
        );
      await agentSame(
        "heartbeat",
        { json: { stage: "ready", execution_plan: { mode: "serial" } } },
        409,
        { detail: "请先等待实例任务完成后更改执行方式" },
      );
      for (const [i, side] of sides.entries()) {
        const { caller, stranger } = credentials[i],
          { v, a } = jobs[i];
        const request = (
          suffix: string,
          options: Options = {},
          lane = video,
          node = caller,
          ticket = v.ticket,
        ) =>
          http(side, jobPath(v.id, suffix), {
            ...options,
            headers: {
              ...agentOptions(node, ticket, lane),
              ...options.headers,
            },
          });
        const path = "ref/" + refs[i];
        const expected = await request(path);
        assert.equal(expected.status, 200);
        assert.equal(
          expected.headers.get("content-type"),
          "application/octet-stream",
        );
        assert.deepEqual(
          await sharp(expected.body).raw().toBuffer(),
          await sharp(png).raw().toBuffer(),
        );
        const range = await request(path, {
          headers: { Range: "bytes=0-7" },
        });
        assert.equal(range.status, 206);
        assert.deepEqual(range.body, expected.body.subarray(0, 8));
        assert.equal((await request(path, {}, video, stranger)).status, 409);
        assert.equal((await request("ref/" + unrelated[i])).status, 403);
        assert.deepEqual((await request(path, {}, voice)).body, {
          detail: "任务不属于这个执行通道",
        });
        assert.deepEqual((await request("receipt")).body, {
          delivered: false,
        });
        assert.deepEqual(
          (await request("receipt", {}, video, caller, a.ticket)).body,
          { detail: "该任务已由其他实例接管或已结束" },
        );
        const heartbeat = (lane: string, ticket: string) =>
          http(side, "/agent/heartbeat", {
            ...laneBeat(lane, {
              stage: "busy",
              ticket,
              step: 1,
              steps: 4,
              job_phase: "generating",
            }),
            headers: agentOptions(caller, undefined, lane),
          });
        assert.deepEqual(
          (await heartbeat(voice, v.ticket)).body,
          beatResult(false),
        );
        assert.deepEqual(
          (await heartbeat(video, v.ticket)).body,
          beatResult(true),
        );

        if (side.native) {
          await f.db.query(
            "UPDATE jobs SET lease_until=now()-interval '2 seconds' WHERE public_id=$1",
            [a.id],
          );
        } else
          await sqlite("UPDATE jobs SET lease=unixepoch()-2 WHERE id=" + a.id);
        // The parent poll reaps expired work without claiming either lane.
        assert.deepEqual(await claim(side, caller), {
          job: null,
          protocol: 2,
        });
        assert.equal(
          (
            await http(side, jobPath(a.id, "receipt"), {
              headers: agentOptions(caller, a.ticket, voice),
            })
          ).status,
          409,
        );
        assert.deepEqual(
          (await heartbeat(voice, a.ticket)).body,
          beatResult(true),
        );
        assert.deepEqual(await claim(side, caller, voice), {
          job: a,
          protocol: 2,
        });
        assert.deepEqual(await claim(side, caller, video), {
          job: v,
          protocol: 2,
        });

        const bad = Buffer.from("synthetic invalid mp4");
        const wrong = await request("result", { method: "PUT", body: bad });
        assert.deepEqual(
          [wrong.status, wrong.body],
          [422, { detail: "成片参考模式与任务不一致，请更新实例后重试" }],
        );
        const audioError = (detail: string) =>
          http(side, jobPath(a.id, "error"), {
            headers: agentOptions(caller, a.ticket, voice),
            json: { stage: "error", detail },
          });
        assert.deepEqual((await audioError("合成素材测试失败")).body, {
          ok: true,
        });
        assert.equal((await audioError("重复错误")).status, 409);
      }
      await checkJob(
        speech,
        {
          status: "failed",
          attempts: 1,
          node: credentials[0].nodeId,
          note: "合成素材测试失败",
        },
        [99, 1],
        ["refund", "reserve"],
      );
      // Generate a real local H.264/AAC clip with the frozen H3 frame geometry.
      const output = join(f.directory, "synthetic-output.mp4");
      const { width, height } = jobs[0].v;
      await exec("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=blue:s=${width}x${height}:r=24`,
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=32000:cl=stereo",
        "-frames:v",
        "124",
        "-t",
        "5.166667",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        output,
      ]);
      const mp4 = await readFile(output);
      for (const [i, side] of sides.entries()) {
        const v = jobs[i].v,
          { caller } = credentials[i];
        // Run the installed worker's own urllib and fingerprint code from
        // the fixed archive. No installer, hardware probe or model runs.
        const fixedCode = [
          "import hashlib, json, sys",
          "from pathlib import Path",
          "sys.path.insert(0, sys.argv[1])",
          "import worker",
          "from node_models import h3_input_fingerprint",
          "worker.SITE, worker.LANE = sys.argv[2], 'MiniMax H3'",
          "worker.identity = Path(sys.argv[3])",
          "job = worker.api('/agent/claim')['job']",
          "assert job['id'] == int(sys.argv[5])",
          "path = '/agent/jobs/' + str(job['id'])",
          "raw = Path(sys.argv[4]).read_bytes()",
          "report = dict(h3_input_fingerprint=h3_input_fingerprint(job), sampling_steps=4, fast_mode=True)",
          "print(json.dumps(worker.api(path + '/result', method='PUT', ticket_value=job['ticket'], raw=raw, digest=hashlib.sha256(raw).hexdigest(), timing_report=report)))",
        ].join("\n");
        const identity = join(f.directory, "fixed-worker-identity");
        await writeFile(identity, caller, { mode: 0o600 });
        const { stdout } = await exec(
          python,
          [
            "-c",
            fixedCode,
            join(f.directory, "fixed-agent"),
            side.url,
            identity,
            output,
            String(v.id),
          ],
          { env: { PATH: process.env.PATH } },
        );
        const result = JSON.parse(stdout);
        assert.deepEqual(Object.keys(result).sort(), ["id", "ok"]);
        assert.equal(result.ok, true);
        const media = "/media/" + result.id;
        assert.equal((await http(side, media, member)).status, 404);
        assert.deepEqual((await http(side, media, administrator)).body, mp4);
        assert.equal(
          (
            await http(side, jobPath(v.id, "ref/" + refs[i]), {
              headers: agentOptions(caller, v.ticket, video),
            })
          ).status,
          409,
        );
      }
      await agentSame(
        "heartbeat",
        {
          json: {
            stage: "preparing",
            runtime_id: "parent-2",
            ready_models: [],
            detail: "正在校验已有模型",
          },
        },
        200,
        beatResult(),
      );
      await agentSame("claim", { method: "POST", lane: video }, 200, {
        job: null,
        protocol: 2,
      });

      const expired = await submit();
      await agentSame("heartbeat", laneBeat(voice), 200, beatResult());
      for (const [i, side] of sides.entries()) {
        const { caller, stranger } = credentials[i];
        const first = (await claim(side, caller, voice)).job;
        assert.equal(first.id, expired);
        if (side.native)
          await f.db.query(
            "UPDATE jobs SET lease_until=now()-interval '2 seconds' WHERE public_id=$1",
            [expired],
          );
        else
          await sqlite(
            "UPDATE jobs SET lease=unixepoch()-2 WHERE id=" + expired,
          );
        await ready(side, stranger);
        const retry = (await claim(side, stranger)).job;
        assert.equal(retry.id, expired);
        assert.equal(retry.attempts, 2);
        assert.notEqual(retry.ticket, first.ticket);
        const oldHeartbeat = await http(side, "/agent/heartbeat", {
          ...laneBeat(voice, { stage: "busy", ticket: first.ticket }),
          headers: agentOptions(caller, undefined, voice),
        });
        assert.deepEqual(oldHeartbeat.body, beatResult(false));
        const oldResult = await http(side, jobPath(expired, "result"), {
          method: "PUT",
          body: wav,
          headers: agentOptions(caller, first.ticket, voice),
        });
        assert.equal(oldResult.status, 409);
        if (side.native) {
          await f.db.query(
            "UPDATE jobs SET lease_until=now()-interval '2 seconds' WHERE public_id=$1",
            [expired],
          );
          // Exercise the same periodic recovery used by the BullMQ process.
          await new Executor(f.p).recover();
        } else
          await sqlite(
            "UPDATE jobs SET lease=unixepoch()-2 WHERE id=" + expired,
          );
        assert.equal((await claim(side, stranger)).job, null);
        const receipt = await http(side, jobPath(expired, "receipt"), {
          headers: agentOptions(stranger, retry.ticket),
        });
        assert.equal(receipt.status, 409);
      }
      await checkJob(
        expired,
        {
          status: "failed",
          attempts: 2,
          node: credentials[0].nodeId + 1,
          note: "实例连续中断，请重新生成",
        },
        [98, 0],
        ["refund", "reserve"],
      );
      assert.deepEqual(
        (
          await f.db.query(
            "SELECT r.status FROM job_runs r JOIN jobs j ON j.id=r.job WHERE j.public_id=$1 ORDER BY r.id",
            [expired],
          )
        ).rows.map((r) => r.status),
        ["interrupted", "interrupted"],
      );

      const pending = await Promise.all(
        sides.map((side) => pair(side, { name: "disabled-owner" }, "observer")),
      );
      const disabled = (await state(old, "observer")).me;
      await same("/api/users/" + disabled.id + "/disable", {
        ...administrator,
        json: {},
      });
      for (const [index, side] of sides.entries())
        assert.deepEqual(
          (await enroll(side, pending[index].code, secret())).body,
          { detail: "配对码已过期或无效" },
        );

      const { me } = await state(old, "member");
      const deletion = "/api/users/" + me.id;
      await same("/api/users/invalid", { method: "DELETE" }, 422);
      await same(deletion, { method: "DELETE" }, 401);
      await same(deletion, { ...member, method: "DELETE" }, 403);
      await same(
        "/api/users/" + (await state(old, "admin")).me.id,
        {
          ...administrator,
          method: "DELETE",
        },
        403,
      );
      await same(deletion, administrator, 405);

      const avatar = await sharp({
        create: { width: 16, height: 16, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      const retiring = await Promise.all(
        sides.map(async (side) => {
          const uploaded = await http(side, "/api/me/avatar", {
            ...member,
            method: "PUT",
            headers: { "content-type": "image/png" },
            body: new Uint8Array(avatar),
          });
          assert.equal(uploaded.status, 200);
          const pairCode = await pair(side, { name: "retiring", models });
          const openCode = await pair(side, {
            name: "retiring-unused",
            models,
          });
          const token = secret();
          assert.equal((await enroll(side, pairCode.code, token)).status, 200);
          await ready(side, token);
          return {
            token,
            openCode: openCode.code,
            avatarURL: uploaded.body.avatar_url,
          };
        }),
      );
      const secondAttempt = await submit();
      for (const [i, side] of sides.entries())
        assert.equal(
          (await claim(side, retiring[i].token)).job.id,
          secondAttempt,
        );
      const retiringId = (
        await http(old, "/agent/registration", {
          headers: asBearer(retiring[0].token),
        })
      ).body.id;
      await same(nodePath(retiringId, "stop"), { ...administrator, json: {} });
      await same(nodePath(retiringId, "resume"), {
        ...administrator,
        json: {},
      });
      for (const [i, side] of sides.entries())
        assert.equal((await claim(side, retiring[i].token)).job.attempts, 2);
      const firstAttempt = await submit();
      // The existing serial connection is busy. A second node starts a fresh attempt.
      const alsoRetiring = await Promise.all(
        sides.map(async (side) => {
          const token = secret();
          const pairing = await pair(side, { name: "retiring-second", models });
          assert.equal((await enroll(side, pairing.code, token)).status, 200);
          await ready(side, token);
          assert.equal((await claim(side, token)).job.id, firstAttempt);
          return token;
        }),
      );
      await same(deletion + "/disable", { ...administrator, json: {} });
      await same(
        deletion,
        {
          ...administrator,
          method: "DELETE",
          body: "{",
          headers: { "content-type": "application/json" },
        },
        200,
        { ok: true },
      );
      await same(deletion, { ...administrator, method: "DELETE" }, 404);
      await same("/api/workspaces", member, 401);
      await same("/api/state", member, 401);
      await same("/api/login", { json: { name: "member", password } }, 401);
      await checkJob(
        secondAttempt,
        {
          status: "failed",
          attempts: 2,
          node: null,
          note: "接入成员已移除，等待其他实例",
        },
        [98, 1],
        ["refund", "reserve"],
      );
      await checkJob(
        firstAttempt,
        {
          status: "queued",
          attempts: 1,
          node: null,
          note: "接入成员已移除，等待其他实例",
        },
        [98, 1],
        ["reserve"],
      );
      for (const [i, side] of sides.entries()) {
        for (const token of [
          retiring[i].token,
          alsoRetiring[i],
          credentials[i].caller,
        ])
          assert.equal(
            (
              await http(side, "/agent/registration", {
                headers: asBearer(token),
              })
            ).status,
            403,
          );
        assert.deepEqual(
          (await enroll(side, retiring[i].openCode, secret())).body,
          { detail: "配对码已过期或无效" },
        );
        assert.equal(
          (await http(side, retiring[i].avatarURL, administrator)).status,
          404,
        );
        const remaining = await state(side, "admin");
        assert.ok(
          remaining.jobs.find((job: any) => job.id === completed)?.result,
        );
        assert.ok(!remaining.users.some((user: any) => user.id === me.id));
      }
      assert.ok(
        await one(f.db, "SELECT id FROM assets WHERE public_id=$1", [
          unrelated[1],
        ]),
      );
      for (const side of sides) {
        const recreated = await http(side, "/api/users", {
          ...administrator,
          json: { name: "member", password },
        });
        assert.equal(recreated.status, 200);
        assert.notEqual(recreated.body.id, me.id);
      }
    } finally {
      if (savedSite === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = savedSite;
      if (savedPause === undefined)
        delete process.env.ORIGINAL_GPU_DISPATCH_PAUSE_FILE;
      else process.env.ORIGINAL_GPU_DISPATCH_PAUSE_FILE = savedPause;
      oracle.kill("SIGTERM");
      await oracleClosed;
      await app?.close();
      await f.cleanup();
    }
  },
);
