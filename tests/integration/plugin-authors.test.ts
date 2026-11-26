import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import { StudioPackages } from "@fumiao/platform/studio-packages.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { databaseFixture } from "../helpers/database.js";

const exec = promisify(execFile);
const dist = resolve("packages/plugin-sdk/dist");
const cli = join(dist, "lib/cli.js");
const sdkRequire = createRequire(import.meta.url);
async function temp(t: test.TestContext) {
  const path = await mkdtemp(join(tmpdir(), "fumiao-sdk-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
function cleanup(t: test.TestContext, child: ChildProcess) {
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode) return;
    const quit = once(child, "exit");
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    try {
      await quit;
    } finally {
      clearTimeout(timer);
    }
  });
}
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function ready(
  url: string,
  child: ChildProcess,
  headers: Record<string, string> = {},
) {
  for (let i = 0; i < 150; i++) {
    assert.equal(child.exitCode, null, "本地进程提前结束");
    try {
      if ((await fetch(url, { headers, signal: AbortSignal.timeout(500) })).ok)
        return;
    } catch {}
    await delay(80);
  }
  throw Error("本地服务未就绪");
}
test("each shipped scaffold builds, passes its hook contracts and receives an unsigned Studio import preview", async (t) => {
  const dir = await temp(t),
    fixture = await databaseFixture();
  t.after(fixture.cleanup);
  await fixture.p.registry.initializeStudio(fixture.db, false);
  const identity = new OriginalIdentity(fixture.p),
    credentials = { name: "admin", password: randomUUID() };
  await identity.bootstrap({ ...credentials, nickname: "示例负责人" });
  const actor = await identity.actor(
    await identity.login(credentials, "author-test"),
  );
  const packages = new StudioPackages(fixture.p);
  const templates = (await readdir(join(dist, "templates"))).sort();
  assert.ok(templates.includes("nodePools.json"), "SDK authors can still scaffold a node pool");
  for (const template of templates) {
    const type = template.replace(/\.json$/, ""),
      project = join(dir, "author-" + type.toLowerCase());
    await exec(process.execPath, [cli, "create", type, project]);
    await assert.rejects(
      exec(process.execPath, [cli, "create", type, project]),
    );
    const cases = await exec(process.execPath, [cli, "test", project]);
    assert.match(cases.stdout, /通过 /, type);
    const built = (
      await exec(process.execPath, [cli, "build", project])
    ).stdout.trim();
    const preview = await packages.preview(
      actor,
      JSON.parse(await readFile(built, "utf8")),
    );
    assert.equal(preview.publisher.fingerprint, null, type);
  }
});
test("all repository examples pass their contracts, including both real loopback provider services", async (t) => {
  const names = (await readdir("plugins"))
    .filter((n) => n.startsWith("example-"))
    .sort();
  for (const name of names) {
    const directory = resolve("plugins", name),
      args = [cli, "test", directory];
    const files = await readdir(directory);
    const env = { ...process.env, PLUGIN_KEY: randomUUID() };
    if (files.includes("server.ts")) {
      const port = await freePort(),
        endpoint = "http://127.0.0.1:" + port;
      const child = spawn(process.execPath, [join(directory, "server.ts")], {
        env: { ...env, PORT: String(port) },
        stdio: "ignore",
      });
      cleanup(t, child);
      await ready(endpoint + "/health", child, {
        authorization: "Bearer " + env.PLUGIN_KEY,
      });
      args.push("--service", endpoint);
    }
    const result = await exec(process.execPath, args, { env });
    assert.match(result.stdout, /通过 /, name);
    if (files.includes("server.ts"))
      assert.match(result.stdout, /\.service/, name);
  }
});
test("external SDK tarball exposes types, signs an edited plugin, and reloads valid and invalid changes in Chromium", async (t) => {
  const dir = await temp(t);
  const output = await exec(
    "npm",
    ["pack", dist, "--json", "--ignore-scripts"],
    { cwd: dir },
  );
  const archive = JSON.parse(output.stdout)[0].filename;
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "external-author", private: true, type: "module" }),
  );
  await exec(
    "pnpm",
    [
      "add",
      "--prefer-offline",
      "--ignore-scripts",
      "./" + archive,
      "@types/node@" + sdkRequire("@types/node/package.json").version,
    ],
    { cwd: dir, timeout: 120000 },
  );
  const bin = join(dir, "node_modules/.bin/fumiao-plugin"),
    project = join(dir, "external-tool");
  await writeFile(
    join(dir, "consumer.ts"),
    'import {packageSchema, viewSchema,type View} from "@fumiao/plugin-sdk";\nimport {signPackage} from "@fumiao/plugin-sdk/signing";\nconst page:View={schema:2, title:"测试",blocks:[{type:"text",text:"测试"}]};viewSchema.parse(page);void [packageSchema,signPackage];\n',
  );
  await exec(
    process.execPath,
    [
      sdkRequire.resolve("typescript/bin/tsc"),
      "--noEmit",
      "--module",
      "nodenext",
      "--target",
      "es2022",
      "--strict",
      "--skipLibCheck",
      "consumer.ts",
    ],
    { cwd: dir },
  );
  await exec(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import assert from "node:assert/strict"; await import("@fumiao/plugin-sdk"); await assert.rejects(import("@fumiao/plugin-sdk/transport.js"),{code:"ERR_PACKAGE_PATH_NOT_EXPORTED"})',
    ],
    { cwd: dir },
  );
  await exec(bin, ["create", "chatTools", project]);
  const id = "chatTools.reading-time";
  const sample = [
    { script: "海风", pace: "自然" },
    { callId: "example", turn: randomUUID() },
  ];
  const expected = JSON.stringify({
    characters: 2,
    charactersPerMinute: 240,
    estimatedSeconds: 1,
  });
  await writeFile(
    join(project, "fixtures.json"),
    JSON.stringify({ inputs: { [id]: sample }, expect: { [id]: expected } }),
  );
  await exec(bin, ["test", project]);
  const file = (await exec(bin, ["build", project])).stdout.trim(),
    key = join(dir, "publisher.pem"),
    signed = join(dir, "demo.signed.json");
  await exec(bin, ["keygen", key]);
  await exec(bin, [
    "sign",
    file,
    "--key",
    key,
    "--publisher",
    "测试作者",
    "--out",
    signed,
  ]);
  assert.match(
    (await exec(bin, ["verify", signed])).stdout,
    /测试作者 · SHA-256 [0-9a-f]{64}/,
  );
  const port = await freePort(),
    url = "http://127.0.0.1:" + port;
  const child = spawn(bin, ["dev", project, "--port", String(port)], {
    stdio: "ignore",
  });
  cleanup(t, child);
  await ready(url + "/project", child);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "external-tool" }),
  ).toBeVisible();
  const run = page.getByRole("button", { name: "运行入口" });
  await run.click();
  await expect(page.locator("#result")).toContainText("estimatedSeconds");
  const source = join(project, "package/reading-time.js");
  await writeFile(source, 'export default {run(){return "保存已生效";}};\n');
  await expect
    .poll(async () => {
      await run.click();
      return page.locator("#result").innerText();
    })
    .toContain("保存已生效");
  await assert.rejects(exec(bin, ["test", project]), /示例预期/);
  await writeFile(source, "invalid edit");
  await expect(page.getByRole("alert")).toContainText("默认");
  await expect(run).toBeDisabled();
  await writeFile(source, 'export default {run(){return "已修正";}};');
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.locator("#result")).toContainText("已修正");
});
