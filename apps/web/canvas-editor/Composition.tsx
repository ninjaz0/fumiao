import { useEffect, useState } from "react";
import { Download, Film, Package } from "lucide-react";
import { api, ApiError } from "./api";

type Exporter = {
  key: string;
  title: string;
  output_kind?: "composition" | "project";
  file_extension?: "mp4" | "zip" | "fcpxml";
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
};

function exportDownloadLabel(r: Result): string {
  if (r.output_kind !== "project") return "MP4";
  if (r.exporter?.startsWith("jianying-exporter/")) return "剪映草稿 ZIP";
  if (r.output_mime === "application/xml") return "FCPXML";
  if (r.exporter?.startsWith("fcpxml-exporter/")) return "FCPXML 工程包";
  return "工程包 ZIP";
}

export function Composition({
  project,
  getRevision,
  ready,
  waitingReason,
}: {
  project: string;
  getRevision: () => Promise<number>;
  ready: boolean;
  waitingReason: string;
}) {
  const [results, setResults] = useState<Result[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pollError, setPollError] = useState(""),
    [preview, setPreview] = useState<string | null>(null);
  const [exporters, setExporters] = useState<Exporter[] | undefined>(),
    [selected, select] = useState("");
  const chosen =
    exporters?.find((x) => x.key === selected) ??
    exporters?.find((x) => x.key === "storyboard/mp4") ??
    exporters?.[0];
  const isProjectExporter = chosen?.output_kind === "project";
  const load = async () => {
    const data = await api<{ exports: Result[]; exporters?: Exporter[] }>(
      `/api/canvases/${project}/exports`,
    );
    setResults(data.exports);
  };
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const data = await api<{ exports: Result[]; exporters?: Exporter[] }>(
          `/api/canvases/${project}/exports`,
        );
        if (active) {
          setResults(data.exports);
          setExporters(data.exporters);
          setPollError("");
        }
      } catch (e) {
        if (active) setPollError((e as Error).message);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [project]);
  const pending = results.some((r) => ["queued", "running"].includes(r.state));
  const submit = async () => {
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
        };
        localStorage.setItem(key, JSON.stringify(body));
      }
      try {
        await api(`/api/canvases/${project}/exports`, body);
        localStorage.removeItem(key);
      } catch (e) {
        if (e instanceof ApiError && e.status < 500)
          localStorage.removeItem(key);
        throw e;
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="shot-composition" aria-label="成片预览与导出">
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
      <div className="composition-heading">
        <h3>成片</h3>
        <button
          className="primary"
          disabled={busy || pending || !ready || exporters?.length === 0}
          onClick={() => void submit()}
        >
          {isProjectExporter ? <Package size={16} /> : <Film size={16} />}
          {pending
            ? isProjectExporter
              ? "打包中…"
              : "合成中…"
            : busy
              ? "提交中…"
              : isProjectExporter
                ? "打包导出"
                : "合成预览"}
        </button>
      </div>
      <p>
        {isProjectExporter
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
                    <a
                      className="secondary"
                      href={"/media/" + r.result + "?download=true"}
                    >
                      <Download size={15} />
                      {exportDownloadLabel(r)}
                    </a>
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
