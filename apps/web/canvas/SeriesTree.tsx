import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Clapperboard, Film, Plus, Trash2 } from "lucide-react";
import { api, workspaceURL } from "./api";

export type SeriesEpisode = {
  id: string;
  season_no: number;
  episode_no: number;
  title: string;
  status: "draft" | "producing" | "review" | "done";
  canvas_id: string | null;
  revision: number;
  updated: number;
};

export type SeriesItem = {
  id: string;
  title: string;
  synopsis: string;
  bible: Record<string, unknown>;
  revision: number;
  updated: number;
  can_delete: boolean;
  episodes: SeriesEpisode[];
};

const STATUS_LABELS: Record<SeriesEpisode["status"], string> = {
  draft: "草稿",
  producing: "制作中",
  review: "审片中",
  done: "已完片",
};

export function SeriesTree({ workspace }: { workspace: string }) {
  const [seriesList, setSeriesList] = useState<SeriesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [creatingSeries, setCreatingSeries] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSynopsis, setNewSynopsis] = useState("");
  const [addingEpFor, setAddingEpFor] = useState<string | null>(null);
  const [epSeason, setEpSeason] = useState(1);
  const [epNo, setEpNo] = useState(1);
  const [epTitle, setEpTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api<{ series: SeriesItem[] }>(workspace, "/api/series");
      setSeriesList(res.series);
      setExpanded((prev) => {
        if (prev.size > 0 || !res.series.length) return prev;
        return new Set([res.series[0].id]);
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void load();
  }, [load]);

  const createSeries = async () => {
    if (!newTitle.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await api<SeriesItem>(workspace, "/api/series", {
        title: newTitle.trim(),
        synopsis: newSynopsis.trim(),
      });
      setNewTitle("");
      setNewSynopsis("");
      setCreatingSeries(false);
      setExpanded((prev) => new Set([...prev, created.id]));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createEpisode = async (seriesId: string) => {
    if (!epTitle.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await api<SeriesEpisode>(
        workspace,
        `/api/series/${seriesId}/episodes`,
        {
          season_no: epSeason,
          episode_no: epNo,
          title: epTitle.trim(),
        },
      );
      setAddingEpFor(null);
      setEpTitle("");
      if (created.canvas_id) {
        location.assign(workspaceURL("/canvas/" + created.canvas_id, workspace));
      } else {
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const deleteSeries = async (item: SeriesItem) => {
    setBusy(true);
    setError("");
    try {
      await api(workspace, `/api/series/${item.id}`, undefined, "DELETE");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="fm-series-panel" aria-label="多集剧集项目树">
      <div className="fm-series-head">
        <h2>
          <Clapperboard size={18} />
          剧集项目树
        </h2>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setCreatingSeries((v) => !v)}
        >
          <Plus size={15} />
          新建剧集
        </button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {creatingSeries && (
        <div className="fm-series-form">
          <input
            aria-label="剧集名称"
            placeholder="例如：霓虹侦探社"
            maxLength={120}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <textarea
            aria-label="剧集梗概与世界观"
            rows={2}
            maxLength={4000}
            placeholder="填写核心设定与世界观，建分集时自动同步到画布设定便签…"
            value={newSynopsis}
            onChange={(e) => setNewSynopsis(e.target.value)}
          />
          <div className="fm-series-form-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setCreatingSeries(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || !newTitle.trim()}
              onClick={() => void createSeries()}
            >
              创建剧集
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="fm-series-muted">正在加载剧集树…</p>
      ) : seriesList.length === 0 ? (
        <p className="fm-series-muted">
          按「剧集 → 季 → 分集 → 专属画布」管理长片与短剧，每集突破 12 镜限制。
        </p>
      ) : (
        <div className="fm-series-list">
          {seriesList.map((s) => {
            const open = expanded.has(s.id);
            const nextEp =
              (s.episodes.reduce(
                (max, e) => (e.season_no === 1 ? Math.max(max, e.episode_no) : max),
                0,
              ) || 0) + 1;
            return (
              <div key={s.id} className="fm-series-card">
                <div className="fm-series-row">
                  <button
                    type="button"
                    className="fm-series-toggle"
                    aria-expanded={open}
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.id)) next.delete(s.id);
                        else next.add(s.id);
                        return next;
                      })
                    }
                  >
                    {open ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                    <strong>{s.title}</strong>
                    <span>{s.episodes.length} 集</span>
                  </button>
                  <div className="fm-series-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setAddingEpFor(addingEpFor === s.id ? null : s.id);
                        setEpSeason(1);
                        setEpNo(nextEp);
                        setEpTitle(`第 ${nextEp} 集`);
                        setExpanded((prev) => new Set([...prev, s.id]));
                      }}
                    >
                      <Plus size={14} />
                      加一集
                    </button>
                    {s.can_delete && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`删除剧集 ${s.title}`}
                        disabled={busy}
                        onClick={() => void deleteSeries(s)}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {open && (
                  <div className="fm-series-body">
                    {s.synopsis && <p className="fm-series-synopsis">{s.synopsis}</p>}
                    {addingEpFor === s.id && (
                      <div className="fm-ep-form">
                        <label>
                          季
                          <input
                            type="number"
                            min={1}
                            max={99}
                            value={epSeason}
                            onChange={(e) =>
                              setEpSeason(Math.max(1, Number(e.target.value) || 1))
                            }
                          />
                        </label>
                        <label>
                          集
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={epNo}
                            onChange={(e) =>
                              setEpNo(Math.max(1, Number(e.target.value) || 1))
                            }
                          />
                        </label>
                        <input
                          aria-label="分集标题"
                          placeholder="分集标题"
                          maxLength={120}
                          value={epTitle}
                          onChange={(e) => setEpTitle(e.target.value)}
                        />
                        <button
                          type="button"
                          className="primary"
                          disabled={busy || !epTitle.trim()}
                          onClick={() => void createEpisode(s.id)}
                        >
                          创建并打开画布
                        </button>
                      </div>
                    )}
                    {s.episodes.length === 0 ? (
                      <p className="fm-series-muted">暂无分集，点击「加一集」自动建绑定画布。</p>
                    ) : (
                      <ul className="fm-ep-list">
                        {s.episodes.map((ep) => (
                          <li key={ep.id}>
                            {ep.canvas_id ? (
                              <a
                                href={workspaceURL(
                                  "/canvas/" + ep.canvas_id,
                                  workspace,
                                )}
                              >
                                <Film size={14} />
                                <span>
                                  S{String(ep.season_no).padStart(2, "0")}E
                                  {String(ep.episode_no).padStart(2, "0")} ·{" "}
                                  {ep.title}
                                </span>
                                <small>{STATUS_LABELS[ep.status]}</small>
                              </a>
                            ) : (
                              <span>
                                S{String(ep.season_no).padStart(2, "0")}E
                                {String(ep.episode_no).padStart(2, "0")} ·{" "}
                                {ep.title}（无画布）
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
