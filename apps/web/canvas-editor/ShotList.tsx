import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Download,
  Link2,
  Mic,
  Play,
  X,
} from "lucide-react";
import { CinematographyPanel } from "./CinematographyPanel";
import type { CanvasGenerationMode, CanvasNode, CinematographySpec } from "./types";

export type Shot = {
  id: string;
  title: string;
  media: string | null;
  seconds: number;
  adopted: number | null;
  status: string;
  prompt?: string;
  generation_mode?: CanvasGenerationMode;
  cinematography?: CinematographySpec | null;
};

export function ShotList({
  shots,
  onMove,
  onRemove,
  onSelect,
  onExport,
  onInheritTailFrame,
  onEditShot,
  onBatchPrecheck,
  renderNarration,
  composition,
  docked = false,
}: {
  shots: Shot[];
  onMove: (id: string, offset: number) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onExport: () => Promise<void>;
  onInheritTailFrame?: (id: string) => Promise<void>;
  onEditShot?: (id: string, patch: Partial<CanvasNode>) => void;
  onBatchPrecheck?: (nodeIds: string[]) => void;
  renderNarration: (shot: Shot) => ReactNode;
  composition: ReactNode;
  docked?: boolean;
}) {
  const [voiceNode, setVoiceNode] = useState<string | null>(null);
  const [cineNode, setCineNode] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [tailBusy, setTailBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const ready = shots.filter((s) => s.media).length;
  const allReady = !!shots.length && ready === shots.length;

  const toggleCheck = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectedIds = shots.map((s) => s.id).filter((id) => checked.has(id));

  return (
    <div className={"shot-editor" + (docked ? " fm-shot-docked" : "")}>
      <div className="shot-summary">
        <span>
          {shots.length
            ? `${ready} / ${shots.length} 个镜头已有视频 · 约 ${Math.round(shots.reduce((t, s) => t + s.seconds, 0) * 10) / 10} 秒`
            : "选中视频节点，加入镜头列表开始编排。"}
        </span>
        <div className="fm-shot-summary-actions">
          {onBatchPrecheck && shots.length > 0 && (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                onBatchPrecheck(
                  selectedIds.length ? selectedIds : shots.map((s) => s.id),
                )
              }
            >
              <Play size={14} />
              {selectedIds.length
                ? `预检已选 (${selectedIds.length})`
                : "全部分镜预检"}
            </button>
          )}
          {!!shots.length && (
            <button
              className="secondary"
              disabled={!allReady || exporting}
              onClick={async () => {
                setExporting(true);
                setError("");
                try {
                  await onExport();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Download size={15} />
              {exporting ? "准备中…" : "导出镜头包"}
            </button>
          )}
        </div>
      </div>

      {!!shots.length && (
        <ol className="shot-list">
          {shots.map((shot, index) => (
            <li key={shot.id} className="fm-shot-row">
              <div className="fm-shot-top">
                {onBatchPrecheck && (
                  <input
                    type="checkbox"
                    aria-label={`勾选镜头 ${index + 1}`}
                    checked={checked.has(shot.id)}
                    onChange={() => toggleCheck(shot.id)}
                  />
                )}
                <span className="shot-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {onEditShot ? (
                  <div className="fm-shot-inline">
                    <input
                      className="fm-shot-title-input"
                      aria-label={`镜头 ${index + 1} 标题`}
                      value={shot.title}
                      maxLength={80}
                      placeholder="未命名镜头"
                      onChange={(e) =>
                        onEditShot(shot.id, { title: e.target.value })
                      }
                    />
                    <small>
                      {Math.round(shot.seconds * 10) / 10} 秒 ·{" "}
                      {shot.adopted
                        ? `已采用 #${shot.adopted}`
                        : shot.media
                          ? "当前视频"
                          : shot.status}
                    </small>
                  </div>
                ) : (
                  <button
                    className="shot-link"
                    onClick={() => onSelect(shot.id)}
                  >
                    <strong>{shot.title || "未命名镜头"}</strong>
                    <small>
                      {Math.round(shot.seconds * 10) / 10} 秒 ·{" "}
                      {shot.adopted
                        ? `已采用 #${shot.adopted}`
                        : shot.media
                          ? "当前视频"
                          : shot.status}
                    </small>
                  </button>
                )}
                <div className="shot-actions">
                  {onEditShot && (
                    <button
                      type="button"
                      className="icon-button"
                      title="定位画布节点"
                      aria-label={`定位镜头 ${index + 1}`}
                      onClick={() => onSelect(shot.id)}
                    >
                      定位
                    </button>
                  )}
                  {onEditShot && (
                    <button
                      type="button"
                      className="icon-button"
                      title="导演镜头参数"
                      aria-label={`镜头 ${index + 1} 导演参数`}
                      aria-expanded={cineNode === shot.id}
                      onClick={() =>
                        setCineNode(cineNode === shot.id ? null : shot.id)
                      }
                    >
                      <Clapperboard size={16} />
                    </button>
                  )}
                  {onInheritTailFrame && shot.media && (
                    <button
                      className="icon-button"
                      title="抽取尾帧续接下一镜"
                      aria-label={`镜头 ${index + 1} 尾帧续接`}
                      disabled={tailBusy === shot.id || exporting}
                      onClick={async () => {
                        setTailBusy(shot.id);
                        setError("");
                        try {
                          await onInheritTailFrame(shot.id);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setTailBusy(null);
                        }
                      }}
                    >
                      <Link2 size={16} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    title="旁白与多角色对白"
                    aria-label={`镜头 ${index + 1} 的旁白`}
                    aria-expanded={voiceNode === shot.id}
                    onClick={() =>
                      setVoiceNode(voiceNode === shot.id ? null : shot.id)
                    }
                  >
                    <Mic size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title="上移"
                    aria-label={`上移镜头 ${index + 1}`}
                    disabled={index === 0 || exporting}
                    onClick={() => onMove(shot.id, -1)}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title="下移"
                    aria-label={`下移镜头 ${index + 1}`}
                    disabled={index === shots.length - 1 || exporting}
                    onClick={() => onMove(shot.id, 1)}
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title="从列表移除"
                    aria-label={`移除镜头 ${index + 1}`}
                    disabled={exporting}
                    onClick={() => onRemove(shot.id)}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {onEditShot && (
                <div className="fm-shot-live-fields">
                  <textarea
                    rows={2}
                    maxLength={12000}
                    aria-label={`镜头 ${index + 1} 提示词`}
                    placeholder="直接编辑本镜提示词，实时同步画布节点…"
                    value={shot.prompt ?? ""}
                    onChange={(e) =>
                      onEditShot(shot.id, { prompt: e.target.value })
                    }
                  />
                  <div className="fm-shot-mode-row">
                    <label>
                      链路：
                      <select
                        aria-label={`镜头 ${index + 1} 分镜链路`}
                        value={shot.generation_mode ?? "first_last_frame"}
                        onChange={(e) =>
                          onEditShot(shot.id, {
                            generation_mode: e.target
                              .value as CanvasGenerationMode,
                          })
                        }
                      >
                        <option value="first_frame">单首帧</option>
                        <option value="first_last_frame">经典首尾帧</option>
                        <option value="omni_ref">全能 @图N 多参考</option>
                        <option value="grid_preview">宫格构图预览</option>
                      </select>
                    </label>
                  </div>
                </div>
              )}

              {cineNode === shot.id && onEditShot && (
                <CinematographyPanel
                  compact
                  value={shot.cinematography}
                  onChange={(cinematography) =>
                    onEditShot(shot.id, { cinematography })
                  }
                />
              )}

              {voiceNode === shot.id && renderNarration(shot)}
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {composition}
    </div>
  );
}
