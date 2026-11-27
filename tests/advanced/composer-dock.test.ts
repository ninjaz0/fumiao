import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { dockNotice } from "../../apps/web/studio/composer-dock.js";

test("blocking reason wins over draft recovery", () =>
  assert.equal(dockNotice({ status: "当前空间积分不足", busy: false, canRestoreDraft: true }), "当前空间积分不足"));
test("draft recovery wins over progress", () =>
  assert.equal(dockNotice({ status: "上传中", busy: true, canRestoreDraft: true }), "原草稿已暂存，点按恢复"));
test("progress shows when nothing else", () =>
  assert.equal(dockNotice({ status: "正在提交…", busy: true, canRestoreDraft: false }), "正在提交…"));
test("empty when idle", () =>
  assert.equal(dockNotice({ status: "", busy: false, canRestoreDraft: false }), ""));

test("the asset page uses the shared dock instead of its own toggle", async () => {
  const studio = join(import.meta.dirname, "../../apps/web/studio");
  const library = await readFile(join(studio, "Library.tsx"), "utf8");
  const polish = await readFile(join(studio, "studio-polish.css"), "utf8");
  assert.ok(!library.includes("展开创作框"), "Library.tsx still renders the 展开创作框 toggle");
  assert.ok(!polish.includes(".mobile-asset-composer"), "studio-polish.css still styles .mobile-asset-composer");
});
