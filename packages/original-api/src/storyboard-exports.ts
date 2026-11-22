import {
  canvasExporters,
  planComposition,
} from "@fumiao/platform/composition/exporters.js";
import { storyboardHistory } from "@fumiao/platform/composition/history.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, statfs } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { requireValue } from "@fumiao/platform/security.js";
import { capacity, EXPORT_RESERVE } from "@fumiao/platform/capacity.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import {
  originalStoryboard,
  type CompositionPlugin,
  type Shot,
} from "@fumiao/platform/composition/renderer.js";
import { webVtt } from "@fumiao/platform/composition/subtitles.js";
import { OriginalCanvases, canvasConflict } from "./canvases.js";
import { parseBody } from "./validation.js";
import { parseCanvasDocument, storyboardExportFields } from "./canvas-draft.js";
import {
  canvasBytes,
  canvasText,
  canvasDocumentJson,
} from "./canvas-values.js";

const cleanupBatchSize = 16;
type ExportObject = {
  export_id: string;
  object_key: string;
  work_token: string;
  committed: boolean;
  write_state: "unstarted" | "uncertain" | "settled";
  cleanup_attempts: number;
};

/** Original export authority shared by the opt-in HTTP API and the worker. */
export class OriginalStoryboardExports {
  readonly canvases: OriginalCanvases;
  readonly plugins: Map<string, CompositionPlugin>;
  constructor(
    readonly p: Platform,
    plugins: CompositionPlugin[] = [originalStoryboard],
    readonly clock = () => Date.now() / 1000,
    readonly stage = tmpdir(),
  ) {
    this.canvases = new OriginalCanvases(p, clock);
    this.plugins = new Map(plugins.map((p) => [p.id + "@" + p.version, p]));
  }
  async availableStageBytes() {
    const disk = await statfs(this.stage);
    return Number(disk.bavail) * Number(disk.bsize);
  }
  public(row: any) {
    return {
      id: row.public_id,
      state: row.state,
      result: row.result ?? null,
      error: canvasText(row.error),
      revision: row.revision,
      created: Number(row.created),
      updated: Number(row.updated),
    };
  }
  async list(user: Actor, key: string) {
    return this.p.db.transaction(async (sql) => {
      const project = await this.canvases.project(sql, user, key);
      const rows = (
        await sql.query(
          "SELECT e.*,a.public_id AS result FROM storyboard_exports e LEFT JOIN assets a ON a.id=e.result_id WHERE e.project_id=$1 ORDER BY e.created DESC,e.ordinal DESC LIMIT 20",
          [project.id],
        )
      ).rows;
      const exporters = (await canvasExporters(sql)).map(({ key, title }) => ({
        key,
        title,
      }));
      return { exports: rows.map((row) => this.public(row)), exporters };
    });
  }
  async subtitles(user: Actor, key: string, format: "srt" | "vtt" = "srt") {
    requireValue(!key.includes("\0"), 404, "内容不存在或无权访问");
    return this.p.db.transaction(async (sql) => {
      const row = await one(
        sql,
        "SELECT * FROM storyboard_exports WHERE public_id=$1",
        [key],
      );
      requireValue(row, 404, "内容不存在或无权访问");
      await this.canvases.library.access(
        sql,
        user,
        { kind: "asset", row },
        row.workspace_id,
      );
      requireValue(row.state === "done", 409, "字幕尚未就绪");
      const text = canvasText(row.subtitles);
      return {
        body: format === "vtt" ? webVtt(text) : text,
        mime: format === "vtt" ? "text/vtt" : "application/x-subrip",
        ...(format === "srt"
          ? { disposition: 'attachment; filename="subtitles.srt"' }
          : {}),
      };
    });
  }
  async create(user: Actor, key: string, value: unknown) {
    const body = parseBody(value, storyboardExportFields);
    const renderer = this.plugins.get("original-storyboard@1.0.0");
    requireValue(
      renderer && (await renderer.health()),
      503,
      "成片合成服务尚未配置，请联系管理员",
    );
    return this.p.db.transaction(async (sql) => {
      const project = await this.canvases.project(sql, user, key, true);
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('storyboard-accept',0))",
      );
      const old = await one(
        sql,
        "SELECT e.*,a.public_id AS result FROM storyboard_exports e LEFT JOIN assets a ON a.id=e.result_id WHERE e.owner_id=$1 AND e.uid=$2",
        [user.id, body.uid],
      );
      if (old) {
        requireValue(
          old.project_id === project.id &&
            (old.exporter_plugin
              ? old.exporter_plugin + "/" + old.exporter_id
              : "storyboard/mp4") === body.exporter,
          409,
          "提交编号已使用",
        );
        return this.public(old);
      }
      const exporter = (
        await canvasExporters(sql, body.exporter.split("/")[0])
      ).find((e) => e.key === body.exporter);
      requireValue(exporter, 503, "成片合成服务尚未配置，请联系管理员");
      requireValue(
        project.revision === body.expected_revision,
        409,
        canvasConflict,
      );
      const doc = parseCanvasDocument(canvasDocumentJson(project.document));
      requireValue(
        (doc.shots ?? []).length > 0 && (doc.shots ?? []).length <= 30,
        400,
        "合成需要 1–30 个镜头",
      );
      requireValue(
        !(await one(
          sql,
          "SELECT 1 FROM storyboard_exports WHERE workspace_id=$1 AND state IN ('queued','running')",
          [project.workspace_id],
        )),
        409,
        "当前空间已有成片在合成，请完成后再试",
      );
      requireValue(
        Number(
          (
            await one(
              sql,
              "SELECT count(*) AS n FROM storyboard_exports WHERE state IN ('queued','running')",
            )
          ).n,
        ) < 10,
        429,
        "合成队列已满，请稍后重试",
      );
      const shots: Shot[] = [],
        assets = new Map<string, any>();
      for (const [i, nid] of (doc.shots ?? []).entries()) {
        const n = doc.nodes.find((n) => n.id === nid)!;
        const media = await this.canvases.videoForShot(sql, project.id, n);
        requireValue(media, 409, `镜头 ${i + 1} 的视频尚未就绪`);
        await this.canvases.library.access(
          sql,
          user,
          { kind: "asset", row: media },
          project.workspace_id,
        );
        assets.set(media.public_id, media);
        const shot: Shot = {
          node: nid,
          title: n.title,
          video: media.public_id,
          voice: null,
          text: "",
        };
        if (n.narration_pending) {
          const pending = await one(
            sql,
            "SELECT state FROM jobs WHERE public_id=$1 AND deleted_at IS NULL FOR SHARE",
            [n.narration_pending],
          );
          requireValue(
            !pending ||
              ![
                "queued",
                "dispatching",
                "running",
                "finalizing",
                "uncertain",
              ].includes(pending.state),
            409,
            `镜头 ${i + 1} 的新旁白仍在生成，请完成后合成`,
          );
        }
        if (n.narration_job) {
          const job = await one(
            sql,
            "SELECT * FROM jobs WHERE public_id=$1 AND kind='audio' AND deleted_at IS NULL FOR SHARE",
            [n.narration_job],
          );
          const voice = job && (await this.canvases.library.result(sql, job));
          requireValue(
            job?.state === "completed" && voice,
            409,
            `镜头 ${i + 1} 的旁白尚未就绪`,
          );
          await this.canvases.library.access(
            sql,
            user,
            { kind: "job", row: job },
            project.workspace_id,
          );
          requireValue(
            pythonStrip(job.input.prompt) === pythonStrip(n.narration_text),
            409,
            `镜头 ${i + 1} 的旁白文字已修改，请重新生成旁白或移除音轨`,
          );
          await sql.query("SELECT id FROM assets WHERE id=$1 FOR SHARE", [
            voice.id,
          ]);
          shot.voice = voice.public_id;
          shot.text = job.input.prompt;
          assets.set(voice.public_id, voice);
        } else
          requireValue(
            !pythonStrip(n.narration_text),
            409,
            `镜头 ${i + 1} 已填写旁白，请先生成语音或清空旁白`,
          );
        shots.push(shot);
      }
      await capacity(sql, this.p.storage, EXPORT_RESERVE);
      requireValue(
        (await this.availableStageBytes()) >=
          [...assets.values()].reduce((sum, a) => sum + Number(a.size), 0) +
            2 * EXPORT_RESERVE +
            (1 << 30),
        507,
        "合成空间不足，请先清理素材或联系管理员",
      );
      const id = randomUUID(),
        publicId = id.replaceAll("-", ""),
        stamp = Math.floor(this.clock());
      const row = await one(
        sql,
        "INSERT INTO storyboard_exports(id,public_id,uid,owner_id,workspace_id,project_id,revision,snapshot,state,subtitles,error,created,updated,exporter_plugin,exporter_version,exporter_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9,$9,$10,$10,$11,$12,$13) RETURNING *",
        [
          id,
          publicId,
          body.uid,
          user.id,
          project.workspace_id,
          project.id,
          project.revision,
          canvasBytes(
            JSON.stringify(await planComposition(exporter.program, shots)),
          ),
          canvasBytes(""),
          stamp,
          exporter.plugin,
          exporter.version,
          exporter.id,
        ],
      );
      for (const asset of assets.values())
        await sql.query("INSERT INTO storyboard_export_refs VALUES($1,$2)", [
          id,
          asset.id,
        ]);
      return this.public(row);
    });
  }
  async recover() {
    await this.expireLeases();
    await this.cleanupObjects();
  }
  async expireLeases() {
    await this.p.db.transaction(async (sql) => {
      const rows = (
        await sql.query(
          "UPDATE storyboard_exports SET state='failed',error=$1,updated=$2,lease_token=NULL,lease_until=NULL WHERE state='running' AND (lease_until IS NULL OR lease_until<clock_timestamp()) RETURNING id",
          [
            canvasBytes("服务重启中断了合成，请重新合成"),
            Math.floor(this.clock()),
          ],
        )
      ).rows;
      for (const row of rows)
        await sql.query(
          "DELETE FROM storyboard_export_refs WHERE export_id=$1",
          [row.id],
        );
    });
  }
  async cleanupObjects(exportId?: string) {
    const token = randomUUID();
    // The claim commits before any I/O. A dead cleaner's batch becomes due again.
    const objects = (
      await this.p.db.query<ExportObject>(
        `WITH due AS (
           SELECT o.export_id FROM storyboard_export_objects o
           WHERE o.cleanup_after <= statement_timestamp()
             AND ($1::uuid IS NULL OR o.export_id=$1)
             AND NOT EXISTS (
               SELECT 1 FROM storyboard_exports e
               WHERE e.id=o.export_id AND e.state IN ('queued','running')
             )
           ORDER BY o.cleanup_after,o.export_id LIMIT $2 FOR UPDATE OF o SKIP LOCKED
         )
         UPDATE storyboard_export_objects o
         SET cleanup_token=$3,cleanup_after=clock_timestamp()+interval '1 minute'
         FROM due WHERE o.export_id=due.export_id
         RETURNING o.*`,
        [exportId ?? null, cleanupBatchSize, token],
      )
    ).rows;

    const results = await Promise.allSettled(
      objects.map((o) => this.cleanupObject(o, token)),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
  }
  private async cleanupObject(o: ExportObject, token: string) {
    const operations = [
      rm(join(this.stage, "storyboard-" + o.work_token), {
        recursive: true,
        force: true,
      }),
    ];
    if (!o.committed && o.write_state !== "unstarted")
      operations.push(
        this.p.storage.remove(o.object_key, AbortSignal.timeout(15_000)),
      );
    const results = await Promise.allSettled(operations);
    const failure = results.find((result) => result.status === "rejected");
    if (!failure && (o.committed || o.write_state !== "uncertain")) {
      await this.p.db.query(
        "DELETE FROM storyboard_export_objects WHERE export_id=$1 AND cleanup_token=$2",
        [o.export_id, token],
      );
      return;
    }
    // A successful DELETE is provisional while an unacknowledged PUT can still land.
    const retryDelay = failure
      ? Math.min(5 * 2 ** o.cleanup_attempts, 300)
      : Math.min(30 * 2 ** o.cleanup_attempts, 3600);
    await this.p.db.query(
      `UPDATE storyboard_export_objects
       SET cleanup_token=NULL,
           cleanup_after=clock_timestamp() +
             CASE WHEN write_state=$3 THEN $4 * interval '1 second' ELSE interval '0' END,
           cleanup_attempts=CASE WHEN write_state=$3 THEN $5 ELSE 0 END
       WHERE export_id=$1 AND cleanup_token=$2`,
      [
        o.export_id,
        token,
        o.write_state,
        retryDelay,
        Math.min(o.cleanup_attempts + 1, 8),
      ],
    );
    if (failure) throw failure.reason;
  }
  private async lockWork(sql: Sql, id: string, token: string) {
    const work = await one(
      sql,
      "SELECT project_id FROM storyboard_exports WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE",
      [id, token],
    );
    if (!work) throw new Error("合成中断，请检查素材后重试");
    return work;
  }
  async ready() {
    return (
      await this.p.db.query(
        "SELECT id FROM storyboard_exports WHERE state='queued' ORDER BY created,ordinal",
      )
    ).rows;
  }
  async execute(id: string) {
    const token = randomUUID();
    const claim = await this.p.db.transaction(async (sql) => {
      // Original has one global composition worker, independent of provider concurrency.
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('storyboard-execute',0))",
      );
      if (
        await one(sql, "SELECT 1 FROM storyboard_exports WHERE state='running'")
      )
        return;
      const first = await one(
        sql,
        "SELECT id FROM storyboard_exports WHERE state='queued' ORDER BY created,ordinal LIMIT 1",
      );
      if (first?.id !== id) return;
      const row = await one(
        sql,
        "UPDATE storyboard_exports SET state='running',lease_token=$2,lease_until=clock_timestamp()+interval '30 seconds',updated=$3 WHERE id=$1 AND state='queued' RETURNING *",
        [id, token, Math.floor(this.clock())],
      );
      if (!row) return;
      const objectKey = randomUUID();
      await sql.query(
        "INSERT INTO storyboard_export_objects(export_id,object_key,work_token,write_state) VALUES($1,$2,$3,'unstarted')",
        [id, objectKey, token],
      );
      return { row, objectKey };
    });
    if (!claim) return;
    const { row, objectKey } = claim;
    const abort = new AbortController();
    let heart: Promise<unknown> = Promise.resolve();
    const timer = setInterval(() => {
      heart = heart
        .then(async () => {
          const alive = await one(
            this.p.db,
            "UPDATE storyboard_exports SET lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_until>clock_timestamp() RETURNING id",
            [id, token],
          );
          if (!alive) abort.abort();
        })
        .catch(() => abort.abort());
    }, 5000);
    let folder: string | undefined;
    try {
      const plugin = this.plugins.get(row.plugin_id + "@" + row.plugin_version);
      if (!plugin) throw new Error("合成中断，请检查素材后重试");
      const stageFolder = join(this.stage, "storyboard-" + token);
      folder = stageFolder;
      // A terminal cleanup can retire an unstarted marker even if its worker resumes.
      await this.p.db.transaction(async (sql) => {
        await this.lockWork(sql, id, token);
        await mkdir(stageFolder, { mode: 0o700 });
      });
      const result = await plugin.compose(
        JSON.parse(canvasText(row.snapshot)),
        folder,
        async (key, path) => {
          const asset = await one(
            this.p.db,
            "SELECT a.object_key FROM assets a JOIN storyboard_export_refs r ON r.asset_id=a.id WHERE r.export_id=$1 AND a.public_id=$2",
            [id, key],
          );
          if (!asset) throw new Error("素材缺少所需的视频或音轨");
          await pipeline(
            await this.p.storage.stream(asset.object_key),
            createWriteStream(path, { mode: 0o600 }),
            { signal: abort.signal },
          );
        },
        abort.signal,
      );
      const bytes = (await stat(result.path)).size;
      const storage = this.p.storage;
      const data = storage.putFile ? undefined : await readFile(result.path);
      abort.signal.throwIfAborted();
      // Record the potentially late write under the same export lock as expiry/deletion.
      await this.p.db.transaction(async (sql) => {
        await this.lockWork(sql, id, token);
        const writing = await one(
          sql,
          `UPDATE storyboard_export_objects SET write_state='uncertain'
           WHERE export_id=$1 AND work_token=$2 AND write_state='unstarted'
           RETURNING export_id`,
          [id, token],
        );
        if (!writing) throw new Error("合成中断，请检查素材后重试");
      });
      if (storage.putFile)
        await storage.putFile(
          objectKey,
          result.path,
          "video/mp4",
          abort.signal,
        );
      else await storage.put(objectKey, data!, "video/mp4");
      // Only a successful PUT acknowledgement proves the writer has finished.
      await this.p.db.query(
        `UPDATE storyboard_export_objects
         SET write_state='settled',
             cleanup_attempts=0,
             cleanup_after=CASE WHEN cleanup_token IS NULL THEN clock_timestamp() ELSE cleanup_after END
         WHERE export_id=$1 AND work_token=$2`,
        [id, token],
      );
      await this.p.db.transaction(async (sql) => {
        // Deletion locks the document first. Completion must use the same order.
        if (row.project_id)
          await sql.query("SELECT id FROM documents WHERE id=$1 FOR UPDATE", [
            row.project_id,
          ]);
        const current = await this.lockWork(sql, id, token);
        await sql.query(
          "UPDATE storyboard_exports SET state='done',updated=$2,lease_token=NULL,lease_until=NULL WHERE id=$1",
          [id, Math.floor(this.clock())],
        );
        await capacity(sql, this.p.storage, bytes - EXPORT_RESERVE);
        const asset = randomUUID();
        const source = current.project_id
          ? await one(sql, "SELECT public_id FROM documents WHERE id=$1", [
              current.project_id,
            ])
          : null;
        await sql.query(
          "INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state,original_kind,metadata) VALUES($1,$2,$3,$4,'video/mp4',$5,'ready','video',$6)",
          [
            asset,
            row.workspace_id,
            row.owner_id,
            objectKey,
            bytes,
            JSON.stringify({
              width: result.width,
              height: result.height,
              duration: result.duration,
              storyboard_export: row.public_id,
              canvas_project: source?.public_id ?? null,
            }),
          ],
        );
        const connection = "aed2b868-cb0d-4a87-adbf-591e8360a899",
          model = "bd3c789a-bae2-4664-b355-61ed0a79f062";
        await sql.query(
          "INSERT INTO plugin_versions(id,version,manifest) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [
            storyboardHistory.manifest.id,
            storyboardHistory.manifest.version,
            JSON.stringify(storyboardHistory.manifest),
          ],
        );
        await sql.query(
          "INSERT INTO connections(id,name,plugin_id,plugin_version,config,enabled) VALUES($1,'镜头合成','original-storyboard','1.0.0',$2,false) ON CONFLICT DO NOTHING",
          [connection, this.p.vault.seal({})],
        );
        await sql.query(
          "INSERT INTO models(id,connection_id,provider_model,label,kind,schema,enabled) VALUES($1,$2,'storyboard','镜头合成','video','{}',false) ON CONFLICT DO NOTHING",
          [model, connection],
        );
        const job = randomUUID(),
          metadata = {
            width: result.width,
            height: result.height,
            duration: result.duration,
            storyboard_export: row.public_id,
            canvas_project: source?.public_id ?? null,
          };
        const view = {
          ratio: `${result.width}:${result.height}`,
          quality: 0,
          seconds: result.duration,
          sampling_steps: 0,
          seed: 0,
          width: result.width,
          height: result.height,
          image_quality: null,
          audio_settings: {},
          h3_inputs: {},
          refs: [],
        };
        await sql.query(
          "INSERT INTO jobs(id,workspace_id,owner_id,model_id,connection_id,plugin_id,plugin_version,config_snapshot,provider_model,kind,input,idempotency_key,request_hash,price,state,result,original_uid,original_view,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'original-storyboard','1.0.0',$6,'storyboard','video',$7,$8,$8,0,'completed',$9,$8,$10,to_timestamp($11),to_timestamp($12))",
          [
            job,
            row.workspace_id,
            row.owner_id,
            model,
            connection,
            this.p.vault.seal({}),
            JSON.stringify({
              prompt: "镜头合成",
              params: {
                ratio: view.ratio,
                quality: 0,
                seconds: result.duration,
                seed: 0,
              },
              references: [],
            }),
            "storyboard-export-" + row.public_id,
            JSON.stringify({ assets: [asset], metadata }),
            JSON.stringify(view),
            row.created,
            Math.floor(this.clock()),
          ],
        );
        await sql.query(
          "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'output')",
          [job, asset],
        );
        await sql.query(
          "UPDATE storyboard_exports SET result_id=$2,subtitles=$3 WHERE id=$1",
          [id, asset, canvasBytes(result.subtitles)],
        );
        await sql.query(
          "UPDATE storyboard_export_objects SET committed=true WHERE export_id=$1",
          [id],
        );
        await sql.query(
          "DELETE FROM storyboard_export_refs WHERE export_id=$1",
          [id],
        );
      });
    } catch (error) {
      // A lost COMMIT acknowledgement is not a rollback. Reconcile before deleting.
      const saved = await one(
        this.p.db,
        "SELECT true AS committed FROM storyboard_exports e JOIN assets a ON a.id=e.result_id WHERE e.id=$1 AND e.state='done' AND a.object_key=$2",
        [id, objectKey],
      );
      if (saved?.committed) return;
      await this.p.db.transaction(async (sql) => {
        await sql.query(
          "UPDATE storyboard_exports SET state='failed',error=$3,updated=$4,lease_token=NULL,lease_until=NULL WHERE id=$1 AND state='running' AND lease_token=$2",
          [
            id,
            token,
            canvasBytes(
              error instanceof Error &&
                /^(素材解码或合成失败，请检查视频和音轨后重试|素材缺少所需的视频或音轨|单段素材时长需在 0.05–120 秒之间|成片总时长最多 5 分钟，请减少镜头或旁白|成片时长无效|合成结果时长或体积异常，请调整后重试)$/.test(
                  error.message,
                )
                ? error.message
                : "合成中断，请检查素材后重试",
            ),
            Math.floor(this.clock()),
          ],
        );
        await sql.query(
          "DELETE FROM storyboard_export_refs WHERE export_id=$1 AND EXISTS(SELECT 1 FROM storyboard_exports WHERE id=$1 AND state NOT IN ('queued','running'))",
          [id],
        );
      });
      await this.cleanupObjects(id);
    } finally {
      clearInterval(timer);
      await heart;
      if (folder) await rm(folder, { recursive: true, force: true });
    }
  }
}
