import React, { useEffect, useState } from "react";
import {
  AtSign,
  BookOpen,
  FileText,
  Layers,
  MessageSquare,
  PanelRight,
  PictureInPicture2,
  Sparkles,
  X,
} from "lucide-react";
import { ChatWorkspace, type Message } from "./chat/ChatWorkspace";
import { ProposalDiffPreview } from "./ProposalDiffPreview";
import { scriptApi, type ScriptDocumentSummary } from "./script-api";
import type { CanvasNode } from "./types";

export function FloatingCanvasAgent({
  visible,
  activeTab,
  onTabChange,
  onClose,
  onDockedWidthChange,
  workspace,
  userId,
  isAdmin,
  projectId,
  revision,
  canEditPolicy,
  configureHref,
  onConfigureModels,
  onRecharge,
  selectedNode,
  activeScript,
  canvasNodes,
  getCanvasRevision,
  onApplyChatToCanvas,
  onProposalApplied,
  onOpenSkills,
  onNotify,
}: {
  visible: boolean;
  activeTab: "chat" | "proposals";
  onTabChange: (tab: "chat" | "proposals") => void;
  onClose: () => void;
  onDockedWidthChange: (width: number) => void;
  workspace: number;
  userId: number;
  isAdmin: boolean;
  projectId: string;
  revision: number;
  canEditPolicy: boolean;
  configureHref?: string;
  onConfigureModels?: (
    event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>,
  ) => void;
  onRecharge: () => void;
  selectedNode: CanvasNode | null;
  activeScript: { id: string; path: string; body_md: string } | null;
  canvasNodes: CanvasNode[];
  getCanvasRevision: () => Promise<number>;
  onApplyChatToCanvas: (
    cid: string,
    message: Message,
    mode: "new" | "replace",
  ) => Promise<void>;
  onProposalApplied: (canvas: any) => void;
  onOpenSkills: () => void;
  onNotify: (msg: string) => void;
}) {
  const [docked, setDocked] = useState(true);
  const [width, setWidth] = useState(400);
  const [floatPos, setFloatPos] = useState<{ right: number; bottom: number }>({
    right: 16,
    bottom: 16,
  });
  const [mentionOpen, setMentionOpen] = useState(false);
  const [scriptList, setScriptList] = useState<ScriptDocumentSummary[]>([]);
  const [pinnedMentions, setPinnedMentions] = useState<
    { key: string; kind: "script" | "node"; id: string; label: string; snippet: string }[]
  >([]);

  useEffect(() => {
    onDockedWidthChange(visible && docked ? width : 0);
  }, [visible, docked, width, onDockedWidthChange]);

  useEffect(() => {
    if (!mentionOpen) return;
    void scriptApi
      .list()
      .then((r) =>
        setScriptList(r.items.filter((i) => i.entry_type === "file")),
      )
      .catch(() => {});
  }, [mentionOpen]);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(
        320,
        Math.min(540, startW + (startX - ev.clientX)),
      );
      setWidth(next);
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  const startFloatDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (docked) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...floatPos };
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      setFloatPos({
        right: Math.max(
          12,
          Math.min(window.innerWidth - width - 12, orig.right + (startX - ev.clientX)),
        ),
        bottom: Math.max(
          12,
          Math.min(window.innerHeight - 360, orig.bottom + (startY - ev.clientY)),
        ),
      });
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  const addMention = (
    kind: "script" | "node",
    id: string,
    label: string,
    snippet: string,
  ) => {
    const key = `${kind}:${id}`;
    setPinnedMentions((prev) =>
      prev.some((m) => m.key === key)
        ? prev
        : [...prev.slice(-4), { key, kind, id, label, snippet }],
    );
    setMentionOpen(false);
    onNotify(`已挂载 @${label} 正文至对话上下文（提问时将由服务端授权注入）`);
  };

  if (!visible) return null;

  return (
    <aside
      className={"fm-floating-agent" + (docked ? " is-docked" : " is-floating")}
      aria-label="AI 创作助手与提案停靠栏"
      style={
        docked
          ? { width }
          : {
              width,
              right: floatPos.right,
              bottom: floatPos.bottom,
              height: "min(680px, calc(100dvh - 84px))",
            }
      }
    >
      <div
        className="fm-agent-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整 AI 创作助手宽度"
        onPointerDown={startResize}
      />

      <header
        className="fm-floating-agent-head"
        onPointerDown={startFloatDrag}
      >
        <div className="fm-floating-agent-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "chat"}
            className={activeTab === "chat" ? "active" : ""}
            onClick={() => onTabChange("chat")}
          >
            <MessageSquare size={14} />
            AI 创作助手
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "proposals"}
            className={activeTab === "proposals" ? "active" : ""}
            onClick={() => onTabChange("proposals")}
          >
            <Sparkles size={14} />
            画布提案箱
          </button>
        </div>

        <div className="fm-floating-agent-btns">
          <button
            type="button"
            className="icon-button"
            title="管理工作区 SKILL.md 技能包"
            aria-label="Skills"
            onClick={onOpenSkills}
          >
            <BookOpen size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={docked ? "切换为可拖拽悬浮窗" : "停靠到右侧"}
            aria-label={docked ? "切换为悬浮" : "停靠到右侧"}
            onClick={() => setDocked((v) => !v)}
          >
            {docked ? (
              <PictureInPicture2 size={15} />
            ) : (
              <PanelRight size={15} />
            )}
          </button>
          <button
            type="button"
            className="icon-button"
            title="收起 AI 创作助手"
            aria-label="关闭 Agent 提案箱"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {activeTab === "chat" ? (
        <div className="fm-floating-agent-chat">
          {/* Context & @ Mention Strip (Toonflow @ mention fusion!) */}
          <div className="fm-agent-context-strip">
            {activeScript && (
              <span
                className="fm-agent-ctx-chip"
                title={`当前打开剧本：${activeScript.path}`}
              >
                <FileText size={12} />
                {activeScript.path.split("/").at(-1)}
              </span>
            )}
            {selectedNode && (
              <span
                className="fm-agent-ctx-chip"
                title={`当前选中画布节点：${selectedNode.title}`}
              >
                <Layers size={12} />
                {selectedNode.title}
              </span>
            )}
            {pinnedMentions.map((m) => (
              <span key={m.key} className="fm-agent-ctx-chip pinned">
                @{m.label}
                <button
                  type="button"
                  aria-label={`移除引用 ${m.label}`}
                  onClick={() =>
                    setPinnedMentions((prev) =>
                      prev.filter((item) => item.key !== m.key),
                    )
                  }
                >
                  <X size={10} />
                </button>
              </span>
            ))}

            <div className="fm-agent-mention-wrap">
              <button
                type="button"
                className="fm-agent-mention-btn"
                onClick={() => setMentionOpen((v) => !v)}
              >
                <AtSign size={12} />
                引用剧本/节点
              </button>
              {mentionOpen && (
                <div className="fm-agent-mention-popover">
                  <div className="fm-mention-group-label">工作区剧本文档</div>
                  {scriptList.length === 0 ? (
                    <div className="fm-mention-empty">暂无剧本文档</div>
                  ) : (
                    scriptList.slice(0, 6).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() =>
                          addMention("script", s.id, s.name, s.preview)
                        }
                      >
                        <FileText size={13} />
                        <span>{s.path}</span>
                      </button>
                    ))
                  )}
                  <div className="fm-mention-group-label">当前画布节点</div>
                  {canvasNodes.length === 0 ? (
                    <div className="fm-mention-empty">画布暂无节点</div>
                  ) : (
                    canvasNodes.slice(0, 8).map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() =>
                          addMention(
                            "node",
                            n.id,
                            n.title,
                            n.text || n.prompt,
                          )
                        }
                      >
                        <Layers size={13} />
                        <span>{n.title}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="fm-agent-chat-host">
            <ChatWorkspace
              compact
              workspace={workspace}
              userId={userId}
              isAdmin={isAdmin}
              configureHref={configureHref}
              onConfigureModels={onConfigureModels}
              onRecharge={onRecharge}
              project={projectId}
              node={selectedNode?.id}
              nodeTitle={
                selectedNode?.title ||
                (activeScript
                  ? `剧本 · ${activeScript.path.split("/").at(-1)}`
                  : "画布与剧本助手")
              }
              getContext={async () => {
                const scriptIds = [
                  ...(activeScript ? [activeScript.id] : []),
                  ...pinnedMentions
                    .filter((m) => m.kind === "script")
                    .map((m) => m.id),
                ].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);
                const nodeIds = [
                  ...(selectedNode ? [selectedNode.id] : []),
                  ...pinnedMentions
                    .filter((m) => m.kind === "node")
                    .map((m) => m.id),
                ].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);
                return {
                  project: projectId,
                  node: selectedNode?.id || "",
                  expected_revision: await getCanvasRevision(),
                  ...(scriptIds.length ? { script_ids: scriptIds.slice(0, 6) } : {}),
                  ...(nodeIds.length ? { node_ids: nodeIds.slice(0, 6) } : {}),
                };
              }}
              onApply={async (cid, message, mode) => {
                await onApplyChatToCanvas(cid, message, mode);
              }}
            />
          </div>
        </div>
      ) : (
        <div className="fm-floating-agent-proposals">
          <ProposalDiffPreview
            embedded
            workspace={workspace}
            projectId={projectId}
            revision={revision}
            canEditPolicy={canEditPolicy}
            onApplied={onProposalApplied}
            onOpenSkills={onOpenSkills}
            onClose={onClose}
          />
        </div>
      )}
    </aside>
  );
}
