import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { one } from "@fumiao/platform/db.js";
import { originalStoryboard } from "@fumiao/platform/composition/renderer.js";
import { StudioPackages, parsePackageFile } from "@fumiao/platform/studio-packages.js";
import {
  parseDialogueScript,
  resolveSpeakerVoice,
} from "@fumiao/original-api/dialogue.js";
import { OriginalPacks } from "@fumiao/original-api/packs.js";
import { OriginalStoryboardExports } from "@fumiao/original-api/storyboard-exports.js";
import { canvasesFixture } from "../helpers/canvases.js";

const exec = promisify(execFile);

async function inspectZip(zipPath: string) {
  const script = `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1], "r") as zf:
    bad = zf.testzip()
    names = zf.namelist()
    texts = {n: zf.read(n).decode("utf-8") for n in names if n.endswith((".json", ".fcpxml"))}
    print(json.dumps({"bad": bad, "names": names, "texts": texts}))
`;
  const { stdout } = await exec("python3", ["-c", script, zipPath]);
  return JSON.parse(stdout) as {
    bad: string | null;
    names: string[];
    texts: Record<string, string>;
  };
}

async function makeTestMedia(dir: string) {
  const videoNoAudio = join(dir, "v-silent.mp4");
  const videoWithAudio = join(dir, "v-av.mp4");
  const voice1 = join(dir, "voice1.wav");
  const voice2 = join(dir, "voice2.wav");
  const bgm = join(dir, "bgm.mp3");

  await exec("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=blue:s=160x96:r=24:d=0.6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    videoNoAudio,
  ]);
  await exec("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=purple:s=160x96:r=24:d=0.6",
    "-f", "lavfi", "-i", "sine=frequency=220:duration=0.6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    videoWithAudio,
  ]);
  await exec("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=520:duration=0.5",
    "-c:a", "pcm_s16le",
    voice1,
  ]);
  await exec("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=680:duration=0.4",
    "-c:a", "pcm_s16le",
    voice2,
  ]);
  await exec("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=180:duration=1.5",
    "-c:a", "libmp3lame", "-b:a", "128k",
    bgm,
  ]);
  return { videoNoAudio, videoWithAudio, voice1, voice2, bgm };
}

test("F014 + F033 BGM auto-ducking, loudnorm mastering and propagation to Jianying/FCPXML bundles", async () => {
  const f = await canvasesFixture();
  try {
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

    const media = await makeTestMedia(f.directory);
    const video = await f.asset(randomUUID().replaceAll("-", ""), "video");
    const voice = await f.asset(randomUUID().replaceAll("-", ""), "audio");
    const bgmAsset = await f.asset(randomUUID().replaceAll("-", ""), "audio");
    await f.db.query("UPDATE assets SET mime='audio/mpeg' WHERE id=$1", [
      bgmAsset.id,
    ]);
    for (const [asset, srcPath] of [
      [video, media.videoNoAudio],
      [voice, media.voice1],
      [bgmAsset, media.bgm],
    ] as const) {
      await f.db.query("UPDATE assets SET object_key=$2 WHERE id=$1", [
        asset.id,
        asset.id,
      ]);
      await writeFile(join(f.directory, asset.id), await readFile(srcPath));
    }

    const voiceJob = await f.job(910, "audio", "completed", voice.id);
    await f.db.query("UPDATE jobs SET input=$2 WHERE id=$1", [
      voiceJob.id,
      JSON.stringify({ prompt: "旁白响起时背景音乐自动闪避。" }),
    ]);

    const project = await f.canvases.create(f.admin, { title: "混音测试片" });
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
          narration_job: 910,
          narration_text: "旁白响起时背景音乐自动闪避。",
        },
      ],
      edges: [],
      shots: ["shot1"],
      bgm: {
        asset_id: bgmAsset.public_id,
        volume: 0.4,
        ducking: true,
        loop: true,
      },
      loudnorm: true,
    };
    const docRow = await one(f.db, "SELECT id FROM documents WHERE public_id=$1", [
      project.id,
    ]);
    await f.db.query(
      "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
      [docRow.id, Buffer.from(JSON.stringify(doc))],
    );

    const service = new OriginalStoryboardExports(
      f.p,
      undefined,
      undefined,
      f.directory,
    );

    // 1. MP4 composition with BGM + sidechain auto-ducking + EBU R128 loudnorm
    const created = await service.create(f.admin, project.id, {
      uid: randomUUID(),
      expected_revision: 1,
    });
    const row = await one(
      f.db,
      "SELECT id FROM storyboard_exports WHERE public_id=$1",
      [created.id],
    );
    // BGM asset is protected in storyboard_export_refs before execution completes
    const refs = (
      await f.db.query(
        "SELECT asset_id FROM storyboard_export_refs WHERE export_id=$1",
        [row.id],
      )
    ).rows.map((r) => r.asset_id);
    assert.ok(refs.includes(bgmAsset.id), "BGM must be protected by export refs");

    await service.execute(row.id);
    const done = (await service.list(f.admin, project.id)).exports[0];
    assert.equal(done.state, "done", done.error);
    const outAsset = await one(
      f.db,
      "SELECT * FROM assets WHERE public_id=$1",
      [done.result],
    );
    const probeOut = JSON.parse(
      (
        await exec("ffprobe", [
          "-v", "error", "-show_streams", "-show_format", "-of", "json",
          join(f.directory, outAsset.object_key),
        ])
      ).stdout,
    );
    assert.ok(
      probeOut.streams.some(
        (s: { codec_name: string; channels?: number }) =>
          s.codec_name === "aac" && s.channels === 2,
      ),
    );
    assert.ok(
      probeOut.streams.some(
        (s: { codec_name: string }) => s.codec_name === "mov_text",
      ),
    );

    // 2. Jianying ZIP includes dedicated BGM track & copied bgm_track.mp3
    const jyCreated = await service.create(f.admin, project.id, {
      uid: randomUUID(),
      expected_revision: 1,
      exporter: "jianying-exporter/draft-zip",
    });
    const jyRow = await one(
      f.db,
      "SELECT id FROM storyboard_exports WHERE public_id=$1",
      [jyCreated.id],
    );
    await service.execute(jyRow.id);
    const jyDone = (await service.list(f.admin, project.id)).exports.find(
      (e) => e.id === jyCreated.id,
    )!;
    assert.equal(jyDone.state, "done", jyDone.error);
    const jyAsset = await one(
      f.db,
      "SELECT object_key FROM assets WHERE public_id=$1",
      [jyDone.result],
    );
    const jyZip = await inspectZip(join(f.directory, jyAsset.object_key));
    assert.equal(jyZip.bad, null);
    assert.ok(jyZip.names.some((n) => n.startsWith("assets/audio/bgm_track")));
    const jyDraft = JSON.parse(jyZip.texts["draft_content.json"]);
    assert.ok(
      jyDraft.tracks.some(
        (t: { type: string; name: string }) => t.type === "audio" && t.name === "BGM",
      ),
    );

    // 3. FCPXML ZIP includes lane="-2" role="music" BGM clip
    const fcpCreated = await service.create(f.admin, project.id, {
      uid: randomUUID(),
      expected_revision: 1,
      exporter: "fcpxml-exporter/bundle-zip",
    });
    const fcpRow = await one(
      f.db,
      "SELECT id FROM storyboard_exports WHERE public_id=$1",
      [fcpCreated.id],
    );
    await service.execute(fcpRow.id);
    const fcpDone = (await service.list(f.admin, project.id)).exports.find(
      (e) => e.id === fcpCreated.id,
    )!;
    assert.equal(fcpDone.state, "done", fcpDone.error);
    const fcpAsset = await one(
      f.db,
      "SELECT object_key FROM assets WHERE public_id=$1",
      [fcpDone.result],
    );
    const fcpZip = await inspectZip(join(f.directory, fcpAsset.object_key));
    assert.equal(fcpZip.bad, null);
    const xml = fcpZip.texts[fcpZip.names.find((n) => n.endsWith(".fcpxml"))!];
    assert.match(xml, /lane="-2"[^>]*role="music"/);
  } finally {
    await f.cleanup();
  }
});

test("F020 native video audio strategy supports keep_original, mix and replace modes", async () => {
  const f = await canvasesFixture();
  try {
    const media = await makeTestMedia(f.directory);
    const files: Record<string, string> = {
      vid: media.videoWithAudio,
      vox: media.voice1,
    };
    const materialize = async (key: string, dest: string) => {
      await writeFile(dest, await readFile(files[key]));
    };

    for (const strategy of ["keep_original", "mix", "replace"] as const) {
      const subDir = join(f.directory, "out-" + strategy);
      await exec("mkdir", ["-p", subDir]);
      const res = await originalStoryboard.compose(
        [
          {
            node: "s1",
            title: "镜头",
            video: "vid",
            voice: "vox",
            text: "测试配音",
            audioStrategy: strategy,
            originalGain: 0.25,
          },
        ],
        subDir,
        materialize,
        AbortSignal.timeout(30_000),
      );
      assert.ok(res.duration > 0.4);
      if (strategy === "keep_original") {
        assert.equal(res.subtitles, "");
      } else {
        assert.match(res.subtitles, /测试配音/);
      }
    }
  } finally {
    await f.cleanup();
  }
});

test("F032 character AssetPack voice_profile & F027 multi-speaker dialogue parser, matcher and composition", async () => {
  const f = await canvasesFixture();
  try {
    await f.db.query(
      "INSERT INTO studio_packages(id,version,enabled) VALUES('storyboard','1.0.0',true) ON CONFLICT DO NOTHING",
    );
    const packs = new OriginalPacks(f.p);
    const refImg = await f.asset(randomUUID().replaceAll("-", ""), "ref");

    // 1. Parse multi-speaker script
    const parsed = parseDialogueScript(
      "林墨：今天这场雨不对劲。\n苏青（紧张）：快看窗外！\n无名台词",
    );
    assert.deepEqual(parsed, [
      { speaker: "林墨", text: "今天这场雨不对劲。" },
      { speaker: "苏青", emotion: "紧张", text: "快看窗外！" },
      { speaker: "旁白", text: "无名台词" },
    ]);

    // 2. Save character AssetPacks with voice_profile (F032)
    const linMo = await packs.save(f.admin, {
      name: "林墨",
      purpose: "subject",
      description: "黑衣侦探",
      media: [refImg.public_id],
      voice_profile: {
        model: "edge-tts",
        voice_id: "zh-CN-YunxiNeural",
        rate: "-10%",
        emotion: "冷静",
        instruction: "低沉克制",
      },
    });
    assert.equal(linMo.voice_profile?.voice_id, "zh-CN-YunxiNeural");

    const suQing = await packs.save(f.admin, {
      name: "苏青",
      purpose: "subject",
      description: "搭档女记者",
      media: [refImg.public_id],
      voice_profile: {
        model: "tts-1",
        voice_id: "nova",
        instruction: "干练清脆",
      },
    });
    assert.equal(suQing.voice_profile?.voice_id, "nova");

    // Verify list returns voice_profile
    const listed = await packs.list(f.admin);
    assert.equal(
      listed.packs.find((p) => p.id === linMo.id)?.voice_profile?.voice_id,
      "zh-CN-YunxiNeural",
    );

    // Cross-workspace ref_audio_asset_id rejected
    const otherAudio = await f.asset(
      randomUUID().replaceAll("-", ""),
      "audio",
      f.memberSpace,
      f.member,
    );
    await assert.rejects(
      packs.save(f.admin, {
        name: "非法声线",
        purpose: "subject",
        description: "",
        media: [refImg.public_id],
        voice_profile: { ref_audio_asset_id: otherAudio.public_id },
      }),
      /参考音频不存在或无权访问/,
    );

    // 3. Auto-match speaker to character pack voice_profile (F027 + F032)
    const resolvedLin = await resolveSpeakerVoice(f.db, f.workspace.id, {
      speaker: "林墨",
    });
    assert.equal(resolvedLin.packId, linMo.id);
    assert.equal(resolvedLin.model, "edge-tts");
    assert.equal(resolvedLin.voiceId, "zh-CN-YunxiNeural");
    assert.equal(resolvedLin.rate, "-10%");
    assert.match(resolvedLin.instruction, /冷静/);

    const resolvedOverride = await resolveSpeakerVoice(f.db, f.workspace.id, {
      speaker: "苏青",
      voice_id: "shimmer",
    });
    assert.equal(resolvedOverride.packId, suQing.id);
    assert.equal(resolvedOverride.model, "tts-1");
    assert.equal(resolvedOverride.voiceId, "shimmer");

    // 4. Multi-speaker dialogue composition produces concatenated voice track & speaker-labeled SRT
    const media = await makeTestMedia(f.directory);
    const video = await f.asset(randomUUID().replaceAll("-", ""), "video");
    const v1 = await f.asset(randomUUID().replaceAll("-", ""), "audio");
    const v2 = await f.asset(randomUUID().replaceAll("-", ""), "audio");
    for (const [asset, srcPath] of [
      [video, media.videoNoAudio],
      [v1, media.voice1],
      [v2, media.voice2],
    ] as const) {
      await f.db.query("UPDATE assets SET object_key=$2 WHERE id=$1", [
        asset.id,
        asset.id,
      ]);
      await writeFile(join(f.directory, asset.id), await readFile(srcPath));
    }
    const j1 = await f.job(921, "audio", "completed", v1.id);
    const j2 = await f.job(922, "audio", "completed", v2.id);
    await f.db.query("UPDATE jobs SET input=$2 WHERE id=$1", [
      j1.id,
      JSON.stringify({ prompt: "今天这场雨不对劲。" }),
    ]);
    await f.db.query("UPDATE jobs SET input=$2 WHERE id=$1", [
      j2.id,
      JSON.stringify({ prompt: "快看窗外！" }),
    ]);

    const project = await f.canvases.create(f.admin, { title: "双人对白镜头" });
    const doc = {
      nodes: [
        {
          id: "shot1",
          type: "video",
          title: "雨夜对话",
          x: 0,
          y: 0,
          use_media: true,
          media_id: video.public_id,
          dialogue_lines: [
            {
              id: "line1",
              speaker: "林墨",
              text: "今天这场雨不对劲。",
              audio_job: 921,
            },
            {
              id: "line2",
              speaker: "苏青",
              text: "快看窗外！",
              audio_job: 922,
            },
          ],
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

    const service = new OriginalStoryboardExports(
      f.p,
      undefined,
      undefined,
      f.directory,
    );
    const created = await service.create(f.admin, project.id, {
      uid: randomUUID(),
      expected_revision: 1,
    });
    const row = await one(
      f.db,
      "SELECT id FROM storyboard_exports WHERE public_id=$1",
      [created.id],
    );
    await service.execute(row.id);
    const done = (await service.list(f.admin, project.id)).exports[0];
    assert.equal(done.state, "done", done.error);
    const srt = await service.subtitles(f.admin, done.id);
    assert.match(srt.body, /林墨：今天这场雨不对劲。/);
    assert.match(srt.body, /苏青：快看窗外！/);
  } finally {
    await f.cleanup();
  }
});
