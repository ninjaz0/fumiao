import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import { databaseFixture } from "../helpers/database.js";
import { migrate } from "@fumiao/platform/db.js";

test("strip whitespace matches the isolated Python interpreter over every Unicode scalar", () => {
  const expected: number[] = JSON.parse(
    execFileSync(
      process.env.STUDIO_PYTHON || "python3",
      [
        "-c",
        "import json; print(json.dumps([i for i in range(0x110000) if chr(i).isspace()]))",
      ],
      { encoding: "utf8" },
    ),
  );
  const actual: number[] = [];
  for (let i = 0; i < 0x110000; i++)
    if (pythonStrip(String.fromCodePoint(i)) === "") actual.push(i);
  assert.deepEqual(actual, expected);
  assert.equal(pythonStrip("\ufeffx\ufeff"), "\ufeffx\ufeff");
});

test("023 preserves existing archive JSON and allows NUL without escape marker collisions", async () => {
  const f = await databaseFixture("022_original_canvas_import.sql");
  try {
    const value = {
      literal: "\\u0000",
      nested: { __encoded__: "中文😀", normal: [1, true, null] },
    };
    await f.db.query(
      "INSERT INTO legacy_records(source,collection,legacy_id,payload) VALUES('upgrade','jobs','1',$1)",
      [JSON.stringify(value)],
    );
    await assert.rejects(
      f.db.query(
        "INSERT INTO legacy_records(source,collection,legacy_id,payload) VALUES('upgrade','jobs','2',$1)",
        [JSON.stringify({ text: "a\0b" })],
      ),
    );
    await migrate(f.db);
    assert.deepEqual(
      (await f.db.query("SELECT payload FROM legacy_records")).rows[0].payload,
      value,
    );
    const special = { ...value, text: "a\0b", "key\0": "\ufeff\u001c" };
    await f.db.query(
      "INSERT INTO legacy_records(source,collection,legacy_id,payload) VALUES('upgrade','jobs','2',$1)",
      [JSON.stringify(special)],
    );
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT payload FROM legacy_records WHERE legacy_id='2'",
        )
      ).rows[0].payload,
      special,
    );
  } finally {
    await f.cleanup();
  }
});
