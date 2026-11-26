import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import sharp from "sharp";
import { one } from "@fumiao/platform/db.js";
import { originalStoryboard } from "@fumiao/platform/composition/renderer.js";
import { Executor } from "@fumiao/platform/executor.js";
import { wakeTailFrameChildren } from "@fumiao/platform/tail-frame.js";
import { canvasesFixture } from "../helpers/canvases.js";

const exec = promisify(execFile);

async function makeTwoColorVideo(dir: string, filename: string) {
  const red = join(dir, "part-red.mp4");
  const green = join(dir, "part-green.mp4");
  const list = join(dir, "concat.txt");
  const out = join(dir, filename);
  await exec("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=red:s=128x96:r=24:d=0.4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    red,
  ]);
  await exec("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=lime:s=128x96:r=24:d=0.4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    green,
  ]);
  await writeFile(list, `file '${red}'\nfile '${green}'\n`);
  await exec("ffmpeg", [
    "-v", "error", "-y",
    "-f", "concat", "-safe", "0", "-i", list,
    "-c", "copy",
    out,
  ]);
  return out;
}

test("F028 server-side extractTailFrame extracts final video frame as ready ref asset", async () => {
  const f = await canvasesFixture();
  try {
    const videoPath = await makeTwoColorVideo(f.directory, "two-color.mp4");
    const videoAsset = await f.asset(randomUUID().replaceAll("-", ""), "video");
    await f.db.query("UPDATE assets SET object_key=$2 WHERE id=$1", [
      videoAsset.id,
      videoAsset.id,
    ]);
    await writeFile(join(f.directory, videoAsset.id), await readFile(videoPath));

    const project = await f.canvases.create(f.admin, { title: "尾帧续接测试" });
    const docRow = await one(f.db, "SELECT id FROM documents WHERE public_id=$1", [
      project.id,
    ]);
    await f.db.query(
      "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
      [
        docRow.id,
        Buffer.from(
          JSON.stringify({
            nodes: [
              {
                id: "shot1",
                type: "video",
                title: "镜头一",
                x: 0,
                y: 0,
                use_media: true,
                media_id: videoAsset.public_id,
              },
            ],
            edges: [],
            shots: ["shot1"],
          }),
        ),
      ],
    );

    const extracted = await f.canvases.extractTailFrame(
      f.admin,
      project.id,
      "shot1",
    );
    assert.equal(extracted.width, 128);
    assert.equal(extracted.height, 96);
    assert.equal(extracted.source_video, videoAsset.public_id);

    const saved = await one(
      f.db,
      "SELECT * FROM assets WHERE public_id=$1",
      [extracted.asset_id],
    );
    assert.equal(saved.original_kind, "ref");
    assert.equal(saved.mime, "image/jpeg");
    assert.equal(saved.metadata.derivation, "tail_frame");
    assert.equal(saved.metadata.derived_from, videoAsset.public_id);

    // Verify extracted frame is bright green (the TAIL frame, NOT the red first frame!)
    const bytes = await f.p.storage.read(saved.object_key);
    const stats = await sharp(bytes).stats();
    const [r, g, b] = stats.channels.map((c) => c.mean);
    assert.ok(g > 180 && r < 60 && b < 60, `Expected green tail frame, got RGB(${r},${g},${b})`);
  } finally {
    await f.cleanup();
  }
});

test("F028 overlap-frame deduplication trims leading frames on tailInherited continuation shots", async () => {
  const f = await canvasesFixture();
  try {
    const clip = await makeTwoColorVideo(f.directory, "clip.mp4");
    const materialize = async (_key: string, dest: string) => {
      await writeFile(dest, await readFile(clip));
    };

    const dirNormal = join(f.directory, "normal");
    const dirTrimmed = join(f.directory, "trimmed");
    await exec("mkdir", ["-p", dirNormal, dirTrimmed]);

    const normal = await originalStoryboard.compose(
      [
        { node: "s1", title: "1", video: "a", voice: null, text: "" },
        { node: "s2", title: "2", video: "a", voice: null, text: "" },
      ],
      dirNormal,
      materialize,
      AbortSignal.timeout(30_000),
    );
    const trimmed = await originalStoryboard.compose(
      [
        { node: "s1", title: "1", video: "a", voice: null, text: "" },
        {
          node: "s2",
          title: "2",
          video: "a",
          voice: null,
          text: "",
          tailInherited: true,
          trimLeadingFrames: 3,
        },
      ],
      dirTrimmed,
      materialize,
      AbortSignal.timeout(30_000),
    );
    assert.ok(
      trimmed.duration < normal.duration - 0.06,
      `Expected trimmed duration (${trimmed.duration}) < normal (${normal.duration})`,
    );
  } finally {
    await f.cleanup();
  }
});

test("F028 parent_tail_job_id holds child until parent finishes, injects tail ref on success and refunds on failure", async () => {
  const f = await canvasesFixture();
  try {
    const videoPath = await makeTwoColorVideo(f.directory, "parent.mp4");
    const videoAsset = await f.asset(randomUUID().replaceAll("-", ""), "video");
    await f.db.query("UPDATE assets SET object_key=$2 WHERE id=$1", [
      videoAsset.id,
      videoAsset.id,
    ]);
    await writeFile(join(f.directory, videoAsset.id), await readFile(videoPath));

    const parent = await f.job(950, "video", "completed", videoAsset.id);
    const child = await f.job(951, "video", "queued");
    await f.db.query("UPDATE jobs SET input=$2 WHERE id=$1", [
      child.id,
      JSON.stringify({
        prompt: "续接镜头",
        references: [],
        params: { h3_inputs: { mode: "frames", first_frame: null } },
      }),
    ]);
    await f.db.query(
      "INSERT INTO job_tail_chains(child_job_id,parent_job_id) VALUES($1,$2)",
      [child.id, parent.id],
    );

    const executor = new Executor(f.p);
    // Child waiting on job_tail_chains must not be claimed or returned by queueReady
    const readyBefore = await executor.queueReady();
    assert.equal(
      readyBefore.some((r) => r.id === child.id),
      false,
      "Child waiting in job_tail_chains must not be dispatched",
    );

    // Parent completion wakes child and injects extracted tail frame ref asset
    const woken = await wakeTailFrameChildren(
      f.p,
      {
        id: parent.id,
        workspace_id: f.workspace.id,
        owner_id: f.admin.id,
        kind: "video",
      },
      "completed",
      videoAsset.id,
      AbortSignal.timeout(30_000),
    );
    assert.equal(woken, 1);

    const updatedChild = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [
      child.id,
    ]);
    const remainingChain = await one(
      f.db,
      "SELECT 1 FROM job_tail_chains WHERE child_job_id=$1",
      [child.id],
    );
    assert.equal(remainingChain, undefined);
    assert.equal(updatedChild.input.references.length, 1);
    const tailAssetId = updatedChild.input.references[0];
    assert.equal(updatedChild.input.params.h3_inputs.first_frame, tailAssetId);
    assert.equal(
      updatedChild.input.params.tail_inherited_from,
      videoAsset.public_id,
    );
    const tailAsset = await one(f.db, "SELECT * FROM assets WHERE id=$1", [
      tailAssetId,
    ]);
    assert.equal(tailAsset.original_kind, "ref");

    // When parent fails, waiting child is settled to failed cleanly
    const failedParent = await f.job(952, "video", "failed");
    const doomedChild = await f.job(953, "video", "queued");
    await f.db.query("UPDATE jobs SET price=0 WHERE id=$1", [doomedChild.id]);
    await f.db.query(
      "INSERT INTO job_tail_chains(child_job_id,parent_job_id) VALUES($1,$2)",
      [doomedChild.id, failedParent.id],
    );
    const settled = await wakeTailFrameChildren(
      f.p,
      {
        id: failedParent.id,
        workspace_id: f.workspace.id,
        owner_id: f.admin.id,
        kind: "video",
      },
      "failed",
      undefined,
      AbortSignal.timeout(15_000),
    );
    assert.equal(settled, 1);
    const doomedAfter = await one(f.db, "SELECT state,error FROM jobs WHERE id=$1", [
      doomedChild.id,
    ]);
    assert.equal(doomedAfter.state, "failed");
    assert.match(doomedAfter.error, /前置镜头生成失败/);
  } finally {
    await f.cleanup();
  }
});
