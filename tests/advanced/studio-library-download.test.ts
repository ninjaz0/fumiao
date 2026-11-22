import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { databaseFixture } from "../helpers/database.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalStateRecords } from "@fumiao/original-api/state-records.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { selectAllAssets } from "../../apps/web/studio/library-selection.js";

test("205 seeded Studio assets download with capped selection", async () => {
  const f = await databaseFixture();
  const identity = new OriginalIdentity(f.p);
  const password = "selection-fixture-password";
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const token = await identity.login({ name: "admin", password }, "fixture");
  const app = await createOriginalApp(f.p);
  try {
    await app.listen(0, "127.0.0.1");
    const origin = await app.getUrl();
    const cookie = "fm_session=" + token;
    const bytes = await sharp({
      create: { width: 17, height: 13, channels: 3, background: "#7a3f9d" },
    })
      .png()
      .toBuffer();
    const visible: string[] = [];
    for (let i = 0; i < 205; i++) {
      const response = await fetch(origin + "/api/assets", {
        method: "POST",
        headers: {
          Cookie: cookie,
          "X-Workspace-Id": "1",
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(bytes),
      });
      assert.equal(response.status, 200);
      visible.push("asset:" + (await response.json()).id);
    }
    const workspace = (
      await f.db.query("SELECT id FROM workspaces WHERE kind='team'")
    ).rows[0];
    assert.equal(
      (await new OriginalStateRecords().assets(f.db, workspace.id)).length,
      205,
    );
    const download = (keys: string[]) =>
      fetch(origin + "/api/assets/batch-download", {
        method: "POST",
        headers: {
          Cookie: cookie,
          "X-Workspace-Id": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ keys }),
      });
    assert.equal((await download(visible)).status, 422);
    const response = await download(selectAllAssets([visible[204]], visible));
    assert.equal(response.status, 200);
    const ticket = await response.json();
    const archive = await fetch(origin + ticket.url, {
      headers: { Cookie: cookie },
    });
    assert.equal(archive.status, 200);
    assert.ok((await archive.arrayBuffer()).byteLength > 0);
    console.log(
      "Seeded 205 visible assets; uncapped download 422; capped download and archive 200",
    );
  } finally {
    await app.close();
    await f.cleanup();
  }
});
