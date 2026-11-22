/** Start the Studio web app, API and worker on loopback. */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { originalUI } from "../packages/web-compat/src/ui.js";
import { studioConfiguration } from "../packages/platform/src/studio-runtime.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (process.env.STUDIO_BACKEND && process.env.STUDIO_BACKEND !== "nest")
  throw new Error("Studio requires the Nest backend");
const profile = process.env.STUDIO_ENV_FILE;
if (profile || existsSync(".env")) {
  try {
    process.loadEnvFile(profile || ".env");
  } catch {
    throw new Error(
      "Cannot load the Studio environment file. Check STUDIO_ENV_FILE and file permissions",
    );
  }
}
studioConfiguration(process.env);
const runtime = resolve(
  process.env.STUDIO_RUNTIME_DIRECTORY || ".runtime-advanced",
);
const port = Number(process.env.STUDIO_PORT || 3000);
const apiPort = Number(process.env.LEGACY_API_PORT || 4101);
const configuredOrigin =
  process.env.STUDIO_PUBLIC_URL ||
  process.env.PUBLIC_URL ||
  `http://localhost:${port}`;
let publicUrl: string;
try {
  const url = new URL(configuredOrigin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== configuredOrigin.replace(/\/$/, "")
  )
    throw new Error();
  publicUrl = url.origin;
} catch {
  throw new Error(
    "Set STUDIO_PUBLIC_URL or PUBLIC_URL to the browser origin, such as http://localhost:3000",
  );
}
const apiOrigin = `http://127.0.0.1:${apiPort}`;
if (
  ![port, apiPort].every((p) => Number.isInteger(p) && p > 0 && p < 65536) ||
  port === apiPort
)
  throw new Error("Studio and API ports must be different valid ports");
const apiEnv = {
  ...process.env,
  API_HOST: "127.0.0.1",
  PORT: String(apiPort),
  PUBLIC_URL: publicUrl,
};
// Fail without stopping anybody else's process or starting half of a pair.
for (const listenPort of [port, apiPort]) {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(listenPort, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
}
await originalUI().verify();
const children: ChildProcess[] = [];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null)
            return resolve();
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 5000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    ),
  );
  process.exit(code);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
function launch(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  oneShot = false,
) {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
  children.push(child);
  child.once("error", (error) => {
    console.error(error.message);
    void stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping && !(oneShot && code === 0)) void stop(code || 1);
  });
  return child;
}
async function waitForHealth(origin: string, label: string, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && !stopping) {
    try {
      const response = await fetch(origin + "/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        if ((await response.json()).service === "fumiao") return;
      } else await response.body?.cancel();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not start`);
}
function launchTypeScript(script: string, oneShot = false) {
  return launch(process.execPath, ["--import", "tsx", script], apiEnv, oneShot);
}
try {
  const migration = launchTypeScript("scripts/migrate.ts", true);
  const code = await new Promise((resolve) =>
    migration.once("exit", resolve),
  );
  if (code !== 0 || stopping)
    throw new Error(
      "Nest Studio migration failed. Check DATABASE_URL, PostgreSQL availability, and migration permissions",
    );
  const api = launchTypeScript("apps/api/src/main.ts");
  await waitForHealth(apiOrigin, "Studio API", 15000);
  const worker = launchTypeScript("apps/worker/src/main.ts");
  const web = launch(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      process.argv.includes("--production") ? "start" : "dev",
      "apps/web",
      "-p",
      String(port),
      "-H",
      "127.0.0.1",
    ],
    {
      ...process.env,
      API_INTERNAL_URL: apiOrigin,
      FUMIAO_REPOSITORY_ROOT: root,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  );
  await waitForHealth(`http://127.0.0.1:${port}`, "Next Studio", 60000);
  await mkdir(runtime, { recursive: true });
  await writeFile(
    join(runtime, "studio-processes.json"),
    JSON.stringify(
      {
        supervisor: process.pid,
        api: api.pid,
        web: web.pid,
        worker: worker.pid,
        backend: "nest",
        port,
        apiPort,
      },
      null,
      2,
    ),
  );
  console.log(`Studio on Next.js: ${publicUrl}/studio`);
} catch (error) {
  console.error((error as Error).message);
  await stop(1);
}
