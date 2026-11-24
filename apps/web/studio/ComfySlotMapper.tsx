import { useState } from "react";
import {
  inferComfyWorkflowSlots,
  type MicroAppInput,
  type ModelDependency,
} from "@fumiao/plugin-sdk/comfy-microapp";
import { api } from "./api";

const SAMPLE_COMFY_WORKFLOW = {
  "1": {
    class_type: "CheckpointLoaderSimple",
    inputs: { ckpt_name: "flux1-dev-fp8.safetensors" },
    _meta: { title: "加载主模型" },
  },
  "2": {
    class_type: "CLIPTextEncode",
    inputs: { text: "cinematic neon cyberpunk street at night", clip: ["1", 1] },
    _meta: { title: "正向提示词" },
  },
  "3": {
    class_type: "CLIPTextEncode",
    inputs: { text: "blurry, watermark, lowres", clip: ["1", 1] },
    _meta: { title: "负向提示词" },
  },
  "4": {
    class_type: "EmptyLatentImage",
    inputs: { width: 1024, height: 576, batch_size: 1 },
  },
  "5": {
    class_type: "KSampler",
    inputs: {
      model: ["1", 0],
      positive: ["2", 0],
      negative: ["3", 0],
      latent_image: ["4", 0],
      seed: 42,
      steps: 24,
      cfg: 3.5,
    },
  },
  "6": {
    class_type: "VAEDecode",
    inputs: { samples: ["5", 0], vae: ["1", 2] },
  },
  "7": {
    class_type: "SaveImage",
    inputs: { images: ["6", 0], filename_prefix: "fumiao_flux" },
  },
};

type PublishResponse = {
  dry_run: boolean;
  plugin_id: string;
  version: string;
  model_id: string;
  model_key: string;
  smoke_test_passed: boolean;
  package_file: Record<string, unknown>;
};

export function ComfySlotMapper({
  onPublished,
  onClose,
}: {
  onPublished: () => Promise<void>;
  onClose: () => void;
}) {
  const [rawJson, setRawJson] = useState("");
  const [workflowObj, setWorkflowObj] = useState<Record<string, unknown> | null>(
    null,
  );
  const [slug, setSlug] = useState("flux-cinema");
  const [version, setVersion] = useState("1.0.0");
  const [name, setName] = useState("Flux 电影感工作流");
  const [description, setDescription] = useState(
    "通过 ComfyUI API JSON 零代码编译发布的节点池微应用",
  );
  const [kind, setKind] = useState<"image" | "video" | "audio">("image");
  const [modelKey, setModelKey] = useState("");
  const [peakVramGb, setPeakVramGb] = useState(16);
  const [credits, setCredits] = useState(2);
  const [inputs, setInputs] = useState<MicroAppInput[]>([]);
  const [deps, setDeps] = useState<ModelDependency[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [smokePrompt, setSmokePrompt] = useState(
    "A dramatic golden-hour tracking shot in Tokyo",
  );
  const [compiledPkg, setCompiledPkg] = useState<Record<string, unknown> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  function analyzeText(text: string) {
    setError("");
    setStatus("");
    setCompiledPkg(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError("JSON 格式无效，请粘贴 ComfyUI API 格式工作流或 app.json");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError("顶层必须是 JSON 对象");
      return;
    }
    const obj = parsed as Record<string, unknown>;
    // Support pasting/uploading a full F037 `app.json` spec directly (preserving declared slots verbatim!)
    if (obj.schemaVersion === 1 && obj.workflowApiJson && Array.isArray(obj.inputs)) {
      setWorkflowObj(obj.workflowApiJson as Record<string, unknown>);
      if (typeof obj.slug === "string") setSlug(obj.slug);
      if (typeof obj.version === "string") setVersion(obj.version);
      if (typeof obj.name === "string") setName(obj.name);
      if (typeof obj.description === "string") setDescription(obj.description);
      if (obj.kind === "image" || obj.kind === "video" || obj.kind === "audio") {
        setKind(obj.kind);
      }
      if (typeof obj.modelKey === "string") setModelKey(obj.modelKey);
      if (typeof obj.peakVramGb === "number") setPeakVramGb(obj.peakVramGb);
      if (typeof obj.credits === "number") setCredits(obj.credits);
      if (
        obj.smokeTestCase &&
        typeof obj.smokeTestCase === "object" &&
        typeof (obj.smokeTestCase as { prompt?: unknown }).prompt === "string"
      ) {
        setSmokePrompt((obj.smokeTestCase as { prompt: string }).prompt);
      }
      setInputs(obj.inputs as MicroAppInput[]);
      setDeps(
        Array.isArray(obj.modelDependencies)
          ? (obj.modelDependencies as ModelDependency[])
          : [],
      );
      setWarnings([]);
      setStatus(
        `已按 app.json 声明绑定 ${obj.inputs.length} 个槽位（${String(obj.slug || "")}@${String(obj.version || "1.0.0")}），可直接试跑或发布。`,
      );
      return;
    }

    try {
      const analysis = inferComfyWorkflowSlots(obj);
      setWorkflowObj(obj);
      setKind(analysis.outputKind);
      setInputs(analysis.inputs);
      setDeps(analysis.modelDependencies);
      setWarnings(analysis.warnings);
      setModelKey(analysis.suggestedModelKey);
      setStatus(
        `反向图推理完成：检测到 ${analysis.inputs.length} 个可映射槽位、${analysis.modelDependencies.length} 个模型权重依赖（输出类型：${analysis.outputKind}）。`,
      );
    } catch (err) {
      setError((err as Error).message || "工作流解析失败");
    }
  }

  function buildSpec() {
    if (!workflowObj) {
      throw new Error("请先导入并解析 ComfyUI API JSON 工作流");
    }
    if (!inputs.length) {
      throw new Error("请至少保留 1 个输入槽位映射");
    }
    return {
      schemaVersion: 1,
      slug: slug.trim(),
      version: version.trim(),
      name: name.trim(),
      description: description.trim(),
      kind,
      ...(modelKey.trim() ? { modelKey: modelKey.trim() } : {}),
      peakVramGb: Number(peakVramGb) || 16,
      credits: Math.max(0, Math.round(Number(credits) || 0)),
      workflowApiJson: workflowObj,
      inputs,
      modelDependencies: deps,
      smokeTestCase: {
        prompt: smokePrompt.trim() || "A cinematic test frame",
      },
    };
  }

  async function submitPublish(dryRun: boolean) {
    setError("");
    setStatus("");
    let spec: Record<string, unknown>;
    try {
      spec = buildSpec();
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setBusy(true);
    try {
      const res = await api<PublishResponse>(
        null,
        "/api/admin/comfy/publish",
        {
          spec,
          dry_run: dryRun,
          auto_enable: !dryRun,
        },
        "POST",
      );
      setCompiledPkg(res.package_file);
      if (dryRun) {
        setStatus(
          `沙箱试跑通过！已编译标准插件 ${res.plugin_id}@${res.version}（显存路由键：${res.model_key}），可一键发布或下载 .fmplugin.json。`,
        );
      } else {
        setStatus(
          `发布成功！已将 ${res.plugin_id}@${res.version} 编译签发为标准插件并自动启用。`,
        );
        await onPublished();
      }
    } catch (err) {
      setError((err as Error).message || "编译发布失败");
    } finally {
      setBusy(false);
    }
  }

  function downloadPackage() {
    if (!compiledPkg) return;
    const blob = new Blob([JSON.stringify(compiledPkg, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${String(compiledPkg.id || slug)}.fmplugin.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      className="ledger-card plugin-overview plugin-form"
      aria-label="ComfyUI 工作流可视化映射与发布器"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>
            ComfyUI 工作流槽位映射器 &amp; app.json 微应用编译器
          </h3>
          <p className="plugin-section-desc" style={{ marginTop: 4 }}>
            导入 ComfyUI API JSON 或声明式 app.json，自动推断提示词/参考图/采样器槽位与显存模型键，试跑通过后编译签发为标准版本化{" "}
            <code>.fmplugin.json</code> 插件包（自动内置跨工作流{" "}
            <code>POST /free</code> 显存保护）。
          </p>
        </div>
        <button type="button" onClick={onClose}>
          收起
        </button>
      </div>

      <div className="plugin-field">
        <div className="plugin-field-head">
          <label htmlFor="comfy-workflow-json">
            步骤 1 · 导入 ComfyUI API JSON 或 app.json
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                const sample = JSON.stringify(SAMPLE_COMFY_WORKFLOW, null, 2);
                setRawJson(sample);
                analyzeText(sample);
              }}
            >
              加载 Flux 示例工作流
            </button>
            <label
              style={{
                cursor: "pointer",
                padding: "4px 10px",
                border: "1px solid currentColor",
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              选择 JSON 文件（支持同时选 app.json + workflow.json）
              <input
                type="file"
                accept=".json,application/json"
                multiple
                hidden
                onChange={async (e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (!files.length) return;
                  if (files.length === 1) {
                    const text = await files[0].text();
                    setRawJson(text);
                    analyzeText(text);
                    return;
                  }
                  const parsedFiles = await Promise.all(
                    files.map(async (f) => ({
                      name: f.name.toLowerCase(),
                      text: await f.text(),
                    })),
                  );
                  const appEntry = parsedFiles.find((f) => f.name.includes("app"));
                  const wfEntry = parsedFiles.find((f) => f !== appEntry);
                  if (appEntry && wfEntry) {
                    try {
                      const appObj = JSON.parse(appEntry.text) as Record<string, unknown>;
                      const wfObj = JSON.parse(wfEntry.text) as Record<string, unknown>;
                      const merged = JSON.stringify(
                        { ...appObj, workflowApiJson: wfObj },
                        null,
                        2,
                      );
                      setRawJson(merged);
                      analyzeText(merged);
                      return;
                    } catch {
                      // Fall through to normal error reporting
                    }
                  }
                  setRawJson(parsedFiles[0].text);
                  analyzeText(parsedFiles[0].text);
                }}
              />
            </label>
          </div>
        </div>
        <textarea
          id="comfy-workflow-json"
          rows={6}
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
          placeholder='粘贴 ComfyUI 导出的 API Format JSON（如 {"1": {"class_type": "KSampler", ...}}）或声明式 app.json'
          style={{ fontFamily: "monospace", fontSize: 12 }}
        />
        <div className="plugin-form-actions">
          <button
            type="button"
            className="console-primary"
            onClick={() => analyzeText(rawJson)}
          >
            自动推断输入槽位与模型依赖
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="plugin-feedback" role="status">
          {warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}

      {workflowObj && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: 10,
            }}
          >
            <div className="plugin-field">
              <label htmlFor="comfy-name">模型显示名称</label>
              <input
                id="comfy-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="plugin-field">
              <label htmlFor="comfy-slug">模型标识 (slug)</label>
              <input
                id="comfy-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="flux-cinema"
              />
            </div>
            <div className="plugin-field">
              <label htmlFor="comfy-version">语义版本号</label>
              <input
                id="comfy-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            </div>
            <div className="plugin-field">
              <label htmlFor="comfy-kind">输出类型</label>
              <select
                id="comfy-kind"
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as "image" | "video" | "audio")
                }
              >
                <option value="image">图片 (image)</option>
                <option value="video">视频 (video)</option>
                <option value="audio">音频 (audio)</option>
              </select>
            </div>
            <div className="plugin-field">
              <label htmlFor="comfy-credits">单次消耗积分</label>
              <input
                id="comfy-credits"
                type="number"
                min={0}
                value={credits}
                onChange={(e) => setCredits(Number(e.target.value))}
              />
            </div>
            <div className="plugin-field">
              <label htmlFor="comfy-vram">显存峰值 (GB)</label>
              <input
                id="comfy-vram"
                type="number"
                min={1}
                value={peakVramGb}
                onChange={(e) => setPeakVramGb(Number(e.target.value))}
              />
            </div>
            <div className="plugin-field">
              <label htmlFor="comfy-model-key">
                显存路由键 (跨工作流 /free 切换依据)
              </label>
              <input
                id="comfy-model-key"
                value={modelKey}
                onChange={(e) => setModelKey(e.target.value)}
                placeholder="flux1-dev-fp8"
              />
            </div>
          </div>

          <div className="plugin-field">
            <label htmlFor="comfy-desc">功能说明</label>
            <input
              id="comfy-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="plugin-field">
            <div className="plugin-field-head">
              <strong>步骤 2 · 已映射输入槽位（{inputs.length}）</strong>
              <button
                type="button"
                onClick={() =>
                  setInputs((prev) => [
                    ...prev,
                    {
                      key: `param_${prev.length + 1}`,
                      label: `自定义参数 ${prev.length + 1}`,
                      type: "text",
                      required: false,
                      bind: [{ nodeId: "1", inputKey: "text" }],
                    },
                  ])
                }
              >
                + 新增槽位
              </button>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {inputs.map((inp, idx) => (
                <div
                  key={`${inp.key}-${idx}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 120px 1fr auto",
                    gap: 8,
                    alignItems: "center",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(128,128,128,0.22)",
                  }}
                >
                  <input
                    aria-label="槽位标识"
                    value={inp.key}
                    onChange={(e) =>
                      setInputs((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, key: e.target.value } : item,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label="表单显示标签"
                    value={inp.label}
                    onChange={(e) =>
                      setInputs((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, label: e.target.value } : item,
                        ),
                      )
                    }
                  />
                  <select
                    aria-label="槽位类型"
                    value={inp.type}
                    onChange={(e) =>
                      setInputs((prev) =>
                        prev.map((item, i) =>
                          i === idx
                            ? {
                                ...item,
                                type: e.target.value as MicroAppInput["type"],
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="prompt">正向提示词</option>
                    <option value="negative_prompt">负向提示词</option>
                    <option value="image">参考图</option>
                    <option value="video">参考视频</option>
                    <option value="audio">参考音频</option>
                    <option value="seed">随机种子</option>
                    <option value="integer">整数</option>
                    <option value="number">浮点数</option>
                    <option value="boolean">开关</option>
                    <option value="select">下拉选项</option>
                    <option value="text">文本</option>
                  </select>
                  <small style={{ opacity: 0.85, fontFamily: "monospace" }}>
                    {inp.bind
                      .map(
                        (b) =>
                          `#${b.nodeId}.${b.inputKey}${b.template ? ` (${b.template})` : ""}`,
                      )
                      .join(", ")}
                  </small>
                  <button
                    type="button"
                    onClick={() =>
                      setInputs((prev) => prev.filter((_, i) => i !== idx))
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          </div>

          {deps.length > 0 && (
            <div className="plugin-field">
              <strong>模型权重依赖清单（{deps.length}）</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12 }}>
                {deps.map((d, i) => (
                  <li key={`${d.nodeId}-${d.filename}-${i}`}>
                    <code>#{d.nodeId}</code> · {d.loader} →{" "}
                    <code>{d.filename}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="plugin-field">
            <label htmlFor="comfy-smoke">步骤 3 · 沙箱冒烟测试提示词</label>
            <input
              id="comfy-smoke"
              value={smokePrompt}
              onChange={(e) => setSmokePrompt(e.target.value)}
            />
          </div>

          <div className="plugin-form-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitPublish(true)}
            >
              {busy ? "校验中…" : "试跑校验 (Dry-Run)"}
            </button>
            <button
              type="button"
              className="console-primary"
              disabled={busy}
              onClick={() => void submitPublish(false)}
            >
              {busy ? "编译发布中…" : "编译并发布到插件库"}
            </button>
            {compiledPkg && (
              <button type="button" onClick={downloadPackage}>
                下载 .fmplugin.json
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <p className="plugin-feedback is-error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="plugin-feedback" role="status">
          {status}
        </p>
      )}
    </section>
  );
}
