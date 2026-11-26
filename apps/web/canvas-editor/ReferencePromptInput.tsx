import { useMemo, useRef, useState, type KeyboardEventHandler } from "react";
import { Globe, Lock } from "lucide-react";
import type { Pack } from "./AssetPacks";

export type MentionCandidate =
  | { kind: "pack"; id: string; label: string; thumb?: string; pack: Pack }
  | { kind: "ref"; id: string; label: string; thumb?: string; token: string };

/**
 * F011: Prompt input with `@角色名` / `@场景名` / `@图N` fuzzy autocomplete
 * that automatically mounts referenced AssetPacks into the node's reference list.
 */
export function ReferencePromptInput({
  value,
  packs,
  refImages = [],
  placeholder = "输入提示词，键入 @ 可快速引用角色/场景素材包或 @图N…",
  rows = 3,
  maxLength = 12000,
  ariaLabel = "生成提示词",
  onChange,
  onMountPack,
  onFocus,
  onBlur,
  onKeyDown,
}: {
  value: string;
  packs: Pack[];
  refImages?: string[];
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  ariaLabel?: string;
  onChange: (next: string) => void;
  onMountPack?: (pack: Pack) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const candidates = useMemo<MentionCandidate[]>(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query.trim().toLowerCase();
    const list: MentionCandidate[] = [];
    for (const pack of packs) {
      if (
        !q ||
        pack.name.toLowerCase().includes(q) ||
        pack.purpose.toLowerCase().includes(q)
      ) {
        list.push({
          kind: "pack",
          id: pack.id,
          label: pack.name,
          thumb: pack.media[0],
          pack,
        });
      }
    }
    for (const [idx, mediaId] of refImages.entries()) {
      const label = `图${idx + 1}`;
      if (!q || label.includes(q) || `picture ${idx + 1}`.includes(q)) {
        list.push({
          kind: "ref",
          id: mediaId,
          label,
          thumb: mediaId,
          token: `<Picture ${idx + 1}>`,
        });
      }
    }
    return list.slice(0, 8);
  }, [mentionQuery, packs, refImages]);

  const detectMention = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const match = before.match(/(?:^|[\s，。；、])@([^\s@]{0,24})$/);
    if (!match) {
      setMentionQuery(null);
      return;
    }
    const atIndex = before.lastIndexOf("@");
    setMentionQuery({ start: atIndex, end: caret, query: match[1] });
    setActiveIdx(0);
  };

  const applyCandidate = (cand: MentionCandidate) => {
    if (!mentionQuery) return;
    const insertion =
      cand.kind === "pack" ? `@${cand.label} ` : `${cand.token} `;
    const next = (
      value.slice(0, mentionQuery.start) +
      insertion +
      value.slice(mentionQuery.end)
    ).slice(0, maxLength);
    onChange(next);
    if (cand.kind === "pack" && onMountPack) {
      onMountPack(cand.pack);
    }
    const nextCaret = mentionQuery.start + insertion.length;
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
      }
    });
  };

  return (
    <div className="fm-ref-prompt-wrap">
      <textarea
        ref={textareaRef}
        className="composer-prompt fm-ref-prompt"
        aria-label={ariaLabel}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onFocus={onFocus}
        onBlur={() => {
          setTimeout(() => setMentionQuery(null), 150);
          onBlur?.();
        }}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next);
          detectMention(next, e.target.selectionStart ?? next.length);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          onKeyDown(e);
          if (e.defaultPrevented || !mentionQuery || !candidates.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((i) => (i + 1) % candidates.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => (i - 1 + candidates.length) % candidates.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            applyCandidate(candidates[activeIdx] ?? candidates[0]);
          } else if (e.key === "Escape") {
            setMentionQuery(null);
          }
        }}
      />
      {mentionQuery && candidates.length > 0 && (
        <div
          className="fm-mention-menu"
          role="listbox"
          aria-label="引用角色或参考图"
        >
          {candidates.map((cand, idx) => (
            <button
              key={`${cand.kind}:${cand.id}`}
              type="button"
              role="option"
              aria-selected={idx === activeIdx}
              className={
                "fm-mention-item" + (idx === activeIdx ? " active" : "")
              }
              onMouseDown={(e) => {
                e.preventDefault();
                applyCandidate(cand);
              }}
            >
              {cand.thumb && (
                <img
                  src={`/media/${cand.thumb}?variant=thumb`}
                  onError={(ev) => {
                    ev.currentTarget.src = `/media/${cand.thumb}`;
                  }}
                  alt=""
                />
              )}
              <span className="fm-mention-label">
                @{cand.label}
                {cand.kind === "pack" && (
                  <small>
                    {cand.pack.scope === "global" && <Globe size={11} />}
                    {cand.pack.locked && <Lock size={11} />}
                    自动挂载 {cand.pack.media.length} 图
                  </small>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
