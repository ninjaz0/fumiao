import { canvasSourceKind } from "@fumiao/plugin-sdk/canvas-ports.js";
import type { Platform } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { enforceAgentPolicyInTx } from "@fumiao/platform/agent-policy.js";
import { hash, requireValue } from "@fumiao/platform/security.js";
import { CanvasSubmissionModels } from "@fumiao/platform/canvas-submission.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { uuid5 } from "@fumiao/platform/uuid.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import type { OriginalActor } from "./identity.js";
import { parseBody } from "./validation.js";
import { parseDraft } from "./drafts.js";
import {
  canvasBatchRunFields,
  canvasCandidatesFields,
  canvasDialogueRunFields,
  canvasRunFields,
  parseCanvasDocument,
  type CinematographySpec,
} from "./canvas-draft.js";
import {
  expandGroupNodeIds,
  OriginalBatchPrecheck,
  type PrecheckStage,
} from "./batch-precheck.js";
import {
  createTailFrameAsset,
  hasTailChainTable,
} from "@fumiao/platform/tail-frame.js";
import { resolveSpeakerVoice } from "./dialogue.js";
import {
  canvasBytes,
  canvasDocumentJson,
  canvasText,
  parseCanvasRunJson,
} from "./canvas-values.js";
import { OriginalCanvases, canvasConflict } from "./canvases.js";
import { OriginalGeneration } from "./generation.js";
import { OriginalState } from "./state.js";

const namespaceUrl = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
const active = ["queued", "dispatching", "running", "finalizing", "uncertain"];

/** F030: Compiles structured 6-dimension director cinematography spec into clean prompt text. */
export function compileCinematographyPrompt(
  basePrompt: string,
  spec?: CinematographySpec | null,
  generationMode?: string,
  gridLayout?: "2x2" | "3x3" | null,
): string {
  const parts: string[] = [];
  if (generationMode === "grid_preview") {
    const grid = gridLayout === "2x2" ? "2x2 四宫格" : "3x3 九宫格";
    const count = gridLayout === "2x2" ? 4 : 9;
    parts.push(
      `【${grid}分镜构图预览】在一张画布上平均划分为 ${grid}（共 ${count} 个等大独立连续分镜画面），细黑线整齐分隔，无文字水印，主体与场景风格连贯：`,
    );
  }
  parts.push(basePrompt.trim());
  if (spec) {
    const entries: [string, string | undefined][] = [
      ["景别", spec.shot_size],
      ["机位", spec.camera_angle],
      ["运镜", spec.camera_movement],
      ["光影", spec.lighting],
      ["镜头", spec.lens],
      ["氛围", spec.mood],
    ];
    const tags = entries
      .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
      .map(([k, v]) => `${k}:${v!.trim()}`);
    if (tags.length) {
      parts.push(`【导演参数：${tags.join(" / ")}】`);
    }
  }
  return parts.filter(Boolean).join("\n\n").slice(0, 12000);
}
type Run = {
  uid: string;
  expected_revision: number | bigint;
  price_revision: number | bigint | null;
};
export class OriginalCanvasRuns {
  readonly canvases: OriginalCanvases;
  readonly generation: OriginalGeneration;
  constructor(
    readonly p: Platform,
    readonly clock = () => Date.now() / 1000,
  ) {
    this.canvases = new OriginalCanvases(p, clock);
    this.generation = new OriginalGeneration(p);
  }
  async list(user: OriginalActor, project: string) {
    // Recovery may update expired GPU jobs; retry serialization failures exactly
    // as the full state response does, without replaying any submitted request.
    for (let attempt = 0; ; attempt++)
      try {
        return await this.p.db.transaction(async (sql) => {
          await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
          const p = await this.canvases.project(sql, user, project);
          const links = (
            await sql.query(
              `SELECT l.id::text,l.node,l.inputs,j.public_id AS job FROM canvas_job_links l JOIN jobs j ON j.id=l.job_id
          WHERE l.project_id=$1 AND j.deleted_at IS NULL ORDER BY l.id DESC`,
              [p.id],
            )
          ).rows;
          if (!links.length) return { runs: [] };
          const jobs = await new OriginalState(this.p).canvasJobs(
            sql,
            p.workspace_id,
          );
          const byId = new Map(jobs.map((j) => [j.id, j]));
          const batches = (
            await sql.query(
              "SELECT uid,result FROM canvas_run_batches WHERE project_id=$1 ORDER BY owner_id,uid",
              [p.id],
            )
          ).rows;
          const byJob = new Map<
            number,
            { uid: string; index: number; count: number }
          >();
          for (const batch of batches) {
            const result = JSON.parse(canvasText(batch.result));
            for (const [index, id] of result.ids.entries())
              byJob.set(id, {
                uid: batch.uid,
                index: index + 1,
                count: result.ids.length,
              });
          }
          const models = await new StudioCatalog(this.p.db).catalog(sql),
            bindings = await CanvasSubmissionModels.read(sql, {
              strict: false,
            });
          const fields = [
            "id",
            "owner",
            "kind",
            "prompt",
            "refs",
            "status",
            "result",
            "note",
            "width",
            "height",
            "created",
            "updated",
            "model",
            "quality",
            "seconds",
            "sampling_steps",
            "seed",
            "ratio",
            "image_quality",
            "node",
            "attempts",
            "actual",
          ];
          return {
            runs: links.map((l) => {
              const j = byId.get(Number(l.job));
              requireValue(j, 503, "画布任务尚未完成原状态迁移");
              return {
                ...Object.fromEntries(fields.map((key) => [key, j[key]])),
                link_id: parseCanvasRunJson(l.id),
                canvas_node: l.node,
                inputs: parseCanvasRunJson(canvasText(l.inputs)),
                batch: byJob.get(j.id) ?? null,
                model_label: bindings.rules.get(j.model)?.showModelLabel
                  ? (models[j.model]?.label ?? null)
                  : null,
                eta: j.eta ?? null,
                timing: j.timing ?? null,
              };
            }),
          };
        });
      } catch (e) {
        if ((e as any).code !== "40001" || attempt >= 2) throw e;
      }
  }
  private async ownerLock(sql: Sql, user: OriginalActor) {
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "canvas-runs-owner:" + user.id,
    ]);
  }
  private async previous(sql: Sql, user: OriginalActor, uid: string) {
    return one(
      sql,
      `SELECT l.project_id,l.node,j.public_id AS job FROM canvas_job_links l
      LEFT JOIN jobs j ON j.id=l.job_id AND j.deleted_at IS NULL WHERE l.owner_id=$1 AND l.uid=$2`,
      [user.id, uid],
    );
  }
  private async busy(sql: Sql, project: string, node: string) {
    return !!(await one(
      sql,
      `SELECT 1 FROM canvas_job_links l JOIN jobs j ON j.id=l.job_id
      WHERE l.project_id=$1 AND l.node=$2 AND j.state=ANY($3::text[]) AND j.deleted_at IS NULL LIMIT 1`,
      [project, node, active],
    ));
  }
  private async link(
    sql: Sql,
    p: any,
    user: OriginalActor,
    node: string,
    uid: string,
    job: number,
    inputs: unknown,
  ) {
    const row = await one(
      sql,
      "SELECT id FROM jobs WHERE public_id=$1 AND deleted_at IS NULL FOR KEY SHARE",
      [job],
    );
    requireValue(row, 409, "这次提交已处理，请刷新画布");
    await sql.query(
      "INSERT INTO canvas_job_links(project_id,node,job_id,owner_id,uid,inputs,created) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        p.id,
        node,
        row.id,
        user.id,
        uid,
        canvasBytes(JSON.stringify(inputs)),
        Math.floor(this.clock()),
      ],
    );
    const hasJobProjects = await one(
      sql,
      "SELECT to_regclass('job_projects') IS NOT NULL AS ok",
    );
    if (hasJobProjects?.ok) {
      await sql.query(
        "INSERT INTO job_projects(job_id, project_id) VALUES($1, $2) ON CONFLICT DO NOTHING",
        [row.id, p.id],
      );
    }
  }
  private async createOn(
    sql: Sql,
    p: any,
    user: OriginalActor,
    nid: string,
    body: Run,
    allowBusy = false,
    seedOffset = 0,
  ) {
    const old = await this.previous(sql, user, body.uid);
    if (old) {
      requireValue(
        old.project_id === p.id && old.node === nid && old.job !== null,
        409,
        "这次提交已处理，请刷新画布",
      );
      return { id: Number(old.job) };
    }
    requireValue(p.revision === body.expected_revision, 409, canvasConflict);
    const doc = parseCanvasDocument(canvasDocumentJson(p.document)),
      nodes = new Map(doc.nodes.map((n) => [n.id, n])),
      node = nodes.get(nid);
    requireValue(
      node && (node.type === "image" || node.type === "video"),
      400,
      "请选择图片或视频节点",
    );
    if (user.tokenId || user.agentAction) {
      await enforceAgentPolicyInTx(sql, String(p.workspace_id), {
        projectId: String(p.id),
        nodeId: nid,
        executionKey: `canvas-run:${p.id}:${nid}:${body.uid}`,
        approvedProposalId: user.agentAction?.approvedProposalId ?? null,
      });
    }
    requireValue(
      allowBusy || !(await this.busy(sql, p.id, nid)),
      409,
      "这个节点还有生成任务，请等待完成",
    );
    const texts: string[] = [],
      sources: (
        { node: string; text: string } | { node: string; media: string }
      )[] = [];
    let refs: string[] = [];
    for (const edge of doc.edges) {
      if (edge.target !== nid) continue;
      const source = nodes.get(edge.source)!;
      const extValue =
        source.extension && edge.sourcePort
          ? source.extension.result?.[edge.sourcePort]
          : undefined;
      if (canvasSourceKind(source, edge.sourcePort) === "text") {
        const text = pythonStrip(
          source.extension ? (extValue ?? "") : source.text,
        );
        requireValue(
          text,
          409,
          `参考文本“${source.title || "文本"}”还没有内容`,
        );
        texts.push(text);
        sources.push({ node: source.id, text });
      } else {
        const key = source.extension
          ? extValue
          : await this.canvases.mediaForNode(sql, p.id, source);
        requireValue(key, 409, `参考图片“${source.title || "图片"}”尚未就绪`);
        if (!refs.includes(key)) refs.push(key);
        sources.push({ node: source.id, media: key });
      }
    }
    const rawPrompt = [
      ...texts,
      ...(pythonStrip(node.prompt) ? [pythonStrip(node.prompt)] : []),
    ].join("\n\n");
    requireValue(
      rawPrompt && [...rawPrompt].length <= 12000,
      400,
      "请输入提示词或连接文本，合计不超过 12000 字",
    );
    const prompt = compileCinematographyPrompt(
      rawPrompt,
      node.cinematography,
      node.generation_mode,
      node.grid_layout,
    );
    const bindings = await CanvasSubmissionModels.read(sql),
      params = node.params,
      model = params.model || bindings.default(node.type),
      rule = bindings.rules.get(model);

    // F011: Honor explicit node.generation_mode instead of letting stale params.h3.mode override it.
    let native =
      node.type === "video" && rule?.nativeH3
        ? params.h3
          ? node.generation_mode === "omni_ref"
            ? {
                ...params.h3,
                mode: "reference" as const,
                first_frame: null,
                last_frame: null,
              }
            : node.generation_mode === "first_last_frame"
              ? { ...params.h3, mode: "frames" as const }
              : params.h3
          : node.generation_mode === "first_last_frame"
            ? {
                mode: "frames" as const,
                first_frame: null,
                last_frame: null,
                video_audio: [] as string[],
              }
            : node.generation_mode === "omni_ref"
              ? {
                  mode: "reference" as const,
                  first_frame: null,
                  last_frame: null,
                  video_audio: [] as string[],
                }
              : null
        : null;
    if (
      node.type === "video" &&
      rule?.nativeH3 &&
      node.generation_mode === "omni_ref" &&
      params.h3
    ) {
      const carried = [params.h3.first_frame, params.h3.last_frame].filter(
        (id): id is string => Boolean(id),
      );
      if (carried.length) refs = [...new Set([...refs, ...carried])];
    }

    // F028: Automatic tail-frame chain discovery for video shots marked `tail_inherited: true`.
    // Never touches shots where `tail_inherited` is falsy (preserves explicit first frames).
    let pendingTailParentJobId: string | null = null;
    if (node.type === "video" && node.tail_inherited) {
      const fallbackVideoOrder = doc.nodes
        .filter((n) => n.type === "video")
        .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y))
        .map((n) => n.id);
      const shotOrder = doc.shots?.length ? doc.shots : fallbackVideoOrder;
      const shotIdx = shotOrder.indexOf(nid);
      const prevNodeId =
        shotIdx > 0
          ? shotOrder[shotIdx - 1]
          : (doc.edges.find(
              (e) =>
                e.target === nid &&
                nodes.get(e.source)?.type === "video",
            )?.source ?? null);
      if (prevNodeId) {
        const prevJob = await one(
          sql,
          `SELECT j.id, j.state,
                  (SELECT a.id FROM job_assets ja JOIN assets a ON a.id=ja.asset_id
                    WHERE ja.job_id=j.id AND ja.role='output' AND a.state='ready'
                    ORDER BY a.created_at ASC LIMIT 1) AS output_asset_id
             FROM canvas_job_links l
             JOIN jobs j ON j.id = l.job_id
            WHERE l.project_id = $1 AND l.node = $2 AND j.kind = 'video' AND j.deleted_at IS NULL
            ORDER BY l.id DESC
            LIMIT 1`,
          [p.id, prevNodeId],
        );
        if (prevJob && active.includes(String(prevJob.state))) {
          pendingTailParentJobId = String(prevJob.id);
        } else if (
          prevJob &&
          prevJob.state === "completed" &&
          prevJob.output_asset_id &&
          !native?.first_frame
        ) {
          const srcAsset = await one(
            sql,
            "SELECT id, public_id, object_key FROM assets WHERE id=$1 AND state='ready'",
            [prevJob.output_asset_id],
          );
          if (srcAsset) {
            const existingTail = await one(
              sql,
              `SELECT public_id FROM assets
                WHERE workspace_id=$1 AND state='ready'
                  AND metadata->>'derivation'='tail_frame'
                  AND metadata->>'derived_from'=$2
                ORDER BY created_at DESC LIMIT 1`,
              [p.workspace_id, String(srcAsset.public_id)],
            );
            let tailPublicId = existingTail
              ? String(existingTail.public_id)
              : "";
            if (!tailPublicId) {
              try {
                const extracted = await createTailFrameAsset(
                  this.p,
                  sql,
                  user.id,
                  String(p.workspace_id),
                  {
                    id: String(srcAsset.id),
                    public_id: String(srcAsset.public_id),
                    object_key: String(srcAsset.object_key),
                  },
                  AbortSignal.timeout(30_000),
                );
                tailPublicId = extracted.public_id;
              } catch {
                // Keep submission resilient if source asset bytes are unavailable in a mock fixture.
              }
            }
            if (tailPublicId) {
              if (rule?.nativeH3) {
                native = {
                  ...(native ?? {
                    mode: "frames" as const,
                    first_frame: null,
                    last_frame: null,
                    video_audio: [],
                  }),
                  mode: "frames",
                  first_frame: tailPublicId,
                };
              } else if (!refs.includes(tailPublicId)) {
                refs = [tailPublicId, ...refs];
              }
            }
          }
        }
      }
    }

    if (native)
      refs =
        native.mode === "frames"
          ? [
              ...new Set(
                [native.first_frame, native.last_frame].filter(
                  (id): id is string => !!id,
                ),
              ),
            ]
          : [...new Set([...refs, ...params.h3_refs])];
    else if (node.generation_mode === "first_last_frame" && params.h3) {
      const frameRefs = [params.h3.first_frame, params.h3.last_frame].filter(
        (id): id is string => !!id,
      );
      if (frameRefs.length) refs = [...new Set([...frameRefs, ...refs])];
    } else if (node.generation_mode === "omni_ref" && params.h3_refs.length) {
      refs = [...new Set([...refs, ...params.h3_refs])];
    } else
      requireValue(
        !params.h3_refs.length || !params.model || rule?.nativeH3,
        400,
        "请先移除 H3 参考素材后切换模型生成",
      );
    const common = {
      uid: uuid5(
        namespaceUrl,
        `fumiao:canvas:${p.public_id}:${nid}:${body.uid}`,
      ),
      prompt,
      refs,
      ratio: params.ratio,
      price_revision:
        typeof body.price_revision === "number" ? body.price_revision : null,
      asset_packs: node.asset_packs,
      model,
    };
    const draft = parseDraft(
      node.type,
      node.type === "image"
        ? {
            ...common,
            resolution: params.resolution,
            image_quality: params.image_quality,
          }
        : {
            ...common,
            h3: native,
            flow_source_job: params.flow_source_job,
            quality: params.quality,
            seconds: params.seconds,
            seed:
              params.seed === null
                ? null
                : (params.seed + seedOffset) % 2 ** 53,
            sampling_steps:
              rule?.fixedSamplingSteps ??
              (params.fast_mode ? 4 : params.sampling_steps),
          },
      await new StudioCatalog(this.p.db).catalog(sql),
    );
    const result = await this.generation.submitOn(
      sql,
      user,
      draft,
      String(p.workspace_number),
      body.price_revision,
      {
        projectId: String(p.id),
        nodeId: nid,
        executionKey: `canvas-run:${p.id}:${nid}:${body.uid}`,
      },
    );
    await this.link(sql, p, user, nid, body.uid, result.id, {
      revision: p.revision,
      prompt,
      refs,
      sources,
      params,
      asset_packs: node.asset_packs,
    });
    if (pendingTailParentJobId && (await hasTailChainTable(sql))) {
      const childRow = await one(
        sql,
        "SELECT id FROM jobs WHERE public_id=$1 AND deleted_at IS NULL",
        [result.id],
      );
      if (childRow && String(childRow.id) !== pendingTailParentJobId) {
        await sql.query(
          `INSERT INTO job_tail_chains(child_job_id, parent_job_id)
           VALUES ($1, $2)
           ON CONFLICT (child_job_id) DO NOTHING`,
          [childRow.id, pendingTailParentJobId],
        );
        // Suppress immediate worker dispatch until parent video completes and wakes this child.
        await sql.query("DELETE FROM outbox WHERE job_id=$1", [childRow.id]);
      }
    }
    return result;
  }
  async generate(
    user: OriginalActor,
    project: string,
    node: string,
    value: unknown,
  ) {
    const body = parseBody(value, canvasRunFields, true) as Run;
    return this.p.db.transaction(async (sql) => {
      const p = await this.canvases.project(sql, user, project, true);
      await this.ownerLock(sql, user);
      return this.createOn(sql, p, user, node, body);
    });
  }
  async candidates(
    user: OriginalActor,
    project: string,
    node: string,
    value: unknown,
  ) {
    const body = parseBody(value, canvasCandidatesFields, true) as Run & {
      count: 1 | 2;
    };
    return this.p.db.transaction(async (sql) => {
      const p = await this.canvases.project(sql, user, project, true);
      await this.ownerLock(sql, user);
      const old = await one(
        sql,
        "SELECT * FROM canvas_run_batches WHERE owner_id=$1 AND uid=$2",
        [user.id, body.uid],
      );
      if (old) {
        requireValue(
          old.project_id === p.id &&
            old.node === node &&
            old.count === body.count,
          409,
          "这次提交已处理，请刷新后重试",
        );
        return JSON.parse(canvasText(old.result)) as {
          ids: number[];
          count: number;
          credits: number;
        };
      }
      const ids: number[] = [];
      for (let index = 0; index < body.count; index++)
        ids.push(
          (
            await this.createOn(
              sql,
              p,
              user,
              node,
              { ...body, uid: uuid5(body.uid, `candidate:${index}`) },
              index > 0,
              index,
            )
          ).id,
        );
      const fees = await one(
        sql,
        "SELECT sum(price) AS total FROM jobs WHERE public_id=ANY($1::bigint[])",
        [ids],
      );
      const result = { ids, count: body.count, credits: Number(fees.total) };
      await sql.query(
        "INSERT INTO canvas_run_batches(owner_id,uid,project_id,node,count,result) VALUES($1,$2,$3,$4,$5,$6)",
        [
          user.id,
          body.uid,
          p.id,
          node,
          body.count,
          canvasBytes(JSON.stringify(result)),
        ],
      );
      return result;
    });
  }
  async narrate(
    user: OriginalActor,
    project: string,
    nid: string,
    value: unknown,
  ) {
    const body = parseBody(value, canvasRunFields, true) as Run;
    return this.p.db.transaction(async (sql) => {
      const p = await this.canvases.project(sql, user, project, true);
      await this.ownerLock(sql, user);
      const uid = uuid5(body.uid, "narration"),
        nodeName = "voice:" + nid,
        old = await this.previous(sql, user, uid);
      if (old) {
        requireValue(
          old.project_id === p.id && old.node === nodeName && old.job !== null,
          409,
          "这次提交已处理，请刷新后重试",
        );
        return { id: Number(old.job) };
      }
      requireValue(p.revision === body.expected_revision, 409, canvasConflict);
      const doc = parseCanvasDocument(canvasDocumentJson(p.document)),
        node = doc.nodes.find((n) => n.id === nid && n.type === "video");
      requireValue(
        node && pythonStrip(node.narration_text),
        400,
        "请先填写镜头旁白",
      );
      requireValue(
        !(await this.busy(sql, p.id, nodeName)),
        409,
        "这个镜头的旁白仍在生成",
      );
      const bindings = await CanvasSubmissionModels.read(sql);
      const draft = parseDraft(
        "audio",
        {
          uid: uuid5(body.uid, `voice:${p.public_id}:${nid}`),
          model: bindings.resolveAudio(node.narration_model),
          prompt: node.narration_text,
          instruction: node.narration_instruction,
          price_revision:
            typeof body.price_revision === "number"
              ? body.price_revision
              : null,
        },
        await new StudioCatalog(this.p.db).catalog(sql),
      );
      const result = await this.generation.submitOn(
        sql,
        user,
        draft,
        String(p.workspace_number),
        body.price_revision,
        {
          projectId: String(p.id),
          nodeId: nid,
          executionKey: `canvas-narration:${p.id}:${nid}:${uid}`,
        },
      );
      await this.link(sql, p, user, nodeName, uid, result.id, {
        text: node.narration_text,
        instruction: node.narration_instruction,
        revision: p.revision,
      });
      return result;
    });
  }
  async narrateDialogue(
    user: OriginalActor,
    project: string,
    nid: string,
    value: unknown,
  ) {
    const body = parseBody(value, canvasDialogueRunFields, true) as Run & {
      line_id?: string;
    };
    return this.p.db.transaction(async (sql) => {
      const p = await this.canvases.project(sql, user, project, true);
      await this.ownerLock(sql, user);
      requireValue(p.revision === body.expected_revision, 409, canvasConflict);
      const doc = parseCanvasDocument(canvasDocumentJson(p.document)),
        node = doc.nodes.find((n) => n.id === nid && n.type === "video");
      requireValue(
        node && node.dialogue_lines && node.dialogue_lines.length > 0,
        400,
        "请先添加至少一句角色对白",
      );
      const targets = body.line_id
        ? node.dialogue_lines.filter((l) => l.id === body.line_id)
        : node.dialogue_lines.filter((l) => pythonStrip(l.text));
      requireValue(targets.length > 0, 400, "未找到可合成的对白台词");
      const bindings = await CanvasSubmissionModels.read(sql);
      const catalog = await new StudioCatalog(this.p.db).catalog(sql);
      const items: {
        line_id: string;
        id: number;
        speaker: string;
        model: string;
        voice_id: string | null;
      }[] = [];

      for (const line of targets) {
        const cleanText = pythonStrip(line.text);
        requireValue(cleanText, 400, "对白台词不能为空");
        const nodeName = `dialogue:${nid}:${line.id}`;
        const uid = uuid5(body.uid, `dialogue:${p.public_id}:${nid}:${line.id}`);
        const old = await this.previous(sql, user, uid);
        const resolved = await resolveSpeakerVoice(sql, p.workspace_id, line);
        const model = bindings.resolveAudio(resolved.model);
        if (old) {
          requireValue(
            old.project_id === p.id &&
              old.node === nodeName &&
              old.job !== null,
            409,
            "这次提交已处理，请刷新后重试",
          );
          items.push({
            line_id: line.id,
            id: Number(old.job),
            speaker: line.speaker,
            model,
            voice_id: resolved.voiceId ?? null,
          });
          continue;
        }
        requireValue(
          !(await this.busy(sql, p.id, nodeName)),
          409,
          `对白「${line.speaker || line.id}」仍在生成`,
        );
        const extraParams: Record<string, unknown> = {};
        if (resolved.voiceId) extraParams.voice = resolved.voiceId;
        if (resolved.rate) extraParams.rate = resolved.rate;
        if (resolved.pitch) extraParams.pitch = resolved.pitch;
        if (resolved.instruction) extraParams.instruction = resolved.instruction;

        const draft = parseDraft(
          "audio",
          {
            uid: uuid5(
              body.uid,
              `dialogue-job:${p.public_id}:${nid}:${line.id}`,
            ),
            model,
            prompt: cleanText,
            instruction: resolved.instruction,
            ...(Object.keys(extraParams).length ? { params: extraParams } : {}),
            price_revision:
              typeof body.price_revision === "number"
                ? body.price_revision
                : null,
          },
          catalog,
        );
        const submitted = await this.generation.submitOn(
          sql,
          user,
          draft,
          String(p.workspace_number),
          body.price_revision,
          {
            projectId: String(p.id),
            nodeId: nid,
            executionKey: `canvas-dialogue:${p.id}:${nid}:${line.id}:${uid}`,
          },
        );
        await this.link(sql, p, user, nodeName, uid, submitted.id, {
          line_id: line.id,
          speaker: line.speaker,
          pack_id: resolved.packId,
          voice_id: resolved.voiceId ?? null,
          text: cleanText,
          instruction: resolved.instruction,
          revision: p.revision,
        });
        items.push({
          line_id: line.id,
          id: submitted.id,
          speaker: line.speaker,
          model,
          voice_id: resolved.voiceId ?? null,
        });
      }
      return { items };
    });
  }
  /**
   * F007 + F010: Partial workflow group / multi-node batch rerun (`POST /api/canvases/:key/batch-runs`).
   * Expands group nodes into children and submits only requested stages (`image`, `video`,
   * `narration`, `dialogue`) with deterministic per-item idempotency keys.
   */
  async batchRun(user: OriginalActor, projectKey: string, value: unknown) {
    const body = parseBody(value, canvasBatchRunFields, true) as Run & {
      node_ids: string[];
      stages: PrecheckStage[];
      precheck_token?: string;
      expected_total_credits?: number;
      executable_keys?: string[];
    };
    const requestHash = hash(
      JSON.stringify({
        node_ids: [...new Set(body.node_ids)].sort(),
        stages: [...new Set(body.stages)].sort(),
      }),
    );

    // 1. Check persisted idempotent receipt FIRST (BEFORE revision/precheck checks!)
    // so retrying a dropped response with the same business `uid` returns the exact
    // accepted receipt even if another tab renamed/edited the canvas (revision 2 -> 3)
    // or the user refreshed the page.
    const init = await this.p.db.transaction(async (sql) => {
      const p = await this.canvases.project(sql, user, projectKey, true);
      const hasTables = await one(
        sql,
        `SELECT to_regclass('canvas_batch_runs') IS NOT NULL AS has_runs,
                to_regclass('canvas_precheck_tickets') IS NOT NULL AS has_tickets`,
      );
      if (hasTables?.has_runs) {
        const persisted = await one(
          sql,
          `SELECT request_hash, response
             FROM canvas_batch_runs
            WHERE owner_id=$1 AND project_id=$2 AND uid=$3`,
          [user.id, p.id, body.uid],
        );
        if (persisted) {
          requireValue(
            String(persisted.request_hash) === requestHash,
            409,
            "该批量提交 UID 已被用于不同的节点或阶段集合",
          );
          return {
            replayResponse: persisted.response as {
              submitted: {
                node: string;
                stage: PrecheckStage;
                job_id: number;
                line_id?: string;
              }[];
              skipped: { node: string; stage: PrecheckStage; reason: string }[];
              total_credits: number;
            },
            projectUuid: String(p.id),
            hasRunsTable: true,
            plan: [] as ReturnType<typeof expandGroupNodeIds>,
            shotIndexMap: new Map<string, number>(),
            serverAllowedKeys: null as Set<string> | null,
            serverTotalCredits: null as number | null,
          };
        }
      }

      const doc = parseCanvasDocument(canvasDocumentJson(p.document));
      const targets = expandGroupNodeIds(doc.nodes, body.node_ids);
      requireValue(targets.length > 0, 400, "未找到可执行的节点");

      // Crash-recovery fallback: if items were already submitted under this `uid` before
      // `canvas_batch_runs` was persisted (even if revision has since bumped), recover receipt!
      const candidateMeta = new Map<
        string,
        { node: string; stage: PrecheckStage; line_id?: string }
      >();
      for (const node of targets) {
        for (const stage of body.stages) {
          const itemUid = uuid5(
            body.uid,
            `batch:${projectKey}:${node.id}:${stage}`,
          );
          candidateMeta.set(itemUid, { node: node.id, stage });
          if (stage === "dialogue" && node.dialogue_lines?.length) {
            for (const line of node.dialogue_lines) {
              candidateMeta.set(
                uuid5(itemUid, `dialogue:${p.public_id}:${node.id}:${line.id}`),
                { node: node.id, stage: "dialogue", line_id: line.id },
              );
            }
          }
        }
      }
      const existingLinks = candidateMeta.size
        ? (
            await sql.query(
              `SELECT l.uid, j.public_id AS job_id, COALESCE(j.price, 0)::bigint AS price
                 FROM canvas_job_links l
                 JOIN jobs j ON j.id = l.job_id AND j.deleted_at IS NULL
                WHERE l.owner_id=$1 AND l.project_id=$2 AND l.uid = ANY($3::uuid[])
                ORDER BY l.id ASC`,
              [user.id, p.id, [...candidateMeta.keys()]],
            )
          ).rows
        : [];
      if (existingLinks.length > 0) {
        const recoveredSubmitted = existingLinks
          .map((row) => {
            const meta = candidateMeta.get(String(row.uid));
            if (!meta) return null;
            return {
              node: meta.node,
              stage: meta.stage,
              job_id: Number(row.job_id),
              ...(meta.line_id ? { line_id: meta.line_id } : {}),
            };
          })
          .filter(
            (
              x,
            ): x is {
              node: string;
              stage: PrecheckStage;
              job_id: number;
              line_id?: string;
            } => Boolean(x),
          );
        const recoveredCredits = existingLinks.reduce(
          (sum, row) => sum + Number(row.price ?? 0),
          0,
        );
        const recovered = {
          submitted: recoveredSubmitted,
          skipped: [] as { node: string; stage: PrecheckStage; reason: string }[],
          total_credits: recoveredCredits,
        };
        if (hasTables?.has_runs) {
          await sql.query(
            `INSERT INTO canvas_batch_runs(owner_id, project_id, uid, request_hash, response)
             VALUES ($1,$2,$3,$4,$5::jsonb)
             ON CONFLICT (owner_id, project_id, uid) DO NOTHING`,
            [user.id, p.id, body.uid, requestHash, JSON.stringify(recovered)],
          );
        }
        return {
          replayResponse: recovered,
          projectUuid: String(p.id),
          hasRunsTable: Boolean(hasTables?.has_runs),
          plan: [] as ReturnType<typeof expandGroupNodeIds>,
          shotIndexMap: new Map<string, number>(),
          serverAllowedKeys: null as Set<string> | null,
          serverTotalCredits: null as number | null,
        };
      }

      // 2. NEW submission: enforce expected_revision + mandatory server-bound precheck ticket!
      requireValue(p.revision === body.expected_revision, 409, canvasConflict);
      requireValue(
        typeof body.precheck_token === "string" &&
          body.precheck_token.trim().length > 0,
        400,
        "请先执行批量预检并携带有效预检票据后再确认提交",
      );

      let serverAllowedKeys: Set<string> | null = null;
      let serverTotalCredits: number | null = null;
      if (hasTables?.has_tickets) {
        const ticket = await one(
          sql,
          `SELECT token, revision, price_revision, request_hash, executable_keys, total_credits, budget_blocked
             FROM canvas_precheck_tickets
            WHERE token=$1 AND owner_id=$2 AND project_id=$3`,
          [body.precheck_token, user.id, p.id],
        );
        requireValue(
          ticket,
          409,
          "预检票据不存在或已失效，请重新预检后再确认提交",
        );
        requireValue(
          String(ticket.request_hash) === requestHash &&
            Number(ticket.revision) === Number(p.revision),
          409,
          "画布版本或选中节点/阶段与预检票据不一致，请重新预检",
        );
        requireValue(
          !ticket.budget_blocked,
          402,
          "预检显示已超出预算硬上限，无法提交",
        );
        serverAllowedKeys = new Set(
          Array.isArray(ticket.executable_keys)
            ? ticket.executable_keys.map(String)
            : [],
        );
        serverTotalCredits = Number(ticket.total_credits ?? 0);
      }

      const fallbackVideoOrder = doc.nodes
        .filter((n) => n.type === "video")
        .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y))
        .map((n) => n.id);
      const effectiveShots = doc.shots?.length
        ? doc.shots
        : fallbackVideoOrder;
      const orderMap = new Map<string, number>(
        effectiveShots.map((id, idx) => [id, idx]),
      );
      return {
        replayResponse: null,
        projectUuid: String(p.id),
        hasRunsTable: Boolean(hasTables?.has_runs),
        plan: targets,
        shotIndexMap: orderMap,
        serverAllowedKeys,
        serverTotalCredits,
      };
    });

    if (init.replayResponse) {
      return init.replayResponse;
    }

    // 3. Re-verify fresh read-only precheck right before submitting to catch concurrent
    // price changes, pack updates, busy jobs, or budget exhaustion; derive allowed keys
    // strictly from the server-verified ticket/precheck (NEVER client executable_keys!).
    const freshPrecheck = await new OriginalBatchPrecheck(
      this.p,
    ).precheckCanvas(user, projectKey, {
      expected_revision: body.expected_revision,
      node_ids: body.node_ids,
      stages: body.stages,
    });
    if (freshPrecheck.precheck_token !== body.precheck_token) {
      requireValue(
        false,
        409,
        "画布节点状态、模型报价或可执行集合已发生变化，请重新预检后再确认提交",
      );
    }
    const expectedCredits =
      body.expected_total_credits ?? init.serverTotalCredits;
    if (
      expectedCredits !== null &&
      expectedCredits !== undefined &&
      freshPrecheck.summary.total_credits !== expectedCredits
    ) {
      requireValue(
        false,
        409,
        `批量报价已变动（预期 ${expectedCredits} 积分，当前 ${freshPrecheck.summary.total_credits} 积分），请重新预检`,
      );
    }
    if (freshPrecheck.summary.budget_blocked) {
      requireValue(
        false,
        402,
        freshPrecheck.summary.budget_blocks[0] || "已超出预算硬上限",
      );
    }

    const allowedKeys =
      init.serverAllowedKeys ?? new Set(freshPrecheck.executable_keys);
    const plan = init.plan;
    const shotIndexMap = init.shotIndexMap;
    const submitted: {
      node: string;
      stage: PrecheckStage;
      job_id: number;
      line_id?: string;
    }[] = [];
    const skipped: { node: string; stage: PrecheckStage; reason: string }[] =
      [];

    const stageOrder: PrecheckStage[] = [
      "image",
      "video",
      "narration",
      "dialogue",
    ];
    const requestedStages = stageOrder.filter((s) => body.stages.includes(s));

    for (const stage of requestedStages) {
      // Order video shots by storyboard shot sequence so tail-frame parents ALWAYS submit before children!
      const orderedNodes =
        stage === "video"
          ? [...plan].sort((a, b) => {
              const ia = shotIndexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
              const ib = shotIndexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
              return ia - ib;
            })
          : plan;

      for (const node of orderedNodes) {
        if (stage === "image" && node.type !== "image") continue;
        if (stage === "video" && node.type !== "video") continue;
        if (
          (stage === "narration" || stage === "dialogue") &&
          node.type !== "video"
        )
          continue;

        if (allowedKeys && !allowedKeys.has(`${node.id}:${stage}`)) {
          skipped.push({
            node: node.id,
            stage,
            reason: "预检已标记阻塞，按预检集合跳过",
          });
          continue;
        }

        const itemUid = uuid5(
          body.uid,
          `batch:${projectKey}:${node.id}:${stage}`,
        );
        try {
          if (stage === "image" || stage === "video") {
            const res = await this.generate(user, projectKey, node.id, {
              expected_revision: body.expected_revision,
              price_revision: body.price_revision,
              uid: itemUid,
            });
            submitted.push({ node: node.id, stage, job_id: res.id });
          } else if (stage === "narration") {
            if (!pythonStrip(node.narration_text)) {
              skipped.push({
                node: node.id,
                stage,
                reason: "未填写旁白文本",
              });
              continue;
            }
            const res = await this.narrate(user, projectKey, node.id, {
              expected_revision: body.expected_revision,
              price_revision: body.price_revision,
              uid: itemUid,
            });
            submitted.push({ node: node.id, stage, job_id: res.id });
          } else if (stage === "dialogue") {
            const lines = (node.dialogue_lines ?? []).filter((l) =>
              Boolean(pythonStrip(l.text)),
            );
            if (!lines.length) {
              skipped.push({
                node: node.id,
                stage,
                reason: "未填写多角色对白",
              });
              continue;
            }
            const res = await this.narrateDialogue(user, projectKey, node.id, {
              expected_revision: body.expected_revision,
              price_revision: body.price_revision,
              uid: itemUid,
            });
            for (const item of res.items) {
              submitted.push({
                node: node.id,
                stage,
                job_id: item.id,
                line_id: item.line_id,
              });
            }
          }
        } catch (err) {
          skipped.push({
            node: node.id,
            stage,
            reason: (err as Error).message || "提交跳过",
          });
        }
      }
    }

    let totalCredits = 0;
    if (submitted.length) {
      const feeRow = await one(
        this.p.db,
        "SELECT COALESCE(SUM(price),0) AS total FROM jobs WHERE public_id=ANY($1::bigint[])",
        [submitted.map((s) => s.job_id)],
      );
      totalCredits = Number(feeRow?.total ?? 0);
    }

    const response = {
      submitted,
      skipped,
      total_credits: totalCredits,
    };
    if (init.hasRunsTable) {
      await this.p.db.query(
        `INSERT INTO canvas_batch_runs(owner_id, project_id, uid, request_hash, response)
         VALUES ($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT (owner_id, project_id, uid) DO NOTHING`,
        [
          user.id,
          init.projectUuid,
          body.uid,
          requestHash,
          JSON.stringify(response),
        ],
      );
    }
    return response;
  }
}
