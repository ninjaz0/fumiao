import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  CINEMATOGRAPHY_DIMENSIONS,
  GENERATION_MODE_OPTIONS,
  GRID_LAYOUT_OPTIONS,
  TURNAROUND_VIEW_OPTIONS,
  buildCinematographyOptions,
  countActiveCinematography,
  resolveEffectiveGenerationMode,
  updateCinematographyField,
} from "../../apps/web/canvas-editor/composer-options.js";
import { computeOverlayPositions } from "../../apps/web/canvas-editor/performance.js";

test("computeOverlayPositions prevents selection toolbar from overlapping expanded cinematography composer", () => {
  const expanded = computeOverlayPositions({
    viewport: { x: 0, y: 0, zoom: 1 },
    windowSize: { w: 1280, h: 800 },
    node: { x: 420, y: 130, width: 330, height: 246, type: "video" },
    panelHeight: 475,
  });
  assert.ok(expanded.toolbar && expanded.composer);
  assert.ok(
    expanded.toolbar.top + 44 <= expanded.composer.top,
    `Expected toolbar bottom (${expanded.toolbar.top + 44}) <= composer top (${expanded.composer.top})`,
  );
});

test("resolveEffectiveGenerationMode honors explicit mode and falls back cleanly by node type and H3 state", () => {
  assert.equal(
    resolveEffectiveGenerationMode({ type: "image" }, false, false),
    "first_frame",
  );
  assert.equal(
    resolveEffectiveGenerationMode({ type: "video" }, false, false),
    "first_last_frame",
  );
  assert.equal(
    resolveEffectiveGenerationMode({ type: "video" }, true, false),
    "omni_ref",
  );
  assert.equal(
    resolveEffectiveGenerationMode({ type: "video" }, true, true),
    "first_last_frame",
  );
  assert.equal(
    resolveEffectiveGenerationMode(
      { type: "video", generation_mode: "grid_preview" },
      true,
      false,
    ),
    "grid_preview",
  );
});

test("cinematography helpers count active fields, clear empty values to null, and preserve custom options", () => {
  assert.equal(CINEMATOGRAPHY_DIMENSIONS.length, 6);
  assert.equal(GENERATION_MODE_OPTIONS.length, 4);
  assert.deepEqual(
    GENERATION_MODE_OPTIONS.find((opt) => opt.value === "omni_ref"),
    { value: "omni_ref", label: "全能参考" },
  );
  assert.equal(GRID_LAYOUT_OPTIONS.length, 2);
  assert.equal(TURNAROUND_VIEW_OPTIONS.length, 4);

  assert.equal(countActiveCinematography(null), 0);
  assert.equal(countActiveCinematography({}), 0);
  assert.equal(
    countActiveCinematography({
      shot_size: "特写",
      camera_movement: "缓慢推进",
      mood: "  ",
    }),
    2,
  );

  const next = updateCinematographyField(null, "shot_size", "特写");
  assert.deepEqual(next, { shot_size: "特写" });
  const two = updateCinematographyField(next, "lighting", "黄金时刻");
  assert.deepEqual(two, { shot_size: "特写", lighting: "黄金时刻" });
  const oneLeft = updateCinematographyField(two, "shot_size", "");
  assert.deepEqual(oneLeft, { lighting: "黄金时刻" });
  const cleared = updateCinematographyField(oneLeft, "lighting", "   ");
  assert.equal(cleared, null);

  const standardOpts = buildCinematographyOptions(["特写", "近景"], "特写");
  assert.deepEqual(standardOpts, [
    { value: "", label: "不限定" },
    { value: "特写", label: "特写" },
    { value: "近景", label: "近景" },
  ]);

  const customOpts = buildCinematographyOptions(
    ["特写", "近景"],
    "超微距特写",
  );
  assert.deepEqual(customOpts, [
    { value: "", label: "不限定" },
    { value: "特写", label: "特写" },
    { value: "近景", label: "近景" },
    { value: "超微距特写", label: "超微距特写" },
  ]);
});

test("canvas composer, cinematography panel, shot list, and asset packs use unified custom controls without raw mode selects or duplicate H3 mode dropdown", async () => {
  const root = process.cwd();
  const [
    optionSelectSource,
    cineSource,
    workspaceSource,
    shotListSource,
    assetPacksSource,
    aiStoryboardSource,
    overridesCss,
  ] = await Promise.all([
    readFile(join(root, "apps/web/canvas-editor/OptionSelect.tsx"), "utf8"),
    readFile(
      join(root, "apps/web/canvas-editor/CinematographyPanel.tsx"),
      "utf8",
    ),
    readFile(join(root, "apps/web/canvas-editor/CanvasWorkspace.tsx"), "utf8"),
    readFile(join(root, "apps/web/canvas-editor/ShotList.tsx"), "utf8"),
    readFile(join(root, "apps/web/canvas-editor/AssetPacks.tsx"), "utf8"),
    readFile(join(root, "apps/web/canvas-editor/AiStoryboard.tsx"), "utf8"),
    readFile(
      join(root, "apps/web/canvas-editor/canvas-overrides.css"),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(aiStoryboardSource, /全能 @图N 多参考/);
  assert.match(aiStoryboardSource, /<option value="omni_ref">全能参考<\/option>/);

  // OptionSelect provides accessible listbox + segmented group primitives
  assert.match(optionSelectSource, /aria-haspopup="listbox"/);
  assert.match(optionSelectSource, /role="listbox"/);
  assert.match(optionSelectSource, /role="option"/);
  assert.match(optionSelectSource, /export function SegmentedOptions/);

  // CinematographyPanel replaces all 6 raw <select> controls with OptionSelect field pills
  assert.doesNotMatch(cineSource, /<select\b/);
  assert.match(cineSource, /OptionSelect/);
  assert.match(cineSource, /variant="field"/);
  assert.match(cineSource, /导演镜头参数/);

  // CanvasWorkspace uses unified .fm-ui-chip, OptionSelect, SegmentedOptions, .fm-chip-badge,
  // preserves .canvas-pack-entry for Playwright contracts, and removes duplicate bottom h3-mode menu
  assert.match(workspaceSource, /className="canvas-pack-entry"/);
  assert.match(workspaceSource, /ariaLabel="分镜生成链路"/);
  assert.match(workspaceSource, /SegmentedOptions[\s\S]*?ariaLabel="宫格规格"/);
  assert.match(workspaceSource, /fm-chip-badge/);
  assert.doesNotMatch(workspaceSource, /className="fm-mode-select"/);
  assert.doesNotMatch(workspaceSource, /menu\s*===\s*['"]h3-mode['"]/);

  // ShotList and AssetPacks also use OptionSelect for mode / turnaround view
  assert.match(shotListSource, /OptionSelect/);
  assert.doesNotMatch(shotListSource, /分镜链路[\s\S]{0,120}<select\b/);
  assert.match(assetPacksSource, /OptionSelect[\s\S]*?ariaLabel="三视图生成视角"/);

  // canvas-overrides.css defines unified 32px chip height, resets .canvas-pack-entry padding, and styles segmented & cine pills
  assert.match(
    overridesCss,
    /\.fm-composer-wave3-bar\s+\.canvas-pack-entry\s*\{[\s\S]*?padding:\s*0;/,
  );
  assert.match(overridesCss, /\.fm-ui-chip\s*\{[\s\S]*?height:\s*32px;/);
  assert.match(overridesCss, /\.fm-grid-seg\s*\{[\s\S]*?height:\s*32px;/);
  assert.match(overridesCss, /\.fm-cine-trigger\s*\{/);
});
