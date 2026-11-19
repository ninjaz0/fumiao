import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chatSettingsFixture } from "../tests/helpers/chat-settings.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-chat-settings-oracle-"));
let f: Awaited<ReturnType<typeof chatSettingsFixture>> | undefined;
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/chat-settings-fixtures.py", directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const data = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ),
    failures: any[] = [];
  f = await chatSettingsFixture();
  for (const c of data.cases) {
    await f.reset(c.keys ?? {}, c.fallback ?? "");
    f.wire.setWire(
      "probe",
      c.wire ?? { raw: '{"data":[{"id":"deepseek-flash"},{"id":"gpt-4.1"}]}' },
    );
    await f.db.query(
      "UPDATE studio_policy SET flags=$1,revision=$2,price_revision=$3",
      [
        JSON.stringify({ ...data.initial.enabled, ...c.flags }),
        data.initial.revision,
        data.pricing.revision,
      ],
    );
    await f.db.query("UPDATE wallets SET balance=23,held=3");
    const bytes =
      c.hex !== undefined
        ? Buffer.from(c.hex, "hex")
        : c.raw !== undefined
          ? Buffer.from(c.raw)
          : Object.hasOwn(c, "body")
            ? Buffer.from(JSON.stringify(c.body))
            : undefined;
    const response: Response = await fetch(f.url + c.path, {
      method: c.method,
      headers: {
        cookie: "fm_session=" + f.tokens[c.actor ?? 0],
        origin: c.origin ?? "http://localhost:3000",
        "content-type": c.type ?? "application/json",
      },
      body: ["GET", "HEAD"].includes(c.method) ? undefined : bytes,
    });
    const text = await response.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (body && typeof body === "object" && body.credits)
      body.credits.workspace = "fixture-workspace";
    const actual: {
      status: number;
      body: unknown;
      contentType: string | null;
      allow: string | null;
    } = {
      status: response.status,
      body,
      contentType: response.headers.get("content-type"),
      allow: response.headers.get("allow"),
    };
    const configured: Record<string, boolean> = Object.fromEntries(
      Object.entries((await f.settings.read(f.admin)).providers).map(
        ([id, p]) => [id, p.configured],
      ),
    );
    try {
      assert.deepEqual(actual, c.expected, c.name);
      assert.deepEqual(f.wire.requests, c.requests, c.name + " provider calls");
      assert.deepEqual(configured, c.configured, c.name + " configuration");
      assert.deepEqual(await f.catalog.policy(), c.policy, c.name + " policy");
    } catch (error) {
      failures.push({
        name: c.name,
        error: String(error),
        actual,
        expected: c.expected,
      });
    }
  }
  await mkdir(".runtime-advanced/chat-settings-parity", { recursive: true });
  const report = {
    passed: !failures.length,
    scenarios: data.cases.length,
    failures,
  };
  await writeFile(
    ".runtime-advanced/chat-settings-parity/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
  console.log("Original chat settings HTTP parity: " + JSON.stringify(report));
} finally {
  await f?.cleanup();
  await rm(directory, { recursive: true, force: true });
}
