import { creditUnits, formatCredits } from "@fumiao/platform/credit-amount.js";
import { randomUUID } from "node:crypto";
import type { Platform } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { CanvasSubmissionModels } from "@fumiao/platform/canvas-submission.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { DomainError, requireValue } from "@fumiao/platform/security.js";
import {
  enforceAgentPolicyInTx,
  hasActiveWorkspaceCapBudget,
  readAgentExecutionPolicy,
  type AgentActionGuardOptions,
  type AgentExecutionPolicy,
} from "@fumiao/platform/agent-policy.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import { OriginalIdentity, type OriginalActor } from "./identity.js";
import { OriginalCanvases, canvasConflict } from "./canvases.js";
import {
  parseCanvasDocument,
  type CanvasDocument,
  type CanvasNode,
} from "./canvas-draft.js";
import { canvasDocumentJson, canvasText } from "./canvas-values.js";
import { parseBody } from "./validation.js";
import {
  agentPolicyFields,
  proposalApplyFields,
  proposalCreateFields,
} from "./wave4-fields.js";

export type { AgentExecutionPolicy };

export { agentPolicyFields, proposalApplyFields, proposalCreateFields };

const ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;
const NODE_TYPES = new Set(["text", "image", "video", "sticky", "group"]);
const COLORS = new Set(["none", "mint", "blue", "purple", "orange", "yellow"]);
const GEN_MODES = new Set([
  "first_frame",
  "first_last_frame",
  "omni_ref",
  "grid_preview",
]);

export type CanvasProposalOp =
  | {
      op: "add_node";
      temp_id: string;
      type: "text" | "image" | "video" | "sticky" | "group";
      title: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
      text?: string;
      prompt?: string;
      narration_text?: string;
      color?: "none" | "mint" | "blue" | "purple" | "orange" | "yellow";
      parent_id?: string | null;
      generation_mode?:
        | "first_frame"
        | "first_last_frame"
        | "omni_ref"
        | "grid_preview";
      cinematography?: Record<string, string>;
      params?: Record<string, unknown>;
    }
  | {
      op: "update_node";
      id: string;
      patch: Record<string, unknown>;
    }
  | { op: "remove_node"; id: string }
  | {
      op: "add_edge";
      source: string;
      target: string;
      sourcePort?: string;
      targetPort?: string;
    }
  | { op: "remove_edge"; id: string }
  | { op: "set_shots"; shots: string[] };

function validCoord(v: unknown, fallback = 0): number {
  if (v === undefined) return fallback;
  requireValue(
    typeof v === "number" && Number.isFinite(v) && v >= -100000 && v <= 100000,
    400,
    "画布坐标无效",
  );
  return v as number;
}

function parseProposalOp(raw: unknown): CanvasProposalOp {
  requireValue(
    raw && typeof raw === "object" && !Array.isArray(raw),
    400,
    "画布变更提案包含无效操作",
  );
  const obj = raw as Record<string, any>;
  if (obj.op === "add_node") {
    requireValue(
      typeof obj.temp_id === "string" && ID_RE.test(obj.temp_id),
      400,
      "add_node temp_id 无效",
    );
    requireValue(
      typeof obj.type === "string" && NODE_TYPES.has(obj.type),
      400,
      "add_node 节点类型无效",
    );
    const title = typeof obj.title === "string" ? obj.title.slice(0, 80) : "";
    const out: CanvasProposalOp = {
      op: "add_node",
      temp_id: obj.temp_id,
      type: obj.type as any,
      title,
      x: validCoord(obj.x, 0),
      y: validCoord(obj.y, 0),
      ...(typeof obj.width === "number" && obj.width >= 160 && obj.width <= 3200
        ? { width: obj.width }
        : {}),
      ...(typeof obj.height === "number" &&
      obj.height >= 100 &&
      obj.height <= 3200
        ? { height: obj.height }
        : {}),
      ...(typeof obj.text === "string" ? { text: obj.text.slice(0, 12000) } : {}),
      ...(typeof obj.prompt === "string"
        ? { prompt: obj.prompt.slice(0, 12000) }
        : {}),
      ...(typeof obj.narration_text === "string"
        ? { narration_text: obj.narration_text.slice(0, 300) }
        : {}),
      ...(typeof obj.color === "string" && COLORS.has(obj.color)
        ? { color: obj.color as any }
        : {}),
      ...(typeof obj.parent_id === "string" && ID_RE.test(obj.parent_id)
        ? { parent_id: obj.parent_id }
        : {}),
      ...(typeof obj.generation_mode === "string" &&
      GEN_MODES.has(obj.generation_mode)
        ? { generation_mode: obj.generation_mode as any }
        : {}),
      ...(obj.cinematography && typeof obj.cinematography === "object"
        ? { cinematography: obj.cinematography }
        : {}),
      ...(obj.params && typeof obj.params === "object"
        ? { params: obj.params }
        : {}),
    };
    return out;
  }
  if (obj.op === "update_node") {
    requireValue(
      typeof obj.id === "string" && ID_RE.test(obj.id),
      400,
      "update_node id 无效",
    );
    requireValue(
      obj.patch && typeof obj.patch === "object" && !Array.isArray(obj.patch),
      400,
      "update_node patch 无效",
    );
    const allowedKeys = new Set([
      "title",
      "text",
      "prompt",
      "narration_text",
      "x",
      "y",
      "generation_mode",
      "cinematography",
    ]);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj.patch)) {
      if (allowedKeys.has(k)) patch[k] = v;
    }
    return { op: "update_node", id: obj.id, patch };
  }
  if (obj.op === "remove_node") {
    requireValue(
      typeof obj.id === "string" && ID_RE.test(obj.id),
      400,
      "remove_node id 无效",
    );
    return { op: "remove_node", id: obj.id };
  }
  if (obj.op === "add_edge") {
    requireValue(
      typeof obj.source === "string" &&
        ID_RE.test(obj.source) &&
        typeof obj.target === "string" &&
        ID_RE.test(obj.target),
      400,
      "add_edge source/target 无效",
    );
    return {
      op: "add_edge",
      source: obj.source,
      target: obj.target,
      ...(typeof obj.sourcePort === "string"
        ? { sourcePort: obj.sourcePort.slice(0, 32) }
        : {}),
      ...(typeof obj.targetPort === "string"
        ? { targetPort: obj.targetPort.slice(0, 32) }
        : {}),
    };
  }
  if (obj.op === "remove_edge") {
    requireValue(
      typeof obj.id === "string" && ID_RE.test(obj.id),
      400,
      "remove_edge id 无效",
    );
    return { op: "remove_edge", id: obj.id };
  }
  if (obj.op === "set_shots") {
    requireValue(
      Array.isArray(obj.shots) &&
        obj.shots.length <= 200 &&
        obj.shots.every((s: unknown) => typeof s === "string" && ID_RE.test(s)),
      400,
      "set_shots 列表无效",
    );
    return { op: "set_shots", shots: obj.shots };
  }
  throw new DomainError(400, "画布变更提案包含未知操作类型");
}

/**
 * Pure deterministic patch engine: applies an atomic list of proposal operations
 * onto a CanvasDocument, resolving batch-local `temp_id` references cleanly.
 */
export function applyCanvasProposalOps(
  baseDoc: CanvasDocument,
  rawOps: unknown[],
  allocateId: () => string = () => randomUUID(),
): {
  document: CanvasDocument;
  ops: CanvasProposalOp[];
  tempMap: Record<string, string>;
  addedNodes: CanvasNode[];
  affectedGenNodeIds: string[];
} {
  const ops: CanvasProposalOp[] = rawOps.map(parseProposalOp);

  const nodes = baseDoc.nodes.map((n) => ({ ...n, params: { ...n.params } }));
  const edges = baseDoc.edges.map((e) => ({ ...e }));
  let shots = baseDoc.shots ? [...baseDoc.shots] : undefined;
  const tempMap: Record<string, string> = {};
  const addedNodes: CanvasNode[] = [];
  const affectedGenNodeSet = new Set<string>();

  const resolveId = (ref: string) => tempMap[ref] ?? ref;

  for (const op of ops) {
    if (op.op === "add_node") {
      requireValue(!tempMap[op.temp_id], 400, `重复的临时节点标识：${op.temp_id}`);
      const realId = allocateId();
      tempMap[op.temp_id] = realId;
      const node: any = {
        id: realId,
        type: op.type,
        title: op.title || op.temp_id,
        x: op.x,
        y: op.y,
        width: op.width ?? (op.type === "group" ? 720 : 320),
        height: op.height ?? (op.type === "group" ? 440 : 240),
        text: op.text ?? "",
        prompt: op.prompt ?? "",
        narration_text: op.narration_text ?? "",
        color:
          op.color ??
          (op.type === "sticky"
            ? "yellow"
            : op.type === "group"
              ? "blue"
              : "none"),
        ...(op.parent_id ? { parent_id: resolveId(op.parent_id) } : {}),
        ...(op.generation_mode ? { generation_mode: op.generation_mode } : {}),
        ...(op.cinematography ? { cinematography: op.cinematography } : {}),
        ...(op.params ? { params: op.params } : {}),
      };
      nodes.push(node);
      addedNodes.push(node);
      if (op.type === "image" || op.type === "video") {
        affectedGenNodeSet.add(realId);
      }
    } else if (op.op === "update_node") {
      const targetId = resolveId(op.id);
      const idx = nodes.findIndex((n) => n.id === targetId);
      requireValue(idx >= 0, 404, `提案引用的节点不存在：${op.id}`);
      nodes[idx] = { ...nodes[idx], ...op.patch };
      if (nodes[idx].type === "image" || nodes[idx].type === "video") {
        affectedGenNodeSet.add(targetId);
      }
    } else if (op.op === "remove_node") {
      const targetId = resolveId(op.id);
      const idx = nodes.findIndex((n) => n.id === targetId);
      requireValue(idx >= 0, 404, `提案要删除的节点不存在：${op.id}`);
      nodes.splice(idx, 1);
      affectedGenNodeSet.delete(targetId);
      for (let i = edges.length - 1; i >= 0; i--) {
        if (edges[i].source === targetId || edges[i].target === targetId) {
          edges.splice(i, 1);
        }
      }
      if (shots) shots = shots.filter((s) => s !== targetId);
    } else if (op.op === "add_edge") {
      const source = resolveId(op.source);
      const target = resolveId(op.target);
      edges.push({
        id: allocateId(),
        source,
        target,
        ...(op.sourcePort ? { sourcePort: op.sourcePort } : {}),
        ...(op.targetPort ? { targetPort: op.targetPort } : {}),
      });
    } else if (op.op === "remove_edge") {
      const idx = edges.findIndex((e) => e.id === op.id);
      if (idx >= 0) edges.splice(idx, 1);
    } else if (op.op === "set_shots") {
      shots = op.shots.map(resolveId);
    }
  }

  const parsedDoc = parseCanvasDocument({
    schemaVersion: 1,
    nodes,
    edges,
    ...(shots !== undefined ? { shots } : {}),
    ...(baseDoc.bgm !== undefined ? { bgm: baseDoc.bgm } : {}),
    ...(baseDoc.loudnorm !== undefined ? { loudnorm: baseDoc.loudnorm } : {}),
  });

  return {
    document: parsedDoc,
    ops,
    tempMap,
    addedNodes,
    affectedGenNodeIds: [...affectedGenNodeSet],
  };
}

export class OriginalAgentPolicies {
  readonly identity: OriginalIdentity;
  constructor(readonly p: Platform) {
    this.identity = new OriginalIdentity(p);
  }
  async readPolicy(sql: Sql, workspaceId: string): Promise<AgentExecutionPolicy> {
    return readAgentExecutionPolicy(sql, workspaceId);
  }
  /** Checks whether the workspace currently has an active enabled `cap` budget policy. */
  async hasActiveCapBudget(sql: Sql, workspaceId: string): Promise<boolean> {
    return hasActiveWorkspaceCapBudget(sql, workspaceId);
  }
  /**
   * F031: Unified server-authoritative Agent execution policy guardrail.
   * Covers MCP tools, Bearer API Token generation routes, and internal Canvas Agent actions.
   * Normal user browser-session requests bypass this guardrail so user-initiated generation still works.
   */
  async enforceForAgentAction(
    sql: Sql,
    workspaceId: string,
    options: AgentActionGuardOptions = {},
  ): Promise<void> {
    await enforceAgentPolicyInTx(sql, workspaceId, options);
  }
  /** Legacy alias kept for compatibility. */
  async assertCanSubmitPaidJob(
    sql: Sql,
    workspaceId: string,
    options?: AgentActionGuardOptions,
  ): Promise<void> {
    return this.enforceForAgentAction(sql, workspaceId, options);
  }
  async get(user: OriginalActor, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      const policy = await this.readPolicy(sql, workspace.id);
      const hasCapBudget = await this.hasActiveCapBudget(sql, workspace.id);
      return {
        workspace: Number(workspace.public_id),
        execution_policy: policy,
        has_active_cap_budget: hasCapBudget,
      };
    });
  }
  async set(user: OriginalActor, value: unknown, selected?: string) {
    requireValue(
      !user.tokenId,
      403,
      "修改 Agent 安全执行策略仅支持浏览器会话，禁止使用 API Token",
    );
    const body = parseBody(value, agentPolicyFields, true) as {
      execution_policy: AgentExecutionPolicy;
    };
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      requireValue(
        user.role === "admin" || workspace.owner_id === user.id,
        403,
        "只有工作区负责人或管理员可以修改 Agent 安全执行策略",
      );
      if (body.execution_policy === "auto_within_budget") {
        const hasCap = await this.hasActiveCapBudget(sql, workspace.id);
        requireValue(
          hasCap,
          400,
          "启用「预算上限内自动执行」前，请先在「设置 → 预算与风控」中为当前工作区配置并启用有效的硬上限预算策略 (cap)",
        );
      }
      await sql.query(
        `INSERT INTO workspace_agent_policies(workspace_id, execution_policy, updated_by, updated_at)
         VALUES($1, $2, $3, now())
         ON CONFLICT (workspace_id) DO UPDATE SET
           execution_policy = excluded.execution_policy,
           updated_by = excluded.updated_by,
           updated_at = now()`,
        [workspace.id, body.execution_policy, user.id],
      );
      return {
        workspace: Number(workspace.public_id),
        execution_policy: body.execution_policy,
      };
    });
  }
}

export class OriginalCanvasProposals {
  readonly canvases: OriginalCanvases;
  readonly catalog: StudioCatalog;
  constructor(readonly p: Platform) {
    this.canvases = new OriginalCanvases(p);
    this.catalog = new StudioCatalog(p.db);
  }
  private format(row: any) {
    return {
      id: row.public_id as string,
      title: row.title as string,
      summary: row.summary as string,
      base_revision: Number(row.base_revision),
      operations: row.operations as CanvasProposalOp[],
      estimated_credits: Number(row.estimated_credits),
      status: row.status as "pending" | "applied" | "rejected" | "expired",
      applied_revision:
        row.applied_revision !== null ? Number(row.applied_revision) : null,
      created: Math.floor(new Date(row.created_at).getTime() / 1000),
      resolved: row.resolved_at
        ? Math.floor(new Date(row.resolved_at).getTime() / 1000)
        : null,
    };
  }
  /** F018: Read-only structured canvas graph query for AI Agents (zero write locks). */
  async readGraph(user: OriginalActor, projectKey: string) {
    return this.p.db.transaction(async (sql) => {
      await sql.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const project = await this.canvases.project(sql, user, projectKey);
      const doc = parseCanvasDocument(canvasDocumentJson(project.document));
      return {
        id: project.public_id as string,
        title: canvasText(project.original_title),
        revision: Number(project.revision),
        workspace: Number(project.workspace_number),
        nodes: doc.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
          text: n.text,
          prompt: n.prompt,
          narration_text: n.narration_text,
          parent_id: n.parent_id ?? null,
          generation_mode: n.generation_mode ?? null,
          cinematography: n.cinematography ?? null,
          media_id: n.media_id,
          asset_packs: n.asset_packs,
          params: n.params,
        })),
        edges: doc.edges,
        shots: doc.shots ?? [],
      };
    });
  }
  async list(user: OriginalActor, projectKey: string) {
    return this.p.db.transaction(async (sql) => {
      const project = await this.canvases.project(sql, user, projectKey);
      const { rows } = await sql.query(
        `SELECT * FROM canvas_proposals WHERE project_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [project.id],
      );
      return {
        project_id: project.public_id as string,
        current_revision: Number(project.revision),
        proposals: rows.map((r) => this.format(r)),
      };
    });
  }
  /**
   * F018: Validates and records an atomic Canvas Proposal + estimated credits WITHOUT
   * modifying the live canvas or charging credits. User must approve via `apply()`.
   */
  async create(user: OriginalActor, projectKey: string, value: unknown) {
    const body = parseBody(value, proposalCreateFields, true) as {
      title: string;
      summary: string;
      base_revision?: number | null;
      operations: unknown[];
    };
    return this.p.db.transaction(async (sql) => {
      const project = await this.canvases.project(sql, user, projectKey);
      const baseRevision = body.base_revision ?? Number(project.revision);
      requireValue(
        baseRevision === Number(project.revision),
        409,
        canvasConflict,
      );
      const baseDoc = parseCanvasDocument(canvasDocumentJson(project.document));
      // Dry-run patch to guarantee structural validity before persisting proposal!
      const preview = applyCanvasProposalOps(baseDoc, body.operations);

      // Estimate future render credits for newly proposed or updated image/video nodes
      const bindings = await CanvasSubmissionModels.read(sql, {
        strict: false,
      });
      const affectedSet = new Set(preview.affectedGenNodeIds);
      let estimatedUnits = 0n;
      for (const node of preview.document.nodes) {
        if (!affectedSet.has(node.id)) continue;
        if (node.type !== "image" && node.type !== "video") continue;
        let model = node.params?.model || "";
        if (!model) {
          try {
            model = bindings.default(node.type);
          } catch {
            model = "";
          }
        }
        if (!model) continue;
        const q = await this.catalog.quoteReadOnly(
          sql,
          model,
          project.workspace_id,
          node.type === "image"
            ? {
                resolution: node.params?.resolution || "1K",
                image_quality: node.params?.image_quality || "medium",
                ratio: node.params?.ratio || "16:9",
              }
            : {
                seconds: node.params?.seconds ?? 5,
                quality: node.params?.quality ?? 480,
                ratio: node.params?.ratio || "16:9",
              },
          { requireConnection: false },
        );
        if (q.allowed && q.priced) estimatedUnits += creditUnits(String(q.amount));
      }

      const id = randomUUID();
      const publicId = randomUUID().replaceAll("-", "");
      await sql.query(
        `INSERT INTO canvas_proposals(id, public_id, project_id, workspace_id, owner_id, base_revision, title, summary, operations, estimated_credits, status)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')`,
        [
          id,
          publicId,
          project.id,
          project.workspace_id,
          user.id,
          baseRevision,
          pythonStrip(body.title) || "画布变更提案",
          pythonStrip(body.summary || ""),
          JSON.stringify(preview.ops),
          formatCredits(estimatedUnits),
        ],
      );
      const row = await one(
        sql,
        "SELECT * FROM canvas_proposals WHERE id=$1",
        [id],
      );
      return this.format(row);
    });
  }
  /**
   * F018: Atomically applies an approved proposal onto the canvas using optimistic revision lock.
   * NEVER triggers paid generation jobs automatically!
   */
  async apply(
    user: OriginalActor,
    projectKey: string,
    proposalKey: string,
    value: unknown,
  ) {
    requireValue(
      !user.tokenId,
      403,
      "提案审批落图必须由用户在浏览器会话中确认，禁止使用 API Token 自行批准",
    );
    const body = parseBody(value, proposalApplyFields, true) as {
      expected_revision: number;
    };
    const applied = await this.p.db.transaction(async (sql) => {
      const project = await this.canvases.project(sql, user, projectKey, true);
      requireValue(
        Number(project.revision) === Number(body.expected_revision),
        409,
        canvasConflict,
      );
      const proposal = await one(
        sql,
        `SELECT * FROM canvas_proposals WHERE project_id=$1 AND public_id=$2 FOR UPDATE`,
        [project.id, proposalKey],
      );
      requireValue(proposal, 404, "提案不存在");
      requireValue(
        proposal.status === "pending",
        409,
        "该提案已处理，不能重复落图",
      );
      const baseDoc = parseCanvasDocument(canvasDocumentJson(project.document));
      const patched = applyCanvasProposalOps(baseDoc, proposal.operations);
      return {
        proposalId: proposal.id as string,
        projectId: String(project.id),
        estimatedCredits: String(proposal.estimated_credits ?? 0),
        title: canvasText(project.original_title),
        document: patched.document,
        tempMap: patched.tempMap,
        affectedGenNodeIds: patched.affectedGenNodeIds,
      };
    });

    // Save through canonical OriginalCanvases.save (enforces full node/edge/pack/asset validation + optimistic lock!)
    const savedCanvas = await this.canvases.save(user, projectKey, {
      expected_revision: body.expected_revision,
      title: applied.title,
      document: applied.document,
    });

    await this.p.db.transaction(async (sql) => {
      await sql.query(
        `UPDATE canvas_proposals
         SET status='applied', applied_revision=$2, resolved_at=now()
         WHERE id=$1`,
        [applied.proposalId, savedCanvas.revision],
      );
      const hasScopes = await one(
        sql,
        "SELECT to_regclass('agent_proposal_scopes') IS NOT NULL AS ok",
      );
      if (hasScopes?.ok) {
        await sql.query(
          `INSERT INTO agent_proposal_scopes(proposal_id, project_id, allowed_node_ids, approved_credits)
           VALUES ($1, $2, $3::text[], $4)
           ON CONFLICT (proposal_id) DO UPDATE
             SET allowed_node_ids = EXCLUDED.allowed_node_ids,
                 approved_credits = EXCLUDED.approved_credits`,
          [
            applied.proposalId,
            applied.projectId,
            applied.affectedGenNodeIds,
            applied.estimatedCredits,
          ],
        );
      }
    });

    const updatedProposal = await one(
      this.p.db,
      "SELECT * FROM canvas_proposals WHERE id=$1",
      [applied.proposalId],
    );

    return {
      proposal: this.format(updatedProposal),
      canvas: savedCanvas,
      temp_id_map: applied.tempMap,
    };
  }
  async reject(user: OriginalActor, projectKey: string, proposalKey: string) {
    requireValue(
      !user.tokenId,
      403,
      "拒绝画布提案仅支持浏览器会话操作",
    );
    return this.p.db.transaction(async (sql) => {
      const project = await this.canvases.project(sql, user, projectKey);
      const proposal = await one(
        sql,
        `SELECT * FROM canvas_proposals WHERE project_id=$1 AND public_id=$2 FOR UPDATE`,
        [project.id, proposalKey],
      );
      requireValue(proposal, 404, "提案不存在");
      requireValue(proposal.status === "pending", 409, "该提案已处理");
      await sql.query(
        `UPDATE canvas_proposals SET status='rejected', resolved_at=now() WHERE id=$1`,
        [proposal.id],
      );
      const updated = await one(
        sql,
        "SELECT * FROM canvas_proposals WHERE id=$1",
        [proposal.id],
      );
      return this.format(updated);
    });
  }
}
