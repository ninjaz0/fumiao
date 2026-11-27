import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Film,
  FolderOpen,
  Layers,
  Plus,
  Trash2,
} from "lucide-react";
import { api, workspaceURL } from "./api";

export type SeriesScene = {
  id: string;
  scene_no: number;
  title: string;
  summary: string;
  canvas_id: string | null;
  group_node_id: string | null;
};

export type SeriesEpisode = {
  id: string;
  season_no: number;
  episode_no: number;
  title: string;
  status: "draft" | "producing" | "review" | "done";
  canvas_id: string | null;
  revision: number;
  updated: number;
  scenes?: SeriesScene[];
};

export type SeriesSeason = {
  season_no: number;
  label: string;
  episode_count: number;
  scene_count: number;
  episodes: SeriesEpisode[];
};

export type SeriesItem = {
  id: string;
  title: string;
  synopsis: string;
  bible: Record<string, unknown>;
  revision: number;
  updated: number;
  can_delete: boolean;
  seasons?: SeriesSeason[];
  episodes: SeriesEpisode[];
};

const STATUS_LABELS: Record<SeriesEpisode["status"], string> = {
  draft: "草稿",
  producing: "制作中",
  review: "审片中",
  done: "已完片",
};

function groupEpisodesBySeason(item: SeriesItem): SeriesSeason[] {
  if (item.seasons?.length) return item.seasons;
  const map = new Map<number, SeriesEpisode[]>();
  for (const ep of item.episodes) {
    const bucket = map.get(ep.season_no) ?? [];
    bucket.push(ep);
    map.set(ep.season_no, bucket);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season_no, episodes]) => ({
      season_no,
      label: `第 ${season_no} 季`,
      episode_count: episodes.length,
      scene_count: episodes.reduce((s, e) => s + (e.scenes?.length ?? 0), 0),
      episodes,
    }));
}

export function SeriesTree({ workspace }: { workspace: string }) {
  const [seriesList, setSeriesList] = useState<SeriesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(() => new Set());
  const [expandedSeasons, setExpandedSeasons] = useState<Set<string>>(() => new Set());
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(() => new Set());
  const [creatingSeries, setCreatingSeries] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSynopsis, setNewSynopsis] = useState("");
  const [addingEpFor, setAddingEpFor] = useState<string | null>(null);
  const [epSeason, setEpSeason] = useState(1);
  const [epNo, setEpNo] = useState(1);
  const [epTitle, setEpTitle] = useState("");
  const [addingSceneFor, setAddingSceneFor] = useState<{
    seriesId: string;
    episodeId: string;
  } | null>(null);
  const [sceneNo, setSceneNo] = useState(1);
  const [sceneTitle, setSceneTitle] = useState("");
  const [sceneSummary, setSceneSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api<{ series: SeriesItem[] }>(workspace, "/api/series");
      setSeriesList(res.series);
      setExpandedSeries((prev) => {
        if (prev.size > 0 || !res.series.length) return prev;
        return new Set([res.series[0].id]);
      });
      setExpandedSeasons((prev) => {
        if (prev.size > 0 || !res.series.length) return prev;
        const first = res.series[0];
        const seasons = groupEpisodesBySeason(first);
        return new Set(seasons.map((sn) => `${first.id}:s${sn.season_no}`));
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

  const toggleSet = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    key: string,
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
      setExpandedSeries((prev) => new Set([...prev, created.id]));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createEpisode = async (seriesId: string, openCanvas = false) => {
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
      setExpandedSeasons((prev) => new Set([...prev, `${seriesId}:s${epSeason}`]));
      setExpandedEpisodes((prev) => new Set([...prev, created.id]));
      if (openCanvas && created.canvas_id) {
        location.assign(workspaceURL("/canvas/" + created.canvas_id, workspace));
      } else {
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createScene = async (
    seriesId: string,
    episodeId: string,
    openCanvas = false,
  ) => {
    if (!sceneTitle.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await api<SeriesScene>(
        workspace,
        `/api/series/${seriesId}/episodes/${episodeId}/scenes`,
        {
          scene_no: sceneNo,
          title: sceneTitle.trim(),
          summary: sceneSummary.trim(),
          create_canvas: true,
        },
      );
      setAddingSceneFor(null);
      setSceneTitle("");
      setSceneSummary("");
      setExpandedEpisodes((prev) => new Set([...prev, episodeId]));
      if (openCanvas && created.canvas_id) {
        location.assign(workspaceURL("/canvas/" + created.canvas_id, workspace));
      } else {
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
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

  const deleteScene = async (
    seriesId: string,
    episodeId: string,
    sceneId: string,
  ) => {
    setBusy(true);
    setError("");
    try {
      await api(
        workspace,
        `/api/series/${seriesId}/episodes/${episodeId}/scenes/${sceneId}`,
        undefined,
        "DELETE",
      );
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
          <span>剧集项目树（项目 → 季 → 集 → 场）</span>
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
            placeholder="填写核心设定与世界观，建分集/分场时自动同步到画布设定便签…"
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
        <>
          <p className="fm-series-muted fm-series-desc">
            按「剧集 → 季 → 分集 → 分场」四级结构管理长片与短剧，每集/每场均可独立绑定画布。
          </p>
          <details className="fm-series-help">
            <summary>查看结构说明</summary>
            <p className="fm-series-muted">
              按「剧集 → 季 → 分集 → 分场」四级结构管理长片与短剧，每集/每场均可独立绑定画布。
            </p>
          </details>
        </>
      ) : (
        <div className="fm-series-list">
          {seriesList.map((s) => {
            const open = expandedSeries.has(s.id);
            const seasons = groupEpisodesBySeason(s);
            const maxSeason = seasons.reduce(
              (m, sn) => Math.max(m, sn.season_no),
              0,
            );
            const defaultSeason = maxSeason || 1;
            const nextEpInDefaultSeason =
              (s.episodes.reduce(
                (max, e) =>
                  e.season_no === defaultSeason
                    ? Math.max(max, e.episode_no)
                    : max,
                0,
              ) || 0) + 1;
            const totalScenes = s.episodes.reduce(
              (sum, e) => sum + (e.scenes?.length ?? 0),
              0,
            );
            return (
              <div key={s.id} className="fm-series-card">
                <div className="fm-series-row">
                  <button
                    type="button"
                    className="fm-series-toggle"
                    aria-expanded={open}
                    onClick={() => toggleSet(setExpandedSeries, s.id)}
                  >
                    {open ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                    <strong>{s.title}</strong>
                    <span>
                      {seasons.length} 季 · {s.episodes.length} 集 · {totalScenes} 场
                    </span>
                  </button>
                  <div className="fm-series-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setAddingEpFor(addingEpFor === s.id ? null : s.id);
                        setEpSeason(defaultSeason);
                        setEpNo(nextEpInDefaultSeason);
                        setEpTitle(`第 ${nextEpInDefaultSeason} 集`);
                        setExpandedSeries((prev) => new Set([...prev, s.id]));
                      }}
                    >
                      <Plus size={14} />
                      加一集
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        const nextSeason = maxSeason + 1;
                        setAddingEpFor(s.id);
                        setEpSeason(nextSeason);
                        setEpNo(1);
                        setEpTitle(`第 ${nextSeason} 季第 1 集`);
                        setExpandedSeries((prev) => new Set([...prev, s.id]));
                      }}
                    >
                      <FolderOpen size={14} />
                      加一季
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
                    {s.synopsis && (
                      <p className="fm-series-synopsis">{s.synopsis}</p>
                    )}
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
                              setEpSeason(
                                Math.max(1, Number(e.target.value) || 1),
                              )
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
                          className="secondary"
                          disabled={busy || !epTitle.trim()}
                          onClick={() => void createEpisode(s.id, false)}
                        >
                          仅创建分集
                        </button>
                        <button
                          type="button"
                          className="primary"
                          disabled={busy || !epTitle.trim()}
                          onClick={() => void createEpisode(s.id, true)}
                        >
                          创建并打开画布
                        </button>
                      </div>
                    )}

                    {seasons.length === 0 ? (
                      <p className="fm-series-muted">
                        暂无分季与分集，点击「加一集」或「加一季」开始搭建四级剧集树。
                      </p>
                    ) : (
                      <div
                        className="fm-season-groups"
                        style={{ display: "grid", gap: 8 }}
                      >
                        {seasons.map((season) => {
                          const seasonKey = `${s.id}:s${season.season_no}`;
                          const seasonOpen = expandedSeasons.has(seasonKey);
                          const nextEpInSeason =
                            season.episodes.reduce(
                              (m, e) => Math.max(m, e.episode_no),
                              0,
                            ) + 1;
                          return (
                            <div
                              key={seasonKey}
                              className="fm-season-group"
                              style={{
                                borderLeft: "2px solid rgba(128,128,128,0.28)",
                                paddingLeft: 10,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 8,
                                  marginBottom: 4,
                                }}
                              >
                                <button
                                  type="button"
                                  className="fm-series-toggle"
                                  aria-expanded={seasonOpen}
                                  onClick={() =>
                                    toggleSet(setExpandedSeasons, seasonKey)
                                  }
                                >
                                  {seasonOpen ? (
                                    <ChevronDown size={14} />
                                  ) : (
                                    <ChevronRight size={14} />
                                  )}
                                  <FolderOpen size={14} />
                                  <strong>{season.label}</strong>
                                  <small>
                                    {season.episode_count} 集 · {season.scene_count} 场
                                  </small>
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() => {
                                    setAddingEpFor(s.id);
                                    setEpSeason(season.season_no);
                                    setEpNo(nextEpInSeason);
                                    setEpTitle(`第 ${nextEpInSeason} 集`);
                                    setExpandedSeasons(
                                      (prev) => new Set([...prev, seasonKey]),
                                    );
                                  }}
                                >
                                  <Plus size={13} />
                                  本季加一集
                                </button>
                              </div>

                              {seasonOpen && (
                                <ul className="fm-ep-list">
                                  {season.episodes.map((ep) => {
                                    const epScenes = ep.scenes ?? [];
                                    const epOpen = expandedEpisodes.has(ep.id);
                                    const nextScNo =
                                      epScenes.reduce(
                                        (m, sc) => Math.max(m, sc.scene_no),
                                        0,
                                      ) + 1;
                                    const isAddingScene =
                                      addingSceneFor?.seriesId === s.id &&
                                      addingSceneFor?.episodeId === ep.id;
                                    return (
                                      <li
                                        key={ep.id}
                                        style={{
                                          display: "grid",
                                          gap: 4,
                                          padding: "4px 0",
                                        }}
                                      >
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            gap: 8,
                                            flexWrap: "wrap",
                                          }}
                                        >
                                          <div
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: 6,
                                            }}
                                          >
                                            <button
                                              type="button"
                                              className="icon-button"
                                              aria-label={`展开分集 ${ep.title} 分场`}
                                              aria-expanded={epOpen}
                                              onClick={() =>
                                                toggleSet(
                                                  setExpandedEpisodes,
                                                  ep.id,
                                                )
                                              }
                                            >
                                              {epOpen ? (
                                                <ChevronDown size={13} />
                                              ) : (
                                                <ChevronRight size={13} />
                                              )}
                                            </button>
                                            {ep.canvas_id ? (
                                              <a
                                                href={workspaceURL(
                                                  "/canvas/" + ep.canvas_id,
                                                  workspace,
                                                )}
                                              >
                                                <Film size={14} />
                                                <span>
                                                  S
                                                  {String(ep.season_no).padStart(
                                                    2,
                                                    "0",
                                                  )}
                                                  E
                                                  {String(
                                                    ep.episode_no,
                                                  ).padStart(2, "0")}{" "}
                                                  · {ep.title}
                                                </span>
                                                <small>
                                                  {STATUS_LABELS[ep.status]} ·{" "}
                                                  {epScenes.length} 场
                                                </small>
                                              </a>
                                            ) : (
                                              <span>
                                                S
                                                {String(ep.season_no).padStart(
                                                  2,
                                                  "0",
                                                )}
                                                E
                                                {String(ep.episode_no).padStart(
                                                  2,
                                                  "0",
                                                )}{" "}
                                                · {ep.title}（{epScenes.length} 场）
                                              </span>
                                            )}
                                          </div>
                                          <button
                                            type="button"
                                            className="secondary"
                                            disabled={busy}
                                            onClick={() => {
                                              setAddingSceneFor(
                                                isAddingScene
                                                  ? null
                                                  : {
                                                      seriesId: s.id,
                                                      episodeId: ep.id,
                                                    },
                                              );
                                              setSceneNo(nextScNo);
                                              setSceneTitle(`第 ${nextScNo} 场`);
                                              setSceneSummary("");
                                              setExpandedEpisodes(
                                                (prev) =>
                                                  new Set([...prev, ep.id]),
                                              );
                                            }}
                                          >
                                            <Layers size={13} />
                                            加一场
                                          </button>
                                        </div>

                                        {isAddingScene && (
                                          <div
                                            className="fm-ep-form"
                                            style={{ marginLeft: 22 }}
                                          >
                                            <label>
                                              场号
                                              <input
                                                type="number"
                                                min={1}
                                                max={999}
                                                value={sceneNo}
                                                onChange={(e) =>
                                                  setSceneNo(
                                                    Math.max(
                                                      1,
                                                      Number(e.target.value) ||
                                                        1,
                                                    ),
                                                  )
                                                }
                                              />
                                            </label>
                                            <input
                                              aria-label="分场标题"
                                              placeholder="例如：夜雨天台对峙"
                                              maxLength={120}
                                              value={sceneTitle}
                                              onChange={(e) =>
                                                setSceneTitle(e.target.value)
                                              }
                                            />
                                            <input
                                              aria-label="分场梗概"
                                              placeholder="可选分场说明"
                                              maxLength={400}
                                              value={sceneSummary}
                                              onChange={(e) =>
                                                setSceneSummary(e.target.value)
                                              }
                                            />
                                            <button
                                              type="button"
                                              className="secondary"
                                              disabled={
                                                busy || !sceneTitle.trim()
                                              }
                                              onClick={() =>
                                                void createScene(
                                                  s.id,
                                                  ep.id,
                                                  false,
                                                )
                                              }
                                            >
                                              保存分场
                                            </button>
                                            <button
                                              type="button"
                                              className="primary"
                                              disabled={
                                                busy || !sceneTitle.trim()
                                              }
                                              onClick={() =>
                                                void createScene(
                                                  s.id,
                                                  ep.id,
                                                  true,
                                                )
                                              }
                                            >
                                              创建并打开分场画布
                                            </button>
                                          </div>
                                        )}

                                        {epOpen && epScenes.length > 0 && (
                                          <ul
                                            className="fm-scene-list"
                                            style={{
                                              marginLeft: 24,
                                              listStyle: "none",
                                              padding: 0,
                                              display: "grid",
                                              gap: 4,
                                            }}
                                          >
                                            {epScenes.map((sc) => (
                                              <li
                                                key={sc.id}
                                                style={{
                                                  display: "flex",
                                                  alignItems: "center",
                                                  justifyContent:
                                                    "space-between",
                                                  gap: 8,
                                                  fontSize: 13,
                                                }}
                                              >
                                                {sc.canvas_id ? (
                                                  <a
                                                    href={workspaceURL(
                                                      "/canvas/" + sc.canvas_id,
                                                      workspace,
                                                    )}
                                                  >
                                                    <Layers size={13} />
                                                    <span>
                                                      第 {sc.scene_no} 场 ·{" "}
                                                      {sc.title}
                                                    </span>
                                                    {sc.summary && (
                                                      <small>
                                                        {" "}
                                                        — {sc.summary.slice(0, 40)}
                                                      </small>
                                                    )}
                                                  </a>
                                                ) : (
                                                  <span>
                                                    <Layers size={13} /> 第{" "}
                                                    {sc.scene_no} 场 · {sc.title}
                                                  </span>
                                                )}
                                                <button
                                                  type="button"
                                                  className="icon-button"
                                                  aria-label={`删除分场 ${sc.title}`}
                                                  disabled={busy}
                                                  onClick={() =>
                                                    void deleteScene(
                                                      s.id,
                                                      ep.id,
                                                      sc.id,
                                                    )
                                                  }
                                                >
                                                  <Trash2 size={13} />
                                                </button>
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </div>
                          );
                        })}
                      </div>
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
