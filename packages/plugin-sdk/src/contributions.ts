import { z } from "zod";

/*
 * Plugin contribution contract v1 (see docs/PLUGIN_EXTENSIBILITY.md).
 *
 * A Studio package may contribute host-rendered settings pages, declare its
 * own non-secret settings and request host capabilities. Everything that
 * crosses the boundary is JSON. Page programs run in the QuickJS sandbox
 * (packages/platform/src/plugin-program.ts) and never receive credentials,
 * other workspaces' data, network or filesystem access.
 *
 * This file is the single source of truth shared by the platform, the API
 * and the Studio web app. Change it only together with the design document.
 */

export const CONTRIBUTIONS_VERSION = 1 as const;

/** Icons the Studio shell can render (subset of apps/web/studio/Icon.tsx). */
export const pageIcons = [
  "gpu",
  "sliders",
  "model",
  "queue",
  "drive",
  "film",
  "picture",
  "voice",
  "chat",
  "library",
  "clock",
  "link",
  "team",
] as const;
export type PageIcon = (typeof pageIcons)[number];

/** Settings navigation groups (apps/web/studio/SettingsShell.tsx). */
export const pageGroups = [
  "account",
  "services",
  "billing",
  "organization",
] as const;
export type PageGroup = (typeof pageGroups)[number];

/**
 * Read scopes a page may request. The host assembles them server-side; the
 * browser never supplies page input.
 *
 * - plugin:   { id, label, version, enabled, removing, pending }
 * - models:   this package's Studio models [{ id, label, kind, enabled }]
 * - services: this package's connections [{ id, name, enabled }] (no config)
 * - jobs:     admin: this plugin's latest 100 jobs [{ id, status, model, node, createdAt }]
 *             member: the actor's own jobs of this plugin in the active workspace
 *             Prompts, media and user identities are never included.
 * - settings: { global: SettingsValue|null, workspace: SettingsValue|null }
 * - nodes:    paired nodes and installable node models (requires the
 *             `nodes` host capability): { nodes: [...], nodeModels: {...} }
 */
export const pageScopes = [
  "plugin",
  "models",
  "services",
  "jobs",
  "settings",
  "nodes",
] as const;
export type PageScope = (typeof pageScopes)[number];
export const memberScopes: readonly PageScope[] = [
  "plugin",
  "models",
  "jobs",
  "settings",
];

/**
 * Host capabilities a package may request. The administrator confirms them
 * at installation and the host checks them on every call.
 *
 * - nodes: node pairing and control, through `host` page actions.
 * - http:  HTTPS requests to the origins listed in `contributes.http`.
 * - data:  a key-value store owned by this plugin.
 */
export const hostCapabilities = ["nodes", "http", "data"] as const;
export type HostCapability = (typeof hostCapabilities)[number];

/**
 * Functions a page program reaches as `host.<name>(...)`. Hooks receive
 * `host` as their last argument and may be async:
 * `view(input, host)` gets the `read` functions, `action(id, payload, input, host)`
 * gets all functions of the declared capabilities.
 *
 * | Function    | Arguments                                   | Result                                         |
 * |-------------|---------------------------------------------|------------------------------------------------|
 * | http.fetch  | url, { method?, headers?, json? \| body? }   | { status, ok, contentType, text, json }        |
 * | data.get    | key, { scope? }                             | stored value or null                           |
 * | data.list   | prefix?, { scope? }                         | { keys, more }                                 |
 * | data.put    | key, value, { scope? }                      | true                                           |
 * | data.delete | key, { scope? }                             | whether a value was removed                    |
 *
 * `scope` is `workspace` (default) or `global`. Redirects are returned, not
 * followed. A failed call rejects with an Error carrying a short message.
 */
export const hostFunctions = {
  "http.fetch": { capability: "http", access: "write" },
  "data.get": { capability: "data", access: "read" },
  "data.list": { capability: "data", access: "read" },
  "data.put": { capability: "data", access: "write" },
  "data.delete": { capability: "data", access: "write" },
} as const satisfies Record<
  string,
  { capability: HostCapability; access: "read" | "write" }
>;
export type HostFunction = keyof typeof hostFunctions;

/**
 * Host operations reachable from a page action. The host owns the
 * implementation; a package can only reference these names.
 *
 * | operation          | capability | target       | payload                          | result                       |
 * | nodes.suggestName  | nodes      | -            | -                                | { value: string }            |
 * | nodes.pair         | nodes      | -            | { name: string, models: string[] } | { name, command } (shown as copyable result) |
 * | nodes.drain        | nodes      | node id      | -                                | -                            |
 * | nodes.stop         | nodes      | node id      | -                                | -                            |
 * | nodes.resume       | nodes      | node id      | -                                | -                            |
 * | nodes.remove       | nodes      | node id      | -                                | -                            |
 */
export const hostOperations = {
  "nodes.suggestName": "nodes",
  "nodes.pair": "nodes",
  "nodes.drain": "nodes",
  "nodes.stop": "nodes",
  "nodes.resume": "nodes",
  "nodes.remove": "nodes",
} as const satisfies Record<string, HostCapability>;
export type HostOperation = keyof typeof hostOperations;
const hostOperationNames = Object.keys(hostOperations) as [
  HostOperation,
  ...HostOperation[],
];

const slug = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const label = z.string().trim().min(1).max(60);
const jsonObject = z.record(z.string(), z.unknown());

export const settingsScopes = ["global", "workspace"] as const;
export type SettingsScope = (typeof settingsScopes)[number];

export const pageActionSchema = z.discriminatedUnion("kind", [
  /** Calls a host operation; requires the operation's capability. */
  z
    .object({
      id: slug,
      kind: z.literal("host"),
      operation: z.enum(hostOperationNames),
    })
    .strict(),
  /** Validates the submitted form values and replaces the stored settings. */
  z
    .object({
      id: slug,
      kind: z.literal("settings"),
      scope: z.enum(settingsScopes),
    })
    .strict(),
  /**
   * Runs the page program's `action(id, payload, input)` hook in QuickJS.
   * It returns a ProgramActionOutput; the host validates and applies it.
   */
  z
    .object({
      id: slug,
      kind: z.literal("program"),
    })
    .strict(),
]);
export type PageAction = z.infer<typeof pageActionSchema>;

export const settingsPageSchema = z
  .object({
    id: slug,
    title: label,
    icon: z.enum(pageIcons).default("sliders"),
    audience: z.enum(["admin", "member"]).default("admin"),
    group: z.enum(pageGroups).default("services"),
    order: z.number().int().min(0).max(1000).default(500),
    /** `installed`: visible while installed (also disabled / removing). */
    visibleWhen: z.enum(["installed", "enabled"]).default("installed"),
    scopes: z.array(z.enum(pageScopes)).max(pageScopes.length).default([]),
    actions: z.array(pageActionSchema).max(16).default([]),
    /**
     * QuickJS object expression:
     * `{ view(input, host) { return View }, action?(id, payload, input, host) { return ProgramActionOutput } }`
     * Both hooks may be async. `host` holds the granted host functions.
     */
    program: z
      .string()
      .min(1)
      .max(64 * 1024),
  })
  .strict();
export type SettingsPage = z.infer<typeof settingsPageSchema>;

export const settingsDeclarationSchema = z
  .object({
    /** JSON Schema (type: object) for installation-wide values. */
    global: jsonObject.optional(),
    /** JSON Schema (type: object) for per-workspace values. */
    workspace: jsonObject.optional(),
    /**
     * Optional QuickJS function expression run on upgrade and rollback:
     * `(values, { scope, from, to }) => values`. Output must satisfy the new schema.
     */
    migrate: z
      .string()
      .min(1)
      .max(16 * 1024)
      .optional(),
  })
  .strict();
export type SettingsDeclaration = z.infer<typeof settingsDeclarationSchema>;

export const contributesSchema = z
  .object({
    version: z.literal(CONTRIBUTIONS_VERSION),
    settingsPages: z.array(settingsPageSchema).max(8).default([]),
    settings: settingsDeclarationSchema.optional(),
    hostCapabilities: z
      .array(z.enum(hostCapabilities))
      .max(hostCapabilities.length)
      .default([]),
    /** Where `http.fetch` may send requests, e.g. `https://api.example.com`. */
    http: z
      .object({ origins: z.array(z.string().max(200)).min(1).max(16) })
      .strict()
      .optional(),
  })
  .strict();
export type Contributes = z.infer<typeof contributesSchema>;

/** A page after legacy normalization. Legacy pages keep the GPU panel shape. */
export type ResolvedPage = SettingsPage & { legacy?: true };
export type ResolvedContributions = Omit<Contributes, "settingsPages"> & {
  settingsPages: ResolvedPage[];
};

export interface ContributionContext {
  mode: "request" | "pull";
  /** Package carries a `program` (manifest+program or node program). */
  hasProgram: boolean;
}

/**
 * Structural rules that do not need the database. Returns Chinese messages
 * suitable for a 400 response; an empty array means valid.
 */
export function contributionProblems(
  c: Contributes,
  context: ContributionContext,
): string[] {
  const problems: string[] = [];
  const caps = new Set(c.hostCapabilities);
  if (new Set(c.hostCapabilities).size !== c.hostCapabilities.length)
    problems.push("宿主能力重复");
  if (caps.has("nodes") && !(context.mode === "pull" && context.hasProgram))
    problems.push("节点能力需要 pull 模式的节点程序");
  if (caps.has("http") !== !!c.http)
    problems.push("http 能力与 http.origins 必须同时声明");
  for (const origin of c.http?.origins ?? []) {
    let url: URL | undefined;
    try {
      url = new URL(origin);
    } catch {
      url = undefined;
    }
    if (url?.protocol !== "https:" || url.origin !== origin)
      problems.push(
        "http.origins 只接受 https 源，例如 https://api.example.com：" + origin,
      );
  }
  if (new Set(c.http?.origins).size !== (c.http?.origins.length ?? 0))
    problems.push("http.origins 重复");
  const pageIds = new Set<string>();
  for (const page of c.settingsPages) {
    if (pageIds.has(page.id)) problems.push("设置页标识重复：" + page.id);
    pageIds.add(page.id);
    if (new Set(page.scopes).size !== page.scopes.length)
      problems.push("设置页读取范围重复：" + page.id);
    if (page.scopes.includes("nodes") && !caps.has("nodes"))
      problems.push("设置页读取节点需要节点能力：" + page.id);
    if (page.scopes.includes("settings") && !c.settings)
      problems.push("设置页读取设置需要声明设置：" + page.id);
    if (page.audience === "member") {
      for (const scope of page.scopes)
        if (!memberScopes.includes(scope))
          problems.push("成员设置页不能读取 " + scope + "：" + page.id);
      if (page.actions.length)
        problems.push("成员设置页暂不支持操作：" + page.id);
    }
    const actionIds = new Set<string>();
    for (const action of page.actions) {
      if (actionIds.has(action.id))
        problems.push("设置页操作重复：" + page.id + "/" + action.id);
      actionIds.add(action.id);
      if (action.kind === "host" && !caps.has(hostOperations[action.operation]))
        problems.push(
          "操作 " +
            action.operation +
            " 需要宿主能力 " +
            hostOperations[action.operation],
        );
      if (action.kind === "settings" && !c.settings?.[action.scope])
        problems.push(
          "设置操作缺少 " + action.scope + " 设置声明：" + action.id,
        );
    }
  }
  for (const scope of settingsScopes) {
    const schema = c.settings?.[scope];
    if (!schema) continue;
    if (schema.type !== "object")
      problems.push(scope + " 设置必须是对象 schema");
    if (JSON.stringify(schema).includes('"writeOnly":true'))
      problems.push("插件设置不能包含密钥字段，请放入服务配置");
  }
  return problems;
}

/** Legacy `settingsPage` (GPU 1.x) as stored in studio_package_releases. */
export interface LegacySettingsPage {
  title: string;
  render: string;
}

export const legacyNodeActions: PageAction[] = [
  { id: "suggest-name", kind: "host", operation: "nodes.suggestName" },
  { id: "pair", kind: "host", operation: "nodes.pair" },
  { id: "drain", kind: "host", operation: "nodes.drain" },
  { id: "stop", kind: "host", operation: "nodes.stop" },
  { id: "resume", kind: "host", operation: "nodes.resume" },
  { id: "remove", kind: "host", operation: "nodes.remove" },
];

/**
 * Normalizes a stored package (any release ever accepted) into contributions.
 * Packages without either field contribute nothing.
 */
export function packageContributions(pkg: {
  settingsPage?: LegacySettingsPage | null;
  contributes?: unknown;
}): ResolvedContributions {
  if (pkg.contributes) return contributesSchema.parse(pkg.contributes);
  if (pkg.settingsPage)
    return {
      version: CONTRIBUTIONS_VERSION,
      hostCapabilities: ["nodes"],
      settingsPages: [
        {
          id: "nodes",
          title: pkg.settingsPage.title,
          icon: "gpu",
          audience: "admin",
          group: "account",
          order: 0,
          visibleWhen: "installed",
          scopes: ["plugin", "nodes", "jobs"],
          actions: legacyNodeActions,
          program: pkg.settingsPage.render,
          legacy: true,
        },
      ],
    };
  return {
    version: CONTRIBUTIONS_VERSION,
    hostCapabilities: [],
    settingsPages: [],
  };
}

/* ------------------------------------------------------------------ */
/* View schema v1: what `view(input)` returns and the host renders.    */
/* ------------------------------------------------------------------ */

const text = (max: number) => z.string().max(max);
export const tones = [
  "default",
  "info",
  "success",
  "warning",
  "danger",
] as const;

export const buttonSchema = z
  .object({
    action: slug,
    label: label,
    tone: z.enum(tones).default("default"),
    /** Host operations that address one record (e.g. a node id). */
    target: z.union([z.string().max(100), z.number().int()]).optional(),
    /** Extra JSON sent with the action; at most 4 KB once serialized. */
    payload: jsonObject.optional(),
    /** Shown in the Studio confirm dialog before the action runs. */
    confirm: z
      .object({ title: label, summary: text(300) })
      .strict()
      .optional(),
    /** Opens the form block with this id in a dialog instead of running. */
    opensForm: slug.optional(),
  })
  .strict();
export type ViewButton = z.infer<typeof buttonSchema>;

export const fieldSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
    label: label,
    type: z.enum([
      "text",
      "textarea",
      "number",
      "select",
      "multiselect",
      "checkbox",
    ]),
    options: z
      .array(
        z
          .object({
            value: z.string().max(200),
            label: label,
            detail: text(120).optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    value: z.unknown().optional(),
    required: z.boolean().optional(),
    help: text(300).optional(),
    placeholder: text(100).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    maxLength: z.number().int().positive().max(10000).optional(),
  })
  .strict();
export type ViewField = z.infer<typeof fieldSchema>;

export const blockSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("notice"), tone: z.enum(tones), text: text(500) })
    .strict(),
  z.object({ type: z.literal("text"), text: text(2000) }).strict(),
  z
    .object({
      type: z.literal("stats"),
      items: z
        .array(
          z
            .object({
              label: label,
              value: text(60),
              hint: text(120).optional(),
            })
            .strict(),
        )
        .max(12),
    })
    .strict(),
  z
    .object({
      type: z.literal("keyValue"),
      items: z
        .array(z.object({ label: label, value: text(500) }).strict())
        .max(30),
    })
    .strict(),
  z
    .object({
      type: z.literal("list"),
      title: label.optional(),
      empty: text(200),
      rows: z
        .array(
          z
            .object({
              id: z.union([z.string().max(100), z.number().int()]),
              title: text(120),
              icon: z.enum(pageIcons).optional(),
              status: text(40).optional(),
              tone: z.enum(tones).optional(),
              metadata: z.array(text(200)).max(8).default([]),
              detail: text(500).optional(),
              actions: z.array(buttonSchema).max(6).default([]),
            })
            .strict(),
        )
        .max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("form"),
      id: slug,
      title: label.optional(),
      /** `dialog` forms render only when a button with `opensForm` opens them. */
      presentation: z.enum(["inline", "dialog"]).default("inline"),
      fields: z.array(fieldSchema).min(1).max(30),
      submit: z.object({ action: slug, label: label }).strict(),
      /** Settings revision for optimistic concurrency (settings actions). */
      revision: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);
export type ViewBlock = z.infer<typeof blockSchema>;

export const viewSchema = z
  .object({
    schema: z.literal(1),
    title: label,
    description: text(500).optional(),
    primary: buttonSchema.optional(),
    blocks: z.array(blockSchema).max(40),
  })
  .strict();
export type View = z.infer<typeof viewSchema>;

/** Output of a program action hook, validated by the host. */
export const programActionOutputSchema = z
  .object({
    /** Replaces the stored values of each listed scope (schema-validated). */
    settings: z
      .object({
        global: jsonObject.optional(),
        workspace: jsonObject.optional(),
      })
      .strict()
      .optional(),
    notice: text(300).optional(),
  })
  .strict();
export type ProgramActionOutput = z.infer<typeof programActionOutputSchema>;

/* ------------------------------------------------------------------ */
/* HTTP contract (original protocol, same session and X-Workspace-Id). */
/* ------------------------------------------------------------------ */

/** Entry of `/api/state` → `plugin_pages`, ordered by group, order, title. */
export interface PluginPageEntry {
  /** Settings tab key: `plugin:<pluginId>:<pageId>`. */
  key: string;
  plugin: string;
  page: string;
  title: string;
  icon: PageIcon;
  group: PageGroup;
  order: number;
  audience: "admin" | "member";
  /** Legacy pages are rendered by the existing GPU PluginPanel. */
  legacy: boolean;
  /** Package release; changes invalidate cached views. */
  version: string;
}

export const pageTabKey = (plugin: string, page: string) =>
  "plugin:" + plugin + ":" + page;

/** POST /api/plugins/:plugin/pages/:page/actions/:action */
export const actionRequestSchema = z
  .object({
    target: z.union([z.string().max(100), z.number().int()]).optional(),
    payload: jsonObject.default({}),
    /** Required by settings actions; 409 when stale. */
    revision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ActionRequest = z.infer<typeof actionRequestSchema>;

export interface ActionResult {
  notice?: string;
  /** Copyable value shown in a dialog (e.g. a node pairing command). */
  result?: {
    title: string;
    label: string;
    value: string;
    instructions?: string;
  };
  /** Simple value results (e.g. nodes.suggestName). */
  value?: unknown;
  /** The client re-fetches the view (and /api/state when true). */
  refresh: boolean;
}

/** Stored settings value as exposed to pages and the API. */
export interface SettingsValue {
  values: Record<string, unknown>;
  revision: number;
}
