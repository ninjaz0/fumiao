import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Postgres } from "@fumiao/platform/db.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import { Vault } from "@fumiao/platform/security.js";
import { chromium, expect, type Browser } from "@playwright/test";

const temporary = await mkdtemp(join(tmpdir(), "fumiao-legacy-gpu-"));
const harness = spawn(
  process.execPath,
  ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
  { env: { ...process.env, TMPDIR: temporary }, stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(harness, "exit");
const pairPath = "/api/plugins/gpu/pages/nodes/actions/pair";
let browser: Browser | undefined;

async function restoreGpu() {
  const [directory] = await readdir(temporary);
  const profile = await readFile(join(temporary, directory, "studio.env"), "utf8");
  const setting = (name: string): string => JSON.parse(
    profile.split("\n").find((line) => line.startsWith(name + "="))!.slice(name.length + 1),
  );
  const db = new Postgres(setting("DATABASE_URL"));
  const vault = new Vault(setting("ENCRYPTION_KEY"));
  try {
    const file = await readFile("plugins/gpu/package/legacy-1.0.0.fmplugin.json", "utf8");
    const { id, version, adapterVersion, label } = JSON.parse(file);
    // The old installer stored the release and provisioned a pull connection.
    await db.transaction(async (sql) => {
      await sql.query(
        "INSERT INTO studio_package_releases(id,version,package) VALUES($1,$2,$3)",
        [id, version, file],
      );
      await sql.query(
        "INSERT INTO studio_packages(id,version,enabled) VALUES($1,$2,true)",
        [id, version],
      );
      await sql.query(
        "INSERT INTO connections(id,name,plugin_id,plugin_version,config,enabled) VALUES($1,$2,$3,$4,$5,true)",
        [randomUUID(), label, id, adapterVersion, vault.seal({})],
      );
    });
    await new PluginRegistry().initializeStudio(db, false);
  } finally {
    await db.close();
  }
}

try {
  const [, origin, user, password] = await new Promise<RegExpMatchArray>(
    (resolve, reject) => {
      let output = "";
      const cleanup = () => {
        clearTimeout(timer);
        harness.stdout.off("data", read);
        harness.stderr.off("data", read);
        harness.off("exit", earlyExit);
        harness.off("error", failed);
      };
      const failed = (error: Error) => {
        cleanup();
        reject(error);
      };
      const earlyExit = (code: number | null) => failed(new Error(
        `Studio harness exited (${code}): ${output.replace(/^Synthetic login .*$/gm, "Synthetic login [redacted]")}`,
      ));
      const timer = setTimeout(
        () => failed(new Error("Studio harness startup timed out")),
        180_000,
      );
      const read = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16000);
        const ready = output.match(/Isolated Studio (http:\/\/[^\s]+)\/studio\nSynthetic login (\S+) \/ (\S+)\r?\n/);
        if (ready) {
          cleanup();
          resolve(ready);
        }
      };
      harness.stdout.on("data", read);
      harness.stderr.on("data", read);
      harness.once("exit", earlyExit);
      harness.once("error", failed);
    },
  );
  await restoreGpu();
  browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: origin, viewport: { width: 1280, height: 800 } });
  const requests: unknown[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === pairPath)
      requests.push(request.postDataJSON());
  });
  await page.goto("/studio");
  await page.locator('[name="user"]').fill(user);
  await page.locator('[name="pw"]').fill(password);
  await page.locator('.auth-form [type="submit"]').click();
  await page.getByRole("button", { name: "账户", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "GPU 节点", exact: true }).click();
  await page.getByRole("button", { name: "接入GPU实例", exact: true }).click();
  const form = page.locator("dialog[open] form#pair");
  const name = "Issue 63 repro";
  await form.getByLabel("实例名称").fill(name);
  const models = form.getByRole("checkbox");
  const checked = form.getByRole("checkbox", { checked: true });
  const submit = form.getByRole("button", { name: "生成接入命令" });
  const hint = form.getByText("请至少选择一个安装模型", { exact: true });
  const valid = () => form.evaluate((element: HTMLFormElement) => element.checkValidity());
  await expect(checked).toHaveCount(1);
  assert.equal(await valid(), true, "The default selection should be valid");
  await checked.first().uncheck();
  await expect(checked).toHaveCount(0);
  const screenshot = process.env.LEGACY_GPU_MODELS_SCREENSHOT;
  if (screenshot) {
    await page.mouse.move(8, 8);
    await page.screenshot({ path: screenshot });
  }
  assert.equal(await valid(), false, "An empty install-model group should invalidate the form");
  await expect(hint).toBeVisible();
  await expect(submit).toBeDisabled();
  await form.evaluate((element: HTMLFormElement) => element.requestSubmit());
  assert.deepEqual(requests, [], "Empty models must not send a pair request");
  console.log("Empty model selection: invalid form, inline hint, no pair request");

  const model = models.last();
  const value = await model.inputValue();
  await model.check();
  await expect(hint).toBeHidden();
  await expect(submit).toBeEnabled();
  assert.equal(await valid(), true, "Selecting one model should restore validity");
  const [reply] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === pairPath),
    submit.click(),
  ]);
  assert.equal(reply.status(), 200);
  assert.deepEqual(requests, [{ payload: { name, models: [value] } }]);
  await expect(page.getByRole("textbox", { name: "接入命令" })).toBeVisible();
  console.log("One model selected: valid form, one pair request (HTTP 200), command shown");
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
  await rm(temporary, { recursive: true, force: true });
}
