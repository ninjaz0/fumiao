import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runtime } from "@fumiao/platform/runtime.js";
import { checkStudioStorage } from "@fumiao/platform/studio-runtime.js";
import { S3Storage } from "@fumiao/platform/storage.js";

test("运行时区分首次本地开发存储、已配置的私有卷和 S3", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "fm-disk-runtime-"));
  const cwd = process.cwd(),
    env = process.env;
  process.chdir(tmp);
  process.env = {
    ...env,
    DATABASE_URL: "postgres://localhost/fm_test",
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MEDIA_DIRECTORY: "",
    S3_BUCKET: "",
  };
  t.after(async () => {
    process.env = env;
    process.chdir(cwd);
    await rm(tmp, { recursive: true, force: true });
  });
  const storage = () => {
    const p = runtime();
    t.after(() => p.db.close());
    return p.storage;
  };
  const local = storage();
  assert.ok((await local.availableBytes!()) > 0);
  const bytes = Buffer.from("first object");
  await local.put("first", bytes, "text/plain");
  const defaultRoot = join(tmp, ".runtime-advanced", "objects");
  assert.deepEqual(await readFile(join(defaultRoot, "first")), bytes);
  assert.equal((await stat(defaultRoot)).mode & 0o077, 0);

  const root = join(tmp, "volume");
  process.env.MEDIA_DIRECTORY = root;
  await mkdir(root, { mode: 0o700 });
  await checkStudioStorage(process.env);
  const writer = storage();
  const source = join(tmp, "source");
  await writeFile(source, bytes);
  await writer.putFile!("saved", source, "text/plain");
  await rename(root, root + "-offline");
  await assert.rejects(checkStudioStorage(process.env), /existing private/);
  const restarted = storage();
  await assert.rejects(restarted.availableBytes!(), { status: 503 });
  await assert.rejects(writer.put("other", bytes, "text/plain"), {
    code: "ENOENT",
  });
  await assert.rejects(restarted.putFile!("other-file", source, "text/plain"), {
    code: "ENOENT",
  });
  await assert.rejects(stat(root), { code: "ENOENT" });
  await rename(root + "-offline", root);
  assert.deepEqual(await restarted.read("saved"), bytes);
  await assert.rejects(restarted.stream("missing"), { code: "ENOENT" });
  process.env.S3_BUCKET = "private-test-bucket";
  assert.ok(storage() instanceof S3Storage);
});
