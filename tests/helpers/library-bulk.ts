import assert from "node:assert/strict";
import sharp from "sharp";
import { canvasesFixture } from "./canvases.js";
import { OriginalLibrary } from "@fumiao/original-api/library.js";
import { hash } from "@fumiao/platform/security.js";
import { one } from "@fumiao/platform/db.js";

type Asset = {
  id: string;
  public_id: string;
  size: number | string;
  mime: string;
};

export async function libraryBulkFixture() {
  const f = await canvasesFixture();
  const library = new OriginalLibrary(f.p);
  const refs: Asset[] = [],
    jobs: { row: Record<string, any>; output: Asset }[] = [];
  const bytes = await sharp({
    create: { width: 17, height: 13, channels: 3, background: "#7a3f9d" },
  })
    .png()
    .toBuffer();
  for (let i = 1; i <= 200; i++) {
    const uploaded = await f.p.upload(
      f.admin,
      f.workspace.id,
      bytes,
      "image/png",
    );
    refs.push(
      (await one(f.db, "SELECT * FROM assets WHERE id=$1", [
        uploaded.id,
      ])) as Asset,
    );
    const output = (await f.asset(
      (i + 200).toString(16).padStart(32, "0"),
      "image",
    )) as Asset;
    jobs.push({ row: await f.job(i, "image", "completed", output.id), output });
  }
  async function manifest(keys: string[]) {
    const ticket = await library.prepareDownload(f.admin, { keys });
    return (
      await one(
        f.db,
        "SELECT manifest FROM download_tickets WHERE key_hash=$1",
        [hash(ticket.url.split("/").at(-1)!)],
      )
    ).manifest;
  }
  async function verify(
    keys: string[],
    expectedFavorites: string[],
    expectedManifest: unknown,
  ) {
    await library.changeFavorites(f.admin, { keys, favorite: false });
    assert.deepEqual(
      (await library.changeFavorites(f.admin, { keys, favorite: true }))
        .favorites,
      expectedFavorites,
    );
    assert.deepEqual(await manifest(keys), expectedManifest);
    assert.deepEqual(
      (await library.changeFavorites(f.admin, { keys, favorite: false }))
        .favorites,
      [],
    );
  }
  return { ...f, library, refs, jobs, manifest, verify };
}
