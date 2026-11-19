import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

test(
  "storyboard and canvas downloads match the pinned original over HTTP",
  {
    skip: !process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL,
    timeout: 180_000,
  },
  async () => {
    try {
      const { stdout } = await exec(
        process.execPath,
        ["--import", "tsx", "scripts/smoke-canvas-rest.ts", "--storyboard"],
        { timeout: 150_000 },
      );
      console.log(stdout.trim());
    } catch (error) {
      if (error instanceof Error && "stderr" in error)
        console.error(error.stderr);
      throw error;
    }
  },
);
