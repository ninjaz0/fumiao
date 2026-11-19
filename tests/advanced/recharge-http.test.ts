import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

test(
  "recharge contracts and settlement match pinned FastAPI over HTTP",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 90_000 },
  async () => {
    try {
      const { stdout } = await exec(
        process.execPath,
        ["--import", "tsx", "scripts/smoke-recharge.ts"],
        { timeout: 75_000 },
      );
      console.log(stdout.trim());
    } catch (error) {
      if (error instanceof Error && "stderr" in error)
        console.error(error.stderr);
      throw error;
    }
  },
);
