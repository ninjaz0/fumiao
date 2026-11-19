import { Postgres } from "./db.js";
import { Vault } from "./security.js";
import { PluginRegistry } from "./plugins.js";
import { S3Storage, DiskStorage } from "./storage.js";
import { Platform } from "./platform.js";
export function runtime() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!process.env.ENCRYPTION_KEY)
    throw new Error("ENCRYPTION_KEY is required");
  return new Platform(
    new Postgres(process.env.DATABASE_URL),
    new Vault(process.env.ENCRYPTION_KEY),
    new PluginRegistry(),
    process.env.S3_BUCKET
      ? new S3Storage(process.env.S3_BUCKET)
      : new DiskStorage(
          process.env.MEDIA_DIRECTORY || ".runtime-advanced/objects",
        ),
  );
}
