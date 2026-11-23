import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { buildProject } from "@fumiao/plugin-sdk/author-project.js";
import { packageFile } from "@fumiao/plugin-sdk/package-file.js";
import {
  contributionProblems,
  packageContributions,
  viewSchema,
  programActionOutputSchema,
} from "@fumiao/plugin-sdk/contributions.js";
import {
  artifactRulesSchema,
  capabilitiesSchema,
  receiptVerdictSchema,
} from "@fumiao/plugin-sdk/node-pools.js";
import {
  canvasResultSchema,
  validCanvasResult,
} from "@fumiao/plugin-sdk/canvas-nodes.js";
import { parseImportPlan } from "@fumiao/plugin-sdk/importers.js";
import { toolArguments } from "@fumiao/plugin-sdk/chat-tools.js";
import { manifestSchema, receiptSchema } from "@fumiao/plugin-sdk/index.js";
import { loadProgram, runProgram } from "@fumiao/platform/plugin-program.js";
import { planComposition } from "@fumiao/platform/composition/exporters.js";
import { validator } from "@fumiao/platform/schema.js";
import {
  fixtureHost,
  mediaAsset,
  job,
  paymentInput,
  sampleTrade,
} from "./fixtures.js";

const fixtures = z
  .object({
    inputs: z.record(z.string(), z.array(z.unknown())).optional(),
    expect: z.record(z.string(), z.unknown()).optional(),
    host: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
type Fixture = z.infer<typeof fixtures>;
type Case = {
  id: string;
  args: unknown[];
  run: (args: any[]) => Promise<unknown>;
};
const object = z.record(z.string(), z.unknown());
export async function authorSuite(directory: string, release?: unknown) {
  let project = release;
  if (!project) {
    try {
      project = await buildProject(directory);
    } catch (error) {
      // Protocol-only remote examples ship a manifest alongside the service.
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" ||
        ((error as NodeJS.ErrnoException).path !== join(directory, "package") &&
          (error as NodeJS.ErrnoException).path !==
            resolve(directory, "package"))
      )
        throw error;
      const manifest = manifestSchema.parse(
        JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
      );
      project = {
        format: 1,
        id: manifest.id,
        label: manifest.label,
        version: manifest.version,
        adapterVersion: manifest.version,
        remote: { endpoint: "http://127.0.0.1:4100", manifest },
      };
    }
  }
  const parsed = packageFile.parse(project);
  let fixture: Fixture = {};
  try {
    fixture = fixtures.parse(
      JSON.parse(await readFile(join(directory, "fixtures.json"), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const c = packageContributions(parsed),
    manifest = parsed.manifest ?? parsed.remote?.manifest;
  const m = manifest ? manifestSchema.parse(manifest) : undefined;
  const problems = contributionProblems(c, {
    mode: m?.mode ?? "request",
    hasProgram: !!parsed.program,
  });
  assert.deepEqual(problems, [], "扩展声明无效：" + problems.join("、"));
  const host = fixtureHost(c, fixture.host),
    cases: Case[] = [];
  const add = (id: string, args: unknown[], run: Case["run"]) =>
    cases.push({ id, args: fixture.inputs?.[id] ?? args, run });
  const settings: Record<string, unknown> = { global: null, workspace: null };
  for (const scope of ["global", "workspace"] as const) {
    const schema = c.settings?.[scope];
    if (!schema) continue;
    const validate = validator.compile(schema);
    const defaults: Record<string, unknown> = {};
    validate(defaults);
    const key = "settings." + scope;
    const value = fixture.inputs?.[key]?.[0] ?? defaults;
    settings[scope] = { values: value, revision: 1 };
    add(key, [value], async ([values]) => {
      assert.ok(
        validate(values),
        "示例设置不符合 JSON Schema，请提供 fixtures.json",
      );
      return values;
    });
    if (c.settings?.migrate) {
      const program = await loadProgram(
        "({migrate:" + c.settings.migrate + "\n})",
      );
      add(
        key + ".migrate",
        [value, { scope, from: "1.0.0", to: parsed.version }],
        async (args) => {
          const next = program("migrate", ...args);
          assert.ok(validate(next), "迁移后的设置不符合新 schema");
          return next;
        },
      );
    }
  }
  const allScopes = {
    plugin: {
      id: parsed.id,
      label: parsed.label,
      version: parsed.version,
      enabled: true,
    },
    settings,
    models:
      m?.models.map((item) => ({
        id: item.id,
        label: item.label,
        kind: item.kind,
        enabled: true,
      })) ?? [],
    nodes: { nodes: [], nodeModels: {} },
    jobs: [job],
    services: [],
  };
  for (const [group, pages] of [
    ["settingsPages", c.settingsPages],
    ["pages", c.pages ?? []],
  ] as const) {
    for (const page of pages) {
      if (!page.program) continue;
      const input = Object.fromEntries(
        page.scopes.map((scope) => [scope, allScopes[scope]]),
      );
      const call = page.audience === "admin" ? host.adminCall : host.call;
      const view = async (args: any[]) =>
        viewSchema.parse(
          await runProgram(
            page.program!,
            "view",
            args,
            host.allowed("read"),
            call,
          ),
        );
      const prefix = group + "." + page.id;
      add(prefix + ".view", [input], view);
      for (const action of page.actions.filter((a) => a.kind === "program")) {
        const payload = {
          text: "示例备注",
          key: "notes/000001",
          asset: mediaAsset.id,
          assets: mediaAsset.id + "\n" + mediaAsset.id,
          format: "mp4",
          seconds: 0,
        };
        add(
          prefix + "." + action.id,
          [action.id, payload, input],
          async (args) =>
            programActionOutputSchema.parse(
              await runProgram(
                page.program!,
                "action",
                args,
                host.allowed("write"),
                call,
              ),
            ),
        );
      }
    }
  }
  for (const item of c.importers ?? []) {
    const origins = c.http?.origins ?? [];
    add(
      "importers." + item.id,
      [{ source: item.target === "assets" ? origins[0] + "/cover.png" : "{}" }],
      async (args) => {
        const raw = await runProgram(
          item.program,
          "plan",
          args,
          host.allowed("write").filter((name) => name === "http.fetch"),
          (name, params, signal) => {
            if (
              ((params[1] as { method?: string } | undefined)?.method ??
                "GET") !== "GET"
            )
              throw Error("导入器只能读取外部来源");
            return host.call(name, params, signal);
          },
        );
        return parseImportPlan(item.target, raw, origins);
      },
    );
  }
  for (const e of c.events ?? []) {
    const resource = e.type.startsWith("asset.")
      ? mediaAsset
      : e.type.startsWith("job.")
        ? job
        : { id: 1 };
    add(
      "events." + e.type,
      [{ type: e.type, id: job.requestId, workspace: 1, resource }],
      async (args) =>
        runProgram(e.program, "handle", args, host.allowed("write"), host.call),
    );
  }
  for (const a of c.actions ?? []) {
    const values = Object.fromEntries(
      (a.fields ?? []).map((f) => [f.name, "示例文字"]),
    );
    add(
      "actions." + a.id,
      [
        {
          ...(a.target === "asset" ? mediaAsset : job),
          requestId: job.requestId,
        },
        values,
      ],
      async (args) =>
        z
          .object({ notice: z.string().min(1).max(300) })
          .strict()
          .parse(
            await runProgram(
              a.program,
              "run",
              args,
              host.allowed("write"),
              host.call,
            ),
          ),
    );
  }
  for (const n of c.canvasNodes ?? []) {
    const inputs = Object.fromEntries(
      n.inputs.map((p) => [
        p.id,
        p.kind === "text" ? "海面日出" : mediaAsset.id,
      ]),
    );
    const values = Object.fromEntries(n.fields.map((f) => [f.id, f.default]));
    add(
      "canvasNodes." + n.id,
      [{ inputs, values, uid: job.requestId }],
      async (args) => {
        const result = canvasResultSchema.parse(
          await runProgram(
            n.program,
            "run",
            args,
            host.allowed("write"),
            host.call,
          ),
        );
        assert.ok(
          validCanvasResult(n.outputs, result),
          "节点输出须匹配声明端口",
        );
        return result;
      },
    );
  }
  for (const t of c.chatTools ?? []) {
    const args = Object.fromEntries(
      Object.entries(t.parameters.properties).map(([key, p]) => [
        key,
        p.type === "array"
          ? []
          : p.type === "string"
            ? (p.enum?.[0] ?? "海面日出，海风徐来。")
            : p.type === "boolean"
              ? true
              : 1,
      ]),
    );
    add(
      "chatTools." + t.id,
      [args, { callId: "call-1", turn: job.requestId }],
      async (values) => {
        toolArguments(t.parameters, values[0]);
        const result = await runProgram(
          t.program,
          "run",
          values,
          host.allowed("write"),
          host.call,
        );
        assert.ok(
          typeof result === "string" && Buffer.byteLength(result) <= 16384,
          "对话工具须返回最多 16 KiB 的文本",
        );
        return result;
      },
    );
  }
  for (const e of c.exporters ?? []) {
    add(
      "exporters." + e.id,
      [{ shots: [{ video: "clip.mp4", voice: null, text: "示例旁白" }] }],
      async ([input]) => planComposition(e.program, input.shots),
    );
  }
  for (const m of c.paymentMethods ?? []) {
    for (const hook of ["create", "callback", "verify"] as const) {
      const permissions =
        hook === "create"
          ? ["payment.checkout", "payment.post"]
          : hook === "verify"
            ? ["payment.query"]
            : [];
      add(
        "paymentMethods." + m.id + "." + hook,
        [paymentInput],
        async (args) => {
          const result = await runProgram(
            m.program,
            hook,
            args,
            permissions,
            host.call,
          );
          if (hook === "create") {
            assert.equal(typeof result?.checkout, "string");
            new URL(result.checkout);
          } else
            assert.ok(
              (hook === "verify" && result === null) ||
                (typeof result === "string" &&
                  /^[A-Za-z0-9_-]{1,128}$/.test(result)),
              "支付程序返回的交易编号无效",
            );
          return result;
        },
      );
    }
  }
  if (c.nodePools) {
    assert.ok(
      m && parsed.program && parsed.nodeClient,
      "节点池须声明模型、节点客户端和程序",
    );
    const run = await loadProgram(parsed.program);
    const model = m.models[0].id,
      node = { ready_models: [model], features: {} },
      prepared = {
        ...job,
        model,
        input: { prompt: "示例", params: {}, references: [] },
        assets: {},
        attempts: 1,
        view: {},
      };
    for (const [hook, args, schema] of [
      ["capabilities", [{ ready: true }, [model]], capabilitiesSchema],
      ["eligible", [node, prepared], z.boolean()],
      ["dispatch", [prepared, node], object],
      ["receipt", [prepared, { prompt_id: "fixture" }], receiptVerdictSchema],
      ["artifactRules", [prepared], artifactRulesSchema],
    ] as const)
      add("nodePools." + hook, [...args], async (values) =>
        schema.parse(run(hook, ...values)),
      );
  }
  if (m && m.mode === "request") {
    add("providers.manifest", [m], async ([value]) =>
      manifestSchema.parse(value),
    );
    add(
      "providers.receipt",
      [
        {
          state: "completed",
          artifacts: [
            { url: "https://media.example/fixture.png", mime: "image/png" },
          ],
        },
      ],
      async ([value]) => receiptSchema.parse(value),
    );
    if (parsed.program) {
      const run = await loadProgram(parsed.program);
      add(
        "providers.request",
        [
          {
            model: m.models[0].id,
            kind: m.models[0].kind,
            descriptor: m.models[0].studio?.descriptor,
            remoteId: null,
            input: { prompt: "示例", params: {}, references: [] },
          },
        ],
        async (values) => {
          const mapped = object.parse(run("request", ...values));
          assert.ok(
            typeof mapped.path === "string" &&
              /^\/(?!\/)[A-Za-z0-9/_-]+$/.test(mapped.path),
            "插件请求路径无效",
          );
          return mapped;
        },
      );
      add(
        "providers.result",
        [
          {
            model: m.models[0].id,
            kind: m.models[0].kind,
            remoteId: null,
            raw: { state: "pending", remoteId: sampleTrade },
          },
        ],
        async (values) => receiptSchema.parse(run("result", ...values)),
      );
    }
  }
  for (const key of Object.keys({ ...fixture.inputs, ...fixture.expect }))
    assert.ok(
      cases.some((c) => c.id === key),
      "fixtures.json 中没有对应入口：" + key,
    );
  async function execute(id: string, override?: unknown[]) {
    const entry = cases.find((c) => c.id === id);
    assert.ok(entry, "未知扩展入口：" + id);
    return host.transaction(async () => {
      const result = await entry.run(structuredClone(override ?? entry.args));
      if (!override && fixture.expect && Object.hasOwn(fixture.expect, id))
        assert.deepEqual(result, fixture.expect[id], "插件输出与示例预期不符");
      return result;
    });
  }
  return {
    plugin: parsed.id,
    version: parsed.version,
    remote: parsed.remote ? m : undefined,
    cases: cases.map(({ id, args }) => ({ id, args })),
    execute,
  };
}
