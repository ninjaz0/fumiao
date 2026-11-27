import { useEffect, useRef, useState } from "react";
import { Mic, Plus, Trash2, Users, X } from "lucide-react";
import type { CanvasNode, DialogueLine, Job } from "./types";

function parseQuickScript(raw: string): DialogueLine[] {
  const out: DialogueLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = /^([^:：]{1,32}?)(?:[（(]([^）)]{1,24})[）)])?\s*[:：]\s*(.+)$/.exec(
      trimmed,
    );
    if (m) {
      out.push({
        id: "dlg_" + crypto.randomUUID().slice(0, 8),
        speaker: m[1].trim(),
        text: m[3].trim().slice(0, 300),
        ...(m[2]?.trim() ? { instruction: m[2].trim() } : {}),
      });
    } else {
      out.push({
        id: "dlg_" + crypto.randomUUID().slice(0, 8),
        speaker: "旁白",
        text: trimmed.slice(0, 300),
      });
    }
  }
  return out.slice(0, 20);
}

export function Narration({
  node,
  runs,
  cost,
  unavailableReason,
  audioModels = [],
  onChange,
  onEditStart,
  onEditEnd,
  onGenerate,
  onGenerateDialogue,
}: {
  node: CanvasNode;
  runs: Job[];
  cost: number | null;
  unavailableReason: string;
  audioModels?: { id: string; label: string }[];
  onChange: (patch: Partial<CanvasNode>, history?: boolean) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  onGenerate: () => Promise<void>;
  onGenerateDialogue?: (lineId?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"single" | "dialogue">(() =>
    node.dialogue_lines?.length ? "dialogue" : "single",
  );
  const [scriptDraft, setScriptDraft] = useState("");
  const onEditEndRef = useRef(onEditEnd);
  onEditEndRef.current = onEditEnd;

  useEffect(() => {
    return () => {
      onEditEndRef.current?.();
    };
  }, [node.id]);

  const job = runs.find((j) => j.id === node.narration_job);
  const replacement = runs.find((j) => j.id === node.narration_pending);
  const pending = runs.some(
    (j) =>
      j.canvas_node === "voice:" + node.id &&
      ["queued", "running"].includes(j.status),
  );
  const failed =
    replacement && ["failed", "cancelled"].includes(replacement.status);
  const needsAdoption = replacement?.status === "done" && replacement.result;
  const changed =
    job?.status === "done" &&
    job.prompt.trim() !== (node.narration_text || "").trim();

  const audioStrategy = node.audio_strategy ?? "replace";
  const origGain = node.original_audio_gain ?? 0.35;
  const lines = node.dialogue_lines ?? [];

  const updateLines = (next: DialogueLine[], history = true) => {
    onChange(
      { dialogue_lines: next.length ? next : undefined },
      history,
    );
  };

  return (
    <div className="shot-narration" onClick={(e) => e.stopPropagation()}>
      <div className="narration-mix-bar">
        <label>
          原声策略
          <select
            aria-label="原声策略"
            value={audioStrategy}
            onChange={(e) =>
              onChange(
                {
                  audio_strategy: e.target.value as
                    | "replace"
                    | "keep_original"
                    | "mix",
                },
                true,
              )
            }
          >
            <option value="replace">替换原声</option>
            <option value="mix">混合原声与配音</option>
            <option value="keep_original">仅保留视频原声</option>
          </select>
        </label>
        {audioStrategy === "mix" && (
          <label>
            原声音量 {Math.round(origGain * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={origGain}
              onChange={(e) =>
                onChange(
                  { original_audio_gain: Number(e.target.value) },
                  false,
                )
              }
            />
          </label>
        )}
        <label className="narration-tail-toggle">
          <input
            type="checkbox"
            checked={Boolean(node.tail_inherited)}
            onChange={(e) =>
              onChange({ tail_inherited: e.target.checked || undefined }, true)
            }
          />
          首帧去重衔接（尾帧续接镜头）
        </label>
        {audioModels.length > 0 && (
          <label>
            语音引擎
            <select
              aria-label="语音引擎"
              value={node.narration_model || ""}
              onChange={(e) =>
                onChange(
                  { narration_model: e.target.value || undefined },
                  true,
                )
              }
            >
              <option value="">自动路由（商云优先 / Edge 免费兜底）</option>
              {audioModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {onGenerateDialogue && (
        <div className="narration-mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className="secondary"
            aria-selected={mode === "single"}
            onClick={() => setMode("single")}
          >
            <Mic size={13} />
            单人旁白
          </button>
          <button
            type="button"
            role="tab"
            className="secondary"
            aria-selected={mode === "dialogue"}
            onClick={() => setMode("dialogue")}
          >
            <Users size={13} />
            多角色对白{lines.length ? ` (${lines.length})` : ""}
          </button>
        </div>
      )}

      {mode === "dialogue" && onGenerateDialogue ? (
        <div className="dialogue-editor">
          {lines.map((line, idx) => {
            const lineJob = runs.find((j) => j.id === line.audio_job);
            const lineStale = Boolean(line.audio_stale?.length || (lineJob && lineJob.prompt.trim() !== line.text.trim()));
            const linePendingRun = runs.find((j) => j.id === line.audio_pending);
            const linePending =
              Boolean(
                linePendingRun &&
                  ["queued", "running"].includes(linePendingRun.status),
              ) ||
              runs.some(
                (j) =>
                  j.canvas_node === `dialogue:${node.id}:${line.id}` &&
                  ["queued", "running"].includes(j.status),
              );
            const lineFailed =
              linePendingRun &&
              ["failed", "cancelled"].includes(linePendingRun.status);
            return (
              <div key={line.id} className="dialogue-row">
                <div className="dialogue-row-head">
                  <input
                    aria-label={`第 ${idx + 1} 句说话人`}
                    maxLength={40}
                    value={line.speaker}
                    placeholder="角色名（自动匹配素材包声线）"
                    onFocus={() => onEditStart?.()}
                    onChange={(e) =>
                      updateLines(
                        lines.map((l) =>
                          l.id === line.id ? { ...l, speaker: e.target.value } : l,
                        ),
                        false,
                      )
                    }
                    onBlur={() => onEditEnd?.()}
                  />
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || linePending || !line.text.trim() || !!unavailableReason}
                    onClick={async () => {
                      onEditEnd?.();
                      setBusy(true);
                      setError("");
                      try {
                        await onGenerateDialogue(line.id);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {linePending ? "生成中…" : lineFailed ? "重新合成" : "合成此句"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    aria-label="删除对白"
                    disabled={busy || linePending}
                    onClick={() =>
                      updateLines(
                        lines.filter((l) => l.id !== line.id),
                        true,
                      )
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={line.text}
                  placeholder="输入角色台词…"
                  onFocus={() => onEditStart?.()}
                  onChange={(e) =>
                    updateLines(
                      lines.map((l) =>
                        l.id === line.id ? { ...l, text: e.target.value } : l,
                      ),
                      false,
                    )
                  }
                  onBlur={() => onEditEnd?.()}
                />
                {lineFailed && (
                  <p className="error" role="alert">
                    {linePendingRun.note || "该句对白生成失败"}
                    {lineJob?.result && !lineStale ? "，已保留原有效音轨。" : "。"}
                  </p>
                )}
                {lineStale && <p>对白已修改，请重新生成音轨。</p>}
                {!lineStale && lineJob?.status === "done" && lineJob.result && (
                  <audio
                    aria-label={`${line.speaker || "角色"}配音`}
                    src={"/media/" + lineJob.result}
                    controls
                    preload="metadata"
                  />
                )}
              </div>
            );
          })}
          <div className="dialogue-quick-import">
            <textarea
              rows={2}
              value={scriptDraft}
              placeholder={"粘贴对白剧本快速拆行，例如：\n林墨：今天这场雨不对劲。\n苏青（紧张）：快看窗外！"}
              onChange={(e) => setScriptDraft(e.target.value)}
            />
            <div className="narration-actions">
              <button
                type="button"
                className="secondary"
                disabled={!scriptDraft.trim()}
                onClick={() => {
                  const parsed = parseQuickScript(scriptDraft);
                  if (parsed.length) {
                    updateLines([...lines, ...parsed].slice(0, 20), true);
                    setScriptDraft("");
                  }
                }}
              >
                剧本拆行导入
              </button>
              <button
                type="button"
                className="secondary"
                disabled={lines.length >= 20}
                onClick={() =>
                  updateLines(
                    [
                      ...lines,
                      {
                        id: "dlg_" + crypto.randomUUID().slice(0, 8),
                        speaker: "",
                        text: "",
                      },
                    ],
                    true,
                  )
                }
              >
                <Plus size={13} />
                添加一句
              </button>
              <button
                type="button"
                className="secondary"
                disabled={
                  busy ||
                  !lines.some((l) => l.text.trim()) ||
                  !!unavailableReason
                }
                onClick={async () => {
                  onEditEnd?.();
                  setBusy(true);
                  setError("");
                  try {
                    await onGenerateDialogue();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Mic size={14} />
                {busy ? "提交中…" : "一键合成全部对白"}
              </button>
            </div>
          </div>
          {!!unavailableReason && <p role="status">{unavailableReason}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <>
          <label>
            旁白文字
            <textarea
              rows={3}
              maxLength={300}
              value={node.narration_text || ""}
              placeholder="这一镜头要讲什么？"
              onFocus={() => onEditStart?.()}
              onChange={(e) => onChange({ narration_text: e.target.value }, false)}
              onBlur={() => onEditEnd?.()}
            />
          </label>
          <label>
            音色描述
            <input
              maxLength={300}
              value={node.narration_instruction || ""}
              placeholder="清晰自然的普通话，语速适中"
              onFocus={() => onEditStart?.()}
              onChange={(e) =>
                onChange({ narration_instruction: e.target.value }, false)
              }
              onBlur={() => onEditEnd?.()}
            />
          </label>
          {job?.status === "done" && job.result && (
            <audio
              aria-label="当前旁白"
              src={"/media/" + job.result}
              controls
              preload="metadata"
            />
          )}
          {changed && <p>文字已修改，重新生成后更新旁白。</p>}
          {pending && (
            <p role="status">
              {replacement?.status === "running" ? "正在生成旁白" : "旁白已加入队列"}
              {job?.result ? "，当前音轨会保留至新旁白完成。" : ""}
            </p>
          )}
          {failed && (
            <p className="error" role="alert">
              {replacement.status === "cancelled"
                ? "旁白已取消，积分已退回。"
                : (replacement.note || "旁白生成失败") + "，积分已退回。"}
              {job?.result ? "当前仍保留上一段旁白。" : ""}
            </p>
          )}
          {needsAdoption && (
            <div>
              <p>生成期间文稿或音色描述发生了变化。</p>
              <audio
                aria-label="待采用旁白"
                src={"/media/" + replacement.result}
                controls
              />
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  onEditEnd?.();
                  onChange(
                    {
                      narration_job: replacement.id,
                      narration_pending: null,
                      narration_text: replacement.prompt,
                      narration_instruction: replacement.inputs?.instruction || "",
                    },
                    true,
                  );
                }}
              >
                使用生成时的文稿与旁白
              </button>
            </div>
          )}
          {!!unavailableReason && <p role="status">{unavailableReason}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="narration-actions">
            {(node.narration_job ||
              node.narration_text ||
              node.narration_pending) && (
              <button
                type="button"
                className="secondary"
                disabled={busy || pending}
                onClick={() => {
                  onEditEnd?.();
                  onChange(
                    {
                      narration_job: null,
                      narration_pending: null,
                      narration_text: "",
                      narration_instruction: "",
                    },
                    true,
                  );
                }}
              >
                <X size={14} />
                移除旁白
              </button>
            )}
            <button
              type="button"
              className="secondary"
              disabled={
                busy ||
                pending ||
                !node.narration_text?.trim() ||
                !!unavailableReason ||
                cost === null
              }
              onClick={async () => {
                onEditEnd?.();
                setBusy(true);
                setError("");
                try {
                  await onGenerate();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Mic size={15} />
              {pending
                ? "旁白生成中"
                : busy
                  ? "提交中…"
                  : `${failed ? "重新生成" : "生成旁白"} · ${cost ?? "未定价"}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
