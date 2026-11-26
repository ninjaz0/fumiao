import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { contributionProblems } from "@fumiao/plugin-sdk/contributions.js";
import { planProjectExport } from "@fumiao/platform/composition/exporters.js";
import { one } from "@fumiao/platform/db.js";
import {
  StudioPackages,
  parsePackageFile,
} from "@fumiao/platform/studio-packages.js";
import { OriginalMedia } from "@fumiao/original-api/media.js";
import { OriginalStoryboardExports } from "@fumiao/original-api/storyboard-exports.js";
import { canvasesFixture } from "../helpers/canvases.js";

const exec = promisify(execFile);

const JIANYING_REQUIRED_DIRS = [
  "qr_upload/",
  "matting/",
  "common_attachment/",
  "Resources/audioAlg/",
  "Resources/digitalHuman/",
  "Resources/restore_lut/",
  "Resources/videoAlg/",
  "subdraft/",
  "adjust_mask/",
  "assets/audio/",
  "assets/video/",
  "smart_crop/",
];

const JIANYING_54_MATERIAL_KEYS = [
  "ai_translates",
  "audio_balances",
  "audio_effects",
  "audio_fades",
  "audio_track_indexes",
  "audios",
  "beats",
  "canvases",
  "chromas",
  "color_curves",
  "common_mask",
  "digital_human_model_dressing",
  "digital_humans",
  "drafts",
  "effects",
  "flowers",
  "green_screens",
  "handwrites",
  "hsl",
  "images",
  "log_color_wheels",
  "loudnesses",
  "manual_beautys",
  "manual_deformations",
  "material_animations",
  "material_colors",
  "multi_language_refs",
  "placeholder_infos",
  "placeholders",
  "plugin_effects",
  "primary_color_wheels",
  "realtime_denoises",
  "shapes",
  "smart_crops",
  "smart_relights",
  "sound_channel_mappings",
  "speeds",
  "stickers",
  "tail_leaders",
  "text_templates",
  "texts",
  "time_marks",
  "transitions",
  "video_effects",
  "video_trackings",
  "videos",
  "vocal_beautifys",
  "vocal_separations",
  "ai_avatar_materials",
  "audio_alg_materials",
  "digital_human_backgrounds",
  "matting_materials",
  "subtitle_fragments",
  "vector_graphics",
];

const JIANYING_8_KEYFRAME_KEYS = [
  "adjusts",
  "audios",
  "effects",
  "filters",
  "handwrites",
  "stickers",
  "texts",
  "videos",
];

async function inspectZip(zipPath: string) {
  const script = `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1], "r") as zf:
    bad = zf.testzip()
    names = zf.namelist()
    texts = {}
    sizes = {}
    headers = {}
    for info in zf.infolist():
        sizes[info.filename] = info.file_size
        if info.filename.endswith((".json", ".fcpxml", ".xml", ".srt")):
            texts[info.filename] = zf.read(info.filename).decode("utf-8")
        elif info.filename.endswith(".jpg"):
            headers[info.filename] = zf.read(info.filename)[:4].hex()
    print(json.dumps({"bad": bad, "names": names, "texts": texts, "sizes": sizes, "headers": headers}))
`;
  const { stdout } = await exec("python3", ["-c", script, zipPath]);
  return JSON.parse(stdout) as {
    bad: string | null;
    names: string[];
    texts: Record<string, string>;
    sizes: Record<string, number>;
    headers: Record<string, string>;
  };
}

async function setupProjectFixture() {
  const f = await canvasesFixture();
  await f.db.query(
    "INSERT INTO studio_packages(id,version,enabled) VALUES('storyboard','1.0.0',true) ON CONFLICT DO NOTHING",
  );
  const packages = new StudioPackages(f.p);
  for (const id of ["jianying-exporter", "fcpxml-exporter"]) {
    const raw = JSON.parse(
      await readFile(`plugins/${id}/${id}.fmplugin.json`, "utf8"),
    );
    parsePackageFile(raw);
    await packages.install(f.admin, raw);
    const rev = (
      await one(f.db, "SELECT revision FROM studio_packages WHERE id=$1", [id])
    ).revision;
    await packages.change(f.admin, id, rev, "enable");
  }

  const video = await f.asset(randomUUID().replaceAll("-", ""), "video");
  const voice = await f.asset(randomUUID().replaceAll("-", ""), "audio");
  for (const a of [video, voice])
    await f.db.query("UPDATE assets SET object_key=$2 WHERE id=$1", [
      a.id,
      a.id,
    ]);
  const vPath = join(f.directory, video.id);
  const aPath = join(f.directory, voice.id);
  await exec("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:s=320x180:r=24:d=0.6",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    vPath + ".mp4",
  ]);
  await exec("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.8",
    "-c:a",
    "pcm_s16le",
    aPath + ".wav",
  ]);
  const videoBytes = await readFile(vPath + ".mp4");
  const audioBytes = await readFile(aPath + ".wav");
  await writeFile(vPath, videoBytes);
  await writeFile(aPath, audioBytes);

  const job = await f.job(901, "audio", "completed", voice.id);
  await f.db.query("UPDATE jobs SET input=$2 WHERE id=$1", [
    job.id,
    JSON.stringify({ prompt: "你好，剪映。\x00第二句！" }),
  ]);
  const project = await f.canvases.create(f.admin, { title: "第一集开场" });
  const doc = {
    nodes: [
      {
        id: "shot1",
        type: "video",
        title: "镜头一",
        x: 0,
        y: 0,
        use_media: true,
        media_id: video.public_id,
        narration_job: 901,
        narration_text: "你好，剪映。\x00第二句！",
      },
    ],
    edges: [],
    shots: ["shot1"],
  };
  const docRow = await one(f.db, "SELECT id FROM documents WHERE public_id=$1", [
    project.id,
  ]);
  await f.db.query(
    "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
    [docRow.id, Buffer.from(JSON.stringify(doc))],
  );

  return {
    ...f,
    video,
    voice,
    videoBytes,
    audioBytes,
    project,
    docRow,
    doc,
    service: new OriginalStoryboardExports(f.p, undefined, undefined, f.directory),
  };
}

test("F003 Jianying draft ZIP exporter generates valid archive, 54 material keys, 12 dirs, cache reuse and access isolation", async () => {
  const f = await setupProjectFixture();
  try {
    const listedBefore = await f.service.list(f.admin, f.project.id);
    const exporterKeys = listedBefore.exporters.map((e) => e.key);
    assert.ok(exporterKeys.includes("storyboard/mp4"));
    assert.ok(exporterKeys.includes("jianying-exporter/draft-zip"));
    assert.ok(exporterKeys.includes("fcpxml-exporter/bundle-zip"));
    assert.ok(exporterKeys.includes("fcpxml-exporter/xml"));
    const jyMeta = listedBefore.exporters.find(
      (e) => e.key === "jianying-exporter/draft-zip",
    )!;
    assert.equal(jyMeta.output_kind, "project");
    assert.equal(jyMeta.file_extension, "zip");

    const created = await f.service.create(f.admin, f.project.id, {
      uid: randomUUID(),
      expected_revision: 1,
      exporter: "jianying-exporter/draft-zip",
    });
    assert.equal(created.state, "queued");
    assert.equal(created.output_kind, "project");
    assert.equal(created.exporter, "jianying-exporter/draft-zip");

    const row = await one(
      f.db,
      "SELECT id FROM storyboard_exports WHERE public_id=$1",
      [created.id],
    );
    await f.service.execute(row.id);

    const listedAfter = await f.service.list(f.admin, f.project.id);
    const done = listedAfter.exports.find((e) => e.id === created.id)!;
    assert.equal(done.state, "done", done.error);
    assert.equal(done.output_kind, "project");
    assert.equal(done.output_mime, "application/zip");
    assert.ok(done.output_filename?.endsWith(".zip"));
    assert.ok(done.result);

    // No fake video history job created for project bundle exports
    const fakeJobs = await one(
      f.db,
      "SELECT count(*)::int AS n FROM jobs WHERE plugin_id='original-storyboard'",
    );
    assert.equal(fakeJobs.n, 0);

    // Asset stored with original_kind = 'export' and protected by OriginalMedia
    const asset = await one(f.db, "SELECT * FROM assets WHERE public_id=$1", [
      done.result,
    ]);
    assert.equal(asset.original_kind, "export");
    assert.equal(asset.mime, "application/zip");
    const media = new OriginalMedia(f.p);
    await media.resource(f.db, f.admin, done.result!);
    await assert.rejects(
      media.resource(f.db, f.member, done.result!),
      /无权访问/,
    );

    // Inspect ZIP integrity & Jianying 5.x schema compliance
    const zipInfo = await inspectZip(join(f.directory, asset.object_key));
    assert.equal(zipInfo.bad, null, "ZIP CRC integrity must pass");
    for (const dir of JIANYING_REQUIRED_DIRS) {
      assert.ok(
        zipInfo.names.includes(dir),
        `Missing mandatory Jianying directory: ${dir}`,
      );
    }

    assert.ok(zipInfo.texts["draft_content.json"], "draft_content.json must exist");
    const draft = JSON.parse(zipInfo.texts["draft_content.json"]);
    assert.equal(draft.version, 360000);
    assert.equal(draft.canvas_config.width, 320);
    assert.equal(draft.canvas_config.height, 180);
    assert.equal(JIANYING_54_MATERIAL_KEYS.length, 54);
    for (const key of JIANYING_54_MATERIAL_KEYS) {
      assert.ok(
        Object.hasOwn(draft.materials, key),
        `Missing Jianying materials.${key}`,
      );
    }
    for (const key of JIANYING_8_KEYFRAME_KEYS) {
      assert.ok(
        Object.hasOwn(draft.keyframes, key),
        `Missing Jianying keyframes.${key}`,
      );
    }
    assert.equal(draft.materials.videos.length, 1);
    assert.match(
      draft.materials.videos[0].path,
      /^##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##\/assets\/video\//,
    );
    assert.equal(draft.materials.videos[0].duration % 1000, 0);
    assert.equal(draft.materials.audios.length, 1);
    assert.ok(draft.materials.texts.length >= 1);
    assert.ok(draft.tracks.some((t: { type: string }) => t.type === "video"));
    assert.ok(draft.tracks.some((t: { type: string }) => t.type === "audio"));
    assert.ok(draft.tracks.some((t: { type: string }) => t.type === "text"));

    assert.ok(
      zipInfo.texts["draft_meta_info.json"],
      "draft_meta_info.json must exist",
    );
    const meta = JSON.parse(zipInfo.texts["draft_meta_info.json"]);
    assert.equal(meta.draft_name, "第一集开场");

    assert.equal(zipInfo.headers["draft_cover.jpg"]?.slice(0, 4), "ffd8");

    const videoZipEntry = zipInfo.names.find((n) =>
      n.startsWith("assets/video/shot_001"),
    )!;
    const audioZipEntry = zipInfo.names.find((n) =>
      n.startsWith("assets/audio/shot_001"),
    )!;
    assert.equal(zipInfo.sizes[videoZipEntry], f.videoBytes.length);
    assert.equal(zipInfo.sizes[audioZipEntry], f.audioBytes.length);

    // ArcReel basis_hash cache hit: new UID on unchanged canvas reuses result immediately!
    const cached = await f.service.create(f.admin, f.project.id, {
      uid: randomUUID(),
      expected_revision: 1,
      exporter: "jianying-exporter/draft-zip",
    });
    assert.equal(cached.state, "done");
    assert.equal(cached.result, done.result);

    // Mutating shot title invalidates basis_hash and queues a fresh export
    const updatedDoc = {
      ...f.doc,
      nodes: [{ ...f.doc.nodes[0], title: "镜头一改名" }],
    };
    await f.db.query(
      "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
      [f.docRow.id, Buffer.from(JSON.stringify(updatedDoc))],
    );
    await f.db.query("UPDATE documents SET revision=2 WHERE id=$1", [
      f.docRow.id,
    ]);
    const refreshed = await f.service.create(f.admin, f.project.id, {
      uid: randomUUID(),
      expected_revision: 2,
      exporter: "jianying-exporter/draft-zip",
    });
    assert.equal(refreshed.state, "queued");
  } finally {
    await f.cleanup();
  }
});

test("F021 FCPXML 1.11 exporter supports both ZIP bundle and standalone XML with rational ticks and lanes", async () => {
  const f = await setupProjectFixture();
  try {
    // 1. ZIP bundle
    const bundleCreated = await f.service.create(f.admin, f.project.id, {
      uid: randomUUID(),
      expected_revision: 1,
      exporter: "fcpxml-exporter/bundle-zip",
    });
    const bundleRow = await one(
      f.db,
      "SELECT id FROM storyboard_exports WHERE public_id=$1",
      [bundleCreated.id],
    );
    await f.service.execute(bundleRow.id);
    const bundleDone = (await f.service.list(f.admin, f.project.id)).exports.find(
      (e) => e.id === bundleCreated.id,
    )!;
    assert.equal(bundleDone.state, "done", bundleDone.error);
    assert.equal(bundleDone.output_mime, "application/zip");
    assert.ok(bundleDone.output_filename?.endsWith(".zip"));

    const bundleAsset = await one(
      f.db,
      "SELECT * FROM assets WHERE public_id=$1",
      [bundleDone.result],
    );
    const zipInfo = await inspectZip(join(f.directory, bundleAsset.object_key));
    assert.equal(zipInfo.bad, null);
    const fcpxmlEntry = zipInfo.names.find((n) => n.endsWith(".fcpxml"))!;
    assert.ok(fcpxmlEntry, "FCPXML file must be present in ZIP bundle");
    const xml = zipInfo.texts[fcpxmlEntry];
    assert.match(xml, /<!DOCTYPE fcpxml>/);
    assert.match(xml, /<fcpxml version="1\.11">/);
    assert.match(xml, /hasVideo="1"/);
    assert.match(xml, /lane="-1"/);
    assert.match(xml, /lane="1"/);
    assert.ok(!xml.includes("\x00"), "NUL control characters must be stripped");
    assert.ok(
      zipInfo.names.some((n) => n.startsWith("media/shot_001")),
      "Video file copied into bundle media/",
    );
    assert.ok(
      zipInfo.names.some((n) => n.startsWith("media/shot_001") && n.includes("_voice")),
      "Voice file copied into bundle media/",
    );

    // 2. Standalone XML export
    const xmlCreated = await f.service.create(f.admin, f.project.id, {
      uid: randomUUID(),
      expected_revision: 1,
      exporter: "fcpxml-exporter/xml",
    });
    const xmlRow = await one(
      f.db,
      "SELECT id FROM storyboard_exports WHERE public_id=$1",
      [xmlCreated.id],
    );
    await f.service.execute(xmlRow.id);
    const xmlDone = (await f.service.list(f.admin, f.project.id)).exports.find(
      (e) => e.id === xmlCreated.id,
    )!;
    assert.equal(xmlDone.state, "done", xmlDone.error);
    assert.equal(xmlDone.output_mime, "application/xml");
    assert.ok(xmlDone.output_filename?.endsWith(".fcpxml"));

    const xmlAsset = await one(f.db, "SELECT * FROM assets WHERE public_id=$1", [
      xmlDone.result,
    ]);
    const rawXml = await readFile(join(f.directory, xmlAsset.object_key), "utf8");
    assert.match(rawXml, /<fcpxml version="1\.11">/);
    assert.match(rawXml, /<spine>/);
  } finally {
    await f.cleanup();
  }
});

test("project export sandbox rejects path traversal, unauthorized assets, duplicate paths and invalid exporter metadata", async () => {
  const input = {
    project: {
      id: "proj1",
      title: "test",
      revision: 1,
      fps: 24,
      width: 1920,
      height: 1080,
    },
    shots: [
      {
        index: 0,
        node: "s1",
        title: "shot",
        video: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        videoDurationMs: 1000,
        videoWidth: 1920,
        videoHeight: 1080,
        videoFps: 24,
        videoHasAudio: false,
        videoExt: ".mp4",
        voice: null,
        voiceDurationMs: 0,
        voiceExt: ".wav",
        text: "",
        subtitles: [],
      },
    ],
  };

  // Path traversal blocked
  await assert.rejects(
    planProjectExport(
      '({export:()=>({format:"zip",filename:"out.zip",files:[{path:"../evil.json",content:"{}"}]})})',
      input,
    ),
    /无效的打包清单/,
  );

  // Unauthorized assetId blocked
  await assert.rejects(
    planProjectExport(
      '({export:()=>({format:"zip",filename:"out.zip",files:[{path:"a.json",content:"{}"}],mediaCopies:[{assetId:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",archivePath:"media/x.mp4"}]})})',
      input,
    ),
    /未授权的媒体资产/,
  );

  // Duplicate archive paths blocked (case-insensitive)
  await assert.rejects(
    planProjectExport(
      '({export:()=>({format:"zip",filename:"out.zip",files:[{path:"a/file.json",content:"{}"},{path:"A/FILE.json",content:"{}"}]})})',
      input,
    ),
    /重复归档路径/,
  );

  // Text format with multiple files blocked
  await assert.rejects(
    planProjectExport(
      '({export:()=>({format:"text",filename:"out.fcpxml",files:[{path:"a.fcpxml",content:"<a/>"},{path:"b.fcpxml",content:"<b/>"}]})})',
      input,
    ),
    /单个输出文件/,
  );

  // Contribution validator rejects outputKind="project" with video/mp4
  const problems = contributionProblems(
    {
      version: 1,
      hostCapabilities: ["media"],
      exporters: [
        {
          id: "bad",
          title: "Bad",
          outputKind: "project",
          mime: "video/mp4",
          program: "({export:()=>({})})",
        },
      ],
      settingsPages: [],
    },
    { mode: "request", hasProgram: false },
  );
  assert.ok(
    problems.some((p) => p.includes("不能声明 video/mp4")),
    `Expected video/mp4 rejection, got: ${JSON.stringify(problems)}`,
  );
});
