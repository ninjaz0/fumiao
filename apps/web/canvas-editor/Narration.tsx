import { useEffect, useRef, useState } from "react";
import { Mic, X } from "lucide-react";
import type { CanvasNode, Job } from "./types";

export function Narration({
  node,
  runs,
  cost,
  unavailableReason,
  onChange,
  onEditStart,
  onEditEnd,
  onGenerate,
}: {
  node: CanvasNode;
  runs: Job[];
  cost: number | null;
  unavailableReason: string;
  onChange: (patch: Partial<CanvasNode>, history?: boolean) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  onGenerate: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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

  return (
    <div className="shot-narration" onClick={(e) => e.stopPropagation()}>
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
    </div>
  );
}
