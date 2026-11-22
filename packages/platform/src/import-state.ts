import { z } from "zod";
import { hash, secret, requireValue } from "./security.js";
import type { Sql } from "./db.js";
import { nodeTimingContextSchema } from "@fumiao/plugin-sdk/timing.js";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const epoch = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const strings = z.array(z.string().max(180)).max(500);
const json = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === "string" ? JSON.parse(value) : value),
    schema,
  );
// Whitelist both at export and import. A hand-edited archive must not persist
// authentication keys, deadlines, live tickets or arbitrary hardware fields.
export const publicNodeSchema = z.object({
  id,
  owner: id.nullable(),
  name: z.string().max(80),
  stage: z.string().max(20),
  lastseen: z.number().finite(),
  control: z.enum(["active", "paused", "draining", "removed"]),
  detail: z.string().max(300).default(""),
  models: json(strings),
  ready_models: json(strings),
  profile: json(nodeTimingContextSchema.shape.profile.unwrap()),
  hardware: z.string().max(180).optional(),
  workflow: z.string().max(200).optional(),
  runtime_id: z.string().max(128).optional(),
  model_profiles: json(
    nodeTimingContextSchema.shape.model_profiles.unwrap(),
  ).optional(),
  video_steps: json(
    z.array(z.number().int().min(1).max(100)).max(100),
  ).optional(),
});
export type PublicNode = z.infer<typeof publicNodeSchema>;

export function validateStateImport(
  tables: Record<string, Record<string, any>[]>,
  stateVersion?: number,
) {
  requireValue(
    stateVersion === undefined || stateVersion === 1,
    400,
    "旧状态导出版本无效",
  );
  const nodes = (tables.nodes || []).map((n) => publicNodeSchema.parse(n));
  requireValue(
    new Set(nodes.map((n) => n.id)).size === nodes.length,
    400,
    "旧节点编号重复",
  );
  for (const node of nodes)
    requireValue(
      node.owner === null || tables.users?.some((u) => u.id === node.owner),
      400,
      "旧节点归属用户不存在",
    );
  const media = tables.media || [],
    jobs = tables.jobs || [];
  for (const asset of media)
    requireValue(
      asset.original_order === undefined ||
        id.safeParse(asset.original_order).success,
      400,
      "旧素材顺序无效",
    );
  const order = media
    .filter((m) => m.original_order !== undefined)
    .map((m) => m.original_order);
  requireValue(new Set(order).size === order.length, 400, "旧素材顺序重复");
  for (const job of jobs) {
    requireValue(
      job.attempts === undefined ||
        (Number.isInteger(job.attempts) &&
          job.attempts >= 0 &&
          job.attempts <= 2147483647),
      400,
      "旧任务执行次数无效",
    );
    requireValue(
      job.node == null || id.safeParse(job.node).success,
      400,
      "旧任务节点编号无效",
    );
  }
  const settings = tables.state_settings || [];
  const names = tables.node_pair_names || [];
  requireValue(
    names.every(
      (row) =>
        Object.keys(row).length === 1 &&
        typeof row.label === "string" &&
        /^弗淼[0-9]{1,9}$(?![\s\S])/u.test(row.label),
    ),
    400,
    "旧配对名称无效",
  );
  requireValue(
    new Set(settings.map((s) => s.key)).size === settings.length,
    400,
    "旧状态设置重复",
  );
  for (const setting of settings) {
    requireValue(
      [
        "workspaces_migrated_v1",
        "image_enabled",
        "node_name_sequence",
      ].includes(setting.key),
      400,
      "迁移状态设置不在允许列表",
    );
    if (setting.key === "image_enabled")
      requireValue(typeof setting.value === "boolean", 400, "旧图片开关无效");
    else if (setting.key === "node_name_sequence")
      requireValue(
        Number.isInteger(setting.value) &&
          setting.value >= 0 &&
          setting.value <= 999999999,
        400,
        "旧节点命名编号无效",
      );
    else
      requireValue(
        id.safeParse(setting.value).success &&
          tables.workspaces?.some((w) => w.id === setting.value),
        400,
        "旧默认工作区不存在",
      );
  }
  if (stateVersion === 1)
    requireValue(
      Array.isArray(tables.nodes) &&
        order.length === media.length &&
        jobs.every(
          (j) => j.attempts !== undefined && Object.hasOwn(j, "node"),
        ) &&
        settings.some((s) => s.key === "image_enabled") &&
        settings.some((s) => s.key === "workspaces_migrated_v1"),
      400,
      "导出文件缺少完整状态数据，请重新导出",
    );
  return nodes;
}

const resourceSchema = z.object({
  node: id,
  kind: z.enum(["breeze", "flow", "colab"]),
  enabled: z.union([z.literal(0), z.literal(1)]),
  capabilities: json(
    z.object({
      models: strings.optional(),
      h3: z
        .object({
          modes: z.array(z.string()).optional(),
          steps: z.array(z.number()).optional(),
          quality: z.array(z.number()).optional(),
          seconds: z.array(z.number()).optional(),
        })
        .optional(),
    }),
  ),
  created: epoch,
});
const usageSchema = z.object({
  node: id,
  uid: z
    .string()
    .min(1)
    .refine((uid) => [...uid].length <= 100 && !/[\uD800-\uDFFF]/u.test(uid)),
  units: z.number().min(0).max(1_000_000),
  created: epoch,
});

const archivedFmworkerSchemas = {
  fm_rewards: z.object({
    job: id,
    node: id,
    owner: id,
    workspace: id,
    units: id,
    credited: epoch,
    created: epoch,
  }),
  fm_funds: z.object({ workspace: id, eligible: epoch, held: epoch }),
  fm_reward_remainders: z.object({ workspace: id, units: epoch.max(9999) }),
  fm_reward_settings: z.object({
    key: z.literal("fmworker_reward_bps"),
    value: epoch.max(10000),
  }),
  fm_fund_holds: z.object({
    job: id,
    workspace: id,
    amount: epoch,
    state: z.enum(["held", "spent", "refunded"]),
  }),
  fm_assignments: z.object({
    job: id,
    node: id,
    owner: id,
    reward_bps: epoch.max(10000),
    created: epoch,
  }),
  // Optional independent earnings snapshots stay outside the consumption wallet.
  fm_accounts: z.object({
    id: id.optional(),
    owner: id,
    workspace: id.optional(),
    balance: epoch,
    reserved: epoch.optional(),
    earned: epoch.optional(),
    created: epoch.optional(),
    updated: epoch.optional(),
  }),
  fm_account_ledger: z.object({
    id,
    account: id,
    job: id.nullish(),
    action: z.string().max(100),
    amount: z
      .number()
      .int()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER),
    balance: epoch,
    created: epoch,
  }),
  fm_retired_node_credentials: z.object({
    node: id,
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  }),
};

export function validateRetiredFmworkerImport(
  tables: Record<string, Record<string, any>[]>,
  nodes: PublicNode[],
  requireCredentialArchive: boolean,
) {
  const owners = new Map(nodes.map((node) => [node.id, node.owner]));
  const workspaces = new Map((tables.workspaces || []).map((w) => [w.id, w]));
  const resources = (tables.fm_resources || []).map((row) =>
    resourceSchema.parse(row),
  );
  requireValue(
    new Set(resources.map((r) => r.node)).size === resources.length &&
      resources.every((r) => owners.get(r.node) != null),
    400,
    "旧贡献资源归属无效",
  );
  const usage = (tables.fm_usage || []).map((row) => {
    const { uid, ...entry } = usageSchema.parse(row);
    return { ...entry, uid_hex: Buffer.from(uid, "utf8").toString("hex") };
  });
  requireValue(
    new Set(usage.map((r) => r.node + ":" + r.uid_hex)).size === usage.length &&
      usage.every((r) => owners.has(r.node)),
    400,
    "旧贡献用量记录无效",
  );
  const history = {
    ...Object.fromEntries(
      Object.entries(archivedFmworkerSchemas).map(([collection, schema]) => [
        collection,
        (tables[collection] || []).map((row) => schema.parse(row)),
      ]),
    ),
    fm_resources: resources,
    fm_usage: usage,
  } as typeof tables;
  requireValue(
    Object.entries(tables).every(
      ([collection, records]) =>
        !collection.startsWith("fm_") ||
        !records.length ||
        Object.hasOwn(history, collection),
    ),
    400,
    "存在未知旧贡献归档表，请先核对并更新导入列定义",
  );
  requireValue(
    new Set(history.fm_rewards.map((row) => row.job)).size ===
      history.fm_rewards.length &&
      history.fm_rewards.every(
        (reward) =>
          workspaces.get(reward.workspace)?.kind === "personal" &&
          workspaces.get(reward.workspace)?.owner === reward.owner,
      ),
    400,
    "旧贡献奖励账户或任务编号无效",
  );
  requireValue(
    history.fm_funds.every((row) => row.held === 0) &&
      history.fm_fund_holds.every((row) => row.state !== "held"),
    409,
    "仍有冻结的旧贡献任务费用，请停派并核对后重新导出",
  );
  const retiredNodes = new Set(
    [resources, usage, history.fm_rewards, history.fm_assignments].flatMap(
      (entries) =>
        entries.map((row) => row.node).filter((node) => owners.has(node)),
    ),
  );
  const archivedCredentials = new Set(
    history.fm_retired_node_credentials.map((row) => row.node),
  );
  requireValue(
    archivedCredentials.size === history.fm_retired_node_credentials.length &&
      [...archivedCredentials].every((node) => retiredNodes.has(node)),
    400,
    "旧贡献节点凭据归档无效",
  );
  if (requireCredentialArchive)
    requireValue(
      [...retiredNodes].every((node) => archivedCredentials.has(node)),
      409,
      "缺少旧贡献凭据的撤销摘要，请使用当前导出脚本从停写的 Pure 备份重新导出",
    );
  return { history, retiredNodes };
}

export async function importStateNodes(
  sql: Sql,
  nodes: PublicNode[],
  retiredNodes: ReadonlySet<number>,
  connection: string,
  identity: (kind: string, value: unknown) => string,
) {
  for (const n of nodes) {
    await sql.query(
      `INSERT INTO gpu_nodes(id,public_id,connection_id,owner_id,name,token_hash,models,enabled,last_seen,control,detail,archived,timing_context,queue_state)
      VALUES($1,$2,$3,$4,$5,$6,$7,false,to_timestamp($8),$9,$10,true,$11,$12)`,
      [
        identity("node", n.id),
        n.id,
        connection,
        n.owner === null ? null : identity("user", n.owner),
        n.name,
        hash(secret()),
        JSON.stringify(n.models),
        n.lastseen,
        retiredNodes.has(n.id) ? "removed" : n.control,
        n.detail,
        JSON.stringify({
          profile: n.profile,
          hardware: n.hardware,
          workflow: n.workflow,
          runtime_id: n.runtime_id,
          model_profiles: n.model_profiles,
        }),
        JSON.stringify({
          stage: n.stage,
          ready_models: n.ready_models,
          video_steps: n.video_steps,
        }),
      ],
    );
  }
  await sql.query(
    "SELECT setval(pg_get_serial_sequence('gpu_nodes','public_id'),GREATEST(COALESCE((SELECT max(public_id) FROM gpu_nodes),0),1),EXISTS(SELECT 1 FROM gpu_nodes))",
  );
}

export async function importStateSettings(
  sql: Sql,
  settings: Record<string, any>[],
  identity: (kind: string, value: unknown) => string,
  pairNames: Record<string, any>[],
) {
  for (const s of settings) {
    if (s.key === "workspaces_migrated_v1")
      await sql.query(
        "UPDATE original_state_settings SET legacy_workspace_id=$1",
        [identity("workspace", s.value)],
      );
    else if (s.key === "image_enabled")
      await sql.query("UPDATE original_state_settings SET image_enabled=$1", [
        s.value,
      ]);
    else
      await sql.query(
        "UPDATE original_state_settings SET node_name_sequence=GREATEST(node_name_sequence,$1)",
        [s.value],
      );
  }
  if (pairNames.length)
    await sql.query(
      "INSERT INTO original_node_names(label) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING",
      [pairNames.map((row) => row.label)],
    );
}
