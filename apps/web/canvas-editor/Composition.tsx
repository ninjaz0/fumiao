import { useEffect, useRef, useState } from "react";
import { Download, Film, Music, Package, Sparkles } from "lucide-react";
import { mediaDownloadFilename } from "@fumiao/plugin-sdk/media-filename";
import { directorExportAssetBusy, directorLocalScriptDraft, directorScriptConflict } from "@fumiao/web-compat/director.js";
import { api, ApiError } from "./api";
import type { CanvasBgm } from "./types";

type Exporter = {
  key: string;
  title: string;
  output_kind?: "composition" | "project";
  file_extension?: "mp4" | "zip" | "fcpxml" | "edl";
};
type Result = {
  id: string;
  state: string;
  result: string | null;
  error: string;
  revision: number;
  created: number;
  exporter?: string;
  output_kind?: "composition" | "project";
  output_mime?: string;
  output_filename?: string | null;
  scope?: "canvas" | "episode";
};

type EpisodeSubmission = {
  uid: string;
  scope: "episode";
  expected_revision: number;
  script_revision: number;
  use_confirmed_script: boolean;
};

function readEpisodeSubmission(key: string): EpisodeSubmission | null {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null");
    return stored?.scope === "episode" && typeof stored.uid === "string" ? stored : null;
  } catch {
    return null;
  }
}

function exportDownloadLabel(r: Partial<Result>): string {
  if (r.output_kind !== "project") return "MP4";
  if (r.exporter?.startsWith("jianying-exporter/")) return "剪映草稿 ZIP";
  if (r.output_filename?.endsWith(".edl") || r.exporter?.includes("edl"))
    return "EDL";
  if (r.output_mime === "application/xml") return "FCPXML";
  if (r.exporter?.startsWith("fcpxml-exporter/")) return "FCPXML 工程包";
  return "工程包 ZIP";
}

export function compositionDownloadFilename(r: {
  result: string;
  output_kind?: "composition" | "project";
  output_mime?: string;
  output_filename?: string | null;
}): string {
  const cleaned =
    typeof r.output_filename === "string"
      ? r.output_filename.replace(/[\r\n\0"/\\]/g, "").trim()
      : "";
  if (cleaned) return cleaned;
  const mime =
    r.output_mime || (r.output_kind === "project" ? undefined : "video/mp4");
  return mediaDownloadFilename(r.result, mime);
}

export function CompositionDownloadLink({
  result,
  exportResult,
}: {
  result: string;
  exportResult?: Result;
}) {
  const filename = compositionDownloadFilename(
    exportResult
      ? { ...exportResult, result }
      : {
          result,
          output_kind: "composition",
          output_mime: "video/mp4",
        },
  );
  return (
    <a
      className="secondary"
      href={"/media/" + result + "?download=true"}
      download={filename || true}
    >
      <Download size={15} />
      {exportResult ? exportDownloadLabel(exportResult) : "MP4"}
    </a>
  );
}

export function Composition({
  project,
  scope = "canvas",
  episode,
  active = true,
  getRevision,
  ready,
  waitingReason,
  audioAssets,
  bgm,
  loudnorm,
  defaultBgmPrompt = "",
  bgmModels = [],
  bgmGenerating = false,
  onGenerateBgm,
  onMixChange,
}: {
  project: string;
  scope?: "canvas" | "episode";
  episode?: { account: string; scriptRevision: number; hasLocalScriptEdits: () => boolean; readScriptRevision: () => Promise<number> };
  active?: boolean;
  getRevision: () => Promise<number>;
  ready: boolean;
  waitingReason: string;
  audioAssets?: { id: string; label: string }[];
  bgm?: CanvasBgm | null;
  loudnorm?: boolean;
  defaultBgmPrompt?: string;
  bgmModels?: { id: string; label: string }[];
  bgmGenerating?: boolean;
  onGenerateBgm?: (opts: { prompt: string; model?: string }) => Promise<void>;
  onMixChange?: (patch: { bgm?: CanvasBgm | null; loudnorm?: boolean }) => void;
}) {
  const [results, setResults] = useState<Result[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pollError, setPollError] = useState(""),
    [preview, setPreview] = useState<string | null>(null);
  const [bgmPrompt, setBgmPrompt] = useState(defaultBgmPrompt);
  const [bgmModel, setBgmModel] = useState(bgmModels[0]?.id ?? "");
  const [bgmBusy, setBgmBusy] = useState(false);
  const [bgmNotice, setBgmNotice] = useState("");
  useEffect(() => {
    if (!bgmPrompt && defaultBgmPrompt) setBgmPrompt(defaultBgmPrompt);
  }, [defaultBgmPrompt]);
  useEffect(() => {
    if (!bgmModel && bgmModels.length) setBgmModel(bgmModels[0].id);
  }, [bgmModels]);
  const [exporters, setExporters] = useState<Exporter[] | undefined>(),
    [selected, select] = useState("");
  const reload = useRef<(() => Promise<void>) | null>(null);
  const submitting = useRef(false);
  const [recoverEpisode, setRecoverEpisode] = useState(false);
  const [staleScript, setStaleScript] = useState<number>();
  const episodeKey = `fm-compose-episode:${episode?.account}:${project}`;
  useEffect(() => {
    if (scope !== "episode" || !active) return;
    const inspect = () => setRecoverEpisode(Boolean(readEpisodeSubmission(episodeKey)));
    inspect();
    window.addEventListener("storage", inspect);
    return () => window.removeEventListener("storage", inspect);
  }, [scope, active, episodeKey]);
  const chosen =
    exporters?.find((x) => x.key === selected) ??
    exporters?.find((x) => x.key === "storyboard/mp4") ??
    exporters?.[0];
  const isProjectExporter = chosen?.output_kind === "project";
  const showConfirmedScript = Boolean(episode && staleScript === episode.scriptRevision);
  const path = `/api/canvases/${project}/exports`;
  useEffect(() => {
    if (!active) return;
    let alive = true,
      requested = 0,
      applied = 0;
    const load = async () => {
      if (!alive) return;
      const request = ++requested;
      try {
        const data = await api<{ exports: Result[]; exporters?: Exporter[] }>(
          `${path}?scope=${scope}`,
        );
        if (!alive || request < applied) return;
        applied = request;
        setResults(data.exports.filter((result) => (result.scope ?? "canvas") === scope));
        setExporters(data.exporters);
        setPollError("");
      } catch (e) {
        if (!alive || request < applied) return;
        applied = request;
        setPollError((e as Error).message);
      }
    };
    reload.current = load;
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      reload.current = null;
      clearInterval(timer);
    };
  }, [path, scope, active]);
  const pending = results.some((r) => ["queued", "running"].includes(r.state));
  const submitEpisode = async (useConfirmedScript: boolean, recover: boolean) => {
    if (!episode || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const send = async () => {
      let body = readEpisodeSubmission(episodeKey);
      if (!body) {
        if (recover) return;
        const expected_revision = await getRevision();
        const script_revision = episode.scriptRevision;
        const current = await episode.readScriptRevision();
        const localEdits = episode.hasLocalScriptEdits();
        if ((current > script_revision || localEdits) && !useConfirmedScript) {
          setStaleScript(script_revision);
          throw new Error(localEdits ? directorLocalScriptDraft : directorScriptConflict);
        }
        body = { uid: crypto.randomUUID(), scope: "episode", expected_revision, script_revision, use_confirmed_script: useConfirmedScript };
        localStorage.setItem(episodeKey, JSON.stringify(body));
        setRecoverEpisode(true);
      }
      const clear = () => {
        if (readEpisodeSubmission(episodeKey)?.uid === body.uid) localStorage.removeItem(episodeKey);
        setRecoverEpisode(Boolean(readEpisodeSubmission(episodeKey)));
      };
      try {
        const receipt = await api<Result>(path, body);
        if (!receipt.id || receipt.scope !== "episode") throw new Error("未收到完整合成回执，请恢复本集合成提交。");
        clear();
        setStaleScript(undefined);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status < 500 && cause.status !== 408 &&
          !(cause.status === 409 && cause.message === directorExportAssetBusy)) {
          clear();
          if (cause.message === directorScriptConflict) setStaleScript(body.script_revision);
        }
        throw cause;
      }
    };
    try {
      if (navigator.locks) await navigator.locks.request(episodeKey, send);
      else await send();
      await reload.current?.();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const submitCanvas = async () => {
    const refresh = reload.current;
    setBusy(true);
    setError("");
    setPollError("");
    const key = "fm-compose-" + project + "-" + (chosen?.key || "default");
    try {
      const revision = await getRevision();
      let body;
      try {
        body = JSON.parse(localStorage.getItem(key) || "null");
      } catch {}
      if (!body) {
        body = {
          uid: crypto.randomUUID(),
          expected_revision: revision,
          ...(chosen ? { exporter: chosen.key } : {}),
          ...(bgm?.asset_id
            ? {
                bgm_asset: bgm.asset_id,
                bgm_volume: bgm.volume,
                bgm_ducking: bgm.ducking,
              }
            : {}),
          ...(loudnorm !== undefined ? { loudnorm } : {}),
        };
        localStorage.setItem(key, JSON.stringify(body));
      }
      try {
        await api(path, body);
        localStorage.removeItem(key);
      } catch (e) {
        if (e instanceof ApiError && e.status < 500)
          localStorage.removeItem(key);
        throw e;
      }
      await refresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const episodeTitle = scope === "episode";
  return (
    <section className="shot-composition" aria-label={episodeTitle ? "本集成片预览与导出" : "全画布成片预览与导出"}>
      {exporters && exporters.length > 1 && (
        <label className="composition-exporter-select">
          导出格式{" "}
          <select
            aria-label="导出器"
            value={chosen?.key}
            onChange={(e) => select(e.target.value)}
          >
            {exporters.map((x) => (
              <option key={x.key} value={x.key}>
                {x.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {onMixChange && (
        <div className="composition-mix-box">
          <label>
            <Music size={14} />
            背景音乐 (BGM)
            <select
              aria-label="背景音乐"
              value={bgm?.asset_id || ""}
              onChange={(e) => {
                const asset_id = e.target.value || null;
                onMixChange({
                  bgm: asset_id
                    ? {
                        asset_id,
                        volume: bgm?.volume ?? 0.35,
                        ducking: bgm?.ducking ?? true,
                        loop: bgm?.loop ?? true,
                      }
                    : null,
                });
              }}
            >
              <option value="">不使用背景音乐</option>
              {(audioAssets ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          {onGenerateBgm && (
            <div className="composition-bgm-gen" aria-label="AI 视频驱动配乐生成">
              <input
                type="text"
                className="fm-bgm-input"
                aria-label="AI 配乐风格与情绪描述"
                maxLength={300}
                value={bgmPrompt}
                placeholder="输入配乐风格、乐器与情绪（默认结合当前分镜生成）"
                onChange={(e) => setBgmPrompt(e.target.value)}
              />
              {bgmModels.length > 0 && (
                <select
                  className="fm-bgm-select"
                  aria-label="AI 配乐引擎"
                  value={bgmModel}
                  onChange={(e) => setBgmModel(e.target.value)}
                >
                  {bgmModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="secondary fm-bgm-btn"
                disabled={bgmBusy || bgmGenerating || !bgmPrompt.trim() || !bgmModels.length}
                onClick={async () => {
                  setBgmBusy(true);
                  setError("");
                  setBgmNotice("");
                  try {
                    await onGenerateBgm({
                      prompt: bgmPrompt.trim(),
                      ...(bgmModel ? { model: bgmModel } : {}),
                    });
                    setBgmNotice("已提交 AI 配乐生成，完成后将自动挂载到背景音乐轨");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBgmBusy(false);
                  }
                }}
              >
                <Sparkles size={14} />
                {bgmBusy || bgmGenerating ? "配乐生成中…" : "AI 生成配乐并挂载"}
              </button>
              {!bgmModels.length && (
                <small>请管理员在「设置 → 插件」启用 BGM 配乐插件（如 bgm-generator）后使用。</small>
              )}
              {bgmNotice && <small role="status">{bgmNotice}</small>}
            </div>
          )}
          {bgm?.asset_id && (
            <>
              <label>
                BGM 音量 {Math.round((bgm.volume ?? 0.35) * 100)}%
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={bgm.volume ?? 0.35}
                  onChange={(e) =>
                    onMixChange({
                      bgm: { ...bgm, volume: Number(e.target.value) },
                    })
                  }
                />
              </label>
              <label className="composition-mix-check">
                <input
                  type="checkbox"
                  checked={bgm.ducking !== false}
                  onChange={(e) =>
                    onMixChange({
                      bgm: { ...bgm, ducking: e.target.checked },
                    })
                  }
                />
                旁白/对白自动闪避 BGM（Auto-Ducking）
              </label>
            </>
          )}
          <label className="composition-mix-check">
            <input
              type="checkbox"
              checked={Boolean(loudnorm ?? bgm?.asset_id)}
              onChange={(e) => onMixChange({ loudnorm: e.target.checked })}
            />
            广播级响度归一化（-14 LUFS）
          </label>
        </div>
      )}
      <div className="composition-heading">
        <h3>{episodeTitle ? "本集成片" : "全画布成片"}</h3>
        <button
          type="button"
          className="primary"
          disabled={busy || (!recoverEpisode && (pending || !ready || exporters?.length === 0))}
          onClick={() => episodeTitle ? void submitEpisode(showConfirmedScript, recoverEpisode) : void submitCanvas()}
        >
          {isProjectExporter ? <Package size={16} /> : <Film size={16} />}
          {busy ? "提交中…" : recoverEpisode ? "恢复本集合成提交" : pending
            ? isProjectExporter
              ? "打包中…"
              : "合成中…"
            : isProjectExporter
                ? "打包导出"
                : episodeTitle ? (showConfirmedScript ? `合成已确认剧本版本 ${episode?.scriptRevision}` : "合成本集") : "合成预览"}
        </button>
      </div>
      <p>
        {episodeTitle ? "按本集片单使用已采用视频合成 MP4，最多 30 镜、5 分钟。" : isProjectExporter
          ? "按精准素材时长打包 NLE 工程文件与相对路径媒体，解压后可直接拖入剪映专业版、Final Cut Pro 或达芬奇继续精剪。"
          : "旁白替换对应镜头的原音轨，较长的旁白会延长尾帧停留。字幕按句分配时间，可下载调整。"}
      </p>
      {exporters?.length === 0 && (
        <p role="status">请管理员在设置中安装并启用画布导出器。</p>
      )}
      {!ready && waitingReason && <p role="status">{waitingReason}</p>}
      {(error || pollError) && (
        <p className="error" role="alert">
          {error || pollError}
        </p>
      )}
      <div className="composition-results">
        {results.slice(0, 5).map((r) => {
          const isProject = r.output_kind === "project";
          return (
            <div key={r.id}>
              <div className="composition-result">
                <span>
                  {new Date(r.created * 1000).toLocaleString()}
                  <small>版本 {r.revision}</small>
                </span>
                {r.state === "done" && r.result ? (
                  <>
                    {!isProject && (
                      <button
                        className="secondary"
                        onClick={() =>
                          setPreview(preview === r.id ? null : r.id)
                        }
                      >
                        {preview === r.id ? "收起预览" : "预览"}
                      </button>
                    )}
                    <CompositionDownloadLink
                      result={r.result}
                      exportResult={r}
                    />
                    {!isProject && (
                      <a
                        className="secondary"
                        href={"/api/storyboard-exports/" + r.id + "/subtitles"}
                      >
                        字幕 SRT
                      </a>
                    )}
                  </>
                ) : (
                  <span>
                    {r.state === "queued"
                      ? isProject
                        ? "等待打包"
                        : "等待合成"
                      : r.state === "running"
                        ? isProject
                          ? "正在打包"
                          : "正在合成"
                        : r.state === "failed"
                          ? r.error
                          : "导出文件已删除"}
                  </span>
                )}
              </div>
              {!isProject && preview === r.id && r.result && (
                <video
                  className="composition-preview"
                  src={"/media/" + r.result}
                  controls
                  playsInline
                >
                  <track
                    kind="captions"
                    label="旁白字幕"
                    srcLang="zh"
                    src={
                      "/api/storyboard-exports/" +
                      r.id +
                      "/subtitles?format=vtt"
                    }
                    default
                  />
                </video>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
