import { randomUUID } from "node:crypto";
import { z } from "zod";
import { publicAddressPause } from "../connection-address.js";
import { creditUnits, formatCredits } from "../credit-amount.js";
import { one, type Database, type Sql } from "../db.js";
import {
  guardedTransport,
  requirePublicHttps,
  type HttpTransport,
} from "../plugin-host.js";
import { requireValue, type Vault } from "../security.js";
import {
  discoverModels,
  isOpenRouter,
  type Candidate,
  type DeclaredParameters,
  type Discovery,
  type Directory,
} from "./discovery.js";

const purpose = z.enum(["chat", "image", "video"]);
const videoFormat = z.enum(["new-api-videos", "openrouter-videos"]);
const text = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const revision = z.number().int().positive();
const credential = z
  .string()
  .max(4096)
  .regex(/^[A-Za-z0-9._~+/\-]+=*$/);
const fields = {
  name: text.max(128).optional(),
  base_url: z.string().max(2048),
  api_key: credential,
  default_video_protocol: videoFormat.nullable().optional(),
};
const createInput = z.object(fields).strict();
const editInput = createInput
  .partial()
  .extend({ expected_revision: revision })
  .strict();
const price = z
  .string()
  .max(26)
  .regex(/^\d{1,19}(\.\d{1,6})?$/)
  .transform((s) => formatCredits(creditUnits(s)))
  .nullable();
const chatPrices = z
  .object({
    input: price,
    output: price,
    cache_read: price.optional(),
    cache_write: price.optional(),
  })
  .strict();
const seconds = z.number().int().positive().max(86400);
const overrides = z
  .object({
    protocol: z
      .union([videoFormat, z.literal("openrouter-images")])
      .nullable()
      .optional(),
    durations: z.array(seconds).max(256).optional(),
    duration_range: z
      .object({ min: seconds, max: seconds })
      .strict()
      .refine((r) => r.min <= r.max)
      .optional(),
    resolutions: z.array(text.max(128)).max(128).optional(),
    aspect_ratios: z.array(text.max(128)).max(128).optional(),
    sizes: z.array(text.max(128)).max(128).optional(),
    frame_images: z.array(z.literal("first_frame")).max(1).optional(),
    requires_first_frame: z.boolean().optional(),
    input_references: z
      .object({
        min: z.number().int().nonnegative(),
        max: z.number().int().nonnegative(),
      })
      .strict()
      .refine((r) => r.min <= r.max)
      .optional(),
    chat_response: z.enum(["stream", "json"]).optional(),
    tools: z.boolean().optional(),
  })
  .strict();
const draftInput = z
  .object({
    expected_revision: z.number().int().nonnegative(),
    connection_id: z.uuid(),
    connection_revision: revision,
    upstream_id: text,
    purpose: purpose.nullable().optional(),
    price: price.optional(),
    chat_prices: chatPrices.optional(),
    overrides: overrides.default({}),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  requireValue(result.success, 400, "模型接入参数无效");
  return result.data;
}

type VideoFormat = z.infer<typeof videoFormat>;
type Protocol =
  "openai-chat" | "openai-images" | "openrouter-images" | VideoFormat;
interface Config {
  base_url: string;
  api_key: string;
  default_video_protocol: VideoFormat | null;
}
const allEndpoints = [
  "models",
  "images/models",
  "videos/models",
  "chat/completions",
  "images",
  "images/generations",
  "images/edits",
  "videos",
] as const;
type Endpoint = (typeof allEndpoints)[number];
export interface CredentialScope {
  endpoints: readonly Endpoint[];
  upstream_ids: readonly string[] | null;
}
const directScope: CredentialScope = {
  endpoints: allEndpoints,
  upstream_ids: null,
};
interface ConnectionRow {
  id: string;
  name: string;
  revision: number;
  revision_id: string;
  config: string;
  credential_scope: CredentialScope;
}
type NativeHttp = HttpTransport<string | Uint8Array>;
const joinRevision = `FROM connections c JOIN model_access_connection_revisions r
  ON r.connection_id=c.id AND r.revision=c.revision WHERE c.source_kind='builtin' AND NOT c.removed`;
const selectConnection =
  "SELECT c.id,c.name,c.revision,r.id revision_id,r.config,r.credential_scope " +
  joinRevision;
async function current(
  sql: Sql,
  id: string,
  lock = false,
): Promise<ConnectionRow> {
  parse(z.uuid(), id);
  const row = (
    await sql.query<ConnectionRow>(
      selectConnection + " AND c.id=$1" + (lock ? " FOR UPDATE OF c" : ""),
      [id],
    )
  ).rows[0];
  requireValue(row, 404, "连接不存在");
  return row;
}
function expected(actual: number, requested: number) {
  requireValue(actual === requested, 409, "修订已更新，请刷新后重新确认");
}
async function baseUrl(raw: string) {
  const url = URL.parse(raw);
  requireValue(
    url &&
      !/[\s\u0000-\u001f\u007f]/.test(raw) &&
      !raw.includes("?") &&
      !raw.includes("#") &&
      !raw.includes("\\") &&
      !(await publicAddressPause(url)),
    400,
    "服务地址须为可解析的公网 HTTPS 地址",
  );
  return url.href.replace(/\/+$/, "");
}
function configOf(vault: Vault, sealed: string) {
  return vault.open(sealed) as Config;
}
function connectionView(row: ConnectionRow, config: Config) {
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    revision_id: row.revision_id,
    base_url: config.base_url,
    directory_url: config.base_url + "/models",
    credentials_configured: !!config.api_key,
    default_video_protocol: config.default_video_protocol,
  };
}
async function writeRevision(
  sql: Sql,
  vault: Vault,
  id: string,
  n: number,
  config: Config,
  scope: CredentialScope,
) {
  await sql.query(
    "INSERT INTO model_access_connection_revisions(id,connection_id,revision,config,credential_scope) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), id, n, vault.seal(config), JSON.stringify(scope)],
  );
}

// Resolve by immutable ID, including revisions that no longer accept new work.
// The credential stays inside the transport and each request names its granted endpoint.
export async function resolveConnectionRevision(
  sql: Sql,
  vault: Vault,
  id: string,
  http: NativeHttp = guardedTransport,
) {
  const row = await one(
    sql,
    "SELECT config,credential_scope FROM model_access_connection_revisions WHERE id=$1",
    [id],
  );
  requireValue(row, 404, "连接修订不存在");
  const config = configOf(vault, row.config);
  const scope: CredentialScope = row.credential_scope;
  return {
    base_url: config.base_url,
    default_video_protocol: config.default_video_protocol,
    containsCredential(text: string) {
      return text.includes(config.api_key);
    },
    async request(
      input: {
        endpoint: Endpoint;
        method: "GET" | "POST";
        model?: string;
        video_resource?: { id: string; content?: boolean };
        body?: string | Uint8Array;
        content_type?: string;
      },
      signal: AbortSignal,
    ) {
      requireValue(
        scope.endpoints.includes(input.endpoint),
        403,
        "凭据未授权此接口",
      );
      const directory = input.endpoint.endsWith("models");
      if (scope.upstream_ids && !directory) {
        requireValue(
          input.endpoint === "chat/completions" &&
            !!input.model &&
            scope.upstream_ids.includes(input.model),
          403,
          "凭据未授权此模型",
        );
        let payload: unknown;
        try {
          payload = JSON.parse(
            typeof input.body === "string" ? input.body : "",
          );
        } catch {
          /* rejected below */
        }
        requireValue(
          payload &&
            typeof payload === "object" &&
            "model" in payload &&
            payload.model === input.model &&
            input.content_type === "application/json",
          403,
          "凭据未授权此请求",
        );
      }
      let path: string = input.endpoint;
      if (input.video_resource) {
        const resource = input.video_resource;
        requireValue(
          input.endpoint === "videos" &&
            /^[a-zA-Z0-9_-][a-zA-Z0-9_.:-]{0,511}$/.test(resource.id),
          400,
          "视频查询位置无效",
        );
        path +=
          "/" +
          encodeURIComponent(resource.id) +
          (resource.content ? "/content" : "");
      }
      requireValue(
        input.method === (directory || input.video_resource ? "GET" : "POST") &&
          (input.method !== "GET" || input.body === undefined),
        400,
        "请求方法无效",
      );
      const url = new URL(config.base_url + "/" + path);
      requirePublicHttps(url);
      const headers: Record<string, string> = {
        Authorization: "Bearer " + config.api_key,
      };
      if (input.content_type) headers["Content-Type"] = input.content_type;
      return http(
        url,
        { method: input.method, body: input.body, headers },
        signal,
      );
    },
  };
}

export class ModelAccessConnections {
  constructor(
    private db: Database,
    private vault: Vault,
    private http?: NativeHttp,
  ) {}
  async create(value: unknown) {
    const input = parse(createInput, value);
    const address = await baseUrl(input.base_url);
    const id = randomUUID();
    const config: Config = {
      base_url: address,
      api_key: input.api_key,
      default_video_protocol: input.default_video_protocol ?? null,
    };
    return this.db.transaction(async (sql) => {
      await sql.query(
        "INSERT INTO connections(id,name,source_kind,config,enabled) VALUES($1,$2,'builtin',$3,true)",
        [id, input.name ?? new URL(address).host, this.vault.seal({})],
      );
      await writeRevision(sql, this.vault, id, 1, config, directScope);
      return connectionView(await current(sql, id), config);
    });
  }
  async edit(id: string, value: unknown) {
    const input = parse(editInput, value);
    const address =
      input.base_url === undefined ? undefined : await baseUrl(input.base_url);
    return this.db.transaction(async (sql) => {
      const row = await current(sql, id, true);
      expected(row.revision, input.expected_revision);
      const saved = configOf(this.vault, row.config);
      requireValue(
        !address || address === saved.base_url || input.api_key,
        400,
        "更换服务地址时请重新填写该目的地的密钥",
      );
      const config = {
        base_url: address ?? saved.base_url,
        api_key: input.api_key ?? saved.api_key,
        default_video_protocol:
          input.default_video_protocol === undefined
            ? saved.default_video_protocol
            : input.default_video_protocol,
      };
      await writeRevision(
        sql,
        this.vault,
        id,
        row.revision + 1,
        config,
        input.api_key ? directScope : row.credential_scope,
      );
      await sql.query(
        "UPDATE connections SET name=$2,revision=revision+1 WHERE id=$1",
        [id, input.name ?? row.name],
      );
      const edited = await current(sql, id);
      if (
        saved.base_url === config.base_url &&
        saved.api_key === config.api_key
      ) {
        await sql.query(
          `INSERT INTO model_access_discoveries(connection_revision_id,revision,directories,snapshots,candidates,checked_at)
          SELECT $2,revision,directories,snapshots,candidates,checked_at FROM model_access_discoveries WHERE connection_revision_id=$1`,
          [row.revision_id, edited.revision_id],
        );
      }
      return connectionView(edited, config);
    });
  }
  async discover(id: string, value: unknown) {
    const input = parse(
      z.object({ expected_revision: revision }).strict(),
      value,
    );
    const row = await current(this.db, id);
    expected(row.revision, input.expected_revision);
    const client = await resolveConnectionRevision(
      this.db,
      this.vault,
      row.revision_id,
      this.http,
    );
    const old = await one(
      this.db,
      "SELECT * FROM model_access_discoveries WHERE connection_revision_id=$1",
      [row.revision_id],
    );
    const result = await discoverModels(
      client.base_url,
      (directory: Directory, signal) =>
        client.request({ endpoint: directory, method: "GET" }, signal),
      client.containsCredential,
      old as Discovery | undefined,
    );
    return this.db.transaction(async (sql) => {
      expected((await current(sql, id, true)).revision, row.revision);
      const stored = await one(
        sql,
        `INSERT INTO model_access_discoveries(connection_revision_id,revision,directories,snapshots,candidates)
        VALUES($1,1,$2,$3,$4) ON CONFLICT(connection_revision_id) DO UPDATE SET revision=model_access_discoveries.revision+1,
        directories=excluded.directories,snapshots=excluded.snapshots,candidates=excluded.candidates,checked_at=now()
        WHERE model_access_discoveries.revision=$5 RETURNING revision,checked_at`,
        [
          row.revision_id,
          JSON.stringify(result.directories),
          JSON.stringify(result.snapshots),
          JSON.stringify(result.candidates),
          old?.revision ?? 0,
        ],
      );
      requireValue(stored, 409, "目录已刷新，请重新读取");
      return {
        revision: Number(stored.revision),
        checked_at: new Date(stored.checked_at).toISOString(),
        directories: result.directories,
        candidates: result.candidates,
      };
    });
  }
  async saveDraft(id: string, value: unknown) {
    parse(z.uuid(), id);
    const input = parse(draftInput, value);
    return this.db.transaction(async (sql) => {
      const connection = await current(sql, input.connection_id, true);
      expected(connection.revision, input.connection_revision);
      const old = await one(
        sql,
        "SELECT * FROM model_access_drafts WHERE id=$1 FOR UPDATE",
        [id],
      );
      expected(old?.revision ?? 0, input.expected_revision);
      requireValue(
        !old ||
          (old.connection_id === input.connection_id &&
            old.upstream_id === input.upstream_id),
        409,
        "草稿已绑定其他模型",
      );
      const directory = await one(
        sql,
        "SELECT candidates FROM model_access_discoveries WHERE connection_revision_id=$1",
        [connection.revision_id],
      );
      const candidate = (
        directory?.candidates as Candidate[] | undefined
      )?.find((c) => c.upstream_id === input.upstream_id);
      const selection = draftSelection(
        input,
        configOf(this.vault, connection.config),
        candidate,
      );
      const row = (
        await sql.query<DraftRow>(
          `INSERT INTO model_access_drafts(id,connection_id,connection_revision,upstream_id,revision,selection)
        VALUES($1,$2,$3,$4,1,$5) ON CONFLICT (id) DO UPDATE SET connection_revision=excluded.connection_revision,
        revision=model_access_drafts.revision+1,selection=excluded.selection,updated_at=now()
        WHERE model_access_drafts.revision=$6 AND model_access_drafts.connection_id=excluded.connection_id AND model_access_drafts.upstream_id=excluded.upstream_id RETURNING *`,
          [
            id,
            connection.id,
            connection.revision,
            input.upstream_id,
            JSON.stringify(selection),
            input.expected_revision,
          ],
        )
      ).rows[0];
      requireValue(row, 409, "草稿修订已更新");
      return { draft: draftView(row) };
    });
  }
  async view() {
    return this.db.transaction(async (sql) => {
      await sql.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const connections = (
        await sql.query<ConnectionRow>(
          selectConnection + " ORDER BY c.name,c.id",
        )
      ).rows;
      const discoveries =
        await sql.query(`SELECT c.id connection_id,r.id connection_revision_id,d.revision,d.checked_at,d.directories,d.candidates
      FROM model_access_discoveries d JOIN model_access_connection_revisions r ON r.id=d.connection_revision_id
      JOIN connections c ON c.id=r.connection_id AND c.revision=r.revision WHERE NOT c.removed ORDER BY c.id`);
      const drafts = await sql.query<DraftRow>(
        "SELECT * FROM model_access_drafts ORDER BY connection_id,upstream_id",
      );
      return {
        connections: connections.map((row) =>
          connectionView(row, configOf(this.vault, row.config)),
        ),
        discoveries: discoveries.rows.map((d) => ({
          connection_id: String(d.connection_id),
          connection_revision_id: String(d.connection_revision_id),
          revision: Number(d.revision),
          checked_at: new Date(d.checked_at).toISOString(),
          directories: d.directories,
          candidates: d.candidates,
        })),
        drafts: drafts.rows.map(draftView),
      };
    });
  }
}
function draftProtocol(
  kind: z.infer<typeof purpose> | null,
  config: Config,
  override: VideoFormat | "openrouter-images" | null | undefined,
  candidate?: Candidate,
): Protocol | null {
  const known = isOpenRouter(config.base_url);
  if (override === "openrouter-images") {
    requireValue(
      known && kind === "image",
      400,
      "确认的图片协议与此连接或用途不符",
    );
    return override;
  }
  if (kind === "video")
    return known
      ? "openrouter-videos"
      : (override ?? config.default_video_protocol);
  if (kind === "chat") return "openai-chat";
  if (kind === "image") {
    if (!known) return "openai-images";
    if (candidate?.directories.includes("images/models"))
      return "openrouter-images";
  }
  return null;
}
function draftSelection(
  input: z.infer<typeof draftInput>,
  config: Config,
  candidate?: Candidate,
) {
  const kind =
    input.purpose === undefined ? (candidate?.purpose ?? null) : input.purpose;
  const declared = candidate?.parameters ?? {};
  const options = input.overrides;
  const protocol = draftProtocol(kind, config, options.protocol, candidate);
  const parameters: DeclaredParameters & Omit<typeof options, "frame_images"> =
    { ...declared, ...options };
  delete parameters.protocol;
  if (declared.unconfirmed_parameters?.length && declared.names) {
    const unconfirmed = new Set(declared.unconfirmed_parameters);
    parameters.names = declared.names.filter((name) => !unconfirmed.has(name));
  }
  const reasons: string[] = [];
  if (!kind) reasons.push("purpose");
  if (!protocol) reasons.push("protocol");
  const prices = input.chat_prices;
  if (
    kind === "chat"
      ? prices?.input == null || prices.output == null
      : input.price == null
  )
    reasons.push("price");
  if (
    kind === "video" &&
    !parameters.durations?.length &&
    !parameters.duration_range
  )
    reasons.push("durations");
  if (parameters.upscale_only) reasons.push("upscale_only");
  return {
    purpose: kind,
    price: input.price ?? null,
    chat_prices: prices ?? null,
    overrides: options,
    protocol,
    parameters,
    status: reasons.length ? ("draft" as const) : ("ready" as const),
    missing: reasons,
  };
}
interface DraftRow {
  id: string;
  connection_id: string;
  connection_revision: number;
  upstream_id: string;
  revision: number;
  selection: ReturnType<typeof draftSelection>;
}
function draftView(row: DraftRow) {
  return {
    id: row.id,
    connection_id: row.connection_id,
    connection_revision: row.connection_revision,
    upstream_id: row.upstream_id,
    revision: row.revision,
    ...row.selection,
  };
}
