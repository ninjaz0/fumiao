import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { Queue } from "bullmq";
import { one } from "./db.js";
import type { Platform } from "./platform.js";
import { redisConnection } from "./redis.js";

export function studioConfiguration(env: NodeJS.ProcessEnv) {
  const missing = ["DATABASE_URL", "REDIS_URL", "ENCRYPTION_KEY"].filter(
    (key) => !env[key]?.trim(),
  );
  if (!env.MEDIA_DIRECTORY?.trim() && !env.S3_BUCKET?.trim())
    missing.push("MEDIA_DIRECTORY or S3_BUCKET");
  if (missing.length)
    throw new Error(
      `Studio configuration is missing ${missing.join(", ")}. Set them in .env, STUDIO_ENV_FILE, or the process environment. See docs/ORIGINAL_NEST_STUDIO.md.`,
    );
  const encoded = env
    .ENCRYPTION_KEY!.replaceAll("-", "+")
    .replaceAll("_", "/")
    .replace(/=$/, "");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || encoded + "=" !== key.toString("base64"))
    throw new Error(
      "Set ENCRYPTION_KEY to the existing 32-byte Base64 key, or generate one for a new installation",
    );
  try {
    const url = new URL(env.DATABASE_URL!);
    if (
      !["postgresql:", "postgres:"].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2
    )
      throw new Error();
  } catch {
    throw new Error(
      "Set DATABASE_URL to a PostgreSQL URL naming the Studio database",
    );
  }
  if (
    env.STUDIO_LEGACY_SOURCE &&
    !/^[a-zA-Z0-9_-]{1,80}$/.test(env.STUDIO_LEGACY_SOURCE)
  )
    throw new Error(
      "Set STUDIO_LEGACY_SOURCE to the same source identifier passed to export-legacy.py",
    );
  return redisConnection(env.REDIS_URL!);
}

export async function checkStudioStorage(env: NodeJS.ProcessEnv) {
  if (env.S3_BUCKET?.trim()) return;
  try {
    const directory = env.MEDIA_DIRECTORY;
    if (!directory?.trim()) throw new Error();
    const info = await stat(directory);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0) throw new Error();
    await access(directory, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch {
    throw new Error(
      "Set MEDIA_DIRECTORY to an existing private, writable directory (mode 0700) or configure S3_BUCKET",
    );
  }
}

export async function checkStudio(p: Platform, env: NodeJS.ProcessEnv) {
  const connection = studioConfiguration(env);
  await checkStudioStorage(env);
  const source = env.STUDIO_LEGACY_SOURCE;
  let state;
  try {
    state = await one(
      p.db,
      `SELECT
      EXISTS (SELECT 1 FROM users WHERE role='admin' AND active AND deleted_at IS NULL) AS initialized,
      EXISTS (SELECT 1 FROM legacy_imports WHERE source=$1) AS imported,
      EXISTS (SELECT 1 FROM original_state_settings WHERE legacy_workspace_id IS NOT NULL) AS original_workspace`,
      [source ?? null],
    );
  } catch {
    throw new Error(
      "Studio could not read PostgreSQL. Check DATABASE_URL, permissions, and run pnpm db:migrate with the same configuration",
    );
  }
  if (source && !state.imported)
    throw new Error(
      `Studio is missing the expected import '${source}'. Check DATABASE_URL and complete pnpm import:legacy before starting`,
    );
  if (!state.initialized)
    throw new Error(
      "Studio has no active administrator. Check DATABASE_URL, import the existing workspace, or run API_PROTOCOL=original pnpm bootstrap for a new installation",
    );
  if (!state.original_workspace)
    throw new Error(
      "The database has no original Studio workspace. Check DATABASE_URL and use a Pure import or an original-protocol installation; Advanced prototype data requires a separate migration",
    );

  const queue = new Queue("fumiao-jobs", {
    skipMetasUpdate: true,
    connection: {
      ...connection,
      connectTimeout: 3000,
      commandTimeout: 3000,
      retryStrategy: () => null,
    },
  });
  queue.on("error", () => {});
  try {
    await queue.getJobCounts("waiting");
  } catch {
    throw new Error(
      "Studio could not reach BullMQ Redis. Check REDIS_URL, authentication, the database number, and Redis availability",
    );
  } finally {
    // A failed connection also rejects BullMQ's disconnect promise.
    await queue.disconnect().catch(() => {});
  }
}
