import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Crosshair,
  Download,
  Link2,
  Mic,
  Play,
  X,
} from "lucide-react";
import { reducedMotion, reducedMotionQuery } from "../app/motion";
import { CinematographyPanel } from "./CinematographyPanel";
import { OptionSelect } from "./OptionSelect";
import {
  GENERATION_MODE_OPTIONS,
  countActiveCinematography,
} from "./composer-options";
import type {
  CanvasGenerationMode,
  CanvasNode,
  CinematographySpec,
  NextShotContinuation,
} from "./types";

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
  tailContinuation?: NextShotContinuation | null;
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
  const list = useRef<HTMLOListElement>(null);
  const moveFeedback = useRef<{
    rows: { row: HTMLElement; top: number }[];
    focus: HTMLButtonElement | null;
  } | null>(null);
  useEffect(() => {
    const preference = matchMedia(reducedMotionQuery);
    const sync = ({ matches }: MediaQueryListEvent) => {
      if (!matches) return;
      for (const move of list.current?.getAnimations({ subtree: true }) ?? []) {
        if (move.id === "shot-reorder") move.cancel();
      }
    };
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  function move(event: MouseEvent<HTMLButtonElement>, id: string, offset: number) {
    const button = event.currentTarget;
    const row = button.closest("li");
    const neighbor = offset < 0 ? row?.previousElementSibling : row?.nextElementSibling;
    const rows = reducedMotion()
      ? []
      : [row, neighbor]
          .filter((item): item is HTMLElement => item instanceof HTMLElement)
          .map((item) => ({ row: item, top: item.getBoundingClientRect().top }));
    moveFeedback.current = { rows, focus: document.activeElement === button ? button : null };
    onMove(id, offset);
  }

  useLayoutEffect(() => {
    const moved = moveFeedback.current;
    if (!moved) return;
    moveFeedback.current = null;
    const button = moved.focus;
    if (button?.isConnected && (button.disabled || document.activeElement !== button)) {
      const target = button.disabled
        ? button.closest("li")?.querySelector<HTMLElement>(".shot-link, .fm-shot-title-input")
        : button;
      target?.focus({ preventScroll: true });
    }
    if (reducedMotion()) return;
    for (const { row, top } of moved.rows) {
      if (!row.isConnected) continue;
      for (const animation of row.getAnimations()) {
        if (animation.id === "shot-reorder") animation.cancel();
      }
      const distance = top - row.getBoundingClientRect().top;
      if (!distance) continue;
      const style = getComputedStyle(row);
      const timing = style.getPropertyValue("--motion-enter").trim();
      const duration = Number.parseFloat(timing) * (timing.endsWith("ms") ? 1 : 1000);
      if (!(duration > 0)) continue;
      row.animate([{ translate: `0 ${distance}px` }, { translate: "none" }], {
        id: "shot-reorder",
        duration,
        easing: style.getPropertyValue("--motion-ease").trim(),
      });
    }
  }, [shots]);

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
        <span className="fm-number">
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
        <ol className="shot-list" ref={list}>
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
                <span className="shot-index fm-number">
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
                      <Crosshair size={16} />
                    </button>
                  )}
                  {onEditShot && (
                    <button
                      type="button"
                      className={
                        "icon-button" +
                        (cineNode === shot.id ||
                        countActiveCinematography(shot.cinematography) > 0
                          ? " active"
                          : "")
                      }
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
                  {onInheritTailFrame &&
                    shot.media &&
                    shot.tailContinuation !== null && (
                      <button
                        type="button"
                        className="icon-button"
                        title={
                          shot.tailContinuation?.shotTitle ||
                          "抽取尾帧续接下一镜"
                        }
                        aria-label={
                          shot.tailContinuation
                            ? `镜头 ${index + 1} 尾帧续接（${shot.tailContinuation.label}）`
                            : `镜头 ${index + 1} 尾帧续接`
                        }
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
                    onClick={(event) => move(event, shot.id, -1)}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title="下移"
                    aria-label={`下移镜头 ${index + 1}`}
                    disabled={index === shots.length - 1 || exporting}
                    onClick={(event) => move(event, shot.id, 1)}
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
                    <span className="fm-shot-mode-label">分镜链路</span>
                    <OptionSelect
                      ariaLabel={`镜头 ${index + 1} 分镜链路`}
                      value={shot.generation_mode ?? "first_last_frame"}
                      options={GENERATION_MODE_OPTIONS}
                      onChange={(mode) =>
                        onEditShot(shot.id, {
                          generation_mode: mode,
                        })
                      }
                    />
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
                  onClose={() => setCineNode(null)}
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
