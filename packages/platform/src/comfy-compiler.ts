import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  applyMicroAppInputs,
  buildMicroAppPackageFile,
  inferComfyWorkflowSlots,
  microAppSpecSchema,
  type CompiledNodeClient,
  type InferredWorkflowAnalysis,
  type MicroAppSpec,
} from "@fumiao/plugin-sdk/comfy-microapp.js";
import { packageFile, type PackageFile } from "@fumiao/plugin-sdk/package-file.js";
import { one } from "./db.js";
import { loadProgram } from "./plugin-program.js";
import type { Actor, Platform } from "./platform.js";
import { requireValue } from "./security.js";
import { StudioPackages } from "./studio-packages.js";

function loadWorkerSource(): Buffer {
  const baseDir =
    import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(baseDir, "comfy-worker/worker.py"),
    resolve(baseDir, "../src/comfy-worker/worker.py"),
    resolve(baseDir, "../../src/comfy-worker/worker.py"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate);
    }
  }
  throw new Error(
    "未找到平台内置 ComfyUI Worker 源码 (comfy-worker/worker.py)",
  );
}

function buildSingleFileUstarTgz(filename: string, data: Buffer): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(filename, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(0x20, 148, 156); // checksum placeholder
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");

  const padLen = (512 - (data.length % 512)) % 512;
  const tar = Buffer.concat([header, data, Buffer.alloc(padLen, 0), Buffer.alloc(1024, 0)]);
  return gzipSync(tar, { level: 9 });
}

export function buildComfyNodeClient(pluginId: string): CompiledNodeClient {
  const workerSource = loadWorkerSource();
  const tgz = buildSingleFileUstarTgz("worker.py", workerSource);
  const sha = createHash("sha256").update(tgz).digest("hex");
  const digestLine = `${sha}  agent.tgz\n`;
  const installScript = `#!/usr/bin/env bash
set -euo pipefail
umask 077
: "\${FUMIAO_SITE:?缺少工作台地址}"
root=\${FUMIAO_NODE_HOME:-"$HOME/.local/share/fumiao-${pluginId}"}
mkdir -p "$root"
stage=$(mktemp -d "$root/.install.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
base="$FUMIAO_SITE/agent/${pluginId}/client"
curl -fsSL "$base/agent.tgz" -o "$stage/agent.tgz"
curl -fsSL "$base/agent.tgz.sha256" -o "$stage/digest"
(cd "$stage" && sha256sum -c digest && tar xzf agent.tgz worker.py)
install -m 600 "$stage/worker.py" "$root/worker.py"
cd "$root"
FUMIAO_PLUGIN_ID="${pluginId}" python3 worker.py "\${1:-}"
`;
  return {
    "agent.tgz": tgz.toString("base64"),
    "agent.tgz.sha256": Buffer.from(digestLine, "utf8").toString("base64"),
    "install.sh": Buffer.from(installScript, "utf8").toString("base64"),
  };
}

export type ComfyPublishResult = {
  dry_run: boolean;
  plugin_id: string;
  version: string;
  model_id: string;
  model_key: string;
  smoke_test_passed: boolean;
  smoke_dispatch?: Record<string, unknown>;
  package_file: PackageFile;
  installed?: unknown;
};

/**
 * F037: One-folder-one-microapp packager.
 * Reads `<dir>/app.json` (+ optional sibling `workflow.json` or `workflowFile`),
 * preserves all declared slots (falling back to slot inference only when omitted),
 * compiles to a versioned `.fmplugin.json` PackageFile, and runs QuickJS smoke checks.
 */
export async function packComfyMicroAppDirectory(dirPath: string): Promise<{
  spec: MicroAppSpec;
  package_file: PackageFile;
  model_key: string;
  smoke_dispatch: Record<string, unknown>;
}> {
  const root = resolve(dirPath);
  const appJsonPath = resolve(root, "app.json");
  requireValue(existsSync(appJsonPath), 400, `未找到微应用声明文件：${appJsonPath}`);
  const rawApp = JSON.parse(readFileSync(appJsonPath, "utf8")) as Record<string, unknown>;
  requireValue(
    rawApp && typeof rawApp === "object" && !Array.isArray(rawApp),
    400,
    "app.json 顶层必须是 JSON 对象",
  );

  let workflowApiJson = rawApp.workflowApiJson;
  const workflowFileRef =
    typeof rawApp.workflowFile === "string"
      ? rawApp.workflowFile
      : typeof workflowApiJson === "string"
        ? workflowApiJson
        : "workflow.json";
  if (!workflowApiJson || typeof workflowApiJson === "string") {
    const wfPath = resolve(root, workflowFileRef);
    requireValue(existsSync(wfPath), 400, `未找到工作流文件：${wfPath}`);
    workflowApiJson = JSON.parse(readFileSync(wfPath, "utf8"));
  }

  const candidate: Record<string, unknown> = { ...rawApp, workflowApiJson };
  delete candidate.workflowFile;

  if (!Array.isArray(candidate.inputs) || candidate.inputs.length === 0) {
    const inferred = inferComfyWorkflowSlots(workflowApiJson);
    candidate.inputs = inferred.inputs;
    if (!candidate.kind) candidate.kind = inferred.outputKind;
    if (!candidate.modelKey) candidate.modelKey = inferred.suggestedModelKey;
    if (!Array.isArray(candidate.modelDependencies)) {
      candidate.modelDependencies = inferred.modelDependencies;
    }
  }

  const parsed = microAppSpecSchema.safeParse(candidate);
  requireValue(
    parsed.success,
    400,
    parsed.success
      ? ""
      : "微应用 app.json 校验失败：" +
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("；"),
  );
  const spec = parsed.data;
  const pluginId = spec.slug.startsWith("comfy-") ? spec.slug : `comfy-${spec.slug}`;
  const smokePrompt = spec.smokeTestCase?.prompt || "A cinematic test frame";
  const smoke = applyMicroAppInputs(spec, {
    prompt: smokePrompt,
    params: spec.smokeTestCase?.params ?? {},
  });
  const compiled = packageFile.parse(
    buildMicroAppPackageFile(spec, buildComfyNodeClient(pluginId)),
  );
  const invoke = await loadProgram(compiled.program!);
  const caps = invoke("capabilities", {
    ready: true,
    loaded_model_key: smoke.modelKey,
  }) as { ready_models?: string[] };
  requireValue(
    Array.isArray(caps?.ready_models) && caps.ready_models.includes(spec.slug),
    400,
    "微应用编译后 capabilities 试跑失败",
  );
  const smokeDispatch = invoke("dispatch", {
    kind: spec.kind,
    model: spec.slug,
    view: {},
    attempts: 1,
    assets: {},
    input: {
      prompt: smokePrompt,
      params: spec.smokeTestCase?.params ?? {},
      references: [],
    },
  }) as Record<string, unknown>;
  requireValue(
    smokeDispatch &&
      typeof smokeDispatch.workflow === "object" &&
      smokeDispatch.modelKey === smoke.modelKey,
    400,
    "微应用编译后 dispatch 试跑失败",
  );
  return {
    spec,
    package_file: compiled,
    model_key: smoke.modelKey,
    smoke_dispatch: smokeDispatch,
  };
}

/**
 * F008 + F037 + Q4: Server-side ComfyUI slot analyzer, QuickJS sandbox smoke-tester,
 * and standard versioned `.fmplugin.json` publisher routed through StudioPackages.
 */
export class ComfyMicroAppCompiler {
  constructor(readonly p: Platform) {}

  analyzeWorkflow(user: Actor, workflowApiJson: unknown): InferredWorkflowAnalysis {
    this.p.admin(user);
    try {
      return inferComfyWorkflowSlots(workflowApiJson);
    } catch (err) {
      requireValue(false, 400, (err as Error).message || "工作流解析失败");
      throw err;
    }
  }

  compilePackage(user: Actor, rawSpec: unknown): {
    spec: MicroAppSpec;
    package_file: PackageFile;
    smoke_workflow: Record<string, unknown>;
    model_key: string;
  } {
    this.p.admin(user);
    const parsed = microAppSpecSchema.safeParse(rawSpec);
    requireValue(
      parsed.success,
      400,
      parsed.success
        ? ""
        : "ComfyUI 微应用规范校验失败：" +
            parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("；"),
    );
    const spec = parsed.data;
    const pluginId = spec.slug.startsWith("comfy-")
      ? spec.slug
      : `comfy-${spec.slug}`;
    const smokePrompt = spec.smokeTestCase?.prompt || "A cinematic test frame";
    const smoke = applyMicroAppInputs(spec, {
      prompt: smokePrompt,
      params: spec.smokeTestCase?.params ?? {},
    });
    const nodeClient = buildComfyNodeClient(pluginId);
    const compiled = packageFile.parse(buildMicroAppPackageFile(spec, nodeClient));
    return {
      spec,
      package_file: compiled,
      smoke_workflow: smoke.workflow,
      model_key: smoke.modelKey,
    };
  }

  async publish(
    user: Actor,
    rawSpec: unknown,
    options: { dryRun?: boolean; autoEnable?: boolean } = {},
  ): Promise<ComfyPublishResult> {
    this.p.admin(user);
    const {
      spec,
      package_file: pkg,
      model_key: modelKey,
    } = this.compilePackage(user, rawSpec);

    // Execute QuickJS sandbox smoke test on the compiled NodePoolProgram
    const invoke = await loadProgram(pkg.program!);
    const caps = invoke("capabilities", {
      ready: true,
      loaded_model_key: modelKey,
    }) as { ready_models?: string[] };
    requireValue(
      Array.isArray(caps?.ready_models) && caps.ready_models.includes(spec.slug),
      400,
      "编译后的插件 capabilities 沙箱试跑失败",
    );
    const smokeDispatch = invoke("dispatch", {
      kind: spec.kind,
      model: spec.slug,
      view: {},
      attempts: 1,
      assets: {},
      input: {
        prompt: spec.smokeTestCase?.prompt || "A cinematic test frame",
        params: spec.smokeTestCase?.params ?? {},
        references: [],
      },
    }) as Record<string, unknown>;
    requireValue(
      smokeDispatch &&
        typeof smokeDispatch.workflow === "object" &&
        smokeDispatch.modelKey === modelKey,
      400,
      "编译后的插件 dispatch 沙箱试跑失败",
    );

    const packages = new StudioPackages(this.p);
    // Validate full StudioPackages rules (manifest, nodePoolHooks, settingsPages, sha256)
    await packages.preview(user, pkg);

    if (options.dryRun) {
      return {
        dry_run: true,
        plugin_id: pkg.id,
        version: pkg.version,
        model_id: spec.slug,
        model_key: modelKey,
        smoke_test_passed: true,
        smoke_dispatch: smokeDispatch,
        package_file: pkg,
      };
    }

    const existing = await one(
      this.p.db,
      "SELECT revision FROM studio_packages WHERE id=$1 AND installed",
      [pkg.id],
    );
    const installed = await packages.install(
      user,
      pkg,
      existing ? Number(existing.revision) : undefined,
    );
    if (options.autoEnable) {
      const latest = await one(
        this.p.db,
        "SELECT revision, enabled FROM studio_packages WHERE id=$1 AND installed",
        [pkg.id],
      );
      if (latest && !latest.enabled) {
        await packages.change(user, pkg.id, Number(latest.revision), "enable");
      }
    }
    return {
      dry_run: false,
      plugin_id: pkg.id,
      version: pkg.version,
      model_id: spec.slug,
      model_key: modelKey,
      smoke_test_passed: true,
      smoke_dispatch: smokeDispatch,
      package_file: pkg,
      installed,
    };
  }
}
