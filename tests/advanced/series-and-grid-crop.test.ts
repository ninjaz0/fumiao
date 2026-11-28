import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { compileCinematographyPrompt } from "@fumiao/original-api/canvas-runs.js";
import { canvasesFixture } from "../helpers/canvases.js";

/** Generates a 3x3 color-coded PNG contact sheet (300x300 per cell = 900x900). */
async function makeColorGrid3x3(): Promise<Buffer> {
  const cell = 120;
  const colors: [number, number, number][] = [
    [240, 20, 20], // (0,0) red
    [20, 240, 20], // (0,1) green
    [20, 20, 240], // (0,2) blue
    [240, 240, 20], // (1,0) yellow
    [240, 20, 240], // (1,1) magenta
    [20, 240, 240], // (1,2) cyan
    [240, 128, 20], // (2,0) orange
    [128, 20, 240], // (2,1) purple
    [240, 240, 240], // (2,2) white
  ];
  const composites = await Promise.all(
    colors.map(async ([r, g, b], idx) => ({
      input: await sharp({
        create: {
          width: cell,
          height: cell,
          channels: 4,
          background: { r, g, b, alpha: 1 },
        },
      })
        .png()
        .toBuffer(),
      left: (idx % 3) * cell,
      top: Math.floor(idx / 3) * cell,
    })),
  );
  return sharp({
    create: {
      width: cell * 3,
      height: cell * 3,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

test("a 240-node canvas saves and preserves every node", async () => {
  const f = await canvasesFixture();
  try {
    const canvas = await f.canvases.create(f.admin, {}, String(f.team.public_id));
    const largeNodes = [];
    for (let i = 0; i < 240; i++) {
      largeNodes.push({
        id: `n-${i}`,
        type: i % 2 === 0 ? ("text" as const) : ("sticky" as const),
        title: `节点 ${i + 1}`,
        x: (i % 12) * 360,
        y: Math.floor(i / 12) * 280,
        text: `镜头说明 ${i + 1}`,
      });
    }
    const savedLarge = await f.canvases.save(f.admin, canvas.id, {
      expected_revision: canvas.revision,
      title: canvas.title,
      document: {
        schemaVersion: 1,
        nodes: largeNodes,
        edges: [],
      },
    });
    assert.equal(savedLarge.document.nodes.length, 240);
  } finally {
    await f.cleanup();
  }
});

test("F019 + F030 + F016 3x3 grid single-cell crop extracts exact pixel region and cinematography/generation_mode compile cleanly", async () => {
  const f = await canvasesFixture();
  try {
    const gridBuf = await makeColorGrid3x3();
    const assetId = randomUUID();
    const assetKey = randomUUID().replaceAll("-", "");
    const objKey = `grid-${assetKey}`;
    await f.p.storage.put(objKey, gridBuf, "image/png");
    await f.db.query(
      `INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind,object_modified)
       VALUES($1,$2,$3,$4,$5,'image/png',$6,'ready','{"width":360,"height":360}','ref',1700000000)`,
      [assetId, assetKey, f.team.id, f.admin.id, objKey, gridBuf.length],
    );

    const project = await f.canvases.create(
      f.admin,
      { title: "宫格与导演参数画布" },
      String(f.team.public_id),
    );
    await f.canvases.save(f.admin, project.id, {
      expected_revision: project.revision,
      title: project.title,
      document: {
        schemaVersion: 1,
        nodes: [
          {
            id: "grid-node",
            type: "image",
            title: "九宫格构图",
            x: 0,
            y: 0,
            media_id: assetKey,
            use_media: true,
            generation_mode: "grid_preview",
            grid_layout: "3x3",
            cinematography: {
              shot_size: "特写",
              camera_angle: "低角度仰拍",
              camera_movement: "缓慢推进",
              lighting: "赛博霓虹",
              lens: "50mm标准",
              mood: "悬疑紧张",
            },
          },
        ],
        edges: [],
      },
    });

    // Reload verifies cinematography & generation_mode persisted
    const reloaded = await f.canvases.get(f.admin, project.id);
    assert.equal(reloaded.document.nodes[0].generation_mode, "grid_preview");
    assert.equal(reloaded.document.nodes[0].cinematography?.shot_size, "特写");

    // Crop center cell (1,1) -> expected magenta ~(240, 20, 240)
    const centerCrop = await f.canvases.gridCrop(
      f.admin,
      project.id,
      "grid-node",
      { rows: 3, cols: 3, row: 1, col: 1 },
    );
    assert.equal(centerCrop.width, 120);
    assert.equal(centerCrop.height, 120);

    // Read back cropped asset pixels to verify exact cell was extracted
    const croppedRow = (
      await f.db.query("SELECT object_key FROM assets WHERE public_id=$1", [
        centerCrop.asset_id,
      ])
    ).rows[0];
    const chunks: Buffer[] = [];
    for await (const ch of await f.p.storage.stream(croppedRow.object_key)) {
      chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
    }
    const { data } = await sharp(Buffer.concat(chunks))
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.ok(data[0] > 220 && data[1] < 40 && data[2] > 220, "Center cell should be magenta");

    // Out-of-bounds row rejected
    await assert.rejects(
      () =>
        f.canvases.gridCrop(f.admin, project.id, "grid-node", {
          rows: 2,
          cols: 2,
          row: 2,
          col: 0,
        }),
      { status: 400 },
    );

    // F030 + F019 prompt compilation check
    const compiled = compileCinematographyPrompt(
      "雨夜街头的侦探",
      reloaded.document.nodes[0].cinematography,
      "grid_preview",
      "3x3",
    );
    assert.match(compiled, /3x3 九宫格分镜构图预览/);
    assert.match(compiled, /景别:特写/);
    assert.match(compiled, /运镜:缓慢推进/);
    assert.match(compiled, /氛围:悬疑紧张/);
  } finally {
    await f.cleanup();
  }
});
