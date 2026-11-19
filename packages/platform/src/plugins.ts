import { gpuText } from "../../../plugins/gpu/src/text.js";
import { gpuPairedAgent } from "../../../plugins/gpu/src/paired-agent.js";
import type { PairedAgentProtocol } from "../../plugin-sdk/src/paired-agent.js";
import { museText } from "../../../plugins/muse/src/text.js";
import { flowText } from "../../../plugins/flow/src/text.js";
import { imagesText } from "../../../plugins/images/src/text.js";
import { storyboardHistory } from "../../../plugins/storyboard/src/history.js";
import { validator } from "./schema.js";
export { validator } from "./schema.js";
import { registerStudioModels } from "./catalog.js";
import { museCanvasRuns } from "../../../plugins/muse/src/canvas-runs.js";
import { museCanvas } from "../../../plugins/muse/src/canvas.js";
import { flowCanvasRuns } from "../../../plugins/flow/src/canvas-runs.js";
import { flowCanvas } from "../../../plugins/flow/src/canvas.js";
import { gpuCanvasRuns } from "../../../plugins/gpu/src/canvas-runs.js";
import { gpuCanvas } from "../../../plugins/gpu/src/canvas.js";
import { imagesCanvasRuns } from "../../../plugins/images/src/canvas-runs.js";
import { imagesCanvas } from "../../../plugins/images/src/canvas.js";
import { museStudio } from "../../../plugins/muse/src/studio.js";
import { flowStudio } from "../../../plugins/flow/src/studio.js";
import { gpuStudio } from "../../../plugins/gpu/src/studio.js";
import { chatStudio } from "../../../plugins/chat/src/studio.js";
import { chatStreaming } from "../../../plugins/chat/src/stream.js";
import { imagesStudio } from "../../../plugins/images/src/studio.js";
import { imagesTiming } from "../../../plugins/images/src/timing.js";
import { museTiming } from "../../../plugins/muse/src/timing.js";
import { flowTiming } from "../../../plugins/flow/src/timing.js";
import { gpuTiming } from "../../../plugins/gpu/src/timing.js";
import { gpuQueue } from "../../../plugins/gpu/src/queue.js";
import { gpuReferences } from "../../../plugins/gpu/src/references.js";
import { gpuNative } from "../../../plugins/gpu/src/native.js";
import { gpuOriginal } from "../../../plugins/gpu/src/original.js";
import { museOriginal } from "../../../plugins/muse/src/original.js";
import { imagesOriginal } from "../../../plugins/images/src/original.js";
import { flowOriginal } from "../../../plugins/flow/src/original.js";
import { gpuEstimate } from "../../../plugins/gpu/src/estimate.js";
import { museEstimate } from "../../../plugins/muse/src/estimate.js";
import { imagesEstimate } from "../../../plugins/images/src/estimate.js";
import { flowEstimate } from "../../../plugins/flow/src/estimate.js";
import { gpuState } from "../../../plugins/gpu/src/state.js";
import { museState } from "../../../plugins/muse/src/state.js";
import { flowState } from "../../../plugins/flow/src/state.js";
import { imagesState } from "../../../plugins/images/src/state.js";
import { imagesLifecycle } from "../../../plugins/images/src/lifecycle.js";
import { imagesSettings } from "../../../plugins/images/src/settings.js";
import { museDownload } from "../../../plugins/muse/src/download.js";
import { flowDownload } from "../../../plugins/flow/src/download.js";
import { museArtifacts } from "../../../plugins/muse/src/artifacts.js";
import { flowArtifacts } from "../../../plugins/flow/src/artifacts.js";
import { museLifecycle } from "../../../plugins/muse/src/lifecycle.js";
import { flowLifecycle } from "../../../plugins/flow/src/lifecycle.js";
import { museQueue } from "../../../plugins/muse/src/queue.js";
import { museClock } from "../../../plugins/muse/src/clock.js";
import { flowQueue } from "../../../plugins/flow/src/queue.js";
import { imagesQueue } from "../../../plugins/images/src/queue.js";
import { muse } from "../../../plugins/muse/src/index.js";
import { flow } from "../../../plugins/flow/src/index.js";
import { gpu } from "../../../plugins/gpu/src/index.js";
import { storyboard } from "../../../plugins/storyboard/src/index.js";
import { images } from "../../../plugins/images/src/index.js";
import { chat } from "../../../plugins/chat/src/index.js";
import { remotePlugin } from "../../../plugins/remote/src/index.js";
import { validOriginalRemoteModels } from "../../../plugins/remote/src/original.js";
import {
  manifestSchema,
  ProviderError,
  type ProviderPlugin,
  type Manifest,
} from "../../plugin-sdk/src/index.js";
import type { Database, Sql } from "./db.js";
import { one } from "./db.js";
import { DomainError, requireValue } from "./security.js";
export class PluginRegistry {
  private builtins = new Map<string, ProviderPlugin>();
  constructor(
    plugins = [
      muse,
      flow,
      gpu,
      chat,
      images,
      storyboard,
      storyboardHistory,
      museStudio,
      flowStudio,
      gpuStudio,
      chatStudio,
      chatStreaming,
      imagesStudio,
      imagesTiming,
      museTiming,
      flowTiming,
      gpuTiming,
      gpuQueue,
      museQueue,
      flowQueue,
      imagesQueue,
      museClock,
      gpuReferences,
      gpuNative,
      gpuOriginal,
      museOriginal,
      imagesOriginal,
      flowOriginal,
      gpuEstimate,
      museEstimate,
      imagesEstimate,
      flowEstimate,
      gpuState,
      museState,
      flowState,
      imagesState,
      museDownload,
      flowDownload,
      museArtifacts,
      flowArtifacts,
      museLifecycle,
      flowLifecycle,
      imagesLifecycle,
      imagesSettings,
      museCanvas,
      museCanvasRuns,
      flowCanvas,
      flowCanvasRuns,
      gpuCanvas,
      gpuCanvasRuns,
      imagesCanvas,
      imagesCanvasRuns,
      gpuText,
      museText,
      flowText,
      imagesText,
    ],
    private readonly agentProtocols: readonly PairedAgentProtocol[] = [
      gpuPairedAgent,
    ],
  ) {
    for (const plugin of plugins)
      this.builtins.set(
        `${plugin.manifest.id}@${plugin.manifest.version}`,
        plugin,
      );
  }
  pairedAgent(provider: string) {
    return this.agentProtocols.find(
      (protocol) => protocol.provider === provider,
    );
  }
  async installBuiltins(db: Database, originalStudio = false) {
    await db.transaction(async (sql) => {
      await this.installBuiltinsOn(sql);
      if (originalStudio) await this.prepareOriginalStudio(sql);
    });
  }
  async installBuiltinsOn(sql: Sql) {
    await sql.query("SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))");
    const fresh = !(await one(sql, "SELECT id FROM studio_catalog LIMIT 1"));
    for (const plugin of this.builtins.values())
      await this.installOn(sql, plugin.manifest, undefined, !fresh);
  }
  private async prepareOriginalStudio(sql: Sql) {
    // Move the original seed catalog to the supported adapters without
    // changing any user-visible metadata, amounts, policy or pricing revision.
    for (const [seed, original] of [
      [museStudio, museText],
      [flowStudio, flowText],
      [gpuStudio, gpuText],
      [imagesStudio, imagesText],
      [chatStudio, chatStreaming],
    ]) {
      const from = seed.manifest,
        to = original.manifest;
      const studio = (manifest: Manifest) =>
        manifest.models.map(({ id, kind, hidden, studio }) => ({
          id,
          kind,
          hidden,
          studio,
        }));
      requireValue(
        from.id === to.id && canonical(studio(from)) === canonical(studio(to)),
        409,
        "Studio default adapter upgrade changes the public model catalog",
      );
      await sql.query(
        `UPDATE studio_catalog SET plugin_version=$3 WHERE plugin_id=$1 AND plugin_version=$2`,
        [from.id, from.version, to.version],
      );
    }
  }
  async install(db: Database, value: unknown, endpoint?: string) {
    return db.transaction(async (sql) => {
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))",
      );
      return this.installOn(sql, value, endpoint, true);
    });
  }
  private async installOn(
    sql: Sql,
    value: unknown,
    endpoint: string | undefined,
    bump: boolean,
  ) {
    requireValue(
      !(
        value &&
        typeof value === "object" &&
        Object.hasOwn(value, "fmworkerResources")
      ),
      400,
      "fmWorker 资源能力已退役，无法安装此插件",
    );
    const manifest = manifestSchema.parse(value) as Manifest;
    const local = this.builtins.get(`${manifest.id}@${manifest.version}`);
    if (manifest.canvas) {
      const rules = manifest.canvas.models;
      requireValue(
        new Set(rules.map((r) => r.model)).size === rules.length &&
          rules.every((r) =>
            manifest.models.some(
              (m) => m.id === r.model && m.kind === r.kind && m.studio,
            ),
          ) &&
          ["image", "video"].every(
            (kind) =>
              rules.filter((r) => r.kind === kind && r.defaultForKind).length <=
              1,
          ) &&
          rules.every(
            (r) => r.templatePriority === undefined || r.kind === "video",
          ),
        400,
        "画布模型规则无效",
      );
    }
    if (manifest.canvasSubmission) {
      const rules = manifest.canvasSubmission.models;
      requireValue(
        new Set(rules.map((r) => r.model)).size === rules.length &&
          rules.every((r) =>
            manifest.models.some(
              (m) => m.id === r.model && m.kind === r.kind && m.studio,
            ),
          ) &&
          ["image", "video", "audio"].every(
            (kind) =>
              rules.filter((r) => r.kind === kind && r.defaultForKind).length <=
              1,
          ) &&
          rules.every(
            (r) =>
              (!r.nativeH3 && r.fixedSamplingSteps === undefined) ||
              r.kind === "video",
          ),
        400,
        "画布生成规则无效",
      );
    }
    if (manifest.chat) {
      requireValue(
        !endpoint &&
          manifest.mode === "request" &&
          local?.chatStream &&
          local.chatTitle &&
          local.chatProbe &&
          local.chatProvider &&
          local.chatConfigured &&
          local.chatConfigure,
        400,
        "对话流需要已安装的本地适配器",
      );
      const providers = manifest.chat.providers,
        models = providers.flatMap((p) => p.models);
      requireValue(
        new Set(providers.map((p) => p.id)).size === providers.length &&
          new Set(models).size === models.length &&
          models.every((id) =>
            manifest.models.some((m) => m.id === id && m.kind === "chat"),
          ),
        400,
        "对话提供方目录无效",
      );
    }
    if (manifest.originalImageSettings)
      requireValue(
        !endpoint &&
          local?.checkOriginalSettings &&
          local.originalState &&
          manifest.originalState?.fields.includes("images") &&
          manifest.models.some(
            (m) => m.id === manifest.originalImageSettings!.defaultModel,
          ),
        400,
        "原图片设置需要已安装的本地适配器",
      );
    if (manifest.requestLifecycle)
      requireValue(
        !endpoint &&
          manifest.mode === "request" &&
          local?.manifest.requestLifecycle,
        400,
        "请求生命周期需要已安装的本地适配器",
      );
    if (manifest.artifactDownload)
      requireValue(
        !endpoint && manifest.mode === "request" && local?.downloadArtifact,
        400,
        "产物下载契约需要已安装的本地适配器",
      );
    if (
      manifest.requestLifecycle?.version === 3 &&
      manifest.requestLifecycle.requireConfigured
    )
      requireValue(
        local?.originalState?.configured,
        400,
        "请求准入需要已安装的配置适配器",
      );
    if (manifest.originalState)
      requireValue(
        !endpoint &&
          local?.originalState &&
          manifest.queue &&
          (!manifest.originalState.recovery || manifest.mode === "pull") &&
          new Set(manifest.originalState.fields).size ===
            manifest.originalState.fields.length,
        400,
        "原状态契约需要已安装的本地适配器",
      );
    if (manifest.originalEstimate)
      requireValue(
        !endpoint &&
          local?.originalEstimate &&
          manifest.timing &&
          manifest.queue &&
          (!manifest.timing.hardware || local.originalEstimate.eligible),
        400,
        "原估时契约需要已安装的本地适配器",
      );
    if (manifest.originalSubmission?.version === 1)
      requireValue(
        !endpoint && local?.originalSubmission,
        400,
        "原提交契约需要已安装的本地适配器",
      );
    if (manifest.originalSubmission?.version === 2) {
      requireValue(
        endpoint &&
          validRemoteEndpoint(endpoint) &&
          manifest.mode === "request" &&
          ![...this.builtins.values()].some(
            (p) => p.manifest.id === manifest.id,
          ) &&
          !manifest.canvasSubmission &&
          validOriginalRemoteModels(manifest),
        400,
        "远程工作台提交契约无效",
      );
    }
    if (manifest.inputPreparation)
      requireValue(
        !endpoint &&
          local?.referenceIds &&
          local?.prepareInput &&
          manifest.models.every((m) => m.preparedSchema),
        400,
        "输入冻结需要已安装的本地适配器和结果契约",
      );
    if (manifest.artifactValidation)
      requireValue(
        !endpoint &&
          local?.validateArtifact &&
          (manifest.artifactValidation.version === 1
            ? manifest.mode === "pull"
            : manifest.mode === "request"),
        400,
        manifest.artifactValidation.version === 1
          ? "成片验收需要已安装的本地 pull 适配器"
          : "成片验收需要已安装的本地 request 适配器",
      );
    if (manifest.referenceImports) {
      requireValue(
        !endpoint &&
          this.builtins.get(`${manifest.id}@${manifest.version}`)
            ?.importReference,
        400,
        "参考素材转换需要已安装的本地适配器",
      );
      requireValue(
        new Set(manifest.referenceImports.map((r) => r.id)).size ===
          manifest.referenceImports.length,
        400,
        "参考素材能力重复",
      );
    }
    if (manifest.queue) {
      const adapter = this.builtins.get(`${manifest.id}@${manifest.version}`);
      requireValue(
        !endpoint &&
          manifest.timing &&
          adapter?.timingFeatures &&
          adapter?.queuePlan,
        400,
        "队列能力需要已安装的本地计时和队列适配器",
      );
    }
    requireValue(
      new Set(manifest.models.map((m) => m.id)).size === manifest.models.length,
      400,
      "插件模型 ID 重复",
    );
    try {
      validator.compile(manifest.configSchema);
      for (const model of manifest.models) {
        validator.compile(model.inputSchema);
        if (model.preparedSchema) validator.compile(model.preparedSchema);
      }
    } catch (error) {
      if (manifest.originalSubmission?.version === 2)
        throw new DomainError(400, "远程工作台插件的 JSON Schema 无效");
      throw error;
    }
    if (endpoint)
      requireValue(
        manifest.mode === "request",
        400,
        "远程插件必须使用 request 模式",
      );
    if (endpoint)
      requireValue(/^https?:\/\//.test(endpoint), 400, "插件地址无效");
    const existing = await one(
      sql,
      "SELECT * FROM plugin_versions WHERE id=$1 AND version=$2",
      [manifest.id, manifest.version],
    );
    if (existing) {
      requireValue(
        JSON.stringify(existing.manifest) ===
          JSON.stringify(JSON.parse(JSON.stringify(manifest))) ||
          canonical(existing.manifest) === canonical(manifest),
        409,
        "同一插件版本内容不可修改",
      );
      requireValue(
        (existing.endpoint || undefined) === endpoint,
        409,
        "同一插件版本的地址不可修改",
      );
      await registerStudioModels(sql, manifest, bump);
      return manifest;
    }
    await sql.query(
      "INSERT INTO plugin_versions(id,version,manifest,endpoint) VALUES($1,$2,$3,$4)",
      [
        manifest.id,
        manifest.version,
        JSON.stringify(manifest),
        endpoint || null,
      ],
    );
    await registerStudioModels(sql, manifest, bump);
    return manifest;
  }
  async resolve(
    db: Sql,
    id: string,
    version: string,
  ): Promise<ProviderPlugin & { retired?: true }> {
    const plugin = this.builtins.get(`${id}@${version}`);
    if (plugin) return plugin;
    const row = await one(
      db,
      "SELECT * FROM plugin_versions WHERE id=$1 AND version=$2",
      [id, version],
    );
    if (row && Object.hasOwn(row.manifest, "fmworkerResources")) {
      // Keep the stored manifest immutable. Old references may read its metadata
      // without exposing the retired capability or loading an execution driver.
      const { fmworkerResources: _, ...manifest } = row.manifest;
      return {
        retired: true,
        manifest: manifestSchema.parse(manifest) as Manifest,
        health: async () => false,
        submit: async () => {
          throw new ProviderError("fmWorker 资源能力已退役", "rejected");
        },
      };
    }
    requireValue(row?.endpoint, 503, "插件版本不可用");
    return remotePlugin(row.manifest, row.endpoint);
  }

  async referenceImporter(db: Sql, id: string) {
    const versions = (
      await db.query(
        "SELECT DISTINCT v.id,v.version,v.manifest FROM studio_catalog c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version WHERE v.manifest ? 'referenceImports'",
      )
    ).rows;
    const candidates = versions.flatMap((v) =>
      (v.manifest.referenceImports || [])
        .filter((r: any) => r.id === id)
        .map((capability: any) => ({ version: v, capability })),
    );
    requireValue(candidates.length === 1, 503, "参考素材接入尚未启用");
    const selected = candidates[0],
      plugin = await this.resolve(
        db,
        selected.version.id,
        selected.version.version,
      );
    requireValue(plugin.importReference, 503, "参考素材适配器不可用");
    return { plugin, capability: selected.capability };
  }
}
function validRemoteEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      /^https?:\/\//.test(endpoint) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/\s/.test(endpoint)
    );
  } catch {
    return false;
  }
}
/** Provider-bound chat connections expose only their provider's declared models. */
export function connectionModels(
  plugin: ProviderPlugin,
  config: Record<string, unknown>,
) {
  const provider = plugin.manifest.chat?.providers.find(
    (p) => p.id === plugin.chatProvider?.(config),
  );
  requireValue(
    !plugin.manifest.chat || provider,
    400,
    "连接配置不符合插件要求",
  );
  return plugin.manifest.models.filter(
    (m) => !provider || provider.models.includes(m.id),
  );
}
export function canonical(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
