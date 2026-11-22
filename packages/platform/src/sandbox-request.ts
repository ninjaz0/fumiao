import {
  readProviderStream,
  ProviderStreamInterpreterError,
} from "./provider-stream.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  chatHttp,
  ProviderBodyTooLarge,
} from "@fumiao/plugin-sdk/chat-transport.js";
import {
  ArtifactDownloadError,
  RequestLifecycleError,
  providerClockReportSchema,
  timingReportSchema,
  queueHealthSchema,
  receiptSchema,
  requestDispositionSchema,
  type Execution,
  type Manifest,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
import { decodePythonJson } from "@fumiao/plugin-sdk/json.js";
import { requirePublicHttps, guardedLookup } from "./plugin-host.js";
import { requireValue } from "./security.js";
import { loadStudioPolicy } from "./studio-policy.js";
import {
  requestWorkbenchAdapter,
  workbenchHooks,
} from "./request-workbench.js";

const pathSchema = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/)
  .refine((path) =>
    path.split("/").every((part) => part !== "." && part !== ".."),
  );
const instruction = z
  .object({
    path: pathSchema,
    body: z.record(z.string(), z.unknown()).optional(),
    idempotency: z.enum(["compact", "standard"]).optional(),
    publicAlias: z.string().max(2048).optional(),
    timeoutMs: z.number().int().min(100).max(600000),
  })
  .strict();
const outcome = z
  .object({
    receipt: receiptSchema.optional(),
    disposition: requestDispositionSchema.optional(),
    note: z.string().max(500).optional(),
    clock: providerClockReportSchema.optional(),
    timing: timingReportSchema.optional(),
  })
  .strict()
  .refine((v) => !!v.receipt !== !!v.disposition);
const artifactPlan = z.union([
  z
    .object({
      path: pathSchema,
      timeoutMs: z.number().int().min(100).max(90000).optional(),
    })
    .strict(),
  z
    .object({
      external: z.string().max(65536),
      timeoutMs: z.number().int().min(100).max(90000),
    })
    .strict(),
  z.object({ error: z.string().min(1).max(500) }).strict(),
]);
type Config = Record<string, unknown>;

// Inline only references authorized and frozen for this job. Their contents
// never cross QuickJS's heap boundary. Each reference can occur at most once.
function expandReferences(body: unknown, e: Execution) {
  const seen = new Set<number>();
  function expand(value: unknown, depth: number): unknown {
    requireValue(depth <= 32, 400, "插件请求嵌套过深");
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value))
      return value.map((item) => expand(item, depth + 1));
    const obj = value as Record<string, unknown>;
    if (Object.hasOwn(obj, "$reference")) {
      const i = z.number().int().nonnegative().parse(obj.$reference);
      requireValue(
        Object.keys(obj).length === 1 &&
          i < e.input.references.length &&
          !seen.has(i),
        400,
        "插件请求引用无效",
      );
      seen.add(i);
      return e.input.references[i].url;
    }
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, expand(v, depth + 1)]),
    );
  }
  return expand(body, 0);
}

export async function sandboxRequest(
  manifest: Manifest,
  source: string,
  send = chatHttp,
): Promise<ProviderPlugin> {
  const policy = manifest.originalSubmission;
  requireValue(
    manifest.mode === "request" &&
      policy?.version === 5 &&
      policy.studioDigest === createHash("sha256").update(source).digest("hex"),
    400,
    "请求提供方工作台程序摘要不符",
  );
  const hooks = await loadStudioPolicy(source, [
    ...workbenchHooks,
    ...(policy.stream ? ["stream"] : []),
    "request",
    "result",
    "serviceProbe",
    "queueHealth",
    "artifact",
    "downloadError",
  ]);
  const { sync, resource } = hooks;
  function service(config: Config) {
    const base = new URL(String(config.baseUrl));
    requirePublicHttps(base);
    requireValue(
      !base.search && !base.hash && typeof config.apiKey === "string",
      400,
      "服务地址或密钥无效",
    );
    return base;
  }
  function open(
    config: Config,
    path: string,
    signal: AbortSignal,
    timeout: number,
    maxResponseBytes: number | undefined,
    body?: unknown,
    idempotencyKey?: string,
    forwarded?: { host: string; scheme: string },
  ) {
    const url = service(config);
    url.pathname = url.pathname.replace(/\/+$/, "") + pathSchema.parse(path);
    return send(url, {
      method: body === undefined ? "GET" : "POST",
      key: String(config.apiKey),
      body,
      idempotencyKey,
      forwarded,
      signal,
      lookup: guardedLookup,
      connectMs: timeout,
      readMs: timeout,
      maxRequestBytes: 136 * 1024 * 1024,
      maxResponseBytes,
    });
  }
  async function read(
    config: Config,
    path: string,
    signal: AbortSignal,
    timeout = 8000,
    limit = 2 * 1024 ** 2,
    body?: unknown,
    idempotencyKey?: string,
  ) {
    let response;
    try {
      response = await open(
        config,
        path,
        signal,
        timeout,
        limit,
        body,
        idempotencyKey,
      );
      const status = response.status;
      if (status < 200 || status >= 300) return { status, text: null };
      const chunks = [];
      for await (const chunk of response.body) chunks.push(chunk);
      try {
        return { status, text: decodePythonJson(Buffer.concat(chunks)) };
      } catch {
        return { status, text: null };
      }
    } catch (error) {
      return {
        status:
          error instanceof ProviderBodyTooLarge && response
            ? response.status
            : 0,
        text: null,
      };
    } finally {
      response?.close();
    }
  }
  async function inspectService(config: Config, signal: AbortSignal) {
    const result = await resource(
      "serviceProbe",
      [],
      ["service.read"],
      async (_method, args, hostSignal) =>
        read(
          config,
          pathSchema.parse(args[0]),
          AbortSignal.any([signal, hostSignal]),
          8000,
          256 * 1024,
        ),
    );
    return z
      .object({
        ready: z.boolean(),
        models: z.array(z.string().max(500)).max(10000).optional(),
      })
      .parse(result);
  }
  async function stream(
    e: Execution,
    plan: z.infer<typeof instruction>,
    body: unknown,
  ) {
    let response;
    let failure: "connection" | "invalid" | "oversized" = "connection";
    let status = 0,
      text = "";
    try {
      const alias = plan.publicAlias
        ? new URL(String(e.config.publicUrl || plan.publicAlias))
        : null;
      requireValue(
        !alias ||
          (["http:", "https:"].includes(alias.protocol) &&
            !alias.username &&
            !alias.password),
        400,
        "服务公开地址无效",
      );
      // Framing accounts for the decoded bytes through the terminal event.
      response = await open(
        e.config,
        plan.path,
        e.signal,
        plan.timeoutMs,
        undefined,
        body,
        undefined,
        alias
          ? { host: alias.host, scheme: alias.protocol.slice(0, -1) }
          : undefined,
      );
      status = response.status;
      if (status >= 200 && status < 300) {
        const reply = await readProviderStream(
          source,
          e.kind,
          response.body,
          e.signal,
          e.reportProviderNote,
        );
        failure = "invalid";
        if (reply.outcome !== undefined) return outcome.parse(reply.outcome);
        failure = reply.failure ?? "invalid";
      } else {
        failure = "invalid";
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of response.body) {
          const part = chunk.subarray(0, 65536 - size);
          chunks.push(part);
          size += part.length;
          if (size === 65536) break;
        }
        text = Buffer.concat(chunks).toString("utf8");
        return outcome.parse(sync("result", { status, text }));
      }
    } catch (error) {
      if (error instanceof ProviderStreamInterpreterError && !e.signal.aborted)
        failure = "invalid";
    } finally {
      response?.close();
    }
    return outcome.parse(sync("result", { failure }));
  }
  async function execute(e: Execution, remoteId?: string) {
    const plan = instruction.parse(
      sync("request", {
        model: e.model,
        kind: e.kind,
        remoteId,
        prompt: e.input.prompt,
        params: e.input.params,
        references: e.input.references.map((r, i) => ({
          mime: r.mime,
          value: { $reference: i },
        })),
      }),
    );
    requireValue(
      remoteId ? !plan.body : !!plan.body,
      400,
      "插件请求与执行阶段不匹配",
    );
    const body = expandReferences(plan.body, e);
    const result =
      policy?.version === 5 && policy.stream && !remoteId
        ? await stream(e, plan, body)
        : outcome.parse(
            sync(
              "result",
              await read(
                e.config,
                plan.path,
                e.signal,
                plan.timeoutMs,
                2 * 1024 ** 2,
                body,
                plan.idempotency === "compact"
                  ? e.idempotencyKey.replaceAll("-", "")
                  : plan.idempotency === "standard"
                    ? e.idempotencyKey
                    : undefined,
              ),
              remoteId ?? null,
            ),
          );
    if (result.note && !remoteId) await e.reportProviderNote?.(result.note);
    if (result.clock) await e.reportProviderClock?.(result.clock);
    if (result.timing) await e.reportTiming?.(result.timing);
    if (result.note && remoteId) await e.reportProviderNote?.(result.note);
    if (result.disposition) throw new RequestLifecycleError(result.disposition);
    return result.receipt!;
  }
  return {
    manifest,
    ...requestWorkbenchAdapter(manifest, hooks),
    inspectService,
    health: async (c, s) => (await inspectService(c, s)).ready,
    queueHealth: async (c, s) =>
      queueHealthSchema.parse(
        await resource(
          "queueHealth",
          [],
          ["service.read"],
          (_method, args, hostSignal) =>
            read(
              c,
              pathSchema.parse(args[0]),
              AbortSignal.any([s, hostSignal]),
              8000,
              args.length > 1
                ? z
                    .number()
                    .int()
                    .min(1)
                    .max(2 * 1024 ** 2)
                    .parse(args[1])
                : undefined,
            ),
        ),
      ),
    submit: (e) => execute(e),
    inspect: execute,
    async downloadArtifact({ url, config, recovering }, signal) {
      const base = service(config);
      function publicPart(u: URL) {
        return { netloc: u.host, path: u.pathname.replace(/\/+$/, "") };
      }
      const alias =
        typeof config.publicUrl === "string"
          ? URL.parse(config.publicUrl)
          : null;
      const plan = artifactPlan.parse(
        sync(
          "artifact",
          url,
          publicPart(base),
          alias ? publicPart(alias) : null,
          recovering,
        ),
      );
      if ("error" in plan)
        throw new ArtifactDownloadError(plan.error, "failed");
      let response;
      try {
        if ("external" in plan) {
          const destination = new URL(plan.external);
          requirePublicHttps(destination);
          const granted =
            policy?.version === 5 &&
            policy.artifactOrigins?.some((origin) => {
              if (!origin.startsWith("https://*."))
                return destination.origin === origin;
              return (
                !destination.port &&
                destination.hostname.endsWith(origin.slice("https://*".length))
              );
            });
          requireValue(
            plan.external === url && granted,
            403,
            "成品域名未获授权",
          );
          response = await send(destination, {
            method: "GET",
            signal,
            lookup: guardedLookup,
            connectMs: plan.timeoutMs,
            readMs: plan.timeoutMs,
            maxResponseBytes: 64 * 1024 ** 2,
          });
        } else
          response = await open(
            config,
            plan.path,
            signal,
            plan.timeoutMs ?? 45000,
            64 * 1024 ** 2,
          );
        requireValue(
          response.status >= 200 && response.status < 300,
          502,
          "成品下载失败",
        );
        const chunks = [];
        for await (const chunk of response.body) chunks.push(chunk);
        return Buffer.concat(chunks);
      } catch (e) {
        const failure = z
          .object({
            note: z.string().max(500),
            disposition: z.enum(["retry", "failed"]),
          })
          .parse(
            sync(
              "downloadError",
              e instanceof ProviderBodyTooLarge ? "oversized" : "network",
              recovering,
            ),
          );
        throw new ArtifactDownloadError(failure.note, failure.disposition);
      } finally {
        response?.close();
      }
    },
  };
}
