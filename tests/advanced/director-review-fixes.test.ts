import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import sharp from "sharp";
import { one } from "@fumiao/platform/db.js";
import { ensureBuiltinEdgeTts } from "@fumiao/platform/tts/edge-plugin.js";
import {
  directorAdoptionBasis,
  directorExportAssetBusy,
  type DirectorProduction,
} from "@fumiao/web-compat/director.js";
import { OriginalBatchPrecheck } from "@fumiao/original-api/batch-precheck.js";
import { OriginalCanvasRuns } from "@fumiao/original-api/canvas-runs.js";
import { OriginalModelAccess } from "@fumiao/original-api/model-access.js";
import { OriginalPacks } from "@fumiao/original-api/packs.js";
import { OriginalStoryboardExports } from "@fumiao/original-api/storyboard-exports.js";
import { canvasesFixture } from "../helpers/canvases.js";

const exec = promisify(execFile);

test(
  "episode export pre-locks referenced packs with NOWAIT before locking shot assets",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await canvasesFixture();
    t.after(() => f.cleanup());
    await f.db.query(
      "INSERT INTO studio_packages(id,version,enabled) VALUES('storyboard','1.0.0',true) ON CONFLICT DO NOTHING",
    );
    await ensureBuiltinEdgeTts(f.p);

    const video = await f.asset(randomUUID().replaceAll("-", ""), "video");
    const voice = await f.asset(randomUUID().replaceAll("-", ""), "audio");
    const refImg = await f.asset(randomUUID().replaceAll("-", ""), "ref");
    for (const a of [video, voice, refImg]) {
      await f.db.query("UPDATE assets SET object_key=$2 WHERE id=$1", [
        a.id,
        a.id,
      ]);
    }
    const v = join(f.directory, video.id);
    const a = join(f.directory, voice.id);
    await exec("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=96x64:r=24:d=0.5",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      v + ".mp4",
    ]);
    await exec("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=400:duration=1",
      "-c:a",
      "pcm_s16le",
      a + ".wav",
    ]);
    await writeFile(v, await readFile(v + ".mp4"));
    await writeFile(a, await readFile(a + ".wav"));
    await writeFile(
      join(f.directory, refImg.id),
      await sharp({
        create: { width: 64, height: 64, channels: 3, background: "#336699" },
      })
        .png()
        .toBuffer(),
    );

    const audioJob = await f.job(900, "audio", "completed", voice.id);
    await f.db.query("UPDATE jobs SET input=$2 WHERE id=$1", [
      audioJob.id,
      JSON.stringify({ prompt: "旁白" }),
    ]);

    const packs = new OriginalPacks(f.p);
    const pack = await packs.save(
      f.admin,
      {
        name: "林默",
        purpose: "subject",
        media: [refImg.public_id],
        voice_profile: { model: "edge-tts", voice_id: "zh-CN-XiaoxiaoNeural" },
      },
      String(f.workspace.public_id),
    );

    const project = await f.canvases.create(f.admin, { title: "锁顺序成片" });
    const projectRow = await one(
      f.db,
      "SELECT id FROM documents WHERE public_id=$1",
      [project.id],
    );
    await f.db.query(
      `INSERT INTO workspace_script_documents(id, public_id, workspace_id, owner_id, path, revision)
       SELECT $1,$2,workspace_id,owner_id,'主剧本.md',1 FROM documents WHERE id=$3`,
      [randomUUID(), "c".repeat(32), projectRow.id],
    );

    const shotIds = ["shot"];
    const directorBase: DirectorProduction = {
      script_id: "c".repeat(32),
      script_revision: 1,
      shot_ids: shotIds,
      order_basis: createHash("sha256")
        .update(JSON.stringify(shotIds))
        .digest("hex"),
    };
    const draftDoc: any = {
      nodes: [
        {
          id: "shot",
          type: "video",
          title: "镜头1",
          x: 0,
          y: 0,
          prompt: "主角出场",
          use_media: true,
          media_id: video.public_id,
          asset_packs: [{ id: pack.id, revision: pack.revision }],
          narration_job: 900,
          narration_text: "旁白",
        },
      ],
      edges: [],
      shots: shotIds,
      director: directorBase,
    };
    await f.db.query(
      "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
      [projectRow.id, Buffer.from(JSON.stringify(draftDoc))],
    );
    const precheck = new OriginalBatchPrecheck(f.p);
    const inputs = await precheck.directorInputs(f.admin, project.id, "shot");
    await f.link(
      project.id,
      "narration:shot",
      900,
      JSON.stringify({
        director_basis: inputs.audio_inputs["shot:narration"].basis,
      }),
    );
    const approvedDoc = {
      ...draftDoc,
      director: {
        ...directorBase,
        shots: [
          {
            node_id: "shot",
            ...(inputs.story_basis ? { story_basis: inputs.story_basis } : {}),
            ...(inputs.material_basis
              ? { material_basis: inputs.material_basis }
              : {}),
            adoption_basis: await directorAdoptionBasis(
              inputs.adoption_input_basis!,
              { media_id: video.public_id },
            ),
          },
        ],
      },
    };
    await f.db.query(
      "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
      [projectRow.id, Buffer.from(JSON.stringify(approvedDoc))],
    );

    const service = new OriginalStoryboardExports(
      f.p,
      undefined,
      undefined,
      f.directory,
    );

    // Hold FOR UPDATE on the referenced pack document in another DB session.
    let releasePack!: () => void;
    let signalLocked!: () => void;
    const packLocked = new Promise<void>((r) => {
      signalLocked = r;
    });
    const holdPack = new Promise<void>((r) => {
      releasePack = r;
    });
    const holder = f.db.transaction(async (sql) => {
      await sql.query(
        "SELECT id FROM documents WHERE public_id=$1 AND kind='pack' FOR UPDATE",
        [pack.id],
      );
      signalLocked();
      await holdPack;
    });
    await packLocked;

    try {
      const race = await Promise.race([
        service
          .create(f.admin, project.id, {
            uid: randomUUID(),
            expected_revision: 1,
            scope: "episode",
          })
          .then(
            () => "unexpected_ok",
            (err) => err,
          ),
        new Promise<"hung">((r) => setTimeout(() => r("hung"), 600)),
      ]);
      assert.notEqual(
        race,
        "hung",
        "episode export hung waiting on locked pack instead of failing fast with NOWAIT",
      );
      assert.equal((race as any).status, 409);
      assert.equal((race as any).message, directorExportAssetBusy);
    } finally {
      releasePack();
      await holder;
    }
  },
);

test("CanvasWorkspace background audio promotion passes history=false and gates polling on visibility", async () => {
  const src = await readFile(
    join(process.cwd(), "apps/web/canvas-editor/CanvasWorkspace.tsx"),
    "utf8",
  );
  assert.match(
    src,
    /promoteOrdinaryCanvasAudio[\s\S]{0,160},\s*false\s*\)/,
    "promoteOrdinaryCanvasAudio effect must pass history=false to doc.change",
  );
  assert.match(
    src,
    /directorAudioPromotion[\s\S]{0,160}changeDirectorDocument\([^,]+,\s*false\)/,
    "directorAudioPromotion effect must pass history=false to changeDirectorDocument",
  );
  assert.match(
    src,
    /document\.hidden[\s\S]{0,200}promote\(/,
    "background director audio polling should skip hidden tabs",
  );
});

test(
  "director precheck and batchRun accept decimal-priced builtin media models with script_shot_id metadata",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await canvasesFixture();
    t.after(() => f.cleanup());
    await f.db.query(
      "INSERT INTO studio_plugin_profile(mode) VALUES('compatible') ON CONFLICT DO NOTHING",
    );
    await f.db.query("UPDATE wallets SET balance=10 WHERE workspace_id=$1", [
      f.workspace.id,
    ]);

    const access = new OriginalModelAccess(f.identity);
    const conn = await access.create(f.admin, {
      base_url: "https://1.1.1.1/v1",
      api_key: "synthetic-director-img",
    });
    const draftId = randomUUID();
    await access.saveDraft(f.admin, draftId, {
      expected_revision: 0,
      connection_id: conn.id,
      connection_revision: 1,
      upstream_id: "gpt-image-1",
      purpose: "image",
      price: "0.25",
    });
    const pub = await access.publish(f.admin, {
      uid: randomUUID(),
      items: [{ draft_id: draftId, draft_revision: 1, action: "create" }],
    });
    const builtinImageModel = pub.items[0].catalog_id;

    const project = await f.canvases.create(f.admin, { title: "导演台小数计费" });
    const projectRow = await one(
      f.db,
      "SELECT id FROM documents WHERE public_id=$1",
      [project.id],
    );
    const scriptPublicId = "d".repeat(32);
    await f.db.query(
      `INSERT INTO workspace_script_documents(id, public_id, workspace_id, owner_id, path, revision)
       SELECT $1,$2,workspace_id,owner_id,'主剧本.md',1 FROM documents WHERE id=$3`,
      [randomUUID(), scriptPublicId, projectRow.id],
    );

    const shotIds = ["shot1"];
    const directorBase: DirectorProduction = {
      script_id: scriptPublicId,
      script_revision: 1,
      shot_ids: shotIds,
      order_basis: createHash("sha256")
        .update(JSON.stringify(shotIds))
        .digest("hex"),
    };
    const draftDoc: any = {
      nodes: [
        {
          id: "ref1",
          type: "image",
          title: "参考图1",
          x: 0,
          y: 0,
          prompt: "清晨街道",
          params: { model: builtinImageModel },
          extra_params: { script_shot_id: "shot-1" },
        },
        {
          id: "shot1",
          type: "video",
          title: "镜头1",
          x: 320,
          y: 0,
          prompt: "主角走过清晨街道",
        },
      ],
      edges: [{ id: "e1", source: "ref1", target: "shot1" }],
      shots: shotIds,
      director: directorBase,
    };
    await f.db.query(
      "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
      [projectRow.id, Buffer.from(JSON.stringify(draftDoc))],
    );
    const precheck = new OriginalBatchPrecheck(f.p);
    const inputs = await precheck.directorInputs(f.admin, project.id, "shot1");
    assert.ok(inputs.story_basis);

    const confirmedDoc = {
      ...draftDoc,
      director: {
        ...directorBase,
        shots: [{ node_id: "shot1", story_basis: inputs.story_basis }],
      },
    };
    await f.db.query(
      "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
      [projectRow.id, Buffer.from(JSON.stringify(confirmedDoc))],
    );

    const selection = {
      script_revision: 1,
      targets: [{ node_id: "ref1", stage: "image" as const }],
    };
    const quote = await precheck.precheckCanvas(f.admin, project.id, {
      expected_revision: 1,
      director: selection,
    });
    assert.equal(quote.summary.ready, 1);
    assert.equal(quote.summary.exact_total_credits, "0.25");
    assert.equal(quote.summary.total_credits, 0.25);

    const runs = new OriginalCanvasRuns(f.p);
    const receipt = await runs.batchRun(f.admin, project.id, {
      uid: randomUUID(),
      expected_revision: 1,
      price_revision: quote.price_revision,
      precheck_token: quote.precheck_token,
      expected_total_credits: quote.summary.exact_total_credits,
      director: selection,
    });
    assert.equal(receipt.submitted.length, 1);
    assert.equal(receipt.skipped.length, 0);
    assert.equal(receipt.exact_total_credits, "0.25");
    assert.equal(receipt.total_credits, 0.25);

    const wallet = await one(
      f.db,
      "SELECT held::text AS held FROM wallets WHERE workspace_id=$1",
      [f.workspace.id],
    );
    assert.equal(Number(wallet.held), 0.25);
  },
);
