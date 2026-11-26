import { useMemo, useState } from "react";
import {
  Check,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Layers,
  Sparkles,
  User,
  X,
} from "lucide-react";
import {
  detectAmbiguousShotMatches,
  type ScriptAnchorLink,
  type ScriptBreakdown,
  type ScriptSyncOptions,
} from "./script-fusion";
import type { CanvasGenerationMode, Doc } from "./types";

export function ScriptSyncModal({
  canvasDoc,
  breakdown,
  existingLinks,
  defaultVideoModel,
  defaultImageModel,
  onSync,
  onClose,
}: {
  canvasDoc: Doc;
  breakdown: ScriptBreakdown;
  existingLinks: Record<string, ScriptAnchorLink>;
  defaultVideoModel: string;
  defaultImageModel: string;
  onSync: (
    options: ScriptSyncOptions,
    switchAfterSync: boolean,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [includeAssets, setIncludeAssets] = useState(true);
  const [generationMode, setGenerationMode] =
    useState<CanvasGenerationMode>("omni_ref");
  const [gridLayout, setGridLayout] = useState<"2x2" | "3x3">("3x3");
  const [tailChain, setTailChain] = useState(true);
  const [ratio, setRatio] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [selectedAnchors, setSelectedAnchors] = useState<Set<string>>(
    () => new Set(breakdown.shots.map((s) => s.anchor)),
  );
  // Keyed by existingVideoNodeId -> "__keep_separate__" | targetAnchor
  const [ambiguousDecisions, setAmbiguousDecisions] = useState<
    Record<string, string>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ambiguousMediaNodes = useMemo(
    () =>
      detectAmbiguousShotMatches(canvasDoc, breakdown, [...selectedAnchors]),
    [canvasDoc, breakdown, selectedAnchors],
  );

  const hasUnresolvedAmbiguity = useMemo(
    () =>
      ambiguousMediaNodes.some(
        (amb) => !ambiguousDecisions[amb.existingVideoNodeId],
      ),
    [ambiguousMediaNodes, ambiguousDecisions],
  );

  const toggleAnchor = (anchor: string) => {
    setSelectedAnchors((prev) => {
      const next = new Set(prev);
      if (next.has(anchor)) next.delete(anchor);
      else next.add(anchor);
      return next;
    });
  };

  const stats = useMemo(() => {
    let newCount = 0;
    let updateCount = 0;
    let totalSeconds = 0;
    for (const shot of breakdown.shots) {
      if (!selectedAnchors.has(shot.anchor)) continue;
      totalSeconds += shot.seconds;
      if (existingLinks[shot.anchor]) updateCount++;
      else newCount++;
    }
    return { newCount, updateCount, totalSeconds };
  }, [breakdown.shots, existingLinks, selectedAnchors]);

  const submit = async (switchAfterSync: boolean) => {
    if (hasUnresolvedAmbiguity) {
      setError(
        "请先确认上方已出片视频节点的归属方式（选择保留原节点独立或绑定到指定镜号）",
      );
      return;
    }
    const explicitBindings: Record<string, string> = {};
    for (const [videoNodeId, decision] of Object.entries(ambiguousDecisions)) {
      if (decision && decision !== "__keep_separate__") {
        explicitBindings[decision] = videoNodeId;
      }
    }
    setBusy(true);
    setError("");
    try {
      await onSync(
        {
          includeAssets,
          generationMode,
          gridLayout,
          tailChain,
          ratio,
          videoModel: defaultVideoModel,
          imageModel: defaultImageModel,
          selectedAnchors: [...selectedAnchors],
          explicitNodeBindings: explicitBindings,
        },
        switchAfterSync,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步画布失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="从剧本拆解并同步至画布"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="fm-script-sync-dialog">
        <header className="fm-script-sync-head">
          <div>
            <h2>
              <Clapperboard size={18} />
              剧本 ↔ 画布智能融合同步
            </h2>
            <p>
              从「{breakdown.docPath}」自动识别角色/场景参考卡与镜头节点链；已生成的视频素材将无损保留。
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭同步窗口"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="fm-script-sync-controls">
          <label>
            <span>生成链路</span>
            <select
              value={generationMode}
              disabled={busy}
              onChange={(e) =>
                setGenerationMode(e.target.value as CanvasGenerationMode)
              }
            >
              <option value="omni_ref">全能多参考（角色/场景连线引用）</option>
              <option value="first_last_frame">经典首尾帧连贯</option>
              <option value="grid_preview">九宫格/四宫格低成本预览</option>
            </select>
          </label>
          {generationMode === "grid_preview" && (
            <label>
              <span>宫格规格</span>
              <select
                value={gridLayout}
                disabled={busy}
                onChange={(e) =>
                  setGridLayout(e.target.value as "2x2" | "3x3")
                }
              >
                <option value="2x2">2×2 四宫格</option>
                <option value="3x3">3×3 九宫格</option>
              </select>
            </label>
          )}
          <label>
            <span>目标画幅</span>
            <select
              value={ratio}
              disabled={busy}
              onChange={(e) =>
                setRatio(e.target.value as "9:16" | "16:9" | "1:1")
              }
            >
              <option value="9:16">9:16 竖屏短剧</option>
              <option value="16:9">16:9 横屏电影</option>
              <option value="1:1">1:1 方形构图</option>
            </select>
          </label>
          <label className="fm-sync-checkbox">
            <input
              type="checkbox"
              checked={includeAssets}
              disabled={busy}
              onChange={(e) => setIncludeAssets(e.target.checked)}
            />
            <span>同步角色/场景参考图节点并自动连线 ({breakdown.assets.length})</span>
          </label>
          <label className="fm-sync-checkbox">
            <input
              type="checkbox"
              checked={tailChain}
              disabled={busy}
              onChange={(e) => setTailChain(e.target.checked)}
            />
            <span>开启跨镜尾帧衔接标记</span>
          </label>
        </div>

        <div className="fm-script-sync-body">
          {ambiguousMediaNodes.length > 0 && (
            <section className="fm-sync-section" role="region" aria-label="已出片镜头复用确认">
              <h3>已出片镜头复用确认（{ambiguousMediaNodes.length} 项）</h3>
              <p style={{ fontSize: 12.5, color: "var(--cv-muted)", marginBottom: 8 }}>
                检测到场次镜头数量增删且正文已改写。为防止把已有视频误挂到新插入的镜头上，请确认以下已出片节点的对应镜头（留空则保留原节点独立，不覆盖已有视频）：
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ambiguousMediaNodes.map((amb) => {
                  const chosenValue =
                    ambiguousDecisions[amb.existingVideoNodeId] ?? "";
                  return (
                    <label
                      key={amb.existingVideoNodeId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--cv-line)",
                        background: "var(--cv-bg)",
                        fontSize: 12.5,
                      }}
                    >
                      <span>
                        原已出片节点：<strong>{amb.existingTitle}</strong>
                        {amb.previousAnchor ? ` (${amb.previousAnchor})` : ""}
                      </span>
                      <select
                        aria-label={`确认已出片节点 ${amb.existingTitle} 的归属`}
                        value={chosenValue}
                        disabled={busy}
                        onChange={(e) => {
                          const decision = e.target.value;
                          setError("");
                          setAmbiguousDecisions((prev) => {
                            const next = { ...prev };
                            if (decision && decision !== "__keep_separate__") {
                              for (const [vid, val] of Object.entries(next)) {
                                if (val === decision && vid !== amb.existingVideoNodeId) {
                                  delete next[vid];
                                }
                              }
                            }
                            next[amb.existingVideoNodeId] = decision;
                            return next;
                          });
                        }}
                      >
                        <option value="">— 请确认此视频的归属 —</option>
                        <option value="__keep_separate__">
                          保留原视频节点独立（不绑定新镜头）
                        </option>
                        {amb.candidateAnchors.map((anc) => {
                          const shot = breakdown.shots.find(
                            (s) => s.anchor === anc,
                          );
                          return (
                            <option key={anc} value={anc}>
                              绑定到 {shot?.title || anc}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {breakdown.assets.length > 0 && (
            <section className="fm-sync-section">
              <h3>
                <ImageIcon size={15} />
                识别出的资产设定卡（{breakdown.assets.length} 项）
              </h3>
              <div className="fm-sync-asset-grid">
                {breakdown.assets.map((asset) => (
                  <div
                    key={asset.key}
                    className={`fm-sync-asset-card cat-${asset.category}`}
                  >
                    <div className="fm-sync-asset-top">
                      <span className="fm-sync-asset-badge">
                        {asset.category === "character" ? (
                          <User size={12} />
                        ) : (
                          <Layers size={12} />
                        )}
                        {asset.code}
                      </span>
                      <strong>{asset.name}</strong>
                    </div>
                    <p>{asset.description || asset.prompt}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="fm-sync-section">
            <div className="fm-sync-section-head">
              <h3>
                <Film size={15} />
                识别出的场次与镜头段（已选 {selectedAnchors.size} /{" "}
                {breakdown.shots.length} 镜 · 约 {stats.totalSeconds}s）
              </h3>
              {breakdown.shots.length > 0 && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setSelectedAnchors(
                      selectedAnchors.size === breakdown.shots.length
                        ? new Set()
                        : new Set(breakdown.shots.map((s) => s.anchor)),
                    )
                  }
                >
                  {selectedAnchors.size === breakdown.shots.length
                    ? "取消全选"
                    : "全选镜头"}
                </button>
              )}
            </div>

            {breakdown.shots.length === 0 ? (
              <div className="fm-sync-empty">
                当前文档尚未包含可拆解的场次或动作/台词段落。可使用工具栏插入「+ 场次 S01」「+ △动作」或「+ 角色对白」后再同步。
              </div>
            ) : (
              <div className="fm-sync-shot-list">
                {breakdown.shots.map((shot) => {
                  const linked = existingLinks[shot.anchor];
                  const checked = selectedAnchors.has(shot.anchor);
                  return (
                    <label
                      key={shot.anchor}
                      className={
                        "fm-sync-shot-card" + (checked ? " selected" : "")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy}
                        onChange={() => toggleAnchor(shot.anchor)}
                      />
                      <div className="fm-sync-shot-main">
                        <div className="fm-sync-shot-title">
                          <span className="fm-sync-anchor">{shot.anchor}</span>
                          <strong>{shot.title}</strong>
                          <span className="fm-sync-meta">{shot.seconds}s</span>
                          {shot.cinematography.shot_size && (
                            <span className="fm-sync-cine">
                              {shot.cinematography.shot_size}
                            </span>
                          )}
                          {shot.cinematography.camera_movement && (
                            <span className="fm-sync-cine">
                              {shot.cinematography.camera_movement}
                            </span>
                          )}
                          <span
                            className={
                              "fm-sync-state " + (linked ? "update" : "create")
                            }
                          >
                            {linked ? "更新已有节点" : "新建镜头链"}
                          </span>
                        </div>
                        <p className="fm-sync-shot-prompt">{shot.prompt}</p>
                        {shot.dialogues.length > 0 && (
                          <div className="fm-sync-dialogues">
                            {shot.dialogues.map((d, i) => (
                              <span key={i}>
                                <b>{d.speaker}：</b>
                                {d.text}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {error && (
          <p className="fm-sync-error" role="alert">
            {error}
          </p>
        )}

        <footer className="fm-script-sync-foot">
          <span className="fm-number">
            新增 {stats.newCount} 镜 · 增量同步 {stats.updateCount} 镜（不自动触发扣费生成）
          </span>
          <div className="fm-script-sync-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="secondary"
              disabled={
                busy ||
                (selectedAnchors.size === 0 &&
                  (!includeAssets || breakdown.assets.length === 0))
              }
              onClick={() => void submit(false)}
            >
              <Check size={15} />
              仅同步留在文档
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                busy ||
                (selectedAnchors.size === 0 &&
                  (!includeAssets || breakdown.assets.length === 0))
              }
              onClick={() => void submit(true)}
            >
              <Sparkles size={15} />
              {busy ? "正在落图…" : "一键落图并查看画布"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
