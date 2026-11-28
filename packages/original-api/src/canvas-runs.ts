import { creditUnits, formatCredits } from "@fumiao/platform/credit-amount.js";
import { randomUUID } from "node:crypto";
import { directorBatchUnclaimed, directorTargetKey, type DirectorBatchSelection, type DirectorTarget } from "@fumiao/web-compat/director.js";
import { canvasShotOrder, tailParentNode } from "@fumiao/plugin-sdk/canvas-ports.js";
import type { Platform } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { enforceAgentPolicyInTx } from "@fumiao/platform/agent-policy.js";
import { DomainError, hash, requireValue } from "@fumiao/platform/security.js";
import { CanvasSubmissionModels } from "@fumiao/platform/canvas-submission.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { uuid5 } from "@fumiao/platform/uuid.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import { isBgmMusicModel } from "@fumiao/plugin-sdk/speech-routing.js";
import type { OriginalActor } from "./identity.js";
import { parseBody } from "./validation.js";
import { parseDraft } from "./drafts.js";
import {
  canvasBatchFields,
  canvasBatchRunFields,
  canvasBgmRunFields,
  canvasCandidatesFields,
  canvasDialogueRunFields,
  canvasRunFields,
  parseCanvasDocument,
} from "./canvas-draft.js";
import {
  canvasBatchRequestHash,
  directorDraft,
  directorLinkNode,
  directorTargetShots,
  expandGroupNodeIds,
  normalizeDirectorSelection,
  requireDirectorAudioTarget,
  OriginalBatchPrecheck,
  validateDirectorSelection,
  type DirectorTicket,
  type DirectorTicketItem,
  type PrecheckStage,
} from "./batch-precheck.js";
import {
  createTailFrameAsset,
  hasTailChainTable,
} from "@fumiao/platform/tail-frame.js";
import { resolveDialogueInput } from "./dialogue.js";
import {
  canvasNarrationInput,
  canvasVisualPayload,
  directorRenderedVoice,
  resolveCanvasVisualBase,
  resolveDirectorInput,
} from "./director-inputs.js";
import {
  canvasBytes,
  canvasDocumentJson,
  canvasText,
  parseCanvasRunJson,
} from "./canvas-values.js";
import { OriginalCanvases, canvasConflict } from "./canvases.js";
import { OriginalGeneration } from "./generation.js";
import { activeCanvasJobStates, readCanvasTail } from "./canvas-tail.js";
import { OriginalState } from "./state.js";

const namespaceUrl = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

export { compileCinematographyPrompt } from "./director-inputs.js";
type Run = {
  route_revision?: string;
  price_revision_id?: string;
  max_charge?: string;
  uid: string;
  expected_revision: number | bigint;
  price_revision: number | bigint | null;
};
type BatchRunResponse = {
  submitted: { node: string; stage: PrecheckStage; job_id: number; line_id?: string }[];
  skipped: { node: string; stage: PrecheckStage; reason: string; line_id?: string }[];
  total_credits: number;
  exact_total_credits?: string;
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
              `SELECT l.id::text,l.node,l.inputs,j.public_id AS job,
                j.original_view->'audio_settings' AS audio_settings, j.input->'params' AS prepared_audio
                FROM canvas_job_links l JOIN jobs j ON j.id=l.job_id
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
              const inputs = parseCanvasRunJson(canvasText(l.inputs));
              const voice = j.kind === "audio" ? directorRenderedVoice(j.model, l.audio_settings, l.prepared_audio,
                inputs && typeof inputs === "object" ? inputs as Record<string, unknown> : undefined) : {};
              return {
                ...Object.fromEntries(fields.map((key) => [key, j[key]])),
                ...(j.result_mime ? { result_mime: j.result_mime } : {}),
                ...(Object.keys(voice).length ? { audio_settings: voice } : {}),
                link_id: parseCanvasRunJson(l.id),
                canvas_node: l.node,
                inputs,
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
      `SELECT l.project_id,l.node,l.inputs,j.public_id AS job,j.catalog_id,j.provider_model,j.input AS job_input
      FROM canvas_job_links l
      LEFT JOIN jobs j ON j.id=l.job_id AND j.deleted_at IS NULL WHERE l.owner_id=$1 AND l.uid=$2`,
      [user.id, uid],
    );
  }
  private async busy(sql: Sql, project: string, node: string) {
    return !!(await one(
      sql,
      `SELECT 1 FROM canvas_job_links l JOIN jobs j ON j.id=l.job_id
      WHERE l.project_id=$1 AND l.node=$2 AND j.state=ANY($3::text[]) AND j.deleted_at IS NULL LIMIT 1`,
      [project, node, activeCanvasJobStates],
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
    const doc = parseCanvasDocument(canvasDocumentJson(p.document));
    const node = doc.nodes.find((item) => item.id === nid);
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
    const params = node.params;
    const base = await resolveCanvasVisualBase(sql, p.id, doc, node);
    let { refs, native } = base;
    const { builtin, rule } = base;
    // F028: Automatic tail-frame chain discovery for video shots marked `tail_inherited: true`.
    // Never touches shots where `tail_inherited` is falsy (preserves explicit first frames).
    let pendingTailParentJobId: string | null = null;
    if (node.type === "video" && node.tail_inherited) {
      const prevNodeId = tailParentNode(doc, nid);
      if (prevNodeId) {
        const frameRefs = node.generation_mode === "first_last_frame"
          ? [params.h3?.first_frame, params.h3?.last_frame].filter((id): id is string => Boolean(id))
          : node.generation_mode === "omni_ref" ? params.h3_refs : [];
        const tail = await readCanvasTail(sql, p.id, p.workspace_id, prevNodeId, [...refs, ...frameRefs], node.asset_packs.map(pack => pack.id));
        if (tail?.state === "pending") {
          pendingTailParentJobId = tail.job;
        } else if (tail?.state === "completed" && !native?.first_frame) {
          let frame = tail.frame;
          if (!frame) {
            try {
              frame = (await createTailFrameAsset(this.p, sql, user.id, p.workspace_id, tail.source, AbortSignal.timeout(30_000))).public_id;
            } catch {
              requireValue(!builtin, 409, "未能提取上游镜头的尾帧");
              // Legacy plugins can generate without an optional inherited frame.
            }
          }
          if (frame && rule?.nativeH3) {
            native = { ...(native ?? {last_frame:null, video_audio:[]}), mode:"frames", first_frame:frame };
          } else if (frame && !refs.includes(frame)) {
            refs = [frame, ...refs];
          }
        }
      }
    }

    const payload = canvasVisualPayload(node, { ...base, refs, native }, seedOffset);
    const draft = parseDraft(
      node.type,
      {
        ...payload,
        ...(body.route_revision !== undefined && { route_revision: body.route_revision }),
        ...(body.price_revision_id !== undefined && { price_revision_id: body.price_revision_id }),
        ...(body.max_charge !== undefined && { max_charge: body.max_charge }),
        uid: uuid5(namespaceUrl, `fumiao:canvas:${p.public_id}:${nid}:${body.uid}`),
        price_revision: typeof body.price_revision === "number" ? body.price_revision : null,
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
        tailParentJobId: pendingTailParentJobId,
      },
    ).catch((error: unknown) => {
      if (builtin && error instanceof DomainError && error.status === 400)
        throw new DomainError(400, `节点「${node.title || nid}」：${error.message}`);
      throw error;
    });
    await this.link(sql, p, user, nid, body.uid, result.id, {
      revision: p.revision,
      prompt: payload.prompt,
      refs: payload.refs,
      sources: base.sources,
      params: node.params,
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
      const total = creditUnits(String(fees.total));
      requireValue(body.max_charge === undefined || total <= creditUnits(body.max_charge), 409, "候选合计超过已确认的最高积分，请重新确认");
      const result = { ids, count: body.count, credits: Number(fees.total), exact_credits: formatCredits(total) };
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
      const bindings = await CanvasSubmissionModels.read(sql, {
        workspaceId: String(p.workspace_id),
        vault: this.p.vault,
        registry: this.p.registry,
      });
      const draft = parseDraft(
        "audio",
        {
          uid: uuid5(body.uid, `voice:${p.public_id}:${nid}`),
          ...canvasNarrationInput(node, bindings),
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
  async generateBgm(user: OriginalActor, project: string, value: unknown) {
    const body = parseBody(value, canvasBgmRunFields, true) as {
      uid: string;
      model: string;
      prompt: string;
      instruction: string;
      params?: Record<string, unknown>;
      price_revision: number | bigint | null;
    };
    const prompt = pythonStrip(body.prompt);
    requireValue(prompt, 400, "请描述背景音乐的场景与氛围");
    const instruction = pythonStrip(body.instruction || "");
    return this.p.db.transaction(async (sql) => {
      const p = await this.canvases.project(sql, user, project, true);
      await this.ownerLock(sql, user);
      const uid = uuid5(body.uid, "bgm"),
        nodeName = "bgm:project",
        old = await this.previous(sql, user, uid);
      if (old) {
        requireValue(
          old.project_id === p.id && old.node === nodeName && old.job !== null,
          409,
          "这次提交已处理，请刷新后重试",
        );
        return { id: Number(old.job) };
      }
      requireValue(
        !(await this.busy(sql, p.id, nodeName)),
        409,
        "当前画布配乐仍在生成中",
      );
      const catalog = await new StudioCatalog(this.p.db).catalog(sql);
      const modelSpec = catalog[body.model];
      requireValue(
        modelSpec && modelSpec.kind === "audio",
        400,
        "未知配乐模型",
      );
      requireValue(
        isBgmMusicModel(body.model, modelSpec),
        400,
        "该模型仅支持语音合成，不支持作为画布 AI 配乐模型；请启用 BGM 配乐插件",
      );
      const draft = parseDraft(
        "audio",
        {
          uid: uuid5(body.uid, `bgm:${p.public_id}`),
          model: body.model,
          prompt,
          instruction,
          ...(body.params ? { params: body.params } : {}),
          price_revision:
            typeof body.price_revision === "number"
              ? body.price_revision
              : null,
        },
        catalog,
      );
      const result = await this.generation.submitOn(
        sql,
        user,
        draft,
        String(p.workspace_number),
        body.price_revision,
        {
          projectId: String(p.id),
          nodeId: nodeName,
          executionKey: `canvas-bgm:${p.id}:${uid}`,
        },
      );
      await this.link(sql, p, user, nodeName, uid, result.id, {
        model: body.model,
        prompt,
        instruction,
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
      let bindings: CanvasSubmissionModels | null = null;
      let catalog: Awaited<ReturnType<StudioCatalog["catalog"]>> | null = null;
      const items: {
        line_id: string;
        id: number;
        speaker: string;
        model: string;
        voice_id: string | null;
      }[] = [];

      for (const line of targets) {
        const nodeName = `dialogue:${nid}:${line.id}`;
        const uid = uuid5(body.uid, `dialogue:${p.public_id}:${nid}:${line.id}`);
        const old = await this.previous(sql, user, uid);
        if (old) {
          requireValue(
            old.project_id === p.id &&
              old.node === nodeName &&
              old.job !== null,
            409,
            "这次提交已处理，请刷新后重试",
          );
          const savedInputs = old.inputs
            ? (parseCanvasRunJson(canvasText(old.inputs)) as Record<
                string,
                unknown
              > | null)
            : null;
          if (
            savedInputs &&
            (typeof savedInputs.revision === "number" ||
              typeof savedInputs.revision === "bigint")
          ) {
            requireValue(
              Number(savedInputs.revision) === Number(body.expected_revision),
              409,
              "这次提交已处理，请刷新后重试",
            );
          }
          const savedModel =
            (typeof savedInputs?.model === "string" && savedInputs.model) ||
            (typeof old.catalog_id === "string" && old.catalog_id) ||
            (typeof old.provider_model === "string" && old.provider_model) ||
            "";
          let savedVoiceId: string | null = null;
          if (savedInputs && Object.hasOwn(savedInputs, "voice_id")) {
            savedVoiceId =
              typeof savedInputs.voice_id === "string" && savedInputs.voice_id
                ? savedInputs.voice_id
                : null;
          } else if (
            old.job_input &&
            typeof old.job_input === "object" &&
            typeof (old.job_input as any).params?.voice === "string" &&
            (old.job_input as any).params.voice
          ) {
            savedVoiceId = (old.job_input as any).params.voice;
          }
          const savedSpeaker =
            typeof savedInputs?.speaker === "string"
              ? savedInputs.speaker
              : line.speaker;
          items.push({
            line_id: line.id,
            id: Number(old.job),
            speaker: savedSpeaker,
            model: savedModel,
            voice_id: savedVoiceId,
          });
          continue;
        }
        bindings ??= await CanvasSubmissionModels.read(sql, {
          workspaceId: String(p.workspace_id),
          vault: this.p.vault,
          registry: this.p.registry,
        });
        catalog ??= await new StudioCatalog(this.p.db).catalog(sql);
        const { voice: resolved, payload } = await resolveDialogueInput(sql, p.workspace_id, line, bindings);
        const { model, prompt: cleanText } = payload;
        requireValue(
          !(await this.busy(sql, p.id, nodeName)),
          409,
          `对白「${line.speaker || line.id}」仍在生成`,
        );
        const draft = parseDraft(
          "audio",
          {
            uid: uuid5(
              body.uid,
              `dialogue-job:${p.public_id}:${nid}:${line.id}`,
            ),
            ...payload,
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
          model,
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
  private async submitDirectorItem(
    sql: Sql,
    user: OriginalActor,
    projectKey: string,
    body: Run,
    selection: DirectorBatchSelection,
    target: DirectorTarget,
    ticketItem?: DirectorTicketItem,
  ) {
    const project = await this.canvases.project(sql, user, projectKey, true);
    const key = directorTargetKey(target);
    const uid = uuid5(body.uid, `director:${project.id}:${key}`);
    const nodeName = directorLinkNode(target);
    const previous = await one(sql,
      `SELECT j.public_id,j.price FROM canvas_job_links l JOIN jobs j ON j.id=l.job_id
       WHERE l.project_id=$1 AND l.owner_id=$2 AND l.uid=$3 AND l.node=$4`,
      [project.id, user.id, uid, nodeName],
    );
    if (previous) {
      return {
        id: Number(previous.public_id),
        exactCredits: formatCredits(creditUnits(String(previous.price))),
      };
    }
    requireValue(ticketItem, 409, "预检已标记阻塞，请检查此项后重新预检");
    await this.ownerLock(sql, user);
    const executionKey = `canvas-director:${project.id}:${key}:${uid}`;
    if ((target.stage === "image" || target.stage === "video") && (user.tokenId || user.agentAction)) {
      await enforceAgentPolicyInTx(sql, project.workspace_id, {
        projectId: project.id,
        nodeId: target.node_id,
        executionKey,
        approvedProposalId: user.agentAction?.approvedProposalId ?? null,
      });
    }
    await this.generation.lockSubmission(sql, user, project.workspace_id);
    const document = parseCanvasDocument(canvasDocumentJson(project.document));
    const { ordered } = await validateDirectorSelection(
      sql, this.canvases, { workspace_id: project.workspace_id, revision: project.revision },
      document, body.expected_revision, selection, true,
    );
    const { node } = directorTargetShots(document, ordered, target);
    requireDirectorAudioTarget(node, target);
    requireValue(!(await this.busy(sql, project.id, nodeName)), 409, "此项正在生成，请等待任务结束");
    const bindings = await CanvasSubmissionModels.read(sql, {
      strict: false, workspaceId: project.workspace_id, vault: this.p.vault, registry: this.p.registry,
    });
    const input = await resolveDirectorInput(
      sql, { id: project.id, workspace_id: project.workspace_id }, document, target, bindings, { lock: true },
    );
    requireValue(input.basis === ticketItem.basis, 409, "生成输入、素材或声线已变更，请重新预检");
    const catalog = await new StudioCatalog(this.p.db).catalog(sql);
    const draft = directorDraft(input, catalog, uid);
    const submitted = await this.generation.submitOn(
      sql, user, draft, String(project.workspace_number), body.price_revision,
      { projectId: project.id, nodeId: target.node_id, executionKey },
      { checked: "checked" in input ? input.checked : undefined, quote: ticketItem.quote },
    );
    const inputs = {
      ...input.payload,
      director_basis: input.basis,
      revision: project.revision,
      ...("sources" in input ? { sources: input.sources } : {}),
      ...(input.stage === "dialogue" ? {
        line_id: input.line.id,
        speaker: input.line.speaker,
        pack_id: input.voice.packId,
        voice_id: input.voice.voiceId ?? null,
        text: input.payload.prompt,
      } : {}),
      ...(input.stage === "narration" ? { text: input.payload.prompt } : {}),
    };
    await this.link(sql, project, user, nodeName, uid, submitted.id, inputs);
    return {
      id: submitted.id,
      exactCredits:
        ticketItem.quote.exactAmount ??
        formatCredits(creditUnits(String(ticketItem.quote.amount))),
    };
  }

  /**
   * F007 + F010: Partial workflow group / multi-node batch rerun (`POST /api/canvases/:key/batch-runs`).
   * Expands group nodes into children and submits only requested stages (`image`, `video`,
   * `narration`, `dialogue`) with deterministic per-item idempotency keys and a concurrent-safe
   * `in_progress` -> `completed` receipt state machine in `canvas_batch_runs`.
   */
  async batchRun(user: OriginalActor, projectKey: string, value: unknown) {
    const body = parseBody(value, canvasBatchFields(value, canvasBatchRunFields), true) as Run & {
      node_ids: string[];
      stages: PrecheckStage[];
      director?: DirectorBatchSelection;
      precheck_token?: string;
      expected_total_credits?: number | string;
      executable_keys?: string[];
    };
    const director = body.director && normalizeDirectorSelection(body.director);
    const selectionHash = canvasBatchRequestHash({ ...body, director });
    const requestHash = director ? hash(JSON.stringify({
      selectionHash, expected_revision: String(body.expected_revision), price_revision: String(body.price_revision),
      precheck_token: body.precheck_token, expected_total_credits: body.expected_total_credits,
    })) : selectionHash;
    const unclaimed = (message: string) => director ? directorBatchUnclaimed + message : message;
    const claimId = randomUUID();
    const itemUid = (node: string, stage: PrecheckStage) =>
      uuid5(body.uid, `batch:${projectKey}:${node}:${stage}`);
    const ensureClaim = (row: unknown) =>
      requireValue(
        row,
        409,
        "该批量提交已由其他请求恢复，请使用同一 UID 重试获取回执",
      );
    const complete = async (
      sql: Sql,
      projectUuid: string,
      response: BatchRunResponse,
    ) => {
      ensureClaim(
        await one(
          sql,
          `UPDATE canvas_batch_runs
            SET status='completed', response=$5::jsonb, updated_at=now()
          WHERE owner_id=$1 AND project_id=$2 AND uid=$3
            AND claim_id=$4 AND status='in_progress'
          RETURNING uid`,
          [user.id, projectUuid, body.uid, claimId, JSON.stringify(response)],
        ),
      );
      return response;
    };

    type NodeQuote = { price_revision: number; price_revision_id: string; route_revision: string; max_charge: string };
    let nativeQuotes: Partial<Record<string, NodeQuote>> = {};
    const waitOrReclaim = async (
      projectUuid: string,
    ): Promise<
      | { mode: "completed"; response: BatchRunResponse }
      | {
          mode: "reclaimed";
          expectedRevision: number | bigint;
          allowedKeys: Set<string>;
        }
    > => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const row = await one(
          this.p.db,
          `SELECT request_hash, status, response, expected_revision, allowed_keys,
                  (updated_at < now() - interval '60 seconds') AS stale
             FROM canvas_batch_runs
            WHERE owner_id=$1 AND project_id=$2 AND uid=$3`,
          [user.id, projectUuid, body.uid],
        );
        requireValue(row, 409, "批量提交状态已变化，请重试");
        requireValue(
          String(row.request_hash) === requestHash,
          409,
          "该批量提交 UID 已被用于不同的节点或阶段集合",
        );
        if (String(row.status) === "completed") {
          return {
            mode: "completed",
            response: row.response as BatchRunResponse,
          };
        }
        if (row.stale) {
          const reclaimed = await one(
            this.p.db,
            `UPDATE canvas_batch_runs
                SET updated_at = now(), claim_id=$4
              WHERE owner_id=$1 AND project_id=$2 AND uid=$3
                AND status = 'in_progress'
                AND updated_at < now() - interval '60 seconds'
             RETURNING expected_revision, allowed_keys, response`,
            [user.id, projectUuid, body.uid, claimId],
          );
          if (reclaimed) {
            nativeQuotes = reclaimed.response?.native_quotes ?? {};
            return {
              mode: "reclaimed",
              expectedRevision:
                reclaimed.expected_revision != null
                  ? Number(reclaimed.expected_revision)
                  : body.expected_revision,
              allowedKeys: new Set(
                Array.isArray(reclaimed.allowed_keys)
                  ? reclaimed.allowed_keys.map(String)
                  : [],
              ),
            };
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      requireValue(
        false,
        409,
        "该批量提交仍在处理中，请稍候使用同一 UID 重试获取完整回执",
      );
      throw new Error("unreachable");
    };

    const loadExecutionPlan = (
      p: Record<string, any>,
    ): {
      plan: ReturnType<typeof expandGroupNodeIds>;
      shotIndexMap: Map<string, number>;
    } => {
      const doc = parseCanvasDocument(canvasDocumentJson(p.document));
      const targets = expandGroupNodeIds(doc.nodes, body.node_ids);
      requireValue(targets.length > 0, 400, "未找到可执行的节点");
      const effectiveShots = canvasShotOrder(doc);
      return {
        plan: targets,
        shotIndexMap: new Map<string, number>(
          effectiveShots.map((id, idx) => [id, idx]),
        ),
      };
    };

    // The original executable keys and deterministic link UIDs survive document edits.
    // Match dialogue by its persisted line identifier because all lines submit atomically.
    const recoverEditedBatch = async (
      sql: Sql,
      projectUuid: string,
      allowed: Set<string>,
    ) => {
      const submitted: BatchRunResponse["submitted"] = [];
      const skipped: BatchRunResponse["skipped"] = [];
      const targetsByUid = new Map<
        string,
        { node: string; stage: PrecheckStage }
      >();
      const dialogueNodes: string[] = [];
      for (const key of allowed) {
        const [node, stage] = key.split(":") as [string, PrecheckStage];
        if (stage === "dialogue") {
          dialogueNodes.push(node);
        } else {
          const uid = itemUid(node, stage);
          targetsByUid.set(stage === "narration" ? uuid5(uid, "narration") : uid, {
            node,
            stage,
          });
        }
      }
      const { rows } = await sql.query<{
        uid: string;
        node: string;
        job_id: string;
        price: string;
      }>(
        `SELECT l.uid, l.node, j.public_id AS job_id, j.price
           FROM canvas_job_links l JOIN jobs j ON j.id=l.job_id
          WHERE l.project_id=$1 AND l.owner_id=$2 AND (
            l.uid=ANY($3::uuid[]) OR (
              l.node LIKE 'dialogue:%' AND split_part(l.node, ':', 2)=ANY($4::text[])
            )
          ) ORDER BY l.id`,
        [projectUuid, user.id, [...targetsByUid.keys()], dialogueNodes],
      );
      const accepted = new Set<string>();
      let totalUnits = 0n;
      for (const row of rows) {
        const target = targetsByUid.get(row.uid);
        if (target) {
          submitted.push({ ...target, job_id: Number(row.job_id) });
          accepted.add(`${target.node}:${target.stage}`);
        } else {
          const [, node, line_id] = row.node.split(":");
          const uid = uuid5(
            itemUid(node, "dialogue"),
            `dialogue:${projectKey}:${node}:${line_id}`,
          );
          if (row.uid !== uid) continue;
          submitted.push({
            node,
            stage: "dialogue",
            job_id: Number(row.job_id),
            line_id,
          });
          accepted.add(`${node}:dialogue`);
        }
        totalUnits += creditUnits(String(row.price));
      }
      for (const key of allowed) {
        if (accepted.has(key)) continue;
        const [node, stage] = key.split(":") as [string, PrecheckStage];
        skipped.push({
          node,
          stage,
          reason: "画布版本已变更，未提交此项。请按当前画布重新预检。",
        });
      }
      return complete(sql, projectUuid, {
        submitted,
        skipped,
        total_credits: Number(formatCredits(totalUnits)),
        exact_total_credits: formatCredits(totalUnits),
      });
    };

    // 1. Check persisted `canvas_batch_runs` row FIRST (BEFORE revision/precheck checks!)
    // so retries of completed OR still-in-progress batches with the same business `uid`
    // NEVER fail with 409 on a later canvas edit and NEVER seal a partial half-receipt.
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
          `SELECT request_hash, status, response
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
          if (String(persisted.status) === "completed") {
            return {
              kind: "completed" as const,
              replayResponse: persisted.response as BatchRunResponse,
              projectUuid: String(p.id),
              hasRunsTable: true,
              plan: [] as ReturnType<typeof expandGroupNodeIds>,
              shotIndexMap: new Map<string, number>(),
              serverAllowedKeys: null as Set<string> | null,
              serverTotalCredits: null as string | null,
            };
          }
          return {
            kind: "in_progress" as const,
            replayResponse: null,
            projectUuid: String(p.id),
            hasRunsTable: true,
            plan: [] as ReturnType<typeof expandGroupNodeIds>,
            shotIndexMap: new Map<string, number>(),
            serverAllowedKeys: null as Set<string> | null,
            serverTotalCredits: null as string | null,
          };
        }
      }

      // 2. NEW submission: enforce expected_revision + mandatory server-bound precheck ticket!
      const { plan, shotIndexMap } = director ? { plan: [], shotIndexMap: new Map<string, number>() } : loadExecutionPlan(p);
      requireValue(p.revision === body.expected_revision, 409, unclaimed(canvasConflict));
      requireValue(
        typeof body.precheck_token === "string" &&
          body.precheck_token.trim().length > 0,
        400,
        unclaimed("请先执行批量预检并携带有效预检票据后再确认提交"),
      );

      let serverAllowedKeys: Set<string> | null = null;
      let serverTotalCredits: string | null = null;
      if (hasTables?.has_tickets) {
        const ticket = await one(
          sql,
          `SELECT token, revision, price_revision, request_hash, executable_keys, total_credits, budget_blocked
                    ${director ? ", director_items" : ""}
             FROM canvas_precheck_tickets
            WHERE token=$1 AND owner_id=$2 AND project_id=$3`,
          [body.precheck_token, user.id, p.id],
        );
        requireValue(
          ticket,
          409,
          unclaimed("预检票据不存在或已失效，请重新预检后再确认提交"),
        );
        requireValue(
          String(ticket.request_hash) === selectionHash &&
            Number(ticket.revision) === Number(p.revision),
          409,
          unclaimed("画布版本或选中节点/阶段与预检票据不一致，请重新预检"),
        );
        requireValue(
          !ticket.budget_blocked,
          402,
          unclaimed("预检显示已超出预算硬上限，无法提交"),
        );
        if (director) requireValue(
          ticket.director_items &&
          Number(ticket.price_revision) === body.price_revision &&
          (body.expected_total_credits === undefined ||
            creditUnits(String(ticket.total_credits)) === creditUnits(String(body.expected_total_credits))),
          409, unclaimed("报价版本或积分与预检票据不一致，请重新预检"),
        );
        serverAllowedKeys = new Set(
          Array.isArray(ticket.executable_keys)
            ? ticket.executable_keys.map(String)
            : [],
        );
        serverTotalCredits = formatCredits(creditUnits(String(ticket.total_credits ?? 0)));
      }

      return {
        kind: "new" as const,
        replayResponse: null,
        projectUuid: String(p.id),
        hasRunsTable: Boolean(hasTables?.has_runs),
        plan,
        shotIndexMap,
        serverAllowedKeys,
        serverTotalCredits,
      };
    });

    if (init.kind === "completed") {
      return init.replayResponse;
    }

    const refreshClaim = async (sql: Sql) => ensureClaim(await one(
      sql,
      `UPDATE canvas_batch_runs SET updated_at=now()
       WHERE owner_id=$1 AND project_id=$2 AND uid=$3 AND claim_id=$4 AND status='in_progress' RETURNING uid`,
      [user.id, init.projectUuid, body.uid, claimId],
    ));
    const claim = (keys: Set<string>, initialResponse: Record<string, unknown> = {}) => one(
      this.p.db,
      `INSERT INTO canvas_batch_runs(
         owner_id, project_id, uid, request_hash, status,
         expected_revision, allowed_keys, response, updated_at, claim_id
       ) VALUES ($1, $2, $3, $4, 'in_progress', $5, $6::text[], $8::jsonb, now(), $7)
       ON CONFLICT (owner_id, project_id, uid) DO NOTHING RETURNING uid`,
      [user.id, init.projectUuid, body.uid, requestHash, Number(body.expected_revision), [...keys].sort(), claimId, JSON.stringify(initialResponse)],
    );

    if (director) {
      requireValue(init.hasRunsTable, 503, "批量回执尚未启用");
      let allowed = init.serverAllowedKeys;
      if (init.kind !== "new" || !(await claim(allowed ?? new Set()))) {
        const outcome = await waitOrReclaim(init.projectUuid);
        if (outcome.mode === "completed") return outcome.response;
        allowed = outcome.allowedKeys;
      }
      const ticket = await one(
        this.p.db,
        "SELECT director_items FROM canvas_precheck_tickets WHERE token=$1 AND owner_id=$2 AND project_id=$3",
        [body.precheck_token, user.id, init.projectUuid],
      );
      const checked = (ticket?.director_items ?? {}) as DirectorTicket;
      const response: BatchRunResponse = { submitted: [], skipped: [], total_credits: 0 };
      let totalUnits = 0n;
      for (const target of director.targets) {
        const { node_id: node, ...stage } = target;
        const key = directorTargetKey(target);
        const item = allowed?.has(key) ? checked[key] : undefined;
        try {
          const result = await this.p.db.transaction(async (sql) => {
            await refreshClaim(sql);
            return this.submitDirectorItem(sql, user, projectKey, body, director, target, item);
          });
          response.submitted.push({ node, ...stage, job_id: result.id });
          totalUnits += creditUnits(result.exactCredits);
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          response.skipped.push({ node, ...stage, reason: error.message });
        }
      }
      const exactTotal = formatCredits(totalUnits);
      response.total_credits = Number(exactTotal);
      response.exact_total_credits = exactTotal;
      return complete(this.p.db, init.projectUuid, response);
    }

    let plan = init.plan;
    let shotIndexMap = init.shotIndexMap;
    let allowedKeys = new Set<string>();
    let effectiveExpectedRevision: number | bigint = body.expected_revision;
    let resume = init.kind === "in_progress";
    if (!resume) {
      // 3. Re-verify fresh read-only precheck right before claiming `in_progress` so
      // concurrent price changes, busy jobs, or budget exhaustion are caught cleanly.
      // If a concurrent identical request already claimed the same `uid` while we were
      // running precheck, defer cleanly to `waitOrReclaim` instead of returning a false 409.
      const checkConcurrentTwin = async () => {
        if (!init.hasRunsTable) return null;
        return one(
          this.p.db,
          `SELECT 1 AS ok FROM canvas_batch_runs WHERE owner_id=$1 AND project_id=$2 AND uid=$3`,
          [user.id, init.projectUuid, body.uid],
        );
      };

      try {
        const freshPrecheck = await new OriginalBatchPrecheck(this.p).precheckCanvas(
          user,
          projectKey,
          {
            expected_revision: body.expected_revision,
            node_ids: body.node_ids,
            stages: body.stages,
          },
        );
        if (freshPrecheck.precheck_token !== body.precheck_token) {
          requireValue(
            false,
            409,
            "画布节点状态、模型报价或可执行集合已发生变化，请重新预检后再确认提交",
          );
        }
        for (const item of freshPrecheck.items) {
          if (item.status === "blocked" || !item.route_revision || !item.price_revision_id) continue;
          nativeQuotes[item.node_id + ":" + item.stage] = {
            price_revision: freshPrecheck.price_revision,
            route_revision: item.route_revision,
            price_revision_id: item.price_revision_id,
            max_charge: item.exact_credits,
          };
        }
        requireValue(
          !Object.keys(nativeQuotes).length || Number(body.price_revision) === freshPrecheck.price_revision,
          409, "积分价格已更新，请重新预检",
        );
        const expectedCredits =
          body.expected_total_credits ?? init.serverTotalCredits;
        if (
          expectedCredits !== null &&
          expectedCredits !== undefined &&
          freshPrecheck.summary.exact_total_credits !== String(expectedCredits)
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
        allowedKeys =
          init.serverAllowedKeys ?? new Set(freshPrecheck.executable_keys);
      } catch (err) {
        if (!(await checkConcurrentTwin())) throw err;
        resume = true;
      }

      // Persist the original executable targets before dispatching any jobs.
      if (!resume && init.hasRunsTable) {
        const claimed = await claim(allowedKeys, { native_quotes: nativeQuotes });
        resume = !claimed;
      }
    }

    if (resume) {
      const outcome = await waitOrReclaim(init.projectUuid);
      if (outcome.mode === "completed") return outcome.response;
      effectiveExpectedRevision = outcome.expectedRevision;
      allowedKeys = outcome.allowedKeys;
      const reloaded = await this.p.db.transaction(async (sql) => {
        const project = await this.canvases.project(sql, user, projectKey, true);
        if (project.revision !== effectiveExpectedRevision) {
          return {
            kind: "edited" as const,
            receipt: await recoverEditedBatch(sql, init.projectUuid, allowedKeys),
          };
        }
        return { kind: "unchanged" as const, ...loadExecutionPlan(project) };
      });
      if (reloaded.kind === "edited") return reloaded.receipt;
      ({ plan, shotIndexMap } = reloaded);
    }

    // 5. Dispatch all items with deterministic per-item idempotency keys while refreshing
    // `updated_at` heartbeat. NEVER write `status='completed'` until the entire batch finishes!
    const submitted: BatchRunResponse["submitted"] = [];
    const skipped: BatchRunResponse["skipped"] = [];

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

        if (!allowedKeys.has(`${node.id}:${stage}`)) {
          skipped.push({
            node: node.id,
            stage,
            reason: "预检已标记阻塞，按预检集合跳过",
          });
          continue;
        }

        if (init.hasRunsTable) {
          await refreshClaim(this.p.db);
        }

        const uid = itemUid(node.id, stage);
        try {
          if (stage === "image" || stage === "video") {
            const res = await this.generate(user, projectKey, node.id, {
              expected_revision: effectiveExpectedRevision,
              price_revision: body.price_revision,
              ...nativeQuotes[node.id + ":" + stage],
              uid,
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
              expected_revision: effectiveExpectedRevision,
              price_revision: body.price_revision,
              uid,
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
              expected_revision: effectiveExpectedRevision,
              price_revision: body.price_revision,
              uid,
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

    let totalCredits = "0";
    if (submitted.length) {
      const feeRow = await one(
        this.p.db,
        "SELECT COALESCE(SUM(price),0) AS total FROM jobs WHERE public_id=ANY($1::bigint[])",
        [submitted.map((s) => s.job_id)],
      );
      totalCredits = formatCredits(creditUnits(String(feeRow?.total ?? 0)));
    }

    const response: BatchRunResponse = {
      submitted,
      skipped,
      total_credits: Number(totalCredits),
      exact_total_credits: totalCredits,
    };
    if (resume) {
      return this.p.db.transaction(async (sql) => {
        const project = await this.canvases.project(sql, user, projectKey, true);
        return project.revision === effectiveExpectedRevision
          ? complete(sql, init.projectUuid, response)
          : recoverEditedBatch(sql, init.projectUuid, allowedKeys);
      });
    }
    return init.hasRunsTable ? complete(this.p.db, init.projectUuid, response) : response;
  }
}
