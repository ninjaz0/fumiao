import type { CanvasNodeEntry } from "@fumiao/plugin-sdk/canvas-nodes";
import { PluginNodeForm, PluginNodePorts, PluginNodeOutputs } from "./PluginNode";
import {
  evaluateFormConstraints,
  matches,
  normalizeForm,
  type FormValues,
} from "@fumiao/plugin-sdk/model-form";
import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {H3Prompt} from './H3Prompt';
import {portableReferences,remapH3Prompt} from './h3References';
import {H3Inputs,mediaType} from './H3Inputs';
import * as FlowPicker from './flowPicker';
import {
  ReactFlow,
  Handle,
  Position,
  MiniMap,
  NodeResizer,
  useReactFlow,
  useViewport,
  SelectionMode,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import {
  ArrowLeft,
  ArrowUp,
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Copy,
  Download,
  FileText,
  Film,
  FolderOpen,
  Hand,
  Image as ImageIcon,
  Link2,
  Link2Off,
  Map as MapIcon,
  Maximize,
  MousePointer2,
  Plus,
  Redo2,
  Search,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
  Clock,
  RefreshCw,
  LayoutGrid,
  ListVideo,
  Columns2,
  Palette,
  LoaderCircle,
  Play,
  Square,
  AtSign,
  Settings2,
  AlertCircle,
  Layers,
  Crop,
  Clapperboard,
  List,
  Sparkles,
  BookOpen,
  MessageSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, upload, downloadJSON, ApiError, workspaceURL } from "./api";
import { useDocument } from "./useDocument";
import {
  newNode,
  names,
  resolveNode,
  videoSeconds,
  connectionError,
  createClipboardSnapshot,
  resolvePasteOffset,
  nextContextSelection,
  collectDownloadTargets,
  hasDownloadableNodes,
  textDownloadFilename,
  canvasMediaDownloadFilename,
  shouldRedirectRunsError,
  formatRunsError,
  resolveHistoryModalState,
  resolveFocusTargets,
  matchViewportFocusShortcut,
  isCanvasComposerOpen,
  hasCanvasSelectionToolbar,
  resolveBatchShots,
  resolveCinePopoverPlacement,
  resolveNextShotContinuation,
  reconcileCanvasRightDocks,
  resolveCanvasWorkspaceTop,
  resolveCanvasSpeechModels,
  quoteCanvasSpeechPlan,
  linkedValue,
  type CanvasClipboard,
  type CanvasNode,
  type CinematographySpec,
  type Kind,
  type Project,
  type Job,
  type Studio,
  type Params,
  type CanvasGenerationMode,
  type PrecheckStage,
} from "./types";
import {ChatWorkspace, chatRequest} from "./chat/ChatWorkspace";
import { chatSettingsPath } from "./chat/guidance";
import { ShotList } from "./ShotList";
import { VideoVersions } from "./VideoVersions";
import { cameraMotion } from "../app/motion";
import { AiStoryboard } from "./AiStoryboard";
import { Narration } from "./Narration";
import { Composition } from "./Composition";
import { AssetPacks, type Pack } from "./AssetPacks";
import { CinematographyPanel } from "./CinematographyPanel";
import { OptionSelect, SegmentedOptions } from "./OptionSelect";
import { isBgmMusicModel } from "@fumiao/plugin-sdk/speech-routing";
import {
  GENERATION_MODE_OPTIONS,
  GRID_LAYOUT_OPTIONS,
  countActiveCinematography,
  resolveEffectiveGenerationMode,
} from "./composer-options";
import { GridCropModal } from "./GridCropModal";
import { PrecheckCostModal } from "./PrecheckCostModal";
import { ReferencePromptInput } from "./ReferencePromptInput";
import { FloatingCanvasAgent } from "./FloatingCanvasAgent";
import {
  ScriptWorkspace,
  type ScriptWorkspaceHandle,
} from "./ScriptWorkspace";
import { scriptApi, type WorkspaceCanvasSummary } from "./script-api";
import {
  buildCanvasLocalBackup,
  createCanvasRunsTracker,
  resolveChatReplaceTarget,
} from "./script-fusion";
import { captureFrame } from "./videoFrame";
import { VideoThumb } from "./VideoThumb";
import { canvasVideoThumbnails } from "./videoThumbnails";
import {
  buildNodeHandles,
  computeGridGap,
  computeOverlayPositions,
  indexRunsByNode,
  reconcileRuns,
  resolveNodeFromIndex,
  shouldVirtualizeCanvas,
  studioFingerprint,
} from "./performance";

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,image/avif,image/tiff,image/bmp,image/gif,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif,.tif,.tiff,.bmp,.gif";
const imageFile = (file: File) => /\.(jpe?g|png|webp|heic|heif|avif|tiff?|bmp|gif)$/i.test(file.name) || ["image/jpeg","image/png","image/webp","image/heic","image/heif","image/heic-sequence","image/heif-sequence","image/avif","image/tiff","image/bmp","image/x-ms-bmp","image/gif"].includes(file.type);
const icons: Record<Kind, LucideIcon> = {
  text: Type,
  image: ImageIcon,
  video: Film,
  sticky: StickyNote,
  plugin: Settings2,
  group: Layers,
};
function freePosition(
  nodes: CanvasNode[],
  x: number,
  y: number,
  width = 360,
  height = 280,
) {
  const start = x;
  for (let i = 0; i < 200; i++) {
    if (
      !nodes.some(
        (n) =>
          x < n.x + n.width + 48 &&
          x + width + 48 > n.x &&
          y < n.y + n.height + 48 &&
          y + height + 48 > n.y,
      )
    )
      return { x, y };
    x += width + 100;
    if (i % 3 === 2) {
      x = start;
      y += height + 90;
    }
  }
  return { x, y };
}
const labels: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  done: "已完成",
  failed: "生成失败",
  cancelled: "已取消",
};
const BGM_ACTIVE_STATUSES = new Set([
  "queued",
  "dispatching",
  "running",
  "finalizing",
  "uncertain",
]);
const colors = ["none", "mint", "blue", "purple", "orange", "yellow"];
const colorNames = ["无标签", "青绿", "蓝色", "紫色", "橙色", "黄色"];
const mediaURL = (id: string) => "/media/" + id;
type Preview = { node: CanvasNode; media: string; run?: Job };
function IconButton({
  icon: Icon,
  label,
  active = false,
  children,
  ...props
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  children?: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={"icon-button " + (active ? "active" : "")}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      {...props}
    >
      <Icon size={18} />
      {children}
    </button>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={"cv-dialog " + (wide ? "wide" : "")}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current!.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
      aria-label={title}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <IconButton icon={X} label="关闭" onClick={onClose} />
      </div>
      {children}
    </dialog>
  );
}
function duration(seconds: number) {
  const unit = seconds >= 3600 ? 60 : seconds >= 60 ? 15 : 5;
  const value = Math.max(5, Math.round(Math.max(0, seconds) / unit) * unit);
  const h = Math.floor(value / 3600), m = Math.floor(value % 3600 / 60), s = value % 60;
  return [h ? `${h} 小时` : '', m ? `${m} 分` : '', s ? `${s} 秒` : ''].filter(Boolean).join(' ');
}
function timeLabel(j?: Job) {
  if (!j) return "";
  const eta = j.eta || {};
  if (j.status === "queued") {
    if (eta.reason === "waiting_gpu") return "等待 GPU 上线";
    if (eta.reason === "service_paused") return "等待图片服务开启";
    if (eta.reason === "observing") return "观测中";
    return Number.isFinite(eta.high)
      ? (eta.median ?? eta.high) > 0 ? `预计约 ${duration(eta.median ?? eta.high)}后开始` : "等待开始"
      : "排队中";
  }
  if (j.status === "running") {
    if (eta.phase === "uploading") return "正在回传";
    if (eta.phase === "validating") return "正在校验";
    if (eta.phase === "finalizing") return "正在整理成片";
    if (eta.overdue) return "生成时间较长，仍在处理中";
    return Number.isFinite(eta.high)
      ? (eta.median ?? eta.high) > 0 ? `预计还需约 ${duration(eta.median ?? eta.high)}` : "仍在生成，请稍候"
      : "正在生成";
  }
  return labels[j.status] || "";
}
function useTheme() {
  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme || "light",
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setTheme(document.documentElement.dataset.theme || "light"),
    );
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);
  return theme === "dark" ? "dark" : "light";
}

const EDGE_STYLE = { stroke: "var(--cv-edge)", strokeWidth: 1.4 } as const;
const FLOW_GRID_STYLE: React.CSSProperties = {
  backgroundImage: "radial-gradient(circle, var(--cv-dot) 1px, transparent 1px)",
  backgroundSize: "var(--cv-grid-gap, 24px) var(--cv-grid-gap, 24px)",
  backgroundPosition: "var(--cv-grid-x, 200px) var(--cv-grid-y, 140px)",
};
const TOOLBAR_POSITION_STYLE: React.CSSProperties = {
  left: "var(--cv-toolbar-left, 76px)",
  top: "var(--cv-toolbar-top, 100px)",
};
const COMPOSER_POSITION_STYLE: React.CSSProperties = {
  left: "var(--cv-composer-left, 76px)",
  top: "var(--cv-composer-top, 100px)",
};
const DOWNSTREAM_POSITION_STYLE: React.CSSProperties = {
  left: "var(--cv-downstream-left, 135px)",
  top: "var(--cv-downstream-top, 150px)",
};
const ARIA_LABEL_CONFIG = {
  "node.a11yDescription.default":
    "按 Enter 选中节点，方向键移动，Delete 删除。",
  "edge.a11yDescription.default": "按 Enter 选中连线，Delete 移除引用。",
  "controls.zoomIn.ariaLabel": "放大",
  "controls.zoomOut.ariaLabel": "缩小",
};

const CanvasViewportEffects = memo(function CanvasViewportEffects({
  workspaceRef,
  anchorNode,
  hasDownstream,
  panelHeight,
  windowSize,
}: {
  workspaceRef: React.RefObject<HTMLDivElement | null>;
  anchorNode: Pick<CanvasNode, "x" | "y" | "width" | "height" | "type"> | null;
  hasDownstream: boolean;
  panelHeight: number;
  windowSize: { w: number; h: number };
}) {
  const viewport = useViewport();
  const lastZoomRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    if (lastZoomRef.current !== viewport.zoom) {
      lastZoomRef.current = viewport.zoom;
      el.style.setProperty("--zoom", String(viewport.zoom));
      el.style.setProperty(
        "--cv-grid-gap",
        `${computeGridGap(viewport.zoom)}px`,
      );
      el.dataset.lod =
        viewport.zoom < 0.35 ? "low" : viewport.zoom < 0.7 ? "med" : "high";
    }
    el.style.setProperty("--cv-grid-x", `${viewport.x}px`);
    el.style.setProperty("--cv-grid-y", `${viewport.y}px`);
    if (anchorNode || hasDownstream) {
      const positions = computeOverlayPositions({
        viewport,
        windowSize,
        node: anchorNode,
        panelHeight,
      });
      if (positions.toolbar) {
        el.style.setProperty("--cv-toolbar-left", `${positions.toolbar.left}px`);
        el.style.setProperty("--cv-toolbar-top", `${positions.toolbar.top}px`);
      }
      if (positions.composer) {
        el.style.setProperty(
          "--cv-composer-left",
          `${positions.composer.left}px`,
        );
        el.style.setProperty(
          "--cv-composer-top",
          `${positions.composer.top}px`,
        );
      }
      if (hasDownstream) {
        el.style.setProperty(
          "--cv-downstream-left",
          `${positions.downstream.left}px`,
        );
        el.style.setProperty(
          "--cv-downstream-top",
          `${positions.downstream.top}px`,
        );
      }
    }
  }, [
    workspaceRef,
    viewport.x,
    viewport.y,
    viewport.zoom,
    anchorNode?.x,
    anchorNode?.y,
    anchorNode?.width,
    anchorNode?.height,
    anchorNode?.type,
    hasDownstream,
    panelHeight,
    windowSize.w,
    windowSize.h,
  ]);
  return null;
});

const ZoomPercent = memo(function ZoomPercent() {
  const { zoom } = useViewport();
  return <>{Math.round(zoom * 100)}%</>;
});

const ZoomCheck = memo(function ZoomCheck({ target }: { target: number }) {
  const { zoom } = useViewport();
  return Math.abs(zoom - target) < 0.01 ? <Check size={14} /> : null;
});

const FloatingCinematographyPopover = memo(function FloatingCinematographyPopover({
  anchorNode,
  panelHeight,
  windowSize,
  headerBottom,
  viewMode,
  agentDock,
  agentDockedWidth,
  mediaPanelRef,
  value,
  onChange,
  onClose,
}: {
  anchorNode: Pick<CanvasNode, "x" | "y" | "width" | "height" | "type">;
  panelHeight: number;
  windowSize: { w: number; h: number };
  headerBottom: number;
  viewMode: "canvas" | "split" | "list";
  agentDock: boolean;
  agentDockedWidth: number;
  mediaPanelRef: React.RefObject<HTMLElement | null>;
  value?: CinematographySpec | null;
  onChange: (next: CinematographySpec | null) => void;
  onClose: () => void;
}) {
  const viewport = useViewport();
  const computedComposer = computeOverlayPositions({
    viewport,
    windowSize,
    node: anchorNode,
    panelHeight,
  }).composer;
  const rect = mediaPanelRef.current?.getBoundingClientRect();
  const composerLeft = computedComposer?.left ?? rect?.left ?? 76;
  const composerTop = computedComposer?.top ?? rect?.top;
  const composerWidth = rect && rect.width > 0 ? rect.width : 520;
  const composerHeight = rect && rect.height > 0 ? rect.height : panelHeight;
  const placement = resolveCinePopoverPlacement({
    composerLeft,
    composerTop,
    composerWidth,
    composerHeight,
    windowWidth: windowSize.w,
    windowHeight: windowSize.h,
    headerBottom,
    viewMode,
    agentDock,
    agentDockedWidth,
  });
  const popoverStyle: React.CSSProperties =
    windowSize.w <= 760
      ? {}
      : placement.side === "viewport"
        ? {
            top: placement.fixedTop,
            right: placement.fixedRight,
            maxHeight: placement.maxHeight,
          }
        : {
            maxHeight: placement.maxHeight,
          };
  return (
    <CinematographyPanel
      compact
      floating
      side={placement.side}
      verticalAlign={placement.verticalAlign}
      style={popoverStyle}
      value={value}
      onChange={onChange}
      onClose={onClose}
    />
  );
});

type ContextValue = {
  edit: (id: string, patch: Partial<CanvasNode>, history?: boolean) => void;
  begin: () => void;
  end: () => void;
  downstream: (id: string) => void;
  selectMedia: (id: string) => void;
  preview: (node: CanvasNode) => void;
  beginEditing: (id: string) => void;
  setEditing: (id: string | null) => void;
  rerunGroup: (groupId: string) => void;
  ungroup: (groupId: string) => void;
};
const NodeContext = createContext<ContextValue>(null!);
type NodeData = {
  videoPort: boolean;
  editing: boolean;
  item: CanvasNode;
  media: string | null;
  run?: Job;
  childCount?: number;
};
type RFNode = FlowNode<NodeData, "content">;
const ContentNode = memo(function ContentNode({
  data,
  selected,
}: NodeProps<RFNode>) {
  const { item: n, media, run, editing, childCount } = data,
    ctx = useContext(NodeContext),
    Icon = icons[n.type],
    isText = n.type === "text" || n.type === "sticky",
    isGroup = n.type === "group";
  if (isGroup) {
    return (
      <div
        className={
          "content-node kind-group fm-group-node" +
          (selected ? " selected" : "") +
          " tag-" +
          n.color
        }
      >
        <NodeResizer
          isVisible={selected}
          minWidth={260}
          minHeight={180}
          maxWidth={3200}
          maxHeight={3200}
          onResizeStart={ctx.begin}
          onResizeEnd={ctx.end}
        />
        <div className="node-title fm-group-header">
          <Layers size={14} />
          <input
            className="nodrag"
            aria-label={"工作流组名称 " + n.title}
            value={n.title}
            maxLength={80}
            onFocus={ctx.begin}
            onChange={(e) => ctx.edit(n.id, { title: e.target.value }, false)}
            onBlur={ctx.end}
          />
          <span className="fm-group-badge">{childCount ?? 0} 节点</span>
          <button
            type="button"
            className="nodrag fm-group-btn"
            title="预检并局部重跑该工作流组"
            onClick={(e) => {
              e.stopPropagation();
              ctx.rerunGroup(n.id);
            }}
          >
            <Play size={12} />
            局部重跑
          </button>
          <button
            type="button"
            className="nodrag fm-group-btn"
            title="解散工作流组（保留子节点）"
            onClick={(e) => {
              e.stopPropagation();
              ctx.ungroup(n.id);
            }}
          >
            解散
          </button>
        </div>
      </div>
    );
  }
  return (
    <div
      className={
        "content-node kind-" +
        n.type +
        (selected ? " selected" : "") +
        " tag-" +
        n.color
      }
    >
      <NodeResizer
        isVisible={selected && isText && !editing}
        minWidth={200}
        minHeight={140}
        maxWidth={1000}
        maxHeight={1000}
        onResizeStart={ctx.begin}
        onResizeEnd={ctx.end}
      />
      <div className="node-title">
        <Icon size={14} />
        <input
          className="nodrag"
          aria-label={"节点名称 " + n.title}
          value={n.title}
          maxLength={80}
          onFocus={ctx.begin}
          onChange={(e) => ctx.edit(n.id, { title: e.target.value }, false)}
          onBlur={ctx.end}
        />
        {n.color !== "none" && <span className={"tag-dot " + n.color} />}
      </div>
      <div
        className="node-content"
        onDoubleClick={() => {
          if (isText) ctx.beginEditing(n.id);
          else if (media) ctx.preview(n);
        }}
      >
        {n.extension ? <PluginNodeOutputs extension={n.extension}/> : isText ? (
          editing ? (
            <textarea
              autoFocus
              className="nodrag nowheel node-text"
              aria-label={n.type === "text" ? "文本内容" : "便签内容"}
              placeholder={n.type === "text" ? "输入文本" : "写下想法"}
              value={n.text}
              maxLength={12000}
              onChange={(e) => ctx.edit(n.id, { text: e.target.value }, false)}
              onBlur={() => {
                ctx.end();
                ctx.setEditing(null);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  if (n.type === "sticky") {
                    e.currentTarget
                      .closest<HTMLElement>(".react-flow__node")
                      ?.focus();
                  } else e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <div className="text-display">
              {n.text || (
                <span>
                  {n.type === "text" ? "双击输入文本" : "按 Enter 或双击添加便签"}
                </span>
              )}
            </div>
          )
        ) : media ? (
          n.type === "image" ? (
            <img
              src={mediaURL(media) + "?variant=thumb"}
              onError={(ev) => {
                if (!ev.currentTarget.dataset.fallback) {
                  ev.currentTarget.dataset.fallback = "1";
                  ev.currentTarget.src = mediaURL(media);
                }
              }}
              alt={n.title}
              draggable={false}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="node-video">
              <VideoThumb mediaId={media} alt={n.title} />
              <button
                className="node-play nodrag"
                aria-label={"播放 " + n.title}
                onClick={() => ctx.preview(n)}
              >
                <Play size={24} />
              </button>
            </div>
          )
        ) : (
          <div className="node-placeholder">
            {run && ["queued", "running"].includes(run.status) ? (
              <>
                <LoaderCircle size={26} className="spin" />
                <span>{timeLabel(run)}</span>
              </>
            ) : run?.status === "failed" ? (
              <>
                <AlertCircle size={26} />
                <span>生成失败</span>
              </>
            ) : (
              <>
                <Icon size={28} />
                {selected && n.type === "image" && (
                  <button
                    className="nodrag"
                    onClick={() => ctx.selectMedia(n.id)}
                  >
                    导入图片
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {n.extension && <PluginNodePorts definition={n.extension.definition}/>}
      {["image", "video"].includes(n.type) && (
        <Handle
          type="target"
          position={Position.Left}
          className="reference-handle"
          aria-label={"连接到 " + n.title}
        />
      )}
      {(["text", "image"].includes(n.type) || (n.type === "video" && data.videoPort)) && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            className="reference-handle"
            aria-label={"从 " + n.title + " 连接"}
          />
          {selected && n.type !== "video" && (
            <button
              className="node-add nodrag"
              aria-label={"从 " + n.title + " 新建连接"}
              title="新建连接"
              onClick={() => ctx.downstream(n.id)}
            >
              <Plus size={14} />
            </button>
          )}
        </>
      )}
    </div>
  );
});
const nodeTypes = { content: ContentNode };

export function CanvasWorkspace({
  project,
  studio: initial,
}: {
  project: Project;
  studio: Studio;
}) {
  const doc = useDocument(project, initial.me.id),
    [studio, setStudio] = useState(initial),
    [runs, setRuns] = useState<Job[]>([]),
    [runsLoaded, setRunsLoaded] = useState(false),
    [runsLoading, setRunsLoading] = useState(true),
    [runsError, setRunsError] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const aliveRef = useRef(true),
    runsLoadedRef = useRef(false),
    runsTrackerRef = useRef(
      createCanvasRunsTracker<Job>({
        reconcile: reconcileRuns,
        isAlive: () => aliveRef.current,
      }),
    );
  const [editing, setEditing] = useState<string | null>(null),
    [hand, setHand] = useState(false),
    [minimap, setMinimap] = useState(false),
    [showEdges, setShowEdges] = useState(true),
    [toast, setToast] = useState("");
  const [archived, setArchived] = useState(project.archived_at != null);
  const [archivePending, setArchivePending] = useState(false);
  const archiveLock = useRef(false);
  const projectMenuTrigger = useRef<HTMLSpanElement>(null);
  const projectMenu = useRef<HTMLDivElement>(null);
  const canvasListPath = archived ? "/canvas?view=archived" : "/canvas";
  type LeaveTarget =
    | { kind: "navigate"; path: string }
    | { kind: "create" }
    | { kind: "duplicate" }
    | { kind: "reload" };
  const [leaveFailure, setLeaveFailure] = useState<{
    target: LeaveTarget;
    message: string;
    retained: boolean;
  } | null>(null);
  const [retryingLeave, setRetryingLeave] = useState(false);
  const [headerBottom, setHeaderBottom] = useState(60);
  const [workspaceTop, setWorkspaceTop] = useState(60);
  const [rightObstruction, setRightObstruction] = useState(0);
  const leaveInFlight = useRef(false);
  const [activeTextNodes,setActiveTextNodes]=useState<string[]>([]);
  const textApplyQueue=useRef<Promise<void>>(Promise.resolve());
  const textPanelRef=useRef<HTMLElement|null>(null);
  const [textPanelHeight,setTextPanelHeight]=useState(180);
  const mediaPanelRef=useRef<HTMLElement|null>(null);
  const [mediaPanelHeight,setMediaPanelHeight]=useState(270);
  const [panel, setPanel] = useState<
      "assets" | "search" | "history" | "references" | null
    >(null),
    [pickerTarget, setPickerTarget] = useState<string | null>(null),
    [downstream, setDownstream] = useState<string | null>(null),
    [context, setContext] = useState<{
      x: number;
      y: number;
      node?: string;
    } | null>(null);
  const [menu, setMenu] = useState<
      | "project"
      | "zoom"
      | "format"
      | "model"
      | "duration"
      | "advanced"
      | "colors"
      | "versions"
      | "candidates"
      | null
    >(null),
    [submitting, setSubmitting] = useState<string | null>(null),
    [progress, setProgress] = useState<number | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [confirm, setConfirm] = useState<null | (() => void)>(null);
  const [agentDock, setAgentDock] = useState(false);
  const [viewMode, setViewModeState] = useState<"canvas" | "split" | "list">(() => {
    try {
      const saved = localStorage.getItem("fm-canvas-view-mode");
      if (saved === "canvas" || saved === "split" || saved === "list") return saved;
    } catch {
      // Ignore storage failures in restricted contexts.
    }
    return "canvas";
  });
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const setViewMode = useCallback(
    (
      next:
        | "canvas"
        | "split"
        | "list"
        | ((prev: "canvas" | "split" | "list") => "canvas" | "split" | "list"),
    ) => {
      const resolved =
        typeof next === "function" ? next(viewModeRef.current) : next;
      viewModeRef.current = resolved;
      setViewModeState(resolved);
      if (
        resolved !== "canvas" &&
        typeof window !== "undefined" &&
        window.innerWidth <= 1100
      ) {
        setAgentDock(false);
      }
      try {
        localStorage.setItem("fm-canvas-view-mode", resolved);
      } catch {
        // Ignore storage failures.
      }
    },
    [],
  );
  const [precheckTarget, setPrecheckTarget] = useState<{
    nodeIds: string[];
    title?: string;
    stages?: PrecheckStage[];
  } | null>(null);
  const [gridCropTarget, setGridCropTarget] = useState<{
    nodeId: string;
    mediaId: string;
    layout: "2x2" | "3x3";
  } | null>(null);
  const [showCinePanel, setShowCinePanel] = useState(false);
  const [pendingBgmJobId, setPendingBgmJobId] = useState<number | null>(null);
  const [pendingProposals, setPendingProposals] = useState(0);
  useEffect(() => {
    let active = true;
    const syncProposals = () => {
      void api<{ proposals?: { status: string }[] }>(
        `/api/canvases/${project.id}/proposals?workspace=${project.workspace}`,
      )
        .then((data) => {
          if (!active) return;
          setPendingProposals(
            (data.proposals ?? []).filter((p) => p.status === "pending").length,
          );
        })
        .catch(() => {});
    };
    syncProposals();
    const timer = setInterval(syncProposals, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [project.id, project.workspace]);
  const [surface, setSurface] = useState<"canvas" | "document">("canvas");
  const [scriptWorkspaceMounted, setScriptWorkspaceMounted] = useState(false);
  const [agentTab, setAgentTab] = useState<"chat" | "proposals">("chat");
  const [agentDockedWidth, setAgentDockedWidth] = useState(0);
  const [activeScript, setActiveScript] = useState<{
    id: string;
    path: string;
    body_md: string;
  } | null>(null);
  const scriptWorkspaceRef = useRef<ScriptWorkspaceHandle | null>(null);
  const [scriptJumpReq, setScriptJumpReq] = useState<{
    docId: string;
    anchor?: string;
    shotId?: string;
    line?: number;
    seq: number;
  } | null>(null);
  const [projectCanvases, setProjectCanvases] = useState<
    WorkspaceCanvasSummary[]
  >([]);
  const [projectSearch, setProjectSearch] = useState("");
  useEffect(() => {
    if (menu !== "project") return;
    setProjectSearch("");
    void scriptApi
      .listCanvases()
      .then((res) => setProjectCanvases(res.projects))
      .catch(() => {});
  }, [menu]);
  const [aiStoryboard, setAiStoryboard] = useState(false);
  const [packPicker, setPackPicker] = useState<string | null>(null);
  const [packMedia, setPackMedia] = useState<Record<string,string[]>>({});
  const [availablePacks, setAvailablePacks] = useState<Pack[]>([]);
  useEffect(()=>{let active=true;void api<{packs:Pack[]}>('/api/asset-packs').then(data=>{if(active){setAvailablePacks(data.packs);setPackMedia(Object.fromEntries(data.packs.map((p)=> [p.id,p.media])))}}).catch(()=>{});return()=>{active=false}},[project.id]);
  const [candidateCount, setCandidateCount] = useState<1 | 2>(1);
  const [confirmCandidates, setConfirmCandidates] = useState(false);
  const [compareNode, setCompareNode] = useState<string | null>(null);
  const [sharedReference, setSharedReference] = useState<string | null>(null);
  const [referenceTargets, setReferenceTargets] = useState<string[]>([]);
  const [frameError, setFrameError] = useState("");
  const [showCrop, setShowCrop] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [modelSearch,setModelSearch]=useState('');
  const previewPlayer = useRef<HTMLVideoElement>(null);
  const [find, setFind] = useState(""),
    [assetType, setAssetType] = useState<"all" | "image" | "video">("all"),
    [assetSelection, setAssetSelection] = useState<Set<string>>(new Set()),
    [windowSize, setWindowSize] = useState({ w: innerWidth, h: innerHeight });
  const flow = useReactFlow<RFNode>(),
    theme = useTheme(),
    workspaceRef = useRef<HTMLDivElement | null>(null),
    runsRef = useRef(runs),
    studioRef = useRef(studio),
    lastPolledStudioRef = useRef<{ fp: string; value: Studio } | null>(null),
    rfNodeCacheRef = useRef(new Map<string, RFNode>()),
    rfEdgeCacheRef = useRef(new Map<string, FlowEdge>()),
    moveResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    fileRef = useRef<HTMLInputElement>(null),
    modelButtonRef = useRef<HTMLButtonElement>(null),
    modelMenuRef = useRef<HTMLDivElement>(null),
    fileTarget = useRef<string | null>(null),
    clipboard = useRef<CanvasClipboard | null>(null),
    dragging = useRef(false);
  runsRef.current = runs;
  studioRef.current = studio;
  useEffect(() => {
    const input = fileRef.current;
    const cancel = () => { fileTarget.current = null; };
    input?.addEventListener("cancel", cancel);
    return () => input?.removeEventListener("cancel", cancel);
  }, []);
  useEffect(() => {
    if (preview?.node.type === "video") {
      canvasVideoThumbnails.pause("preview-open");
      return () => canvasVideoThumbnails.resume("preview-open");
    }
  }, [preview?.node.type]);
  useEffect(
    () => () => {
      if (moveResumeTimerRef.current !== null) {
        clearTimeout(moveResumeTimerRef.current);
        moveResumeTimerRef.current = null;
      }
      canvasVideoThumbnails.resume("viewport-move");
      canvasVideoThumbnails.resume("preview-open");
    },
    [],
  );
  const runsByNode = useMemo(() => indexRunsByNode(runs), [runs]);
  const runById = useMemo(
    () => new Map(runs.map((job) => [job.id, job])),
    [runs],
  );
  const nodeById = useMemo(
    () => new Map(doc.value.document.nodes.map((node) => [node.id, node])),
    [doc.value.document.nodes],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedNodes = useMemo(
    () => doc.value.document.nodes.filter((n) => selectedSet.has(n.id)),
    [doc.value.document.nodes, selectedSet],
  );
  const canDownloadSelected = useMemo(
    () => hasDownloadableNodes(selectedNodes, runs),
    [selectedNodes, runs],
  );
  const active = selected[0] ? nodeById.get(selected[0]) : undefined,
    single = selected.length === 1 && active ? active : null;
  const current = single ? resolveNodeFromIndex(single, runsByNode) : null;
  const completedVersions = current?.list.filter((job) => job.status === "done" && job.result) ?? [];
  const shotIds = doc.value.document.shots ?? [];
  const batchShots = useMemo(
    () => resolveBatchShots(selectedNodes, selected, shotIds),
    [selectedNodes, selected, shotIds],
  );
  const studioJobByResult = useMemo(() => {
    const map = new Map<string, Job>();
    for (const job of studio.jobs) {
      if (job.result && !map.has(job.result)) map.set(job.result, job);
    }
    return map;
  }, [studio.jobs]);
  const availableModel = useCallback(
    (model: string) =>
      !!studio.model_forms?.[model]?.canvas &&
      (studio.model_access || studio.model_policy?.enabled)?.[model] === true &&
      (model !== "gpt-image-2.6-sunburst" || studio.images.configured) &&
      (studio.model_catalog?.[model]?.provider !== "flow" ||
        Boolean(studio.flow?.configured)),
    [
      studio.model_forms,
      studio.model_access,
      studio.model_policy,
      studio.images.configured,
      studio.model_catalog,
      studio.flow?.configured,
    ],
  );
  const formatVideoModelLabel = useCallback(
    (modelId: string) =>
      FlowPicker.label(studio.model_catalog, modelId) ||
      studio.video_models?.[modelId] ||
      studio.model_catalog?.[modelId]?.label ||
      modelId,
    [studio.model_catalog, studio.video_models],
  );
  const resolveNodeTailContinuation = useCallback(
    (node: CanvasNode, run?: Job) =>
      resolveNextShotContinuation(
        studio,
        node.params.model,
        {
          ratio: run?.ratio || node.params.ratio,
          seconds: run?.seconds || node.params.seconds,
        },
        availableModel,
        formatVideoModelLabel,
      ),
    [studio, availableModel, formatVideoModelLabel],
  );
  const shots = useMemo(
    () =>
      shotIds.flatMap((id) => {
        const node = nodeById.get(id);
        if (!node) return [];
        const { run, media } = resolveNodeFromIndex(node, runsByNode);
        const source = run ?? (media ? studioJobByResult.get(media) : undefined);
        const voice = node.narration_job
          ? runById.get(node.narration_job)
          : undefined;
        return [
          {
            id,
            title: node.title,
            media,
            adopted: node.active_job,
            prompt: node.prompt,
            generation_mode: node.generation_mode,
            cinematography: node.cinematography ?? null,
            tailContinuation: media
              ? resolveNodeTailContinuation(node, source)
              : null,
            seconds: Math.max(
              videoSeconds(source) || node.params.seconds,
              voice?.status === "done" ? voice.actual?.duration || 0 : 0,
            ),
            status: run ? labels[run.status] || "待生成" : "待生成",
          },
        ];
      }),
    [
      shotIds,
      nodeById,
      runsByNode,
      runById,
      studioJobByResult,
      resolveNodeTailContinuation,
    ],
  );
  const compositionIssue = useMemo(() => {
    if (viewMode === "canvas") return "";
    if (shots.reduce((sum, shot) => sum + shot.seconds, 0) > 900) {
      return "成片最多 15 分钟（900 秒），请减少镜头或缩短旁白";
    }
    for (let index = 0; index < shotIds.length; index++) {
      const node = nodeById.get(shotIds[index]);
      if (!node) continue;
      if (!resolveNodeFromIndex(node, runsByNode).media) {
        return `镜头 ${index + 1} 的视频尚未就绪`;
      }
      const pending = node.narration_pending
        ? runById.get(node.narration_pending)
        : undefined;
      if (pending && ["queued", "running"].includes(pending.status)) {
        return `镜头 ${index + 1} 的旁白仍在生成`;
      }
      const voice = node.narration_job
        ? runById.get(node.narration_job)
        : undefined;
      if (node.narration_text?.trim() && (!voice?.result || voice.status !== "done")) {
        return `请先生成镜头 ${index + 1} 的旁白`;
      }
      if (voice && voice.prompt.trim() !== (node.narration_text || "").trim()) {
        return `镜头 ${index + 1} 的文稿已修改，请更新旁白`;
      }
    }
    return "";
  }, [viewMode, shots, shotIds, nodeById, runsByNode, runById]);
  const compared = compareNode ? nodeById.get(compareNode) : undefined;
  const comparisonRuns = compared ? resolveNodeFromIndex(compared, runsByNode).list.filter((job) => job.status === "done" && job.result) : [];
  const defaultImageModel =
    (studio.images.default_model && availableModel(studio.images.default_model)
      ? studio.images.default_model
      : Object.keys(studio.images.models || {}).find(availableModel)) || "";
  const defaultVideoModel =
    Object.keys(studio.video_models || {}).find(availableModel) || "";
  const imagesEnabled = Object.keys(studio.images.models || {}).some(availableModel);
  const rawModelChoices = Object.entries(single?.type==='image' ? studio.images.models || {} : studio.video_models || {}).filter(([model])=>availableModel(model));
  const requestedModel = single?.params.model || (single?.type === 'image' ? (defaultImageModel || 'gpt-image-2.6-sunburst') : defaultVideoModel);
  useEffect(() => {
    setShowCinePanel(false);
  }, [single?.id]);
  const selectedModel = rawModelChoices.some(([id])=>id===requestedModel) ? requestedModel : FlowPicker.resolve(studio.model_catalog,requestedModel,availableModel,single?.params) || rawModelChoices[0]?.[0] || '';
  const modelChoices = FlowPicker.grouped(Object.fromEntries(rawModelChoices),studio.model_catalog,availableModel,selectedModel,single?.params);
  const flowModel=studio.model_catalog?.[selectedModel]?.provider==='flow'?studio.model_catalog[selectedModel]:null;
  const flowParameters=flowModel?.family?FlowPicker.options(studio.model_catalog,selectedModel,availableModel):null;
  const form = studio.model_forms?.[selectedModel];
  const fields = form?.fields;
  const BUILTIN_CANVAS_PARAM_KEYS = useMemo(
    () =>
      new Set([
        "ratio",
        "resolution",
        "seconds",
        "quality",
        "image_quality",
        "seed",
        "sampling_steps",
        "fast_mode",
        "flow_source_job",
      ]),
    [],
  );
  const customFormFields = useMemo(
    () =>
      Object.entries(fields ?? {}).filter(
        ([k]) => !BUILTIN_CANVAS_PARAM_KEYS.has(k),
      ),
    [fields, BUILTIN_CANVAS_PARAM_KEYS],
  );
  const formConstraints = useMemo(() => {
    if (!form || !single) return undefined;
    const vals: FormValues = {
      ratio: single.params.ratio,
      resolution: single.params.resolution,
      seconds: single.params.seconds,
      quality: single.params.quality,
      image_quality: single.params.image_quality,
      fast_mode: Boolean(single.params.fast_mode),
      sampling_steps: single.params.sampling_steps,
    };
    for (const [k, field] of Object.entries(form.fields)) {
      if (BUILTIN_CANVAS_PARAM_KEYS.has(k)) continue;
      const raw = single.extra_params?.[k];
      if (
        typeof raw === "string" ||
        typeof raw === "number" ||
        typeof raw === "boolean"
      ) {
        vals[k] = raw;
      } else if (field.default !== undefined) {
        vals[k] = field.default;
      }
    }
    return evaluateFormConstraints(form, vals);
  }, [
    form,
    BUILTIN_CANVAS_PARAM_KEYS,
    single?.params.ratio,
    single?.params.resolution,
    single?.params.seconds,
    single?.params.quality,
    single?.params.image_quality,
    single?.params.fast_mode,
    single?.params.sampling_steps,
    single?.extra_params,
  ]);
  const stepsOptions = (fields?.sampling_steps?.enum ?? []).map(Number).filter(v=>v!==form?.fastSteps) as Params["sampling_steps"][];
  useEffect(()=>{
    if (!single || !['image','video'].includes(single.type) || !selectedModel) return;
    if (!form) return;
    const values = normalizeForm(form,{ratio:single.params.ratio,resolution:single.params.resolution,seconds:single.params.seconds,quality:single.params.quality,image_quality:single.params.image_quality});
    const desired:Partial<Params>=flowModel?{model:selectedModel,ratio:flowModel.ratio!,seconds:flowModel.seconds!,resolution:(flowModel.resolution==='原生'?'1K':flowModel.resolution) as Params['resolution'],fast_mode:false,sampling_steps:20,seed:null,flow_source_job:flowModel.mode==='extend'?single.params.flow_source_job||null:null}:
      {model:selectedModel,flow_source_job:null, ratio:String(values.ratio ?? single.params.ratio),seconds:Number(values.seconds ?? single.params.seconds), resolution:(values.resolution ?? single.params.resolution) as Params["resolution"], quality:(values.quality ?? single.params.quality) as Params["quality"],image_quality:(values.image_quality ?? single.params.image_quality) as Params["image_quality"]};
    if(Object.entries(desired).every(([key,value])=>(single.params as any)[key]===value))return;
    const nid=single.id;doc.change(d=>({...d,document:{...d.document,nodes:d.document.nodes.map(n=>n.id===nid?{...n,params:{...n.params,...desired}}:n)}}));
  },[single?.id,single?.params.model,single?.params.ratio,single?.params.seconds,single?.params.resolution,selectedModel]);
  const muse = form?.nativeResolution;
  const currentImageEnabled = imagesEnabled && availableModel(selectedModel);
  const closeModelMenu = () => { setMenu(null); modelButtonRef.current?.focus(); };
  useEffect(() => {
    if (menu !== 'model') return;
    const frame = requestAnimationFrame(() => {
      (modelMenuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled)') || modelMenuRef.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)'))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [menu, selectedModel]);
  const modelKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (menu !== 'model') {
      if (event.target === modelButtonRef.current && ['ArrowDown','ArrowUp'].includes(event.key)) {
        event.preventDefault();event.stopPropagation();setMenu('model');
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();event.stopPropagation();closeModelMenu();return;
    }
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();event.stopPropagation();
      const options=[...(modelMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') || [])];
      const current=options.indexOf(document.activeElement as HTMLButtonElement);
      const index=event.key==='Home' ? 0 : event.key==='End' ? options.length-1 : (current+(event.key==='ArrowDown' ? 1 : -1)+options.length)%options.length;
      options[index]?.focus();
    }
  };

  const notify = useCallback((text: string) => setToast(text), []);
  const { hasUnsavedChanges } = doc;
  const closeProjectMenu = useCallback(() => {
    if (projectMenu.current?.contains(document.activeElement))
      projectMenuTrigger.current?.querySelector("button")?.focus();
    setMenu((current) => current === "project" ? null : current);
  }, []);
  useEffect(() => {
    if (menu === "project") projectMenu.current?.querySelector("button")?.focus();
  }, [menu]);
  const changeArchive = async () => {
    if (archiveLock.current) return;
    archiveLock.current = true;
    setArchivePending(true);
    try {
      const result = await api<{ archived_at: number | null }>(
        `/api/canvases/${project.id}/archive`,
        undefined,
        archived ? "DELETE" : "PUT",
      );
      const next = result.archived_at !== null;
      setArchived(next);
      closeProjectMenu();
      notify(next ? "已归档，原链接仍可编辑" : "已恢复到画布列表");
    } catch (error) {
      notify((error as Error).message);
    } finally {
      archiveLock.current = false;
      setArchivePending(false);
    }
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const loadRuns = useCallback(
    async (options: { showLoading?: boolean; silent?: boolean } = {}) => {
      return runsTrackerRef.current.runFetch(
        async () => {
          const [data, state] = await Promise.all([
            api<{ runs: Job[] }>(`/api/canvases/${project.id}/runs`),
            api<Studio>("/api/state"),
          ]);
          return { runs: data.runs, extra: state };
        },
        {
          silent: options.silent,
          isAlive: () => aliveRef.current,
          onStart: () => {
            if (options.showLoading) setRunsLoading(true);
          },
          onCommit: (nextRuns, state) => {
            runsLoadedRef.current = true;
            runsRef.current = nextRuns;
            setRuns(nextRuns);
            const nextFp = studioFingerprint(state);
            if (
              !lastPolledStudioRef.current ||
              lastPolledStudioRef.current.fp !== nextFp ||
              studioRef.current !== lastPolledStudioRef.current.value
            ) {
              lastPolledStudioRef.current = { fp: nextFp, value: state };
              setStudio(state);
            }
            setRunsLoaded(true);
            setRunsError("");
          },
          onError: (e) => {
            if (shouldRedirectRunsError(e) && !hasUnsavedChanges()) {
              location.assign("/studio");
            } else {
              setRunsError(formatRunsError(e));
            }
          },
          onFinally: () => {
            if (aliveRef.current) setRunsLoading(false);
          },
        },
      );
    },
    [project.id, hasUnsavedChanges],
  );
  const ensureFreshRuns = useCallback(
    () =>
      runsTrackerRef.current.ensureFresh(() =>
        loadRuns({ showLoading: false, silent: false }),
      ),
    [loadRuns],
  );
  const fetchRuns = useCallback(
    () => loadRuns({ showLoading: true }),
    [loadRuns],
  );
  useEffect(() => {
    aliveRef.current = true;
    runsLoadedRef.current = false;
    runsTrackerRef.current.reset([]);
    lastPolledStudioRef.current = {
      fp: studioFingerprint(studioRef.current),
      value: studioRef.current,
    };
    const update = () => {
      if (runsTrackerRef.current.hasInFlight()) return;
      void loadRuns({ showLoading: !runsLoadedRef.current, silent: true });
    };
    update();
    const timer = setInterval(() => {
      if (!document.hidden) update();
    }, 5000);
    return () => {
      aliveRef.current = false;
      runsTrackerRef.current.reset([]);
      clearInterval(timer);
    };
  }, [loadRuns]);
  useEffect(() => {
    const resize = () => setWindowSize({ w: innerWidth, h: innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const prevWindowWidthRef = useRef(windowSize.w);
  const prevAgentDockedWidthRef = useRef(agentDockedWidth);
  useEffect(() => {
    const decision = reconcileCanvasRightDocks({
      prevWindowWidth: prevWindowWidthRef.current,
      windowWidth: windowSize.w,
      viewMode,
      agentDock,
      prevAgentDockedWidth: prevAgentDockedWidthRef.current,
      agentDockedWidth,
    });
    prevWindowWidthRef.current = windowSize.w;
    prevAgentDockedWidthRef.current = agentDockedWidth;
    if (decision.closeAgentDock) {
      setAgentDock(false);
    } else if (decision.switchSplitToCanvas) {
      setViewMode("canvas");
    }
  }, [windowSize.w, viewMode, agentDock, agentDockedWidth, setViewMode]);
  useEffect(() => {
    if (innerWidth <= 760) {
      const n = doc.ref.current.document.nodes.find(
        (n) => n.id === selected[0],
      );
      if (n) {
        const z = Math.max(0.25, Math.min(1, (innerWidth - 112) / n.width));
        void flow.setViewport({
          zoom: z,
          x: innerWidth * 0.55 - (n.x + n.width / 2) * z,
          y: innerHeight * 0.3 - (n.y + n.height / 2) * z,
        });
      }
    }
  }, [windowSize.w]);
  const edit = useCallback(
    (id: string, patch: Partial<CanvasNode>, history = true) =>
      doc.change(
        (d) => ({
          ...d,
          document: {
            ...d.document,
            nodes: d.document.nodes.map((n) =>
              n.id === id ? { ...n, ...patch } : n,
            ),
          },
        }),
        history,
      ),
    [doc.change],
  );
  useEffect(()=>{
    if(doc.status==='conflict')return;
    const narrationUpdates=new Map<string,number>();
    const dialogueUpdates=new Map<string,Map<string,number>>();
    for(const node of doc.value.document.nodes){
      if(node.narration_pending){
        const job=runById.get(node.narration_pending);
        if(job?.status==='done'&&job.result&&job.prompt.trim()===(node.narration_text||'').trim()&&
           (job.inputs?.instruction||'').trim()===(node.narration_instruction||'').trim()){
          narrationUpdates.set(node.id,job.id);
        }
      }
      if(node.dialogue_lines?.length){
        for(const line of node.dialogue_lines){
          if(!line.audio_pending)continue;
          const job=runById.get(line.audio_pending);
          if(job?.status==='done'&&job.result){
            let map=dialogueUpdates.get(node.id);
            if(!map){map=new Map();dialogueUpdates.set(node.id,map);}
            map.set(line.id,job.id);
          }
        }
      }
    }
    if(narrationUpdates.size||dialogueUpdates.size){
      doc.change(d=>({
        ...d,
        document:{
          ...d.document,
          nodes:d.document.nodes.map(n=>{
            const nextNarr=narrationUpdates.get(n.id);
            const nextDlg=dialogueUpdates.get(n.id);
            if(!nextNarr&&!nextDlg)return n;
            return {
              ...n,
              ...(nextNarr?{narration_job:nextNarr,narration_pending:null}:{}),
              ...(nextDlg&&n.dialogue_lines?{
                dialogue_lines:n.dialogue_lines.map(l=>
                  nextDlg.has(l.id)?{...l,audio_job:nextDlg.get(l.id)!,audio_pending:null}:l
                ),
              }:{}),
            };
          }),
        },
      }));
    }
  },[runById,doc.value.document.nodes,doc.status]);
  const beginEditing = useCallback(
    (id: string) => {
      doc.begin();
      setEditing(id);
    },
    [doc.begin],
  );
  const contextValue = useMemo(
    () => ({
      edit,
      begin: doc.begin,
      end: doc.end,
      downstream: setDownstream,
      selectMedia: (id: string) => {
        setPickerTarget(id);
        setAssetType("image");
        setPanel("assets");
      },
      preview: (node: CanvasNode) => {
        const { media, run } = resolveNode(node, runsRef.current);
        if (media) {
          setFrameError("");
          setPreview({ node, media, run });
        }
      },
      beginEditing,
      setEditing,
      rerunGroup: (groupId: string) => {
        const group = doc.ref.current.document.nodes.find((n) => n.id === groupId);
        void doc
          .flush()
          .then(() => {
            setPrecheckTarget({
              nodeIds: [groupId],
              title: `工作流组预检 · ${group?.title || "未命名组"}`,
              stages: ["image", "video", "narration", "dialogue"],
            });
          })
          .catch((e) => notify((e as Error).message));
      },
      ungroup: (groupId: string) => {
        doc.change((d) => ({
          ...d,
          document: {
            ...d.document,
            nodes: d.document.nodes
              .filter((n) => n.id !== groupId)
              .map((n) => (n.parent_id === groupId ? { ...n, parent_id: null } : n)),
          },
        }));
        setSelected((cur) => cur.filter((id) => id !== groupId));
        notify("已解散工作流组");
      },
    }),
    [edit, doc.begin, doc.end, beginEditing, doc.ref, doc.flush, doc.change],
  );
  const createGroupFromSelection = useCallback(() => {
    const picked = doc.ref.current.document.nodes.filter(
      (n) => selected.includes(n.id) && n.type !== "group",
    );
    if (picked.length < 2) {
      notify("请先框选或 Shift 多选至少 2 个节点");
      return;
    }
    const pad = 44;
    const minX = Math.min(...picked.map((n) => n.x)) - pad;
    const minY = Math.min(...picked.map((n) => n.y)) - pad - 24;
    const maxX = Math.max(...picked.map((n) => n.x + n.width)) + pad;
    const maxY = Math.max(...picked.map((n) => n.y + n.height)) + pad;
    const groupCount =
      doc.ref.current.document.nodes.filter((n) => n.type === "group").length + 1;
    const group = newNode("group", minX, minY, groupCount);
    group.width = Math.min(3200, Math.max(260, Math.round(maxX - minX)));
    group.height = Math.min(3200, Math.max(180, Math.round(maxY - minY)));
    const pickedIds = new Set(picked.map((n) => n.id));
    doc.change((d) => ({
      ...d,
      document: {
        ...d.document,
        nodes: [
          group,
          ...d.document.nodes.map((n) =>
            pickedIds.has(n.id) ? { ...n, parent_id: group.id } : n,
          ),
        ],
      },
    }));
    setSelected([group.id]);
    notify(`已创建「${group.title}」（包含 ${picked.length} 个节点）`);
  }, [doc, selected]);
  const videoPort = useMemo(
    () =>
      !!studio.canvas_nodes?.some((n) =>
        n.inputs.some((p) => p.kind === "video"),
      ) ||
      doc.value.document.nodes.some((n) =>
        n.extension?.definition.inputs.some((p) => p.kind === "video"),
      ),
    [studio.canvas_nodes, doc.value.document.nodes],
  );
  const { nodes, hasLoadedImage } = useMemo(() => {
    const prevCache = rfNodeCacheRef.current;
    const nextCache = new Map<string, RFNode>();
    let loadedImage = false;
    const childCounts = new Map<string, number>();
    for (const node of doc.value.document.nodes) {
      if (node.parent_id) {
        childCounts.set(node.parent_id, (childCounts.get(node.parent_id) ?? 0) + 1);
      }
    }
    const list = doc.value.document.nodes.map((n) => {
      const resolved = resolveNodeFromIndex(n, runsByNode);
      if (n.type === "image" && resolved.media) loadedImage = true;
      const isSelected = selectedSet.has(n.id);
      const isEditing = editing === n.id;
      const childCount = n.type === "group" ? (childCounts.get(n.id) ?? 0) : undefined;
      const prev = prevCache.get(n.id);
      if (
        prev &&
        prev.data.item === n &&
        prev.data.media === resolved.media &&
        prev.data.run === resolved.run &&
        prev.data.videoPort === videoPort &&
        prev.data.editing === isEditing &&
        prev.data.childCount === childCount &&
        prev.selected === isSelected
      ) {
        nextCache.set(n.id, prev);
        return prev;
      }
      const next: RFNode = {
        id: n.id,
        type: "content" as const,
        position: { x: n.x, y: n.y },
        zIndex: n.type === "group" ? -1 : 0,
        data: {
          item: n,
          videoPort,
          editing: isEditing,
          media: resolved.media,
          run: resolved.run,
          childCount,
        },
        handles: buildNodeHandles(n, videoPort),
        measured: { width: n.width, height: n.height },
        width: n.width,
        height: n.height,
        style: { width: n.width, height: n.height },
        selected: isSelected,
        ariaLabel:
          names[n.type] + "节点 " + n.title +
          (n.type === "sticky" && !n.extension ? "，按 Enter 编辑" : ""),
      };
      nextCache.set(n.id, next);
      return next;
    });
    rfNodeCacheRef.current = nextCache;
    return { nodes: list, hasLoadedImage: loadedImage };
  }, [doc.value.document.nodes, runsByNode, selectedSet, videoPort, editing]);
  const selectedEdgeSet = useMemo(() => new Set(selectedEdges), [selectedEdges]);
  const edges = useMemo(() => {
    const prevCache = rfEdgeCacheRef.current;
    const nextCache = new Map<string, FlowEdge>();
    const list = doc.value.document.edges.map((e) => {
      const isSelected = selectedEdgeSet.has(e.id);
      const hidden = !showEdges;
      const prev = prevCache.get(e.id);
      if (
        prev &&
        prev.source === e.source &&
        prev.target === e.target &&
        prev.sourceHandle === e.sourcePort &&
        prev.targetHandle === e.targetPort &&
        prev.selected === isSelected &&
        prev.hidden === hidden
      ) {
        nextCache.set(e.id, prev);
        return prev;
      }
      const next: FlowEdge = {
        ...e,
        sourceHandle: e.sourcePort,
        targetHandle: e.targetPort,
        type: "default",
        selected: isSelected,
        hidden,
        style: EDGE_STYLE,
        interactionWidth: 20,
        ariaLabel: "参考连线",
      };
      nextCache.set(e.id, next);
      return next;
    });
    rfEdgeCacheRef.current = nextCache;
    return list;
  }, [doc.value.document.edges, showEdges, selectedEdgeSet]);
  const onNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) => {
      const select = changes.filter((c) => c.type === "select");
      if (select.length)
        setSelected((current) => {
          const next = new Set(current);
          for (const c of select) {
            if (c.type === "select") {
              if (c.selected) next.add(c.id);
              else next.delete(c.id);
            }
          }
          if (
            next.size === current.length &&
            current.every((id) => next.has(id))
          ) {
            return current;
          }
          return [...next];
        });
      const mutations = changes.filter(
        (c) =>
          (c.type === "position" && Boolean(c.position)) ||
          (c.type === "dimensions" && Boolean(c.resizing && c.dimensions)),
      );
      const keyboardMove =
        mutations.some((c) => c.type === "position" && c.dragging === false) &&
        !dragging.current;
      if (keyboardMove) doc.begin();
      if (mutations.length)
        doc.change(
          (d) => {
            let changed = false;
            const nextNodes = d.document.nodes.map((n) => {
              let v = n;
              for (const c of mutations) {
                if (!("id" in c) || c.id !== n.id) continue;
                if (
                  c.type === "position" &&
                  c.position &&
                  (v.x !== c.position.x || v.y !== c.position.y)
                ) {
                  v = { ...v, x: c.position.x, y: c.position.y };
                  changed = true;
                }
                if (
                  c.type === "dimensions" &&
                  c.dimensions &&
                  (v.width !== c.dimensions.width ||
                    v.height !== c.dimensions.height)
                ) {
                  v = {
                    ...v,
                    width: c.dimensions.width,
                    height: c.dimensions.height,
                  };
                  changed = true;
                }
              }
              return v;
            });
            return changed
              ? { ...d, document: { ...d.document, nodes: nextNodes } }
              : d;
          },
          false,
        );
      if (keyboardMove) doc.end();
    },
    [doc.change, doc.begin, doc.end],
  );
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setSelectedEdges((current) => {
      const next = new Set(current);
      for (const c of changes)
        if (c.type === "select") {
          if (c.selected) next.add(c.id);
          else next.delete(c.id);
        }
      if (
        next.size === current.length &&
        current.every((id) => next.has(id))
      ) {
        return current;
      }
      return [...next];
    });
  }, []);
  const connect = useCallback(
    (connection: Connection) => {
      const error = connectionError(
        doc.ref.current.document,
        connection.source,
        connection.target,
        connection.sourceHandle,
        connection.targetHandle,
      );
      if (error) {
        notify(error);
        return;
      }
      doc.change((d) => ({
        ...d,
        document: {
          ...d.document,
          edges: [
            ...d.document.edges,
            {
              id: crypto.randomUUID(),
              source: connection.source,
              target: connection.target,
              ...(connection.sourceHandle && {sourcePort:connection.sourceHandle}),
              ...(connection.targetHandle && {targetPort:connection.targetHandle}),
            },
          ],
        },
      }));
      setSelected([connection.target]);
    },
    [doc.change, notify],
  );
  const revealText = (n:CanvasNode,force=false) => {
    if(windowSize.w<=760)return;
    const vp=flow.getViewport();
    const top=n.y*vp.zoom+vp.y;
    if(!force&&top>=150&&top+n.height*vp.zoom+20+textPanelHeight<=windowSize.h-80)return;
    const zoom=Math.max(0.15,Math.min(vp.zoom,1,(windowSize.w-112)/n.width,Math.max(32,windowSize.h-250-textPanelHeight)/n.height));
    const center=force?windowSize.w*0.55:(n.x+n.width/2)*vp.zoom+vp.x;
    const centerX=Math.max(76+n.width*zoom/2,Math.min(center,windowSize.w-24-n.width*zoom/2));
    const nextTop=Math.max(150,Math.min(top,windowSize.h-100-textPanelHeight-n.height*zoom));
    void flow.setViewport({zoom,x:centerX-(n.x+n.width/2)*zoom,y:nextTop-n.y*zoom},cameraMotion());
  };
  useEffect(()=>{
    if(single?.type!=='text'||editing||!textPanelRef.current)return;
    const element=textPanelRef.current;
    const measure=()=>setTextPanelHeight(Math.ceil(element.getBoundingClientRect().height));
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[single?.id,editing]);
  useEffect(()=>{if(single?.type==='text'&&!editing)revealText(single)},[single?.id,editing,textPanelHeight,windowSize.w,windowSize.h]);
  useEffect(()=>{
    const element=mediaPanelRef.current;if(!element)return;
    const measure=()=>setMediaPanelHeight(Math.ceil(element.getBoundingClientRect().height));
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[single?.id,editing,single?.type]);
  const reveal = (n: CanvasNode) => {
    const vp = flow.getViewport();
    const zoom = Math.max(
      0.25,
      Math.min(
        vp.zoom,
        1,
        (windowSize.w - 112) / n.width,
        (windowSize.h - 350) / n.height,
      ),
    );
    void flow.setViewport(
      {
        zoom,
        x: windowSize.w * 0.55 - (n.x + n.width / 2) * zoom,
        y: Math.max(200, windowSize.h * 0.32) - (n.y + n.height / 2) * zoom,
      },
      cameraMotion(),
    );
  };
  const selectOne = (id: string) => {
    setSelected([id]);
    setSelectedEdges([]);
    setEditing(null);
    setMenu(null);
    setContext(null);
  };
  const focusNodes = (ids: string[]) => {
    if (!ids.length) return;
    const targets = resolveFocusTargets(doc.ref.current.document.nodes, ids);
    if (!targets.length) return;
    const node =
      targets.length === 1
        ? doc.ref.current.document.nodes.find((n) => n.id === targets[0])
        : null;
    if (node?.type === "text" && windowSize.w > 760) {
      revealText(node, true);
      return;
    }
    void flow.fitView({
      nodes: targets.map((id) => ({ id })),
      padding: 0.5,
      maxZoom: 1,
      ...cameraMotion(),
    });
  };
  const add = (
    type: Kind,
    source?: string,
    point?: { x: number; y: number },
    definition?: CanvasNodeEntry,
  ) => {
    if (doc.ref.current.document.nodes.length >= 200) {
      notify("每张画布最多 200 个节点");
      return;
    }
    const parent = source
      ? doc.ref.current.document.nodes.find((n) => n.id === source)
      : null;
    const center =
      point ||
      flow.screenToFlowPosition({
        x: windowSize.w * 0.48,
        y: windowSize.h * 0.38,
      });
    let x = parent ? parent.x + parent.width + 180 : center.x - 160,
      y = parent ? parent.y : center.y - 120;
    ({ x, y } = freePosition(doc.ref.current.document.nodes, x, y, 320, 240));
    const node = newNode(
      type,
      x,
      y,
      doc.ref.current.document.nodes.filter((n) => n.type === type).length + 1,
    );
    if (definition) {
      node.title = definition.title;
      node.extension = {
        definition,
        values: Object.fromEntries(
          definition.fields.map((f) => [f.id, f.default]),
        ),
      };
    }
    if (type === 'image' || type === 'video') {
      node.params.model=Object.keys(type==='image'?studio.images.models||{}:studio.video_models||{}).find(availableModel) || '';
      node.params.seconds = Number(studio.model_forms[node.params.model]?.fields.seconds?.default ?? node.params.seconds);
    }
    doc.change((d) => ({
      ...d,
      document: {
        ...d.document,
        nodes: [...d.document.nodes, node],
        edges: source
          ? [
              ...d.document.edges,
              { id: crypto.randomUUID(), source, target: node.id },
            ]
          : d.document.edges,
      },
    }));
    selectOne(node.id);
    setDownstream(null);
    setContext(null);
    requestAnimationFrame(() => reveal(node));
    return node;
  };
  const removeSelected = () => {
    const ids = new Set(selected);
    doc.change((d) => ({
      ...d,
      document: {
        ...d.document,
        nodes: d.document.nodes.filter((n) => !ids.has(n.id)),
        shots: d.document.shots?.filter((id) => !ids.has(id)),
        edges: d.document.edges.filter(
          (e) =>
            !ids.has(e.source) &&
            !ids.has(e.target) &&
            !selectedEdges.includes(e.id),
        ),
      },
    }));
    setSelected([]);
    setSelectedEdges([]);
    setMenu(null);
    setContext(null);
  };
  const updateShots = (change: (ids: string[]) => string[]) =>
    doc.change((d) => ({ ...d, document: { ...d.document, shots: change(d.document.shots ?? []) } }));
  const addShot = (node: CanvasNode) => {
    updateShots((ids) => ids.includes(node.id) ? ids : [...ids, node.id]);
    notify("已加入镜头列表");
  };
  const addSelectedShots = () => {
    const current = doc.ref.current.document;
    const { videoIds, addedIds } = resolveBatchShots(
      current.nodes,
      selected,
      current.shots ?? [],
    );
    if (!videoIds.length) return;
    if (!addedIds.length) {
      setViewMode((m) => (m === "canvas" ? "split" : m));
      return;
    }
    updateShots((ids) => {
      const plan = resolveBatchShots(
        doc.ref.current.document.nodes,
        selected,
        ids,
      );
      return plan.addedIds.length ? plan.nextShots : ids;
    });
    notify(`已将 ${addedIds.length} 个视频加入镜头列表`);
  };
  const moveShot = (id: string, offset: number) => updateShots((ids) => {
    const index = ids.indexOf(id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= ids.length) return ids;
    const ordered = [...ids];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    return ordered;
  });
  const exportShots = async () => {
    const expected_revision = await doc.flush();
    const download = await api<{ url: string; filename: string }>(
      `/api/canvases/${project.id}/shots/download`, { expected_revision },
    );
    const link = document.createElement("a");
    link.href = download.url;
    link.download = download.filename;
    link.click();
  };
  const openSharedReference = (id: string) => {
    setReferenceError("");
    setReferenceTargets(doc.ref.current.document.edges.filter((edge) =>
      edge.source === id && shotIds.includes(edge.target)
    ).map((edge) => edge.target));
    setSharedReference(id);
  };
  const [h3Busy,setH3Busy]=useState(false);
  const [referenceError, setReferenceError] = useState("");
  const applySharedReference = () => {
    if (!sharedReference) return;
    const document = doc.ref.current.document;
    const targets = new Set(referenceTargets);
    const inList = new Set(document.shots);
    const edges = document.edges.filter((edge) => edge.source !== sharedReference ||
      !inList.has(edge.target) || targets.has(edge.target));
    for (const target of targets) {
      if (edges.some((edge) => edge.source === sharedReference && edge.target === target)) continue;
      const error = connectionError({ ...document, edges }, sharedReference, target);
      if (error || edges.length >= 600) {
        setReferenceError(error || "每张画布最多 600 条参考连线");
        return;
      }
      edges.push({ id: crypto.randomUUID(), source: sharedReference, target });
    }
    doc.change((d) => ({ ...d, document: { ...d.document, edges } }));
    setSharedReference(null);
    notify("已更新镜头的参考图");
  };
  const extractFrame = async ({ node: source, media, run }: Preview, next: boolean) => {
    if (!previewPlayer.current || extracting) return;
    const desiredRatio = run?.ratio || source.params.ratio;
    const continuation = next ? resolveNodeTailContinuation(source, run) : null;
    const nextVideoModel = continuation?.model || "";
    if (next && !continuation) {
      setFrameError("当前空间没有支持参考图首帧的视频模型");
      return;
    }
    const checkCapacity = () => {
      const d = doc.ref.current.document;
      if (d.nodes.length + (next ? 2 : 1) > 200 || (next && d.edges.length >= 600))
        throw new Error("画布节点或连线已达上限，请先整理画布");
      if (!d.nodes.some((node) => node.id === source.id))
        throw new Error("来源节点已移除");
      return d;
    };
    const video = previewPlayer.current;
    const time = video.currentTime.toFixed(2);
    setExtracting(true);
    setFrameError("");
    try {
      checkCapacity();
      const file = await captureFrame(video);
      const asset = await upload(file, () => {}, {media, seconds:Number(time)});
      setStudio((s) => ({ ...s, assets: [{ ...asset, owner: s.me.id }, ...s.assets] }));
      const d = checkCapacity();
      const imageWidth = 320;
      const imageHeight = Math.max(160, Math.min(480, imageWidth * asset.h / asset.w));
      const origin = run ? "#" + run.id : media.slice(0, 8);
      const image = {
        ...newNode("image", source.x + source.width + 180, source.y, 1),
        ...freePosition(d.nodes, source.x + source.width + 180, source.y, imageWidth, imageHeight),
        title: `${source.title.slice(0, 45)} · ${origin} · ${time} 秒取帧`,
        media_id: asset.id, use_media: true, height: imageHeight,
      };
      image.params.model = defaultImageModel;
      const placed = [...d.nodes, image];
      const edges = [...d.edges];
      const ordered = [...(d.shots ?? [])];
      let target: CanvasNode = image;
      if (next) {
        const point = freePosition(placed, image.x + image.width + 180, image.y, 320, 240);
        target = newNode("video", point.x, point.y, 1);
        target.title = "下一镜头";
        const spec = studio.model_catalog?.[nextVideoModel];
        if (spec?.provider === "flow") {
          target.params = {
            ...target.params,
            model: nextVideoModel,
            ratio: spec.ratio || (studio.ratios.includes(desiredRatio) ? desiredRatio : "16:9"),
            seconds: (spec.seconds || target.params.seconds) as Params["seconds"],
            resolution: ((spec.resolution === "原生" ? "1K" : spec.resolution) || "1K") as Params["resolution"],
            flow_source_job: null,
          };
        } else {
          target.params.model = nextVideoModel;
          target.params.ratio = studio.ratios.includes(desiredRatio) ? desiredRatio : "16:9";
        }
        placed.push(target);
        edges.push({ id: crypto.randomUUID(), source: image.id, target: target.id });
        if (!ordered.includes(source.id)) ordered.push(source.id);
        ordered.splice(ordered.indexOf(source.id) + 1, 0, target.id);
      }
      doc.change((v) => ({
        ...v, document: { ...v.document, nodes: placed, edges, shots: next ? ordered : d.shots },
      }));
      setPreview(null);
      selectOne(target.id);
      requestAnimationFrame(() => reveal(target));
      notify(
        next
          ? continuation?.switched
            ? `已将当前画面设为新镜头首帧（已选用 ${continuation.label}）`
            : "已将当前画面设为新镜头首帧"
          : "已提取当前帧到画布与素材库",
      );
    } catch (error) {
      setFrameError((error as Error).message);
    } finally {
      setExtracting(false);
    }
  };
  const copy = () => {
    const snapshot = createClipboardSnapshot(
      doc.ref.current.document,
      selected,
    );
    if (!snapshot) return;
    clipboard.current = snapshot;
    notify(`已复制 ${snapshot.nodes.length} 个节点`);
  };
  const paste = (duplicate = false, point?: { x: number; y: number }) => {
    const source = duplicate
      ? createClipboardSnapshot(doc.ref.current.document, selected)
      : clipboard.current;
    if (!source?.nodes.length) {
      setContext(null);
      return;
    }
    if (doc.ref.current.document.nodes.length + source.nodes.length > 200) {
      notify("每张画布最多 200 个节点");
      setContext(null);
      return;
    }
    const { dx, dy, nextPasteCount, nextAnchor } = resolvePasteOffset(
      source.nodes,
      {
        duplicate,
        point,
        pasteCount: source.pasteCount,
        anchor: source.anchor,
      },
    );
    if (!duplicate && clipboard.current) {
      clipboard.current.pasteCount = nextPasteCount;
      clipboard.current.anchor = nextAnchor;
    }
    const mapping = new Map(
      source.nodes.map((n) => [n.id, crypto.randomUUID()]),
    );
    const copied = source.nodes.map((n) => ({
      ...structuredClone(n),
      id: mapping.get(n.id)!,
      x: n.x + dx,
      y: n.y + dy,
      media_id: resolveNode(n, runs).media,
      active_job: null,
      use_media: true,
    }));
    doc.change((d) => ({
      ...d,
      document: {
        ...d.document,
        nodes: [...d.document.nodes, ...copied],
        edges: [
          ...d.document.edges,
          ...source.edges.map((e) => ({
            ...e,
            id: crypto.randomUUID(),
            source: mapping.get(e.source)!,
            target: mapping.get(e.target)!,
          })),
        ],
      },
    }));
    setSelected(copied.map((n) => n.id));
    setContext(null);
  };
  const arrange = () => {
    const chosen = doc.ref.current.document.nodes.filter((n) =>
      selected.includes(n.id),
    );
    if (chosen.length < 2) return;
    const x = Math.min(...chosen.map((n) => n.x)),
      y = Math.min(...chosen.map((n) => n.y)),
      cols = Math.ceil(Math.sqrt(chosen.length));
    const w = Math.max(...chosen.map((n) => n.width)) + 60,
      h = Math.max(...chosen.map((n) => n.height)) + 80;
    const positions = new Map(
      chosen.map((n, i) => [
        n.id,
        { x: x + (i % cols) * w, y: y + Math.floor(i / cols) * h },
      ]),
    );
    doc.change((d) => ({
      ...d,
      document: {
        ...d.document,
        nodes: d.document.nodes.map((n) => ({ ...n, ...positions.get(n.id) })),
      },
    }));
  };
  const downloadNodes = async () => {
    setContext(null);
    const chosen = doc.ref.current.document.nodes.filter((n) =>
      selected.includes(n.id),
    );
    const {
      media: keys,
      text,
      hasDownloadable,
    } = collectDownloadTargets(chosen, runs);
    if (!hasDownloadable) {
      notify("所选节点暂无可下载内容");
      return;
    }
    try {
      if (keys.length === 1) {
        const mediaNode = chosen.find(
          (n) => resolveNode(n, runs).media === keys[0],
        );
        const a = document.createElement("a");
        a.href = mediaURL(keys[0]) + "?download=true";
        a.download =
          canvasMediaDownloadFilename(keys[0], {
            runs,
            studio,
            node: mediaNode,
          }) ?? "";
        a.click();
      } else if (keys.length) {
        const canonical = keys.map((key) => {
          const j = studio.jobs.find((j) => j.result === key);
          return j ? "job:" + j.id : "asset:" + key;
        });
        const r = await api("/api/assets/batch-download", { keys: canonical });
        const a = document.createElement("a");
        a.href = r.url;
        a.download = r.filename;
        a.click();
      }
      if (text.length) {
        const url = URL.createObjectURL(
          new Blob([text.map((n) => `${n.title}\n${n.text}`).join("\n\n")], {
            type: "text/plain;charset=utf-8",
          }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = textDownloadFilename(
          doc.ref.current.title,
          project.title,
        );
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      notify((e as Error).message);
    }
  };
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (menu === "project") {
        if (e.key === "Escape") {
          e.preventDefault();
          closeProjectMenu();
        }
        return;
      }
      const targetEl = e.target as HTMLElement | null;
      if (
        targetEl?.closest?.(
          'input,textarea,select,[contenteditable="true"],dialog',
        )
      )
        return;
      if (
        surface === "document" ||
        targetEl?.closest?.(".fm-doc-workspace,.fm-floating-agent")
      ) {
        if (e.key === "Escape") {
          setMenu(null);
          setContext(null);
          setDownstream(null);
        }
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const viewportShortcut = matchViewportFocusShortcut(e);
      if (e.key === "Escape") {
        setMenu(null);
        setContext(null);
        setDownstream(null);
        setPanel(null);
        setSelected([]);
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        doc.travel(e.shiftKey);
      } else if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copy();
      } else if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        paste();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        paste(true);
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(doc.ref.current.document.nodes.map((n) => n.id));
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        removeSelected();
      } else if (viewportShortcut === "fit-all") {
        e.preventDefault();
        focusNodes(doc.ref.current.document.nodes.map((n) => n.id));
      } else if (viewportShortcut === "fit-selected") {
        e.preventDefault();
        if (selected.length) focusNodes(selected);
      } else if (mod && e.key === "1") {
        e.preventDefault();
        void flow.zoomTo(1);
      } else if (mod && ["+", "="].includes(e.key)) {
        e.preventDefault();
        void flow.zoomIn();
      } else if (mod && e.key === "-") {
        e.preventDefault();
        void flow.zoomOut();
      } else if (e.key.toLowerCase() === "v") setHand(false);
      else if (e.key.toLowerCase() === "h") setHand(true);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [
    selected,
    selectedEdges,
    runs,
    studio.jobs,
    windowSize.w,
    menu,
    closeProjectMenu,
    surface,
  ]);
  useEffect(() => {
    const click = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".cv-menu,.menu-trigger")) {
        setMenu(null);
        setContext(null);
        setDownstream(null);
      }
    };
    document.addEventListener("pointerdown", click);
    return () => document.removeEventListener("pointerdown", click);
  }, []);
  const assetItems = useMemo(() => {
    const done = studio.jobs
      .filter((j) => j.status === "done" && j.result && ["image","video"].includes(j.kind))
      .map((j) => ({
        id: j.result!,
        kind: j.kind as "image" | "video",
        w: j.width,
        h: j.height,
        title: (j.kind === "image" ? "图片" : "视频") + " #" + j.id,
        description: j.prompt,
      }));
    const known = new Set(done.map((a) => a.id));
    return [
      ...done,
      ...studio.assets
        .filter((a) => !known.has(a.id) && (!a.kind || a.kind==="ref"))
        .map((a) => ({
          id: a.id,
          kind: "image" as const,
          w: a.w,
          h: a.h,
          title: "上传图片",
          description: a.id,
        })),
    ];
  }, [studio]);
  const importAssets = () => {
    const assets = assetItems.filter((a) => assetSelection.has(a.id));
    if (!assets.length) return;
    if (doc.ref.current.document.nodes.length + assets.length > 200) {
      notify("每张画布最多 200 个节点");
      return;
    }
    const center = flow.screenToFlowPosition({
      x: windowSize.w * 0.4,
      y: windowSize.h * 0.35,
    });
    const target = pickerTarget
      ? doc.ref.current.document.nodes.find((n) => n.id === pickerTarget)
      : null;
    if (target) {
      const a = assets[0];
      edit(target.id, {
        media_id: a.id,
        active_job: null,
        use_media: true,
        width: 360,
        height: Math.max(160, Math.min(480, (360 * a.h) / a.w)),
      });
      selectOne(target.id);
    } else {
      const placed = [...doc.ref.current.document.nodes];
      const added = assets.map((a, i) => {
        const height = Math.max(160, Math.min(480, (360 * a.h) / a.w)),
          pos = freePosition(placed, center.x, center.y, 360, height);
        const n = {
          ...newNode(
            a.kind,
            pos.x,
            pos.y,
            doc.ref.current.document.nodes.filter((n) => n.type === a.kind)
              .length +
              i +
              1,
          ),
          title: a.title,
          media_id: a.id,
          width: 360,
          height,
        };
        placed.push(n);
        return n;
      });
      doc.change((d) => ({
        ...d,
        document: { ...d.document, nodes: [...d.document.nodes, ...added] },
      }));
      setSelected(added.map((n) => n.id));
      requestAnimationFrame(() => reveal(added[0]));
    }
    setPanel(null);
    setPickerTarget(null);
    setAssetSelection(new Set());
  };
  const uploadFiles = async (files: File[], target: string | null = null) => {
    if (progress !== null) return;
    setProgress(0);
    try {
      for (const file of files) {
        if (!imageFile(file)) {
          notify("不支持该图片格式");
          continue;
        }
        if (file.size > 16 * 1024 * 1024) {
          notify("每张图片不能超过 16 MB");
          continue;
        }
        if (doc.ref.current.document.nodes.length >= 200)
          throw new Error("每张画布最多 200 个节点");
        const asset = await upload(file, setProgress);
        if (asset.first_frame) notify("动态图或多页图片已按首帧导入");
        else if (asset.resized) notify(`图片已适配为 ${asset.w} × ${asset.h}`);
        setStudio((s) => ({
          ...s,
          assets: [{ ...asset, owner: s.me.id }, ...s.assets],
        }));
        if (target)
          edit(target, {
            media_id: asset.id,
            active_job: null,
            use_media: true,
            width: 360,
            height: Math.max(160, Math.min(480, (360 * asset.h) / asset.w)),
          });
        else {
          const n = add("image");
          if (n)
            edit(n.id, {
              title: file.name.slice(0, 80),
              media_id: asset.id,
              width: 360,
              height: Math.max(160, Math.min(480, (360 * asset.h) / asset.w)),
            });
        }
        target = null;
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const submit = async () => {
    setConfirmCandidates(false);
    if (!single || submitting) return;
    const nid = single.id;
    if (!single.active_job) edit(nid, { use_media: false });
    setSubmitting(nid);
    try {
      const rev = await doc.flush();
      const storageKey = `fm-canvas-candidates-${studio.me.id}-${project.id}-${nid}`;
      let pending;
      try {
        pending = JSON.parse(localStorage.getItem(storageKey) || "null");
      } catch {}
      if (!pending) {
        pending = { uid: crypto.randomUUID(), expected_revision: rev, price_revision:studio.pricing.revision, count: candidateCount };
        localStorage.setItem(storageKey, JSON.stringify(pending));
      }
      try {
        await api(`/api/canvases/${project.id}/nodes/${nid}/candidates`, pending);
        localStorage.removeItem(storageKey);
      } catch (e) {
        if (e instanceof ApiError && e.status < 500)
          localStorage.removeItem(storageKey);
        throw e;
      }
      await fetchRuns();
      notify("已加入生成队列");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSubmitting(null);
    }
  };
  const pluginRequest = useRef<{ key: string; uid: string } | null>(null);
  async function executePlugin(id: string) {
    setSubmitting(id);
    try {
      const revision = await doc.flush();
      const snapshot = JSON.stringify(doc.ref.current);
      const key = id + ":" + revision;
      if (pluginRequest.current?.key !== key)
        pluginRequest.current = { key, uid: crypto.randomUUID() };
      const result = await api<Project>(
        `/api/canvases/${project.id}/nodes/${id}/execute`,
        { expected_revision: revision, uid: pluginRequest.current.uid },
      );
      doc.acceptRemote(result, snapshot, "运行节点");
      pluginRequest.current = null;
      notify("节点运行完成");
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setSubmitting(null);
    }
  }
  const incoming = single
    ? doc.value.document.edges
        .filter((e) => e.target === single.id)
        .map((e) => ({
          edge: e,
          node: doc.value.document.nodes.find((n) => n.id === e.source)!,
        }))
    : [];
  const missing = incoming.find(({node,edge}) => !linkedValue(node,edge,runs).value?.trim());
  const linkedReferenceMedia = incoming.map(({node,edge})=>linkedValue(node,edge,runs)).filter(v=>v.kind==='image').map(v=>v.value ?? null);
  const h3Native=single?.type==="video" && !!form?.referenceModes;
  const h3Options=single?.params.h3 || {mode:"reference" as const,video_audio:[]};
  const h3Frames=h3Native&&h3Options.mode==="frames";
  const h3Ids=[...new Set([...linkedReferenceMedia,...(single?.params.h3_refs||[])])].filter((k):k is string=>Boolean(k));
  const referenceMedia = [...new Set([...(h3Frames?[h3Options.first_frame,h3Options.last_frame].filter(Boolean):h3Native?h3Ids:linkedReferenceMedia),...(single?.asset_packs||[]).flatMap(p=>packMedia[p.id]||[])])];
  const importPack = async (pack:Pack, images?:string[]) => {
    const latest:Studio = await api('/api/state');
    const document = doc.ref.current.document;
    const target = document.nodes.find(n=>n.id===packPicker);
    if (!target) throw new Error('节点已移除，请重新选择');
    if (
      target.type === 'video' &&
      studio.model_forms?.[target.params.model]?.referenceModes &&
      target.params.h3?.mode === 'frames'
    )
      throw new Error('首尾帧模式请使用首帧和尾帧选择器');
    const incomingIds = document.edges.filter(e=>e.target===target.id).map(e=>linkedValue(document.nodes.find(n=>n.id===e.source)!,e,runs)).filter(v=>v.kind==="image").map(v=>v.value).filter((id):id is string=>Boolean(id));
    const direct = [...incomingIds,...(target.params.h3_refs||[])];
    const keptPacks = images ? target.asset_packs||[] : (target.asset_packs||[]).filter(p=>p.id!==pack.id);
    const existing = [...new Set([...direct,...keptPacks.flatMap(p=>packMedia[p.id]||[])])];
    const ids = [...new Set(images || pack.media)];
    if(ids.some(id=>!latest.assets.some(a=>a.id===id&&(!a.kind||a.kind==='ref'))))throw new Error('图片已移除或不在当前空间，请重新选择');
    const all = [...new Set([...existing,...ids])];
    if(all.filter(id=>mediaType(latest.assets.find(a=>a.id===id))==='Picture').length>9)throw new Error('最多选择 9 张参考图片，请先移除部分图片');
    if(all.length>12)throw new Error('参考素材已达上限，请先移除部分素材');
    setStudio(s=>({...s,assets:latest.assets}));
    if(images){
      const addedIds=ids.filter(id=>!existing.includes(id));
      if(document.nodes.length+addedIds.length>200||document.edges.length+addedIds.length>600)throw new Error('画布容量不足，请先整理节点');
      const placed=[...document.nodes];
      const added=addedIds.map((id,index)=>{
        const a=latest.assets.find(a=>a.id===id)!, height=Math.max(160,Math.min(480,240*a.h/a.w));
        const pos=freePosition(placed,target.x-360,target.y,240,height);
        const node={...newNode('image',pos.x,pos.y,index+1),title:pack.name+' · '+(pack.media.indexOf(id)+1),media_id:id,use_media:true,width:240,height};
        placed.push(node);return node;
      });
      if(added.length)doc.change(d=>({...d,document:{...d.document,nodes:[...d.document.nodes,...added],edges:[...d.document.edges,...added.map(n=>({id:crypto.randomUUID(),source:n.id,target:target.id}))]}}));
    }else{
      setPackMedia(m=>({...m,[pack.id]:pack.media}));
      edit(target.id,{asset_packs:[...keptPacks,{id:pack.id,revision:pack.revision}]});
    }
    setPackPicker(null);
  };
  const firstFrame = single?.type === "video" && !!form?.referenceModes &&
    !single.params.h3 && referenceMedia.length === 1 ? referenceMedia[0] : null;
  const submittedInput=current?.run?.inputs;
  const combinedPrompt=[...incoming.map(({node,edge})=>linkedValue(node,edge,runs)).filter(v=>v.kind==='text').map(v=>v.value?.trim() ?? ''),...(single?.prompt.trim()?[single.prompt.trim()]:[])].join('\n\n');
  const sourceChanged=current?.run?.status==='done' && submittedInput &&
    (submittedInput.prompt!==combinedPrompt || JSON.stringify(submittedInput.refs||[])!==JSON.stringify(linkedReferenceMedia) ||
     JSON.stringify(submittedInput.asset_packs||[])!==JSON.stringify(single?.asset_packs||[]) ||
     JSON.stringify(submittedInput.params)!==JSON.stringify(single?.params));
  const outputSize = single ? studio.sizes[single.params.ratio] : null;
  const sizeOffset = single?.params.quality === 768 ? 2 : 0;
  const cropRatio = outputSize ? `${outputSize[sizeOffset]} / ${outputSize[sizeOffset + 1]}` : "16 / 9";
  const hasPrompt = Boolean(
    single?.prompt.trim() ||
      incoming.some(({node,edge}) => {const source = linkedValue(node,edge,runs); return source.kind === "text" && source.value?.trim();}),
  );
  const pendingRuns = current?.list.filter(job=>['queued','running'].includes(job.status)) || [];
  const pendingCancellations = useRef(new Set<number>());
  const [cancellingRuns, setCancellingRuns] = useState<ReadonlySet<number>>(() => new Set());
  async function cancelRun(id: number) {
    if (pendingCancellations.current.has(id)) return;
    pendingCancellations.current.add(id);
    setCancellingRuns(new Set(pendingCancellations.current));
    try {
      await api(`/api/jobs/${id}/cancel`, {});
      notify("已取消生成，积分已退回");
      await loadRuns({ silent: true });
    } catch (error) {
      notify((error as Error).message);
      if (error instanceof ApiError && error.status === 409)
        await loadRuns({ silent: true });
    } finally {
      pendingCancellations.current.delete(id);
      setCancellingRuns(new Set(pendingCancellations.current));
    }
  }
  const pendingRun = pendingRuns.length > 0;
  const latestBatch = current?.latest?.batch;
  const visibleCandidates = latestBatch?.count === 2 ? (current?.list.filter(job=>job.batch?.uid===latestBatch.uid)||[]) : pendingRuns;
  const creditTiers=single && form?.tiers.filter(t => matches(t.when,{seconds:single.params.seconds,ratio:single.params.ratio,resolution:single.params.resolution,quality:single.params.quality,image_quality:single.params.image_quality}));
  const creditTier=creditTiers?.length===1 ? creditTiers[0].tier : undefined;
  const creditPrice=studio.pricing?.items.find(p=>p.key===selectedModel+'|'+creditTier)?.amount;
  const candidateCost = creditPrice == null ? null : creditPrice * candidateCount;
  const creditAvailable=candidateCost!=null && studio.credits.available>=candidateCost;
  const flowInputError=flowModel ? referenceMedia.length<(flowModel.min_refs||0)?`请添加至少 ${flowModel.min_refs} 张参考图片`:
    referenceMedia.length>(flowModel.max_refs||0)?flowModel.max_refs?`这个模型最多接收 ${flowModel.max_refs} 张参考图片`:'这个模型不接收参考图片':
    flowModel.mode==='extend'&&!single?.params.flow_source_job?'请选择来源视频':'' : '';
  const flowSources=studio.jobs.filter(j=>j.kind==='video'&&j.status==='done'&&j.actual?.flow_media_id&&j.ratio===flowModel?.ratio);
  const canGenerate =
    single &&
    ["image", "video"].includes(single.type) &&
    hasPrompt &&
    !missing &&
    !flowInputError &&
    !pendingRun &&
    !submitting && !h3Busy &&
    doc.status !== "conflict" &&
    (single.type !== "image" || currentImageEnabled) && availableModel(selectedModel) && creditAvailable;
  const generationBlock = doc.status === "conflict" ? "请先处理画布保存冲突"
    : pendingRun ? "当前节点已有生成任务"
    : submitting ? "正在提交生成…"
    : h3Busy ? "正在处理参考素材…"
    : single?.type === "image" && !currentImageEnabled ? "当前空间未开放图片生成"
    : !availableModel(selectedModel) ? "当前模型暂不可用"
    : creditPrice == null ? "当前规格尚未定价"
    : !creditAvailable ? "当前空间积分不足"
    : "";
  const generate = () => {
    if (!canGenerate) return;
    if (candidateCount === 2) setConfirmCandidates(true);
    else void submit();
  };
  const generateShortcut = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.key !== "Enter" || !(event.metaKey || event.ctrlKey))
      return;
    event.preventDefault();
    event.stopPropagation();
    generate();
  };
  const measureTopChrome = useCallback(() => {
    const root = workspaceRef.current;
    const headerEl = root?.querySelector<HTMLElement>(".canvas-header");
    if (!root || !headerEl) return;
    const switcherEl = root.querySelector<HTMLElement>(".fm-surface-switcher");
    const toolsEl = headerEl.querySelector<HTMLElement>(".global-tools");
    const headingEl = headerEl.querySelector<HTMLElement>(".project-heading");
    const rootRect = root.getBoundingClientRect();
    const headerRect = headerEl.getBoundingClientRect();
    const effectiveHeaderBottom = Math.max(
      headerRect.bottom,
      toolsEl?.getBoundingClientRect().bottom ?? 0,
      headingEl?.getBoundingClientRect().bottom ?? 0,
    );
    const swRect = switcherEl?.getBoundingClientRect();
    const resolved = resolveCanvasWorkspaceTop({
      rootTop: rootRect.top,
      headerBottom: effectiveHeaderBottom,
      switcherTop: swRect?.top ?? null,
      switcherBottom: swRect?.bottom ?? null,
      switcherHeight: swRect?.height ?? null,
    });
    setHeaderBottom((prev) =>
      prev === resolved.headerBottom ? prev : resolved.headerBottom,
    );
    setWorkspaceTop((prev) =>
      prev === resolved.workspaceTop ? prev : resolved.workspaceTop,
    );
    let nextRightObstruction = 0;
    if (rootRect.width > 760) {
      const agentEl = root.querySelector<HTMLElement>(
        ".fm-floating-agent.is-docked",
      );
      const sbEl = root.querySelector<HTMLElement>(
        ".fm-docked-storyboard:not(.fm-full-list)",
      );
      const agentInset = agentEl
        ? Math.max(
            0,
            Math.ceil(rootRect.right - agentEl.getBoundingClientRect().left),
          )
        : agentDockedWidth;
      const sbInset = sbEl
        ? Math.max(
            0,
            Math.ceil(rootRect.right - sbEl.getBoundingClientRect().left),
          )
        : 0;
      const rawInset = Math.max(agentInset, sbInset);
      if (rootRect.width - rawInset >= 260) {
        nextRightObstruction = rawInset;
      }
    }
    setRightObstruction((prev) =>
      prev === nextRightObstruction ? prev : nextRightObstruction,
    );
  }, [agentDockedWidth]);
  useLayoutEffect(() => {
    measureTopChrome();
  }, [
    measureTopChrome,
    headerBottom,
    agentDock,
    agentDockedWidth,
    windowSize.w,
    windowSize.h,
    surface,
    viewMode,
  ]);
  useEffect(() => {
    const root = workspaceRef.current;
    const headerEl = root?.querySelector<HTMLElement>(".canvas-header");
    const switcherEl = root?.querySelector<HTMLElement>(".fm-surface-switcher");
    const agentEl = root?.querySelector<HTMLElement>(
      ".fm-floating-agent.is-docked",
    );
    const sbEl = root?.querySelector<HTMLElement>(".fm-docked-storyboard");
    if (!root || !headerEl || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(measureTopChrome);
    obs.observe(headerEl);
    if (switcherEl) obs.observe(switcherEl);
    if (agentEl) obs.observe(agentEl);
    if (sbEl) obs.observe(sbEl);
    obs.observe(root);
    return () => obs.disconnect();
  }, [measureTopChrome, agentDock, viewMode]);

  const downloadLocalBackup = (baseDraft: {
    title: string;
    document: Project["document"];
  }) => {
    const unsavedScripts =
      scriptWorkspaceRef.current?.exportUnsavedScripts() ?? [];
    downloadJSON(
      baseDraft.title + "-本地副本",
      buildCanvasLocalBackup(baseDraft, unsavedScripts),
    );
  };

  const executeLeaveTarget = async (target: LeaveTarget) => {
    if (target.kind === "reload") {
      scriptWorkspaceRef.current?.prepareLeave();
      doc.reload();
      return;
    }
    if (target.kind === "create") {
      const p = await api<Project>("/api/canvases", {});
      scriptWorkspaceRef.current?.prepareLeave();
      doc.leave(workspaceURL("/canvas/" + p.id));
      return;
    }
    if (target.kind === "duplicate") {
      const p = await api<Project>(
        `/api/canvases/${project.id}/duplicate`,
        {},
      );
      scriptWorkspaceRef.current?.prepareLeave();
      doc.leave(workspaceURL("/canvas/" + p.id));
      return;
    }
    scriptWorkspaceRef.current?.prepareLeave();
    doc.leave(workspaceURL(target.path));
  };

  const guardedTransition = async (target: LeaveTarget) => {
    if (leaveInFlight.current) return;
    leaveInFlight.current = true;
    setRetryingLeave(true);
    setMenu(null);
    try {
      if (target.kind === "reload") {
        await (scriptWorkspaceRef.current?.flushAll() ?? Promise.resolve());
      } else {
        await Promise.all([
          doc.flush(),
          scriptWorkspaceRef.current?.flushAll() ?? Promise.resolve(),
        ]);
      }
    } catch (e) {
      const canvasRetained =
        target.kind === "reload" ? true : doc.remember();
      const scriptsRetained =
        scriptWorkspaceRef.current?.rememberAll() ?? true;
      setLeaveFailure({
        target,
        message: (e as Error).message,
        retained: canvasRetained && scriptsRetained,
      });
      leaveInFlight.current = false;
      setRetryingLeave(false);
      return;
    }
    try {
      await executeLeaveTarget(target);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      leaveInFlight.current = false;
      setRetryingLeave(false);
    }
  };

  const closeAndLeave = async (url: string) =>
    guardedTransition({ kind: "navigate", path: url });
  const openCredits = () => void closeAndLeave("/studio?settings=credits");
  const showComposer =
    single && ["image", "video"].includes(single.type) && !editing;
  const composerOpen = isCanvasComposerOpen(single, editing);
  const selectionToolbarOpen = hasCanvasSelectionToolbar(single, editing);
  const mobileMiniMap = windowSize.w <= 760 && composerOpen;
  const historyState = useMemo(
    () =>
      resolveHistoryModalState({
        runs,
        loading: runsLoading,
        loaded: runsLoaded,
        error: runsError,
      }),
    [runs, runsLoading, runsLoaded, runsError],
  );
  const panelHeight = single?.type === "text" ? textPanelHeight : mediaPanelHeight;
  const defaultViewport = useMemo(() => {
    try {
      return (
        JSON.parse(
          localStorage.getItem("fm-canvas-view-" + project.id) || "null",
        ) || { x: 200, y: 140, zoom: 1 }
      );
    } catch {
      return { x: 200, y: 140, zoom: 1 };
    }
  }, [project.id]);
  const isValidConnection = useCallback(
    (c: FlowEdge | Connection) =>
      !connectionError(
        doc.ref.current.document,
        c.source,
        c.target,
        c.sourceHandle,
        c.targetHandle,
      ),
    [doc.ref],
  );
  const onMoveStart = useCallback(() => {
    if (moveResumeTimerRef.current !== null) {
      clearTimeout(moveResumeTimerRef.current);
      moveResumeTimerRef.current = null;
    }
    canvasVideoThumbnails.pause("viewport-move");
  }, []);
  const onMoveEnd = useCallback(
    (_: unknown, vp: { x: number; y: number; zoom: number }) => {
      try {
        localStorage.setItem(
          "fm-canvas-view-" + project.id,
          JSON.stringify(vp),
        );
      } catch {}
      if (moveResumeTimerRef.current !== null) {
        clearTimeout(moveResumeTimerRef.current);
      }
      moveResumeTimerRef.current = setTimeout(() => {
        moveResumeTimerRef.current = null;
        canvasVideoThumbnails.resume("viewport-move");
      }, 180);
    },
    [project.id],
  );
  const virtualizeElements = shouldVirtualizeCanvas(
    doc.value.document.nodes.length,
    hasLoadedImage,
  );
  const patchParams = (patch: Partial<CanvasNode["params"]>, flowMode?:string) => {
    if (!single)return;
    let params={...single.params,...patch};
    const current=studio.model_catalog[params.model];
    if(current?.family){
      const model=FlowPicker.resolve(studio.model_catalog,params.model,availableModel,{ratio:params.ratio,seconds:params.seconds,mode:flowMode||current.mode});
      if(!model)return;
      const spec=studio.model_catalog[model];
      params={...params,model,ratio:spec.ratio!,seconds:spec.seconds!,flow_source_job:spec.mode==='extend'&&spec.ratio===single.params.ratio?params.flow_source_job||null:null};
    } else if (form) {
      const editedKey = Object.keys(patch).find((k) => k in form.fields);
      if (editedKey) {
        const normalized = normalizeForm(
          form,
          {
            ratio: params.ratio,
            resolution: params.resolution,
            seconds: params.seconds,
            quality: params.quality,
            image_quality: params.image_quality,
            fast_mode: Boolean(params.fast_mode),
            sampling_steps: params.sampling_steps,
          },
          editedKey,
        );
        params = {
          ...params,
          ratio: String(normalized.ratio ?? params.ratio),
          seconds: Number(normalized.seconds ?? params.seconds),
          resolution: (normalized.resolution ?? params.resolution) as Params["resolution"],
          quality: (normalized.quality ?? params.quality) as Params["quality"],
          image_quality: (normalized.image_quality ?? params.image_quality) as Params["image_quality"],
        };
      }
    }
    edit(single.id, {params});
  };
  const updateH3=(options:NonNullable<Params['h3']>,ids:string[])=>{
    if(!single)return;
    const allowed=new Set(ids);
    doc.change(d=>({...d,document:{...d.document,edges:d.document.edges.filter(e=>e.target!==single.id || d.document.nodes.find(n=>n.id===e.source)?.type!=='image' || allowed.has(resolveNode(d.document.nodes.find(n=>n.id===e.source)!,runs).media||'')),nodes:d.document.nodes.map(n=>n.id===single.id?{...n,prompt:remapH3Prompt(n.prompt,h3Ids,ids,studio.assets,options.mode==='frames'?options:undefined),params:{...n.params,h3:options,h3_refs:ids.filter(k=>!linkedReferenceMedia.includes(k))}}:n)}}));
  };
  const chooseH3Mode=(mode:'reference'|'frames')=>{
    if(!single)return;
    if(mode==='frames' && single.asset_packs?.length){notify('请先将素材包图片放入画布并取消素材包，再选择首尾帧');return;}
    if(mode==='reference'){
      edit(single.id,{
        generation_mode:'omni_ref',
        params:{
          ...single.params,
          h3:{mode,video_audio:[]},
          h3_refs:[...new Set([...(single.params.h3_refs||[]),h3Options.first_frame,h3Options.last_frame].filter((k):k is string=>Boolean(k)))],
        },
      });
      setMenu(null);
      return;
    }
    const images=h3Ids.filter(k=>mediaType(studio.assets.find(a=>a.id===k))==='Picture');
    let last=images[1]||null;const a=studio.assets.find(a=>a.id===images[0]),b=studio.assets.find(a=>a.id===last);
    if(a&&b&&Math.abs(Math.log((a.w/a.h)/(b.w/b.h)))>.035)last=null;
    const options={mode,first_frame:images[0]||null,last_frame:last,video_audio:[]};
    edit(single.id,{generation_mode:'first_last_frame',prompt:remapH3Prompt(single.prompt,h3Ids,h3Ids,studio.assets,options),params:{...single.params,h3:options}});setMenu(null);
  };
  // The public editor records conversion as a separate undoable document edit.
  useEffect(() => {
    if (!single || h3Native) return;
    doc.change((current) => {
      const document = portableReferences(
        current.document,
        single.id,
        studio.assets,
        (node) => resolveNode(node, runs).media,
      );
      return document === current.document ? current : { ...current, document };
    });
  }, [single?.id, h3Native, single?.params.model, studio.assets]);
  useEffect(()=>{
    if(h3Native && single && !single.params.h3) {
      patchParams({h3:h3Ids.length===1?{mode:'frames',first_frame:h3Ids[0],last_frame:null,video_audio:[]}:{mode:'reference',video_audio:[]}});
    }
  },[single?.id,h3Native]);
  const referenceCandidates =
    panel === "references" && single
      ? doc.value.document.nodes.filter(
          (n) =>
            n.id !== single.id &&
            ["image", "text"].includes(n.type) &&
            !doc.value.document.edges.some(
              (e) => e.source === n.id && e.target === single.id,
            ),
        )
      : [];
  const bgmRuns = useMemo(
    () => runs.filter((r) => r.canvas_node === "bgm:project"),
    [runs],
  );
  const latestBgmRun = bgmRuns[0] ?? null;
  const activeBgmRun =
    bgmRuns.find((r) => BGM_ACTIVE_STATUSES.has(r.status)) ?? null;
  const bgmGenerating =
    Boolean(activeBgmRun) ||
    (pendingBgmJobId !== null &&
      !bgmRuns.some(
        (r) => r.id === pendingBgmJobId && !BGM_ACTIVE_STATUSES.has(r.status),
      ));
  const appliedBgmJobsRef = useRef<Set<number>>(new Set());
  const notifiedBgmFailedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const candidate =
      latestBgmRun ??
      (pendingBgmJobId !== null
        ? (studio.jobs.find((j) => j.id === pendingBgmJobId) ?? null)
        : null);
    if (!candidate) return;
    if (BGM_ACTIVE_STATUSES.has(candidate.status)) {
      if (pendingBgmJobId !== candidate.id) setPendingBgmJobId(candidate.id);
      return;
    }
    const wasPending = pendingBgmJobId === candidate.id;
    if (wasPending) setPendingBgmJobId(null);
    if (candidate.status === "done" && candidate.result) {
      const currentDoc = doc.ref.current.document;
      if (
        currentDoc.bgm_applied_job === candidate.id ||
        appliedBgmJobsRef.current.has(candidate.id)
      ) {
        return;
      }
      appliedBgmJobsRef.current.add(candidate.id);
      doc.change((d) => ({
        ...d,
        document: {
          ...d.document,
          bgm_applied_job: candidate.id,
          bgm: {
            asset_id: candidate.result!,
            volume: d.document.bgm?.volume ?? 0.35,
            ducking: d.document.bgm?.ducking ?? true,
            loop: d.document.bgm?.loop ?? true,
          },
        },
      }));
      void doc.flush().catch(() => {});
      notify("AI 配乐已生成并自动挂载至背景音乐轨");
    } else if (
      ["failed", "cancelled"].includes(candidate.status) &&
      wasPending &&
      !notifiedBgmFailedRef.current.has(candidate.id)
    ) {
      notifiedBgmFailedRef.current.add(candidate.id);
      notify(candidate.note || "AI 配乐生成失败，请重试");
    }
  }, [latestBgmRun, pendingBgmJobId, studio.jobs, doc.change, doc.flush, doc.ref]);

  const availableAudioModels = Object.entries(studio.model_catalog)
    .filter(([id, spec]) => spec.kind === "audio" && availableModel(id))
    .map(([id, spec]) => ({ id, label: spec.label || id }));
  const availableSpeechModels = resolveCanvasSpeechModels(studio);
  const bgmModels = availableAudioModels.filter((m) =>
    isBgmMusicModel(m.id, studio.model_catalog[m.id]),
  );
  const defaultBgmPrompt = shots.length
    ? `为以下分镜创作背景配乐：${shots
        .slice(0, 4)
        .map((s) => s.title || s.prompt.slice(0, 20))
        .filter(Boolean)
        .join(" / ")}，电影感器乐配乐`
    : "电影感器乐背景配乐，情绪层次丰富";
  const handleGenerateBgm = async (opts: { prompt: string; model?: string }) => {
    const model = opts.model || bgmModels[0]?.id;
    if (!model) throw new Error("暂无可用的 AI 配乐模型");
    const res = await api<{ id: number }>(`/api/canvases/${project.id}/bgm`, {
      uid: crypto.randomUUID(),
      model,
      prompt: opts.prompt.slice(0, 300),
      instruction: "background music soundtrack",
      price_revision: studio.pricing.revision,
    });
    setPendingBgmJobId(res.id);
    await fetchRuns();
  };
  const compositionAudioAssets = [
    ...bgmRuns
      .filter((r) => r.status === "done" && r.result)
      .map((r) => ({
        id: r.result!,
        label: `${r.model || "配乐"} · ${(r.prompt || "").slice(0, 18) || "#" + r.id}`,
      })),
    ...studio.assets
      .filter((a) => a.kind === "audio" || a.kind === "ref_audio")
      .map((a) => ({
        id: a.id,
        label: a.name || `音频 ${a.id.slice(0, 6)}`,
      })),
    ...studio.jobs
      .filter((j) => j.kind === "audio" && j.status === "done" && j.result)
      .map((j) => ({
        id: j.result!,
        label: `${j.model || "配乐"} · ${(j.prompt || "").slice(0, 18) || "#" + j.id}`,
      })),
  ].filter((item, idx, arr) => arr.findIndex((x) => x.id === item.id) === idx);
  const handleInheritTailFrame = async (shotId: string) => {
    const source = doc.ref.current.document.nodes.find((n) => n.id === shotId);
    if (!source) return;
    const { run, media } = resolveNodeFromIndex(source, runsByNode);
    const sourceRun = run ?? (media ? studioJobByResult.get(media) : undefined);
    const continuation = resolveNodeTailContinuation(source, sourceRun);
    if (!continuation) {
      notify("当前空间没有支持参考图首帧续接的视频模型");
      return;
    }
    const nextVideoModel = continuation.model;
    await doc.flush();
    const res = await api<{ asset_id: string; width: number; height: number }>(
      `/api/canvases/${project.id}/nodes/${shotId}/tail-frame`,
      {},
    );
    const nextIdx = doc.ref.current.document.nodes.length + 1;
    const imgNode = newNode("image", source.x + source.width + 64, source.y, nextIdx);
    imgNode.title = `${source.title || "镜头"} · 尾帧`;
    imgNode.media_id = res.asset_id;
    imgNode.use_media = true;
    const vidNode = newNode("video", imgNode.x + imgNode.width + 64, source.y, nextIdx + 1);
    vidNode.title = `${source.title || "镜头"} 续镜`;
    vidNode.tail_inherited = true;
    vidNode.generation_mode = "first_last_frame";
    const supportsH3Frames = Boolean(
      studio.model_forms?.[nextVideoModel]?.referenceModes?.includes("frames"),
    );
    const nextSpec = studio.model_catalog?.[nextVideoModel];
    vidNode.params = {
      ...source.params,
      model: nextVideoModel,
      ...(nextSpec?.provider === "flow"
        ? {
            ratio: nextSpec.ratio || source.params.ratio,
            seconds: (nextSpec.seconds || source.params.seconds) as Params["seconds"],
            resolution: ((nextSpec.resolution === "原生" ? "1K" : nextSpec.resolution) || "1K") as Params["resolution"],
            flow_source_job: null,
          }
        : {}),
      h3: supportsH3Frames
        ? {
            mode: "frames",
            first_frame: res.asset_id,
            last_frame: null,
            video_audio: [],
          }
        : null,
    };
    doc.change((d) => ({
      ...d,
      document: {
        ...d.document,
        nodes: [...d.document.nodes, imgNode, vidNode],
        edges: [
          ...d.document.edges,
          { id: crypto.randomUUID(), source: imgNode.id, target: vidNode.id },
        ],
        shots: [...(d.document.shots ?? []), vidNode.id],
      },
    }));
    notify(
      continuation.switched
        ? `已抽取尾帧并用 ${continuation.label} 创建续接镜头`
        : "已抽取尾帧并创建续接镜头",
    );
    if (viewMode === "list") setViewMode("split");
    selectOne(vidNode.id);
    focusNodes([vidNode.id]);
  };
  const renderShotNarration = (shot: { id: string }) => {
    const node = doc.value.document.nodes.find((n) => n.id === shot.id);
    if (!node) return null;
    const speechPlan = quoteCanvasSpeechPlan({
      studio,
      node,
      packs: availablePacks,
    });
    return (
      <Narration
        node={node}
        runs={runs}
        cost={speechPlan.narration.cost}
        costIndeterminate={speechPlan.narration.costIndeterminate}
        unavailableReason={speechPlan.narration.unavailableReason}
        dialogueUnavailableReason={speechPlan.dialogue.unavailableReason}
        dialogueLineUnavailableReasons={speechPlan.dialogue.lineReasons}
        audioModels={availableSpeechModels}
        activeModel={speechPlan.narration.activeModel}
        onEditStart={doc.begin}
        onEditEnd={doc.end}
        onChange={(patch, history) => edit(shot.id, patch, history)}
        onGenerate={async () => {
          const rev = await doc.flush();
          const key = `fm-canvas-voice-${studio.me.id}-${project.id}-${shot.id}`;
          let pending;
          try {
            pending = JSON.parse(localStorage.getItem(key) || "null");
          } catch {}
          if (!pending) {
            pending = {
              uid: crypto.randomUUID(),
              expected_revision: rev,
              price_revision: studio.pricing.revision,
            };
            localStorage.setItem(key, JSON.stringify(pending));
          }
          try {
            const result = await api(
              `/api/canvases/${project.id}/nodes/${shot.id}/narration`,
              pending,
            );
            edit(shot.id, { narration_pending: result.id });
            await doc.flush();
            localStorage.removeItem(key);
            await fetchRuns();
          } catch (e) {
            if (e instanceof ApiError && e.status < 500)
              localStorage.removeItem(key);
            throw e;
          }
        }}
        onGenerateDialogue={async (lineId) => {
          const rev = await doc.flush();
          const result = await api<{ items: { line_id: string; id: number }[] }>(
            `/api/canvases/${project.id}/nodes/${shot.id}/dialogue`,
            {
              uid: crypto.randomUUID(),
              expected_revision: rev,
              price_revision: studio.pricing.revision,
              ...(lineId ? { line_id: lineId } : {}),
            },
          );
          const idMap = new Map(result.items.map((it) => [it.line_id, it.id]));
          const current = doc.ref.current.document.nodes.find(
            (n) => n.id === shot.id,
          );
          if (current?.dialogue_lines?.length) {
            // F027 (#9): Write ONLY audio_pending on submission; preserve previous
            // valid audio_job until the new run actually completes with an output asset.
            edit(shot.id, {
              dialogue_lines: current.dialogue_lines.map((l) =>
                idMap.has(l.id) ? { ...l, audio_pending: idMap.get(l.id)! } : l,
              ),
            });
            await doc.flush();
          }
          await fetchRuns();
        }}
      />
    );
  };
  return (
    <div
      ref={workspaceRef}
      className="canvas-workspace"
      data-surface={surface}
      data-view-mode={viewMode}
      data-composer-open={composerOpen ? "true" : "false"}
      data-selection-toolbar={selectionToolbarOpen ? "true" : "false"}
      style={
        {
          "--fm-agent-width": `${agentDockedWidth}px`,
          "--fm-right-obstruction": `${rightObstruction}px`,
          "--fm-header-bottom": `${headerBottom}px`,
          "--fm-workspace-top": `${workspaceTop}px`,
        } as React.CSSProperties
      }
      tabIndex={-1}
      onKeyDown={(e) => {
        const pop = (e.target as HTMLElement).closest(".cv-menu");
        if (!pop) return;
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          const buttons = Array.from(
            pop.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
          );
          const i = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          if (menu === "project") closeProjectMenu();
          else setMenu(null);
          setContext(null);
          setDownstream(null);
        }
      }}
    >
      <CanvasViewportEffects
        workspaceRef={workspaceRef}
        anchorNode={single}
        hasDownstream={Boolean(downstream)}
        panelHeight={panelHeight}
        windowSize={windowSize}
      />
      <NodeContext.Provider value={contextValue}>
        <ReactFlow<RFNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onKeyDown={(e) => {
            const target = e.target;
            if (
              hand ||
              e.key !== "Enter" ||
              !(target instanceof HTMLElement) ||
              !target.matches(".react-flow__node")
            ) return;
            const note = doc.ref.current.document.nodes.find(
              (n) => n.id === target.dataset.id,
            );
            if (note?.type !== "sticky" || note.extension) return;
            e.preventDefault();
            beginEditing(note.id);
          }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={connect}
          isValidConnection={isValidConnection}
          onNodeDragStart={() => {
            dragging.current = true;
            doc.begin();
          }}
          onNodeDragStop={() => {
            dragging.current = false;
            doc.end();
          }}
          onSelectionDragStart={() => {
            dragging.current = true;
            doc.begin();
          }}
          onSelectionDragStop={() => {
            dragging.current = false;
            doc.end();
          }}
          onPaneClick={() => {
            setSelected([]);
            setSelectedEdges([]);
            setEditing(null);
            setMenu(null);
          }}
          onNodeContextMenu={(e, n) => {
            e.preventDefault();
            if (!selected.includes(n.id)) {
              setSelected(nextContextSelection(selected, n.id));
              setSelectedEdges([]);
            }
            setContext({ x: e.clientX, y: e.clientY, node: n.id });
          }}
          onSelectionContextMenu={(e, selection) => {
            e.preventDefault();
            if (!selection.length) return;
            setContext({ x: e.clientX, y: e.clientY, node: selection[0].id });
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            setContext({ x: e.clientX, y: e.clientY });
          }}
          onMoveStart={onMoveStart}
          onMoveEnd={onMoveEnd}
          defaultViewport={defaultViewport}
          onDrop={(e) => {
            e.preventDefault();
            void uploadFiles([...e.dataTransfer.files]);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          style={FLOW_GRID_STYLE}
          minZoom={0.15}
          maxZoom={2.5}
          panOnDrag={hand ? true : [1, 2]}
          selectionOnDrag={!hand}
          selectionMode={SelectionMode.Partial}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          multiSelectionKeyCode="Shift"
          panActivationKeyCode="Space"
          deleteKeyCode={null}
          colorMode={theme}
          onlyRenderVisibleElements={virtualizeElements}
          preventScrolling
          fitView={false}
          nodesDraggable={!hand && !editing}
          elementsSelectable={!hand}
          ariaLabelConfig={ARIA_LABEL_CONFIG}
        >
          {minimap && (
            <MiniMap
              pannable
              zoomable
              position={mobileMiniMap ? "top-right" : "bottom-left"}
              nodeColor="var(--cv-map-node)"
              maskColor="var(--cv-map-mask)"
              style={
                mobileMiniMap
                  ? { width: 136, height: 92 }
                  : { bottom: 64, left: 12 }
              }
            />
          )}
        </ReactFlow>
      </NodeContext.Provider>
      <header className="canvas-header">
        <div className="project-heading">
          <a
            className="cv-brand"
            href={workspaceURL("/studio")}
            title="返回工作台"
            aria-label="返回工作台"
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              void closeAndLeave("/studio");
            }}
          >
            <img src="/static/mark.svg" alt="弗淼 AIGC" />
          </a>
          <IconButton
            icon={ArrowLeft}
            label="所有画布"
            onClick={() => void closeAndLeave(canvasListPath)}
          />
          <input
            aria-label="画布名称"
            value={doc.value.title}
            maxLength={80}
            onFocus={doc.begin}
            onChange={(e) =>
              doc.change((d) => ({ ...d, title: e.target.value }), false)
            }
            onBlur={() => {
              if (!doc.ref.current.title.trim())
                doc.change((d) => ({ ...d, title: "未命名画布" }), false);
              doc.end();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <span className="menu-trigger" ref={projectMenuTrigger}>
            <IconButton
              icon={ChevronDown}
              label="项目菜单"
              aria-expanded={menu === "project"}
              onClick={() => setMenu(menu === "project" ? null : "project")}
            />
          </span>
          {archived && (
            <span className="canvas-archived-pill" title="已归档，仍可编辑">已归档</span>
          )}
          <span className="node-count fm-number">节点 {nodes.length}</span>
          <button
            className={
              "save-state " +
              (["error", "conflict"].includes(doc.status) ? "save-error" : "")
            }
            onClick={() => {
              if (doc.status === "error")
                void doc.flush().catch((e) => notify(e.message));
            }}
            title={doc.error || "自动保存"}
          >
            {doc.status === "saved" ? (
              <>
                <Check className="fm-state-change" size={13} />
                已保存
              </>
            ) : doc.status === "saving" || doc.status === "dirty" ? (
              <>保存中</>
            ) : doc.status === "conflict" ? (
              "保存冲突"
            ) : (
              "保存失败，重试"
            )}
          </button>
        </div>
        <div className="global-tools">
          {surface === "canvas" && (
            <div className="fm-view-switch" role="group" aria-label="画布与分镜表视图切换">
              <button
                type="button"
                className={viewMode === "canvas" ? "active" : ""}
                onClick={() => setViewMode("canvas")}
                title="纯画布视图"
              >
                <LayoutGrid size={14} />
                画布
              </button>
              <button
                type="button"
                className={viewMode === "split" ? "active" : ""}
                onClick={() => setViewMode("split")}
                title="画布 + 分镜表双轨分屏"
              >
                <Columns2 size={14} />
                分屏
              </button>
              <button
                type="button"
                className={viewMode === "list" ? "active" : ""}
                onClick={() => setViewMode("list")}
                title="纯分镜表视图"
              >
                <List size={14} />
                镜头列表
              </button>
            </div>
          )}
          <IconButton
            icon={Search}
            label="搜索节点"
            onClick={() => {
              setFind("");
              setPanel("search");
            }}
          />
          <IconButton
            icon={Clock}
            label="生成历史"
            onClick={() => {
              setPanel("history");
              if (runsError && !runsLoading) {
                void fetchRuns().catch(() => {});
              }
            }}
          />
          <IconButton icon={FileText} label="AI 分镜" onClick={() => setAiStoryboard(true)} />
          <IconButton
            icon={MessageSquare}
            label="AI 创作助手"
            active={agentDock && agentTab === "chat"}
            onClick={() => {
              if (agentDock && agentTab === "chat") {
                setAgentDock(false);
              } else {
                setAgentTab("chat");
                setAgentDock(true);
                if (window.innerWidth <= 1100 && viewMode !== "canvas") {
                  setViewMode("canvas");
                }
              }
            }}
          />
          <button
            type="button"
            className={
              "icon-button fm-agent-trigger" +
              (agentDock && agentTab === "proposals" ? " active" : "")
            }
            title="画布 Agent 提案箱"
            aria-label="画布 Agent 提案箱"
            aria-expanded={agentDock && agentTab === "proposals"}
            onClick={() => {
              if (agentDock && agentTab === "proposals") {
                setAgentDock(false);
              } else {
                setAgentTab("proposals");
                setAgentDock(true);
                if (window.innerWidth <= 1100 && viewMode !== "canvas") {
                  setViewMode("canvas");
                }
              }
            }}
          >
            <Sparkles size={18} />
            {pendingProposals > 0 && (
              <span className="fm-agent-badge fm-number">{pendingProposals}</span>
            )}
          </button>
        </div>
      </header>
      <div
        className="fm-surface-switcher"
        role="tablist"
        aria-label="画布与剧本文档切换"
      >
        <button
          type="button"
          role="tab"
          aria-selected={surface === "canvas"}
          className={surface === "canvas" ? "active" : ""}
          onClick={() => setSurface("canvas")}
        >
          <LayoutGrid size={14} />
          画布
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={surface === "document"}
          className={surface === "document" ? "active" : ""}
          onClick={() => {
            setScriptWorkspaceMounted(true);
            setSurface("document");
          }}
        >
          <BookOpen size={14} />
          文档
        </button>
      </div>
      {menu === "project" && (
        <div
          className="cv-menu project-menu fm-project-switcher-menu"
          ref={projectMenu}
        >
          <div className="fm-project-switcher-search">
            <Search size={14} />
            <input
              value={projectSearch}
              placeholder="搜索并切换工作区画布…"
              aria-label="搜索工作区画布"
              onChange={(e) => setProjectSearch(e.target.value)}
            />
          </div>
          {projectCanvases.length > 0 && (
            <>
              <div
                className="fm-project-switcher-list"
                role="listbox"
                aria-label="工作区画布列表"
              >
                {projectCanvases
                  .filter(
                    (c) =>
                      !projectSearch.trim() ||
                      c.title
                        .toLowerCase()
                        .includes(projectSearch.trim().toLowerCase()),
                  )
                  .slice(0, 12)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={c.id === project.id ? "active" : ""}
                      onClick={() => {
                        if (c.id === project.id) {
                          setMenu(null);
                          return;
                        }
                        void closeAndLeave("/canvas/" + c.id);
                      }}
                    >
                      <Layers size={14} />
                      <span>{c.title}</span>
                      {c.id === project.id ? (
                        <Check size={13} />
                      ) : (
                        <small className="fm-number">{c.count}</small>
                      )}
                    </button>
                  ))}
              </div>
              <div className="menu-divider" />
            </>
          )}
          <button onClick={() => void closeAndLeave(canvasListPath)}>
            <LayoutGrid size={16} />
            所有画布
          </button>
          <button
            onClick={() => {
              closeProjectMenu();
              void guardedTransition({ kind: "create" });
            }}
          >
            <Plus size={16} />
            新建画布
          </button>
          <button
            onClick={() => {
              closeProjectMenu();
              void guardedTransition({ kind: "duplicate" });
            }}
          >
            <Copy size={16} />
            复制画布
          </button>
          <button
            onClick={() => {
              downloadJSON(doc.value.title, doc.value);
              closeProjectMenu();
            }}
          >
            <Download size={16} />
            下载画布文档
          </button>
          {project.can_delete && (
            <button
              type="button"
              aria-busy={archivePending}
              aria-disabled={archivePending}
              onClick={() => void changeArchive()}
            >
              {archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              {archived ? "恢复画布" : "归档画布"}
            </button>
          )}
          <div className="menu-divider" />
          <button onClick={() => closeAndLeave("/studio")}>
            <ArrowLeft size={16} />
            返回工作台
          </button>
        </div>
      )}
      <aside className="insert-toolbar" aria-label="添加节点">
        {(["text", "image", "video", "sticky"] as Kind[]).map((kind) => (
          <IconButton
            key={kind}
            icon={icons[kind]}
            label={"添加" + names[kind]}
            onClick={() => add(kind)}
          />
        ))}
        {(studio.canvas_nodes ?? []).map(def => <IconButton
          key={def.plugin + "/" + def.id} icon={Settings2} label={"添加" + def.title}
          onClick={() => add("plugin",undefined,undefined,def)}/>)}
        <div className="menu-divider" />
        <IconButton
          icon={FolderOpen}
          label="资产库"
          onClick={() => {
            setPickerTarget(null);
            setAssetType("all");
            setAssetSelection(new Set());
            setPanel("assets");
          }}
        />
        <IconButton
          icon={Upload}
          label="上传图片"
          disabled={progress !== null}
          onClick={() => {
            fileTarget.current = null;
            fileRef.current?.click();
          }}
        />
      </aside>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const target = fileTarget.current;
          fileTarget.current = null;
          void uploadFiles([...(e.target.files || [])], target);
        }}
      />
      {!nodes.length && (
        <div className="canvas-empty">
          <p>从一个节点开始</p>
          <div>
            <button onClick={() => add("text")}>
              <Type size={18} />
              文本
            </button>
            <button onClick={() => add("image")}>
              <ImageIcon size={18} />
              图片
            </button>
            <button onClick={() => add("video")}>
              <Film size={18} />
              视频
            </button>
          </div>
        </div>
      )}
      {single && !editing && (
        <div className="selection-toolbar" style={TOOLBAR_POSITION_STYLE}>
          <IconButton
            icon={Copy}
            label="复制副本"
            onClick={() => paste(true)}
          />
          <IconButton
            icon={Maximize}
            label="聚焦节点"
            onClick={() => focusNodes([single.id])}
          />
          {typeof single.extra_params?.script_doc_id === "string" &&
            Boolean(single.extra_params.script_doc_id) && (
              <IconButton
                icon={BookOpen}
                label="查看源剧本"
                onClick={() => {
                  const docId = String(single.extra_params!.script_doc_id);
                  const line =
                    typeof single.extra_params?.script_line === "number"
                      ? single.extra_params.script_line
                      : undefined;
                  const anchor =
                    typeof single.extra_params?.script_anchor === "string"
                      ? single.extra_params.script_anchor
                      : undefined;
                  const shotId =
                    typeof single.extra_params?.script_shot_id === "string"
                      ? single.extra_params.script_shot_id
                      : undefined;
                  setScriptWorkspaceMounted(true);
                  setSurface("document");
                  setScriptJumpReq((prev) => ({
                    docId,
                    anchor,
                    shotId,
                    line,
                    seq: (prev?.seq ?? 0) + 1,
                  }));
                }}
              />
            )}
          <span className="menu-trigger">
            <IconButton
              icon={Palette}
              label="颜色标签"
              onClick={() => setMenu(menu === "colors" ? null : "colors")}
            />
          </span>
          {canDownloadSelected && (
            <IconButton icon={Download} label="下载" onClick={downloadNodes} />
          )}
          <IconButton icon={Trash2} label="删除节点" onClick={removeSelected} />
          {single.type === "video" && (
            <IconButton icon={ListVideo}
              label={shotIds.includes(single.id) ? "查看镜头列表" : "加入镜头列表"}
              onClick={() => shotIds.includes(single.id) ? setViewMode((m) => (m === "canvas" ? "split" : m)) : addShot(single)} />
          )}
          {single.type === "image" && current?.media && shots.length > 0 && (
            <IconButton icon={Link2} label="应用参考图到镜头" onClick={() => openSharedReference(single.id)} />
          )}
          {single.type === "image" && current?.media && (
            <IconButton
              icon={RefreshCw}
              label="替换内容"
              onClick={() => {
                setPickerTarget(single.id);
                setAssetType("image");
                setAssetSelection(new Set());
                setPanel("assets");
              }}
            />
          )}
          {completedVersions.length > 0 && (
              <span className="menu-trigger">
                <button
                  className="version-button"
                  onClick={() =>
                    setMenu(menu === "versions" ? null : "versions")
                  }
                >
                  {single.active_job ? "已采用" : "版本"} <ChevronDown size={14} />
                </button>
              </span>
            )}
          {menu === "colors" && (
            <div className="cv-menu color-menu">
              {colors.map((color, i) => (
                <button
                  key={color}
                  className={"color-choice " + color}
                  aria-label={colorNames[i]}
                  title={colorNames[i]}
                  aria-pressed={single.color === color}
                  onClick={() => {
                    edit(single.id, { color });
                    setMenu(null);
                  }}
                >
                  {single.color === color && <Check size={15} />}
                </button>
              ))}
            </div>
          )}
          {menu === "versions" && (
            <div className="cv-menu versions-menu">
              <button
                onClick={() => {
                  edit(single.id, { active_job: null, use_media: false });
                  setMenu(null);
                }}
              >
                跟随最新版本{!single.active_job && !single.use_media && <Check size={14} />}
              </button>
              {single.type === "video" && completedVersions.length > 1 && (
                <button onClick={() => { setCompareNode(single.id); setMenu(null); }}>
                  <Columns2 size={16} /> 并排对比
                </button>
              )}
              {completedVersions.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => {
                      edit(single.id, { active_job: j.id, use_media: false });
                      setMenu(null);
                    }}
                  >
                    {single.active_job === j.id ? "版本" : "采用"} #{j.id}{" "}
                    <span>
                      {new Date(j.created * 1000).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {single.active_job === j.id && <>已采用 <Check size={14} /></>}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
      {selected.length > 1 && (
        <div className="multi-toolbar" role="toolbar" aria-label="多选批量操作">
          <span>已选 {selected.length} 个节点</span>
          <IconButton
            icon={Copy}
            label="复制副本"
            onClick={() => paste(true)}
          />
          <IconButton icon={LayoutGrid} label="宫格布局" onClick={arrange} />
          <IconButton
            icon={Download}
            label="批量下载"
            disabled={!canDownloadSelected}
            onClick={downloadNodes}
          />
          {batchShots.videoIds.length > 0 && (
            <IconButton
              icon={ListVideo}
              label={batchShots.allInShots ? "查看镜头列表" : "加入镜头列表"}
              onClick={() =>
                batchShots.allInShots
                  ? setViewMode((m) => (m === "canvas" ? "split" : m))
                  : addSelectedShots()
              }
            />
          )}
          <IconButton
            icon={Trash2}
            label="删除所选节点"
            onClick={removeSelected}
          />
          <span className="dock-divider" aria-hidden="true" />
          <button
            type="button"
            className="secondary fm-multi-action"
            onClick={createGroupFromSelection}
          >
            <Layers size={14} />
            建工作流组
          </button>
          <button
            type="button"
            className="primary fm-multi-action"
            onClick={() => {
              void doc
                .flush()
                .then(() =>
                  setPrecheckTarget({
                    nodeIds: selected,
                    title: `多选批量预检 (${selected.length} 节点)`,
                    stages: ["image", "video", "narration", "dialogue"],
                  }),
                )
                .catch((e) => notify((e as Error).message));
            }}
          >
            <Play size={14} />
            预检并批量生成
          </button>
        </div>
      )}
      {single?.extension && (
        <section className="node-composer plugin-node-form" style={COMPOSER_POSITION_STYLE} aria-label={single.title + "参数"}>
          <PluginNodeForm extension={single.extension}
            available={!!studio.canvas_nodes?.some(n => n.id === single.extension!.definition.id && n.plugin === single.extension!.definition.plugin && n.version === single.extension!.definition.version)}
            busy={!!submitting}
            change={values => edit(single.id,{extension:{...single.extension!,values}})}
            run={() => void executePlugin(single.id)}/>
        </section>
      )}
      {showComposer && (
        <section
          className="node-composer"
          ref={mediaPanelRef}
          style={COMPOSER_POSITION_STYLE}
          aria-label={single.type === "image" ? "图片生成器" : "视频生成器"}
        >
          {incoming.length > 0 && !h3Native && (
            <div className="reference-list">
              {incoming.map(({ node, edge }, index) => {
                const output = linkedValue(node,edge,runs);
                const key = output.kind === "image" && output.value;
                return (
                  <div
                    className="reference-chip"
                    key={edge.id}
                    title={node.title}
                  >
                    {key ? (
                      <img src={mediaURL(key)} alt={node.title} />
                    ) : (
                      <Type size={17} />
                    )}
                    <span>{node.title}</span>
                    <div className="reference-actions">
                      {index > 0 && (
                        <IconButton
                          icon={ChevronLeft}
                          label={"前移 " + node.title}
                          onClick={() =>
                            doc.change((d) => {
                              const list = [...d.document.edges],
                                i = list.findIndex((e) => e.id === edge.id),
                                before = list.findIndex(
                                  (e) => e.id === incoming[index - 1].edge.id,
                                );
                              [list[i], list[before]] = [list[before], list[i]];
                              return {
                                ...d,
                                document: { ...d.document, edges: list },
                              };
                            })
                          }
                        />
                      )}
                      <IconButton
                        icon={X}
                        label={"移除引用 " + node.title}
                        onClick={() =>
                          doc.change((d) => ({
                            ...d,
                            document: {
                              ...d.document,
                              edges: d.document.edges.filter(
                                (e) => e.id !== edge.id,
                              ),
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })}
              <button
                className="add-reference"
                aria-label="添加引用"
                onClick={() => {
                  setFind("");
                  setPanel("references");
                }}
              >
                <Plus size={17} />
              </button>
              {firstFrame && (
                <button className="crop-trigger" onClick={() => setShowCrop(true)}>首帧裁切</button>
              )}
            </div>
          )}
          {h3Native&&<H3Inputs key={single.id} options={h3Options} ids={h3Ids} assets={studio.assets} onChange={updateH3} onAsset={a=>setStudio(s=>({...s,assets:[{...a,owner:s.me.id},...s.assets]}))} onMention={token=>edit(single.id,{prompt:single.prompt+token+' '})} onBusy={setH3Busy}/>}
          {(() => {
            const effectiveGenMode = resolveEffectiveGenerationMode(
              single,
              h3Native,
              h3Frames,
            );
            const activeCineCount = countActiveCinematography(
              single.cinematography,
            );
            const genModeIcon =
              effectiveGenMode === "grid_preview"
                ? LayoutGrid
                : effectiveGenMode === "omni_ref"
                  ? Link2
                  : effectiveGenMode === "first_last_frame"
                    ? Film
                    : ImageIcon;
            return (
              <div className="fm-composer-wave3-bar">
                {!h3Frames && (
                  <div className="canvas-pack-entry">
                    <button
                      type="button"
                      className={
                        "fm-ui-chip" +
                        (single.asset_packs?.length ? " active" : "")
                      }
                      onClick={() => setPackPicker(single.id)}
                    >
                      <FolderOpen size={14} />
                      <span>素材包</span>
                      {single.asset_packs?.length ? (
                        <span className="fm-chip-badge">
                          {single.asset_packs.length}
                        </span>
                      ) : null}
                    </button>
                  </div>
                )}
                <OptionSelect
                  ariaLabel="分镜生成链路"
                  icon={genModeIcon}
                  value={effectiveGenMode}
                  active={effectiveGenMode === "grid_preview"}
                  disabled={h3Busy}
                  options={GENERATION_MODE_OPTIONS}
                  onChange={(mode) => {
                    if (h3Native && mode === "omni_ref") {
                      chooseH3Mode("reference");
                      return;
                    }
                    if (h3Native && mode === "first_last_frame") {
                      chooseH3Mode("frames");
                      return;
                    }
                    edit(single.id, {
                      generation_mode: mode,
                      ...(mode === "grid_preview"
                        ? { grid_layout: single.grid_layout ?? "3x3" }
                        : {}),
                    });
                  }}
                />
                {effectiveGenMode === "grid_preview" && (
                  <SegmentedOptions
                    ariaLabel="宫格规格"
                    value={single.grid_layout ?? "3x3"}
                    options={GRID_LAYOUT_OPTIONS}
                    onChange={(layout) =>
                      edit(single.id, { grid_layout: layout })
                    }
                  />
                )}
                <button
                  type="button"
                  className={
                    "fm-ui-chip" +
                    (showCinePanel || activeCineCount > 0 ? " active" : "")
                  }
                  aria-expanded={showCinePanel}
                  onClick={() => setShowCinePanel((v) => !v)}
                >
                  <Clapperboard size={14} />
                  <span>导演参数</span>
                  {activeCineCount > 0 && (
                    <span className="fm-chip-badge">{activeCineCount}</span>
                  )}
                  <ChevronDown size={13} className="fm-ui-chevron" />
                </button>
                {single.type === "image" && current?.media && (
                  <button
                    type="button"
                    className="fm-ui-chip"
                    onClick={() =>
                      setGridCropTarget({
                        nodeId: single.id,
                        mediaId: current.media!,
                        layout: single.grid_layout ?? "3x3",
                      })
                    }
                  >
                    <Crop size={14} />
                    <span>宫格裁切</span>
                  </button>
                )}
              </div>
            );
          })()}
          {showCinePanel && (
            <FloatingCinematographyPopover
              anchorNode={single}
              panelHeight={panelHeight}
              windowSize={windowSize}
              headerBottom={workspaceTop}
              viewMode={viewMode}
              agentDock={agentDock}
              agentDockedWidth={agentDockedWidth}
              mediaPanelRef={mediaPanelRef}
              value={single.cinematography}
              onChange={(cinematography) => edit(single.id, { cinematography })}
              onClose={() => setShowCinePanel(false)}
            />
          )}
          {h3Native?<H3Prompt
            value={single.prompt}
            ids={h3Ids}
            assets={studio.assets}
            frames={h3Frames}
            packs={availablePacks}
            onChange={prompt=>edit(single.id,{prompt},false)}
            onMountPack={(pack) => {
              const existing = single.asset_packs ?? [];
              const nextPacks = existing.some((p) => p.id === pack.id)
                ? existing
                : [...existing, { id: pack.id, revision: pack.revision, name: pack.name }];
              setPackMedia((prev) => ({ ...prev, [pack.id]: pack.media }));
              if (h3Frames) {
                edit(single.id, {
                  generation_mode: "omni_ref",
                  asset_packs: nextPacks,
                  params: {
                    ...single.params,
                    h3: { mode: "reference", video_audio: [] },
                    h3_refs: [
                      ...new Set([
                        ...(single.params.h3_refs || []),
                        h3Options.first_frame,
                        h3Options.last_frame,
                      ].filter((k): k is string => Boolean(k))),
                    ],
                  },
                });
              } else {
                edit(single.id, { asset_packs: nextPacks });
              }
            }}
            onFocus={doc.begin}
            onBlur={doc.end}
            onKeyDown={generateShortcut}
          />:<ReferencePromptInput
            value={single.prompt}
            packs={availablePacks}
            refImages={referenceMedia.filter((id): id is string => Boolean(id))}
            placeholder={`描述你想生成的${single.type === "image" ? "图片" : "视频"}，键入 @ 引用角色/场景素材包或 @图N`}
            onFocus={doc.begin}
            onChange={(prompt) => edit(single.id, { prompt }, false)}
            onMountPack={(pack) => {
              const existing = single.asset_packs ?? [];
              setPackMedia((prev) => ({ ...prev, [pack.id]: pack.media }));
              if (!existing.some((p) => p.id === pack.id)) {
                edit(single.id, {
                  asset_packs: [...existing, { id: pack.id, revision: pack.revision, name: pack.name }],
                });
              }
            }}
            onBlur={doc.end}
            onKeyDown={generateShortcut}
          />}
          {flowModel?.mode==='extend'&&<label className="cv-flow-source">来源视频<select aria-label="画布续写来源视频" value={single.params.flow_source_job||''} onChange={e=>patchParams({flow_source_job:Number(e.target.value)||null})}><option value="">请选择已完成的 Flow 视频</option>{flowSources.map(j=><option key={j.id} value={j.id}>#{j.id} · {j.prompt.slice(0,42)}</option>)}</select></label>}
          {flowInputError&&<p className="cv-flow-hint" role="status">{flowInputError}</p>}
          {(customFormFields.length > 0 || formConstraints?.references.reason) && (
            <div className="fm-dynamic-form-fields" role="group" aria-label="模型专属参数">
              {customFormFields.map(([key, field]) => {
                const state = formConstraints?.fields[key];
                if (state && !state.visible) return null;
                const currentVal = single.extra_params?.[key] ?? field.default ?? "";
                const updateExtra = (nextVal: string | number | boolean) =>
                  edit(single.id, {
                    extra_params: { ...(single.extra_params ?? {}), [key]: nextVal },
                  });
                const fieldTitle = field.title || key;
                if (field.type === "boolean") {
                  return (
                    <label key={key} className="fm-dynamic-field-check" title={state?.disabledReason}>
                      <input
                        type="checkbox"
                        aria-label={fieldTitle}
                        disabled={Boolean(state?.disabled)}
                        checked={Boolean(currentVal)}
                        onChange={(e) => updateExtra(e.target.checked)}
                      />
                      <span>{fieldTitle}</span>
                    </label>
                  );
                }
                if (field.enum?.length) {
                  return (
                    <label key={key} className="fm-dynamic-field" title={state?.disabledReason}>
                      <span>{fieldTitle}</span>
                      <select
                        aria-label={fieldTitle}
                        disabled={Boolean(state?.disabled)}
                        value={String(currentVal)}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const matched = field.enum!.find((opt) => String(opt) === raw);
                          updateExtra(matched !== undefined ? matched : raw);
                        }}
                      >
                        {field.enum.map((opt) => {
                          const optReason =
                            state?.disabledOptions[JSON.stringify(opt)] ??
                            state?.incompatibleOptions[JSON.stringify(opt)];
                          return (
                            <option
                              key={String(opt)}
                              value={String(opt)}
                              disabled={Boolean(optReason)}
                            >
                              {field.optionLabels?.[String(opt)] ?? String(opt)}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  );
                }
                if (field.type === "number" || field.type === "integer") {
                  return (
                    <label key={key} className="fm-dynamic-field" title={state?.disabledReason}>
                      <span>{fieldTitle}</span>
                      <input
                        type="number"
                        aria-label={fieldTitle}
                        disabled={Boolean(state?.disabled)}
                        min={field.minimum}
                        max={field.maximum}
                        step={field.type === "integer" ? 1 : 0.1}
                        value={currentVal === "" ? "" : Number(currentVal)}
                        onChange={(e) => {
                          const num = Number(e.target.value);
                          if (Number.isFinite(num)) {
                            updateExtra(field.type === "integer" ? Math.round(num) : num);
                          }
                        }}
                      />
                    </label>
                  );
                }
                return (
                  <label key={key} className="fm-dynamic-field" title={state?.disabledReason}>
                    <span>{fieldTitle}</span>
                    <input
                      type="text"
                      aria-label={fieldTitle}
                      disabled={Boolean(state?.disabled)}
                      maxLength={field.maxLength}
                      value={String(currentVal)}
                      onChange={(e) => updateExtra(e.target.value)}
                    />
                  </label>
                );
              })}
              {formConstraints?.references.reason && (
                <small className="fm-dynamic-ref-hint" role="status">
                  参考图槽位 ({formConstraints.references.min}–{formConstraints.references.max})：{formConstraints.references.reason}
                </small>
              )}
            </div>
          )}
          <div className="composer-bottom">
            <div className="parameter-wrap menu-trigger" onKeyDown={modelKeys}>
              <button ref={modelButtonRef} className={"parameter" + (!availableModel(selectedModel) ? " model-unavailable" : "")} disabled={!selectedModel} aria-label="选择模型" aria-haspopup="listbox" aria-controls="canvas-model-options" aria-expanded={menu === "model"} onClick={() => menu === "model" ? closeModelMenu() : setMenu("model")}>
                {!selectedModel ? "无模型" : FlowPicker.label(studio.model_catalog,selectedModel)}<ChevronDown size={13}/>
              </button>
              {menu === "model" && <div ref={modelMenuRef} id="canvas-model-options" className="cv-menu duration-menu model-menu" role="listbox" aria-label="选择模型">{modelChoices.length>12&&<input className="cv-model-search" aria-label="搜索画布模型" placeholder="搜索模型" value={modelSearch} onChange={e=>setModelSearch(e.target.value)} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')closeModelMenu();}}/>} {modelChoices.filter(([,label])=>label.toLowerCase().includes(modelSearch.toLowerCase())).map(([value,label]) => <button key={value} role="option" aria-selected={FlowPicker.sameFamily(studio.model_catalog,selectedModel,value)} tabIndex={FlowPicker.sameFamily(studio.model_catalog,selectedModel,value) ? 0 : -1} onClick={() => {
                const nextForm = studio.model_forms[value];
                const spec = studio.model_catalog[value];
                const values = normalizeForm(nextForm, {ratio:single.params.ratio,seconds:single.params.seconds});
                patchParams(spec?.provider==='flow'?{model:value,ratio:spec.ratio!,seconds:spec.seconds!,resolution:(spec.resolution==='原生'?'1K':spec.resolution) as Params['resolution'],flow_source_job:null}:{model:value,ratio:String(values.ratio ?? single.params.ratio),seconds:Number(values.seconds ?? single.params.seconds),flow_source_job:null});setModelSearch('');closeModelMenu();
              }}>{label}{FlowPicker.sameFamily(studio.model_catalog,selectedModel,value) && <Check size={14}/>}</button>)}</div>}
            </div>
            <div className="parameter-wrap menu-trigger">
              <button
                className={"parameter " + (flowModel&&!flowParameters ? "fixed-parameter " : "") + (menu === "format" ? "active" : "")}
                disabled={Boolean(flowModel&&!flowParameters)}
                aria-label={flowParameters?'选择生成方式和比例':'选择比例和分辨率'}
                onClick={() => setMenu(menu === "format" ? null : "format")}
              >
                <Square size={14} />
                {h3Frames&&referenceMedia.length?"自动":single.params.ratio}
                <span>
                  {flowModel ? flowModel.resolution : muse ? "原生" : single.type === "image"
                    ? single.params.resolution
                    : single.params.quality + "P"}
                </span>
              </button>
              {menu === "format" && (
                <div className="cv-menu parameter-menu">
                  {flowParameters&&flowParameters.modes.length>1&&<><span className="menu-label">生成方式</span><div className="resolution-options" role="group" aria-label="生成方式">{flowParameters.modes.map(mode=><button key={mode} className={flowModel?.mode===mode?'active':''} onClick={()=>patchParams({},mode)}>{FlowPicker.modeLabels[mode]}</button>)}</div></>}
                  <span className="menu-label">选择比例</span>
                  <div className="ratio-options">
                    {(flowParameters?.ratios ?? fields?.ratio?.enum?.map(String) ?? []).map((r) => {
                      const ratioDisabledReason = formConstraints?.fields.ratio?.disabledOptions[JSON.stringify(r)];
                      return (
                      <button
                        key={r}
                        disabled={(h3Frames&&referenceMedia.length>0) || Boolean(ratioDisabledReason)}
                        title={ratioDisabledReason}
                        className={single.params.ratio === r ? "active" : ""}
                        onClick={() => patchParams({ ratio: r })}
                      >
                        <span
                          className="ratio-icon"
                          style={{ aspectRatio: r.replace(":", "/") }}
                        />
                        {r}
                      </button>
                      );
                    })}
                  </div>
                  {!muse && !flowModel && <><span className="menu-label">选择分辨率</span>
                  <div className="resolution-options">
                    {((single.type === "image" ? fields?.resolution : fields?.quality)?.enum ?? []).map(
                      (v) => {
                        const resField = single.type === "image" ? "resolution" : "quality";
                        const resDisabledReason = formConstraints?.fields[resField]?.disabledOptions[JSON.stringify(v)];
                        return (
                        <button
                          key={String(v)}
                          disabled={Boolean(resDisabledReason)}
                          title={resDisabledReason}
                          className={
                            (single.type === "image"
                              ? single.params.resolution
                              : single.params.quality) === v
                              ? "active"
                              : ""
                          }
                          onClick={() =>
                            patchParams(
                              single.type === "image"
                                ? { resolution: v as "1K" | "2K" }
                                : { quality: v as 480 | 768 },
                            )
                          }
                        >
                          {v}
                          {single.type === "video" ? "P" : ""}
                        </button>
                        );
                      },
                    )}
                  </div></>}
                </div>
              )}
            </div>
            {!((muse || flowModel) && single.type === 'image') && <div className="parameter-wrap menu-trigger">
              <button
                className="parameter"
                disabled={Boolean(flowModel&&!flowParameters)}
                aria-label={single.type === "image" ? "图片质量" : "视频时长"}
                onClick={() => setMenu(menu === "duration" ? null : "duration")}
              >
                {single.type === "image" ? (
                  <Settings2 size={15} />
                ) : (
                  <Clock size={15} />
                )}
                <span>
                  {single.type === "image"
                    ? { low: "草稿", medium: "标准", high: "高清" }[
                        single.params.image_quality
                      ]
                    : single.params.seconds + "s"}
                </span>
                <ChevronDown size={13} />
              </button>
              {menu === "duration" && (
                <div className="cv-menu duration-menu">
                  {(single.type === "image"
                    ? fields?.image_quality?.enum ?? []
                    : flowParameters?.seconds ?? fields?.seconds?.enum ?? []
                  ).map((v) => {
                    const durField = single.type === "image" ? "image_quality" : "seconds";
                    const durDisabledReason = formConstraints?.fields[durField]?.disabledOptions[JSON.stringify(v)];
                    return (
                    <button
                      key={String(v)}
                      disabled={Boolean(durDisabledReason)}
                      title={durDisabledReason}
                      onClick={() => {
                        patchParams(
                          single.type === "image"
                            ? { image_quality: v as "low" | "medium" | "high" }
                            : { seconds: v as 5 | 6 | 8 | 10 | 15 },
                        );
                        setMenu(null);
                      }}
                    >
                      {single.type === "image"
                        ? { low: "草稿", medium: "标准", high: "高清" }[
                            v as "low"
                          ]
                        : v + "s"}
                      {(single.type === "image"
                        ? single.params.image_quality
                        : single.params.seconds) === v && <Check size={14} />}
                    </button>
                    );
                  })}
                </div>
              )}
            </div>}
            <IconButton
              icon={AtSign}
              label="引用画布节点"
              onClick={() => {
                setFind("");
                setPanel("references");
              }}
            />
            {single.type === "video" && !!form?.fastSteps && (
              <div className="parameter-wrap menu-trigger">
                <IconButton
                  icon={Settings2}
                  label="更多设置"
                  onClick={() =>
                    setMenu(menu === "advanced" ? null : "advanced")
                  }
                />
                {menu === "advanced" && (
                  <div className="cv-menu seed-menu">
                    <div className="advanced-mode-row">
                      <span>快速模式</span>
                      <button type="button" role="switch" aria-label="快速模式" aria-checked={Boolean(single.params.fast_mode)} className="cv-fast-switch"
                        onClick={()=>patchParams({fast_mode:!single.params.fast_mode})}><span aria-hidden="true" /></button>
                    </div>
                    {!single.params.fast_mode && <div>
                    <div className="sampling-label">采样步数</div>
                    <div className="sampling-options" role="radiogroup" aria-label="采样步数">
                      {stepsOptions.map(steps=>(
                        <button key={steps} type="button" role="radio" aria-checked={(single.params.sampling_steps ?? 20)===steps}
                          tabIndex={(single.params.sampling_steps ?? 20)===steps?0:-1}
                          onClick={()=>patchParams({sampling_steps:steps})}
                          onKeyDown={event=>{
                            if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
                            event.preventDefault();event.stopPropagation();
                            const options=stepsOptions;const direction=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1;
                            const next=(options.indexOf(steps)+direction+options.length)%options.length;patchParams({sampling_steps:options[next]});
                            (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
                          }}>{steps}</button>
                      ))}
                    </div>
                    </div>}
                    <input
                      type="number"
                      aria-label="随机种子"
                      min={0}
                      max={Number.MAX_SAFE_INTEGER}
                      placeholder="随机种子（留空随机）"
                      value={single.params.seed ?? ""}
                      onChange={(e) => {
                        const n =
                          e.target.value === "" ? null : Number(e.target.value);
                        if (n === null || (Number.isSafeInteger(n) && n >= 0))
                          patchParams({ seed: n });
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            <div className="parameter-wrap menu-trigger">
              <button className={'parameter ' + (menu === 'candidates' ? 'active' : '')}
                aria-label="候选数量" aria-expanded={menu === 'candidates'}
                onClick={() => setMenu(menu === 'candidates' ? null : 'candidates')}>{candidateCount} 个<ChevronDown size={13} /></button>
              {menu === 'candidates' && <div className="cv-menu duration-menu candidate-menu" role="group" aria-label="候选数量">
                {([1, 2] as const).map(count => <button key={count} aria-pressed={candidateCount === count}
                  onClick={() => {setCandidateCount(count); setMenu(null);}}><span>{count} 个候选</span>{candidateCount === count && <Check size={16} />}</button>)}
              </div>}
            </div>
            <span className="canvas-credit" aria-label={!selectedModel?'':creditPrice==null?'未定价':`${candidateCost} 积分${creditAvailable?'':'，余额不足'}`} title={`当前空间可用 ${studio.credits.available} 积分${creditPrice!=null && !creditAvailable?'，余额不足':''}`}>
              {!selectedModel?'':creditPrice==null?'未定价':<><svg className="credit-spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C13.4 8.7 15.3 10.6 22 12C15.3 13.4 13.4 15.3 12 22C10.6 15.3 8.7 13.4 2 12C8.7 10.6 10.6 8.7 12 2Z"/></svg><span>{candidateCost}</span></>}
            </span>
            <button
              className="generate-button"
              aria-label="生成"
              disabled={!canGenerate}
              onClick={generate}
              title={generationBlock || flowInputError || (missing ? "参考内容尚未就绪" : !hasPrompt ? "请输入提示词，或连接文本节点" : "生成")}
            >
              {submitting === single.id ? (
                <LoaderCircle size={20} className="spin" />
              ) : (
                <ArrowUp size={21} />
              )}
            </button>
          </div>
          {generationBlock && (
            <div className="composer-message">
              <span role="status">{generationBlock}</span>
              {generationBlock === "当前空间积分不足" && <button onClick={openCredits}>去充值</button>}
            </div>
          )}
          {sourceChanged && <p className="composer-message">参考或参数已变更，下一次生成会使用新设置。{single.active_job ? '已采用版本保持不变。' : ''}</p>}
          {missing && (
            <div className="composer-message">
              <button
                onClick={() => {
                  selectOne(missing.node.id);
                  focusNodes([missing.node.id]);
                }}
              >
                “{missing.node.title}”尚未就绪 <ChevronRight size={12} />
              </button>
            </div>
          )}
          {current?.latest?.status === "failed" && (
            <p className="composer-message error">{current.latest.note}</p>
          )}
          {visibleCandidates.map(job=><div className="composer-message" key={job.id}>
            <span>{job.batch?.count===2?`候选 ${job.batch.index} · `:''}{timeLabel(job)||labels[job.status]}</span>
            {job.status==='queued'&&(job.owner===studio.me.id||studio.me.role==='admin')&&<button disabled={cancellingRuns.has(job.id)} onClick={()=>void cancelRun(job.id)}>{cancellingRuns.has(job.id)?"正在取消…":"取消生成"}</button>}
            {job.status==='done'&&job.result&&single.active_job!==job.id&&<button onClick={()=>edit(single.id,{active_job:job.id,use_media:false})}>采用</button>}
            {job.status==='done'&&single.active_job===job.id&&<span>已采用</span>}
          </div>)}
        </section>
      )}
      <footer className="viewport-dock">
        <IconButton
          icon={MousePointer2}
          label="选择 V"
          active={!hand}
          onClick={() => setHand(false)}
        />
        <IconButton
          icon={Hand}
          label="抓手 H"
          active={hand}
          onClick={() => setHand(true)}
        />
        <span className="dock-divider" />
        <IconButton
          icon={MapIcon}
          label="小地图"
          active={minimap}
          onClick={() => setMinimap(!minimap)}
        />
        <IconButton
          icon={showEdges ? Link2 : Link2Off}
          label={showEdges ? "隐藏连线" : "显示连线"}
          onClick={() => setShowEdges(!showEdges)}
        />
        <span className="menu-trigger">
          <button
            className="zoom-button"
            aria-label="缩放菜单"
            onClick={() => setMenu(menu === "zoom" ? null : "zoom")}
          >
            <ZoomPercent /><ChevronDown size={12} />
          </button>
        </span>
        <span className="dock-divider" />
        <IconButton
          icon={Undo2}
          label="撤销 ⌘Z"
          disabled={!doc.canUndo}
          onClick={() => doc.travel()}
        />
        <IconButton
          icon={Redo2}
          label="重做 ⌘⇧Z"
          disabled={!doc.canRedo}
          onClick={() => doc.travel(true)}
        />
        {menu === "zoom" && (
          <div className="cv-menu zoom-menu">
            <button
              onClick={() => {
                focusNodes(nodes.map((n) => n.id));
                setMenu(null);
              }}
            >
              <Maximize size={16} />
              适配画布<span>⇧1</span>
            </button>
            <button
              disabled={!selected.length}
              onClick={() => {
                focusNodes(selected);
                setMenu(null);
              }}
            >
              聚焦选中项<span>⇧2</span>
            </button>
            {[0.25, 0.5, 1, 2].map((z) => (
              <button
                key={z}
                onClick={() => {
                  void flow.zoomTo(z, cameraMotion());
                  setMenu(null);
                }}
              >
                {z * 100}%
                <ZoomCheck target={z} />
              </button>
            ))}
          </div>
        )}
      </footer>
      {downstream && (
        <div
          className="cv-menu downstream-menu"
          style={DOWNSTREAM_POSITION_STYLE}
        >
          <span className="menu-label">新建连接</span>
          <button
            disabled={!imagesEnabled}
            onClick={() => add("image", downstream)}
          >
            <ImageIcon size={16} />
            图片生成
          </button>
          <button onClick={() => add("video", downstream)}>
            <Film size={16} />
            视频生成
          </button>
        </div>
      )}
      {context && (
        <div
          className="cv-menu context-menu"
          style={{
            left: Math.min(context.x, windowSize.w - 210),
            top: Math.min(context.y, windowSize.h - 300),
          }}
        >
          {context.node ? (
            <>
              <button
                onClick={() => {
                  copy();
                  setContext(null);
                }}
              >
                <Copy size={16} />
                复制<span>⌘C</span>
              </button>
              <button onClick={() => paste(true)}>
                复制副本<span>⌘D</span>
              </button>
              <button disabled={!canDownloadSelected} onClick={downloadNodes}>
                <Download size={16} />
                下载
              </button>
              <div className="menu-divider" />
              <button onClick={removeSelected}>
                <Trash2 size={16} />
                删除节点
              </button>
            </>
          ) : (
            <>
              {(["text", "image", "video", "sticky"] as Kind[]).map((kind) => (
                <button
                  key={kind}
                  onClick={() =>
                    add(
                      kind,
                      undefined,
                      flow.screenToFlowPosition({ x: context.x, y: context.y }),
                    )
                  }
                >
                  {React.createElement(icons[kind], { size: 16 })}
                  {names[kind]}
                </button>
              ))}
              <div className="menu-divider" />
              <button
                disabled={!clipboard.current?.nodes.length}
                onClick={() =>
                  paste(
                    false,
                    flow.screenToFlowPosition({ x: context.x, y: context.y }),
                  )
                }
              >
                粘贴<span>⌘V</span>
              </button>
            </>
          )}
          <div className="menu-divider" />
          <button
            disabled={!doc.canUndo}
            onClick={() => {
              doc.travel();
              setContext(null);
            }}
          >
            <Undo2 size={16} />
            撤销
          </button>
        </div>
      )}
      {doc.status === "conflict" && (
        <div className="save-banner" role="alert">
          <span>画布已被其他成员修改，你的修改尚未保存到服务器。</span>
          <button onClick={() => downloadLocalBackup(doc.value)}>
            下载本地副本
          </button>
          <button
            onClick={() =>
              setConfirm(() => () =>
                void guardedTransition({ kind: "reload" }),
              )
            }
          >
            重新载入
          </button>
        </div>
      )}
      {progress !== null && (
        <div className="upload-progress" role="status">
          正在上传 {progress}%
        </div>
      )}
      {toast && (
        <div className="canvas-toast" role="status">
          {toast}
        </div>
      )}
      {[...new Set([...activeTextNodes,...(single?.type==='text'?[single.id]:[])])].map(id=>{
        const textNode=doc.value.document.nodes.find(n=>n.id===id&&n.type==='text');
        if(!textNode)return null;
        const visible=single?.id===id&&!editing;
        return <section key={id} ref={visible?textPanelRef:undefined} className="node-composer text-node-composer" style={{...COMPOSER_POSITION_STYLE,display:visible?undefined:'none'}} hidden={!visible} aria-label="文本生成器" onKeyDown={e=>e.stopPropagation()}>
          <ChatWorkspace inline compact workspace={project.workspace} userId={initial.me.id} isAdmin={studio.me.role === "admin"}
            configureHref={studio.me.role === "admin" ? workspaceURL(chatSettingsPath(studio)) : undefined}
            onConfigureModels={studio.me.role === "admin" ? (e => {
              if (e.button === 0 && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                void closeAndLeave(chatSettingsPath(studio));
              }
            }) : undefined}
            onRecharge={openCredits}
            project={project.id} node={id} nodeTitle={textNode.title}
            onActivityChange={active=>setActiveTextNodes(ids=>active?(ids.includes(id)?ids:[...ids,id]):(ids.includes(id)?ids.filter(n=>n!==id):ids))}
            getContext={async()=>({project:project.id,node:id,expected_revision:await doc.flush(),writeback:true})}
            onApply={(cid,message,_mode,options)=>{
              const apply=async()=>{
                const target=doc.ref.current.document.nodes.find(n=>n.id===id&&n.type==='text');
                if(!target)throw new Error('文本节点已删除，未写入结果');
                const baseline=options?.expectedText??textNode.text;
                if(target.text!==baseline&&target.text!==message.content)throw new Error('节点文字已被修改，未覆盖。请基于当前文字重新生成。');
                const expectedText=target.text;
                const revision=await doc.flush();
                if(doc.ref.current.document.nodes.find(n=>n.id===id)?.text!==expectedText)throw new Error('节点文字已被修改，未覆盖。请基于当前文字重新生成。');
                const snapshot=JSON.stringify(doc.ref.current);
                const result=await chatRequest<Project & {applied_node:string}>(project.workspace,'/api/chats/'+cid+'/apply',{uid:options?.uid||crypto.randomUUID(),message:message.id,project:project.id,expected_revision:revision,mode:'replace',node:id,expected_text:expectedText});
                doc.acceptRemote(result,snapshot);
              };
              const queued=textApplyQueue.current.then(apply);
              textApplyQueue.current=queued.catch(()=>{});
              return queued;
            }}/>
        </section>;
      })}
      {panel === "assets" && (
        <Modal
          title="资产库"
          wide
          onClose={() => {
            setPanel(null);
            setAssetSelection(new Set());
          }}
        >
          <div className="picker-filter">
            <div>
              {(["all", "image", "video"] as const)
                .filter((t) => !pickerTarget || t === "image")
                .map((t) => (
                  <button
                    className={assetType === t ? "active" : ""}
                    key={t}
                    onClick={() => setAssetType(t)}
                  >
                    {{ all: "全部", image: "图片", video: "视频" }[t]}
                  </button>
                ))}
            </div>
            <button
              className="secondary"
              onClick={() => {
                fileTarget.current = pickerTarget;
                fileRef.current?.click();
                setPanel(null);
              }}
            >
              <Upload size={16} />
              上传图片
            </button>
          </div>
          <div className="picker-grid">
            {assetItems
              .filter((a) => assetType === "all" || a.kind === assetType)
              .map((a) => (
                <button
                  className={
                    "picker-item " +
                    (assetSelection.has(a.id) ? "selected" : "")
                  }
                  key={a.id}
                  onClick={() =>
                    setAssetSelection((current) => {
                      const set = pickerTarget
                        ? new Set<string>()
                        : new Set(current);
                      if (current.has(a.id)) set.delete(a.id);
                      else set.add(a.id);
                      return set;
                    })
                  }
                >
                  {a.kind === "image" ? (
                    <img
                      src={mediaURL(a.id)}
                      alt={a.title}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <VideoThumb mediaId={a.id} alt={a.title} />
                  )}
                  <span>{a.title}</span>
                  {assetSelection.has(a.id) && (
                    <Check className="picked" size={18} />
                  )}
                </button>
              ))}
          </div>
          {!assetItems.length && <p className="empty">暂无资产</p>}
          <div className="dialog-actions">
            <span>
              {assetSelection.size ? `已选 ${assetSelection.size} 项` : ""}
            </span>
            <button
              className="primary"
              disabled={!assetSelection.size}
              onClick={importAssets}
            >
              {pickerTarget ? "替换内容" : "添加到画布"}
            </button>
          </div>
        </Modal>
      )}
      {panel === "references" && single && (
        <Modal title="引用画布节点" onClose={() => setPanel(null)}>
          <div className="source-list">
            {referenceCandidates.map((n) => {
              const reason = connectionError(
                  doc.value.document,
                  n.id,
                  single.id,
                ),
                m = resolveNode(n, runs).media;
              return (
                <button
                  key={n.id}
                  disabled={!!reason}
                  title={reason}
                  onClick={() => {
                    connect({
                      source: n.id,
                      target: single.id,
                      sourceHandle: null,
                      targetHandle: null,
                    });
                    setPanel(null);
                  }}
                >
                  {m ? (
                    <img src={mediaURL(m)} alt="" />
                  ) : (
                    React.createElement(icons[n.type], { size: 22 })
                  )}
                  <span>
                    <strong>{n.title}</strong>
                    <small>
                      {n.type === "text"
                        ? n.text.slice(0, 60)
                        : m
                          ? "图片"
                          : "尚未生成"}
                    </small>
                  </span>
                  <Plus size={16} />
                </button>
              );
            })}
            {!referenceCandidates.length && (
              <p className="empty">暂无可引用的文本或图片节点</p>
            )}
          </div>
        </Modal>
      )}
      {panel === "search" && (
        <Modal title="搜索节点" onClose={() => setPanel(null)}>
          <div className="list-search">
            <Search size={17} />
            <input
              autoFocus
              placeholder="搜索名称或文本"
              aria-label="搜索名称或文本"
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
          </div>
          <div className="source-list">
            {doc.value.document.nodes
              .filter((n) =>
                (n.title + " " + n.text + " " + n.prompt)
                  .toLowerCase()
                  .includes(find.toLowerCase()),
              )
              .map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    selectOne(n.id);
                    focusNodes([n.id]);
                    setPanel(null);
                  }}
                >
                  {React.createElement(icons[n.type], { size: 20 })}
                  <span>
                    <strong>{n.title}</strong>
                    <small>{n.text || n.prompt || names[n.type]}</small>
                  </span>
                </button>
              ))}
          </div>
        </Modal>
      )}
      {panel === "history" && (
        <Modal title="生成历史" onClose={() => setPanel(null)}>
          <div className="run-list">
            {historyState.kind === "error" ? (
              <div className="run-list-state run-list-error" role="alert">
                <AlertCircle size={22} />
                <p className="run-list-error-title">无法加载生成历史</p>
                <p className="run-list-detail">{historyState.error}</p>
                <button
                  type="button"
                  className="secondary"
                  disabled={runsLoading}
                  onClick={() => void fetchRuns().catch(() => {})}
                >
                  <RefreshCw
                    size={14}
                    className={runsLoading ? "spin" : undefined}
                  />
                  {runsLoading ? "正在重试…" : "重试"}
                </button>
              </div>
            ) : historyState.kind === "loading" ? (
              <div className="run-list-state" role="status">
                <LoaderCircle size={20} className="spin" />
                <p>正在加载生成历史…</p>
              </div>
            ) : historyState.kind === "empty" ? (
              <p className="empty">暂无生成记录</p>
            ) : (
              <>
                {historyState.error && (
                  <div className="run-list-error-banner" role="alert">
                    <span>生成历史刷新失败：{historyState.error}</span>
                    <button
                      type="button"
                      className="secondary"
                      disabled={runsLoading}
                      onClick={() => void fetchRuns().catch(() => {})}
                    >
                      {runsLoading ? "重试中…" : "重试"}
                    </button>
                  </div>
                )}
                {historyState.items.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => {
                      if (
                        doc.value.document.nodes.some(
                          (n) => n.id === j.canvas_node,
                        )
                      ) {
                        selectOne(j.canvas_node!);
                        focusNodes([j.canvas_node!]);
                        setPanel(null);
                      } else notify("该节点已移除，作品仍可在资产中查看");
                    }}
                  >
                    {j.result ? (
                      j.kind === "image" ? (
                        <img
                          src={mediaURL(j.result)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <VideoThumb mediaId={j.result} />
                      )
                    ) : (
                      React.createElement(
                        j.kind === "image" ? ImageIcon : Film,
                        {
                          size: 22,
                        },
                      )
                    )}
                    <span>
                      <strong>{j.prompt.slice(0, 60)}</strong>
                      <small>
                        #{j.id} · {labels[j.status]} ·{" "}
                        {new Date(j.created * 1000).toLocaleString()}
                      </small>
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        </Modal>
      )}
      {aiStoryboard && <Modal title="AI 分镜" wide onClose={() => setAiStoryboard(false)}>
        <AiStoryboard workspace={project.workspace} userId={studio.me.id} project={project.id}
          onRecharge={openCredits}
          onConfigureModels={studio.me.role === "admin" ? () => void closeAndLeave(chatSettingsPath(studio)) : undefined}
          onApply={async (shots, options)=>{
          await doc.flush();const current=doc.ref.current.document;
          const isGridPreview=options.generationMode==='grid_preview';
          const nodesPerShot=isGridPreview?3:2;
          const edgesPerShot=isGridPreview?2:1;
          if(current.nodes.length+shots.length*nodesPerShot>400||current.edges.length+shots.length*edgesPerShot>1200)throw new Error('画布容量不足（最多 400 节点 / 1200 连线），请先整理节点');
          const x=current.nodes.length?Math.max(...current.nodes.map(n=>n.x+n.width))+120:0;
          const created=shots.map((shot,i)=>{
            const text={...newNode('text',x+i*420,0,i+1),title:shot.title+' · 文案',text:shot.prompt};
            const gridImage=isGridPreview?{
              ...newNode('image',x+i*420,280,i+1),
              title:shot.title+' · 宫格预览',
              prompt:shot.prompt,
              generation_mode:'grid_preview' as const,
              grid_layout:(options.gridLayout??'3x3') as '2x2'|'3x3',
            }:null;
            const video={
              ...newNode('video',x+i*420,isGridPreview?580:330,i+1),
              title:shot.title,
              narration_text:shot.narration,
              generation_mode:isGridPreview?'first_frame':options.generationMode,
              ...(options.gridLayout&&!isGridPreview?{grid_layout:options.gridLayout}:{}),
              ...(options.tailChain&&i>0?{tail_inherited:true}:{}),
              params:{...newNode('video',0,0,1).params,model:defaultVideoModel,seconds:shot.seconds},
            };
            return {text,gridImage,video};
          });
          doc.change(d=>({
            ...d,
            document:{
              ...d.document,
              nodes:[...d.document.nodes,...created.flatMap(n=>n.gridImage?[n.text,n.gridImage,n.video]:[n.text,n.video])],
              edges:[
                ...d.document.edges,
                ...created.flatMap(n=>n.gridImage
                  ? [
                      {id:crypto.randomUUID(),source:n.text.id,target:n.gridImage.id},
                      {id:crypto.randomUUID(),source:n.gridImage.id,target:n.video.id},
                    ]
                  : [{id:crypto.randomUUID(),source:n.text.id,target:n.video.id}]),
              ],
              shots:[...(d.document.shots||[]),...created.map(n=>n.video.id)],
            },
          }));
          setAiStoryboard(false);
          const firstFocus=created[0].gridImage?created[0].gridImage.id:created[0].video.id;
          setSelected([firstFocus]);
          requestAnimationFrame(()=>focusNodes(created.map(n=>n.gridImage?n.gridImage.id:n.video.id)));
          notify(isGridPreview?`已加入 ${shots.length} 个宫格预览图 + 视频分镜，可先低成本生图并裁切首帧`:`已加入 ${shots.length} 个分镜，可编辑后再生成`);
        }}/>
      </Modal>}
      {packPicker && <Modal title="素材包" wide onClose={() => setPackPicker(null)}>
        <AssetPacks workspace={project.workspace} userId={studio.me.id} admin={studio.me.role === 'admin'}
          selected={doc.value.document.nodes.find(n=>n.id===packPicker)?.asset_packs || []}
          imageRefs={referenceMedia.filter((id):id is string=>Boolean(id))}
          onImportImages={(ids,pack)=>importPack(pack,ids)} onImportPack={pack=>importPack(pack)}
          onRemovePack={id=>{const target=doc.ref.current.document.nodes.find(n=>n.id===packPicker);if(target)edit(target.id,{asset_packs:(target.asset_packs||[]).filter(p=>p.id!==id)});setPackPicker(null);}} />
      </Modal>}
      {confirmCandidates && single && <Modal title="生成两个候选" onClose={() => setConfirmCandidates(false)}>
        <p>为“{single.title}”生成 2 个候选，共 {candidateCost} 积分。各候选独立完成，失败或取消的候选会退回积分。</p>
        <div className="dialog-actions"><button className="secondary" onClick={() => setConfirmCandidates(false)}>取消</button>
          <button className="primary" disabled={!canGenerate} onClick={() => void submit()}>确认生成 · {candidateCost}</button></div>
      </Modal>}
      {showCrop && firstFrame && (
        <Modal title="首帧裁切预览" onClose={() => setShowCrop(false)}>
          <p>
            {studio.video_models?.[selectedModel] ||
              studio.model_catalog?.[selectedModel]?.label ||
              selectedModel ||
              "当前视频模型"}{" "}
            会按 {single?.params.ratio} 居中裁切单张参考图，并将它用作首帧。
          </p>
          <div className="crop-preview">
            <img src={mediaURL(firstFrame)} alt="生成画幅中的首帧" style={{ aspectRatio: cropRatio }} />
          </div>
        </Modal>
      )}
      {compared && comparisonRuns.length > 1 && (
        <Modal title={`对比版本 · ${compared.title}`} wide onClose={() => setCompareNode(null)}>
          <VideoVersions runs={comparisonRuns} adopted={compared.active_job}
            onAdopt={(id) => edit(compared.id, { active_job: id, use_media: false })} />
        </Modal>
      )}
      {sharedReference && (
        <Modal title="应用参考图到镜头" onClose={() => setSharedReference(null)}>
          <p>勾选需要共用这张图的镜头。修改连线会影响后续生成。</p>
          <div className="reference-targets">
            <label>
              <input type="checkbox" checked={referenceTargets.length === shots.length && shots.length > 0}
                onChange={(event) => setReferenceTargets(event.target.checked ? shots.map((shot) => shot.id) : [])} />
              全选镜头
            </label>
            {shots.map((shot, index) => (
              <label key={shot.id}>
                <input type="checkbox" checked={referenceTargets.includes(shot.id)} onChange={(event) => {
                  const checked = event.target.checked;
                  setReferenceTargets((ids) => checked ? [...ids, shot.id] : ids.filter((id) => id !== shot.id));
                }} />
                {String(index + 1).padStart(2, "0")} · {shot.title || "未命名镜头"}
              </label>
            ))}
          </div>
          {referenceError && <p className="error" role="alert">{referenceError}</p>}
          <div className="dialog-actions">
            <button className="primary" onClick={applySharedReference}>应用到所选镜头</button>
          </div>
        </Modal>
      )}
      {preview && (() => {
        const previewContinuation =
          preview.node.type === "video"
            ? resolveNodeTailContinuation(preview.node, preview.run)
            : null;
        return (
        <Modal title={preview.node.title} wide onClose={() => {
          if (!extracting) { setPreview(null); setFrameError(""); }
        }}>
          <div className="media-preview">
            {preview.node.type === "video" ? (
              <video
                ref={previewPlayer}
                src={mediaURL(preview.media)}
                controls
                autoPlay
                playsInline
              />
            ) : (
              <img
                src={mediaURL(preview.media)}
                alt={preview.node.title}
              />
            )}
          </div>
          {frameError && <p className="error" role="alert">{frameError}</p>}
          {preview.node.type === "video" && (
            <p>
              暂停在想保留的画面，可提取为图片
              {previewContinuation
                ? previewContinuation.previewHint
                : "保存到画布与素材库。"}
            </p>
          )}
          <div className="dialog-actions preview-actions">
            {preview.node.type === "video" && <>
              <button className="secondary" disabled={extracting} onClick={() => extractFrame(preview, false)}>
                {extracting ? "正在提取…" : "提取当前帧"}
              </button>
              {Boolean(previewContinuation) && (
                <button className="primary" disabled={extracting} onClick={() => extractFrame(preview, true)}>
                  {previewContinuation!.previewButtonLabel}
                </button>
              )}
            </>}
            <a
              className="secondary"
              href={mediaURL(preview.media) + "?download=true"}
              download={
                canvasMediaDownloadFilename(preview.media, {
                  runs,
                  studio,
                  node: preview.node,
                  run: preview.run,
                }) || true
              }
            >
              <Download size={16} />
              下载
            </a>
          </div>
        </Modal>
        );
      })()}
      {confirm && (
        <Modal title="重新载入画布？" onClose={() => setConfirm(null)}>
          <p>将载入团队最新版本。请先下载需要保留的本地修改。</p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setConfirm(null)}>
              取消
            </button>
            <button className="primary" onClick={() => confirm()}>
              重新载入
            </button>
          </div>
        </Modal>
      )}
      {viewMode !== "canvas" && (
        <aside
          className={
            "fm-docked-storyboard" +
            (viewMode === "list" ? " fm-full-list" : "") +
            (agentDockedWidth > 0 ? " fm-with-agent-dock" : "")
          }
          aria-label="分镜表双向同步视图"
        >
          <div className="fm-docked-head">
            <strong>分镜表 · 实时双向同步 ({shots.length} 镜)</strong>
            <button
              type="button"
              className="secondary"
              onClick={() => setViewMode("canvas")}
            >
              返回纯画布
            </button>
          </div>
          <ShotList
            docked
            shots={shots}
            onMove={moveShot}
            onExport={exportShots}
            onEditShot={(id, patch) => edit(id, patch, false)}
            onBatchPrecheck={(nodeIds) => {
              void doc
                .flush()
                .then(() =>
                  setPrecheckTarget({
                    nodeIds,
                    title: `分镜批量预检 (${nodeIds.length} 镜)`,
                    stages: ["video", "narration", "dialogue"],
                  }),
                )
                .catch((e) => notify((e as Error).message));
            }}
            onInheritTailFrame={(shotId) => handleInheritTailFrame(shotId)}
            onRemove={(id) =>
              updateShots((ids) => ids.filter((item) => item !== id))
            }
            onSelect={(id) => {
              if (viewMode === "list") setViewMode("split");
              selectOne(id);
              focusNodes([id]);
            }}
            composition={
              <Composition
                project={project.id}
                getRevision={doc.flush}
                ready={shots.length > 0 && !compositionIssue}
                waitingReason={compositionIssue}
                audioAssets={compositionAudioAssets}
                bgm={doc.value.document.bgm ?? null}
                loudnorm={doc.value.document.loudnorm}
                defaultBgmPrompt={defaultBgmPrompt}
                bgmModels={bgmModels}
                bgmGenerating={bgmGenerating}
                onGenerateBgm={handleGenerateBgm}
                onMixChange={(patch) =>
                  doc.change((d) => ({
                    ...d,
                    document: {
                      ...d.document,
                      ...("bgm" in patch ? { bgm: patch.bgm } : {}),
                      ...("loudnorm" in patch ? { loudnorm: patch.loudnorm } : {}),
                    },
                  }))
                }
              />
            }
            renderNarration={renderShotNarration}
          />
        </aside>
      )}
      {precheckTarget && (
        <Modal
          title={precheckTarget.title || "批量生成预检与积分确认"}
          wide
          onClose={() => setPrecheckTarget(null)}
        >
          <PrecheckCostModal
            workspace={project.workspace}
            projectId={project.id}
            revision={doc.revision.current}
            nodeIds={precheckTarget.nodeIds}
            title={precheckTarget.title}
            initialStages={precheckTarget.stages}
            onSubmitted={async (res) => {
              // F010/F027 (#9): Write back submitted narration_pending & dialogue_lines[].audio_pending
              // so completed batch audio jobs promote cleanly for playback and storyboard export.
              const narrMap = new Map<string, number>();
              const dlgMap = new Map<string, Map<string, number>>();
              for (const item of res.submitted) {
                if (item.stage === "narration") {
                  narrMap.set(item.node, item.job_id);
                } else if (item.stage === "dialogue" && item.line_id) {
                  let byLine = dlgMap.get(item.node);
                  if (!byLine) {
                    byLine = new Map();
                    dlgMap.set(item.node, byLine);
                  }
                  byLine.set(item.line_id, item.job_id);
                }
              }
              if (narrMap.size || dlgMap.size) {
                doc.change((d) => ({
                  ...d,
                  document: {
                    ...d.document,
                    nodes: d.document.nodes.map((n) => {
                      const nextNarr = narrMap.get(n.id);
                      const nextDlg = dlgMap.get(n.id);
                      if (!nextNarr && !nextDlg) return n;
                      return {
                        ...n,
                        ...(nextNarr ? { narration_pending: nextNarr } : {}),
                        ...(nextDlg && n.dialogue_lines
                          ? {
                              dialogue_lines: n.dialogue_lines.map((l) =>
                                nextDlg.has(l.id)
                                  ? { ...l, audio_pending: nextDlg.get(l.id)! }
                                  : l,
                              ),
                            }
                          : {}),
                      };
                    }),
                  },
                }));
                await doc.flush();
              }
              await fetchRuns();
              notify(
                `已提交 ${res.submitted.length} 项任务（跳过 ${res.skipped.length} 项），合计冻结 ${res.total_credits} 积分`,
              );
            }}
            onClose={() => setPrecheckTarget(null)}
          />
        </Modal>
      )}
      {gridCropTarget && (
        <Modal
          title="宫格构图单格裁切"
          wide
          onClose={() => setGridCropTarget(null)}
        >
          <GridCropModal
            mediaId={gridCropTarget.mediaId}
            defaultLayout={gridCropTarget.layout}
            onCrop={async (opts) => {
              await doc.flush();
              const res = await api<{
                asset_id: string;
                width: number;
                height: number;
              }>(
                `/api/canvases/${project.id}/nodes/${gridCropTarget.nodeId}/grid-crop`,
                opts,
              );
              const src = doc.ref.current.document.nodes.find(
                (n) => n.id === gridCropTarget.nodeId,
              );
              const downstreamVideos = doc.ref.current.document.edges
                .filter((e) => e.source === gridCropTarget.nodeId)
                .map((e) =>
                  doc.ref.current.document.nodes.find((n) => n.id === e.target),
                )
                .filter((n): n is CanvasNode => Boolean(n && n.type === "video"));
              const nextIdx = doc.ref.current.document.nodes.length + 1;
              const cropped = newNode(
                "image",
                (src?.x ?? 0) + (src?.width ?? 320) + 64,
                src?.y ?? 0,
                nextIdx,
              );
              cropped.title = `${src?.title || "宫格"} · 格#${opts.row * opts.cols + opts.col + 1}`;
              cropped.media_id = res.asset_id;
              cropped.use_media = true;
              const downstreamIds = new Set(downstreamVideos.map((v) => v.id));
              doc.change((d) => ({
                ...d,
                document: {
                  ...d.document,
                  nodes: [
                    ...d.document.nodes.map((n) =>
                      downstreamIds.has(n.id)
                        ? {
                            ...n,
                            params: {
                              ...n.params,
                              h3: {
                                mode: "frames" as const,
                                first_frame: res.asset_id,
                                last_frame: n.params.h3?.last_frame ?? null,
                                video_audio: n.params.h3?.video_audio ?? [],
                              },
                            },
                          }
                        : n,
                    ),
                    cropped,
                  ],
                  edges: [
                    ...d.document.edges,
                    ...downstreamVideos.map((v) => ({
                      id: crypto.randomUUID(),
                      source: cropped.id,
                      target: v.id,
                    })),
                  ],
                },
              }));
              setSelected([cropped.id]);
              focusNodes([cropped.id]);
              notify(
                downstreamVideos.length
                  ? `已裁切单格并设为 ${downstreamVideos.length} 个下游视频分镜的首帧`
                  : "已裁切单格为独立参考图 / 首帧节点",
              );
            }}
            onClose={() => setGridCropTarget(null)}
          />
        </Modal>
      )}
      {(surface === "document" || scriptWorkspaceMounted) && (
        <ScriptWorkspace
          ref={scriptWorkspaceRef}
          active={surface === "document"}
          workspace={project.workspace}
          userId={initial.me.id}
          canvasId={project.id}
          canvasTitle={doc.value.title}
          canvasDoc={doc.value.document}
          runs={runs}
          runsKnown={runsLoaded && !runsError}
          ensureFreshRuns={ensureFreshRuns}
          assets={studio.assets}
          defaultVideoModel={defaultVideoModel}
          defaultImageModel={defaultImageModel}
          externalOpenRequest={scriptJumpReq}
          onActiveScriptChange={setActiveScript}
          onChangeCanvasDoc={(updater) =>
            doc.change((d) => ({ ...d, document: updater(d.document) }))
          }
          onEditCanvasNode={(nodeId, patch, history) =>
            edit(nodeId, patch, history)
          }
          onFocusCanvasNode={(nodeId) => {
            setSurface("canvas");
            selectOne(nodeId);
            requestAnimationFrame(() => focusNodes([nodeId]));
          }}
          onSwitchToCanvas={(focusIds) => {
            setSurface("canvas");
            if (focusIds?.length) {
              setSelected(focusIds);
              requestAnimationFrame(() => focusNodes(focusIds));
            }
          }}
          onSwitchCanvasProject={(targetCanvasId) => {
            void closeAndLeave("/canvas/" + targetCanvasId);
          }}
          onAssetUploaded={(asset) =>
            setStudio((s) => ({
              ...s,
              assets: [{ ...asset, owner: s.me.id }, ...s.assets],
            }))
          }
          onNotify={notify}
        />
      )}
      {!agentDock && (
        <button
          type="button"
          className="fm-agent-orb"
          onClick={() => {
            setAgentTab("chat");
            setAgentDock(true);
            if (window.innerWidth <= 1100 && viewMode !== "canvas") {
              setViewMode("canvas");
            }
          }}
        >
          <span className="fm-agent-orb-dot" aria-hidden="true" />
          AI 创作助手
        </button>
      )}
      <FloatingCanvasAgent
        visible={agentDock}
        activeTab={agentTab}
        onTabChange={setAgentTab}
        onClose={() => setAgentDock(false)}
        onDockedWidthChange={setAgentDockedWidth}
        workspace={project.workspace}
        userId={initial.me.id}
        isAdmin={studio.me.role === "admin"}
        projectId={project.id}
        canEditPolicy={
          studio.me.role === "admin" || project.owner === studio.me.id
        }
        configureHref={
          studio.me.role === "admin"
            ? workspaceURL(chatSettingsPath(studio))
            : undefined
        }
        onConfigureModels={
          studio.me.role === "admin"
            ? (e) => {
                if (
                  e.button === 0 &&
                  !e.altKey &&
                  !e.ctrlKey &&
                  !e.metaKey &&
                  !e.shiftKey
                ) {
                  e.preventDefault();
                  void closeAndLeave(chatSettingsPath(studio));
                }
              }
            : undefined
        }
        onRecharge={openCredits}
        selectedNode={single}
        activeScript={activeScript}
        canvasNodes={doc.value.document.nodes}
        flushScripts={(ids) =>
          scriptWorkspaceRef.current?.flushScripts(ids) ?? Promise.resolve()
        }
        getCanvasRevision={() => doc.flush()}
        onApplyChatToCanvas={(cid, message, mode, options) => {
          const apply = async () => {
            if (mode === "replace") {
              const precheck = resolveChatReplaceTarget({
                currentProjectId: project.id,
                nodes: doc.ref.current.document.nodes,
                messageContent: message.content,
                options,
              });
              const revision = await doc.flush();
              const postFlush = resolveChatReplaceTarget({
                currentProjectId: project.id,
                nodes: doc.ref.current.document.nodes,
                messageContent: message.content,
                options: {
                  ...options,
                  targetProject: project.id,
                  targetNode: precheck.nodeId,
                  expectedText: precheck.expectedText,
                },
              });
              const snapshot = JSON.stringify(doc.ref.current);
              const result = await chatRequest<
                Project & { applied_node: string }
              >(project.workspace, "/api/chats/" + cid + "/apply", {
                uid: options?.uid || crypto.randomUUID(),
                message: message.id,
                project: project.id,
                expected_revision: revision,
                mode: "replace",
                node: postFlush.nodeId,
                expected_text: postFlush.expectedText,
              });
              doc.acceptRemote(result, snapshot);
              return;
            }

            const revision = await doc.flush();
            const anchorId =
              (options?.targetProject === project.id
                ? options?.targetNode
                : undefined) || single?.id;
            const snapshot = JSON.stringify(doc.ref.current);
            const result = await chatRequest<
              Project & { applied_node: string }
            >(project.workspace, "/api/chats/" + cid + "/apply", {
              uid: options?.uid || crypto.randomUUID(),
              message: message.id,
              project: project.id,
              expected_revision: revision,
              mode: "new",
              ...(anchorId ? { node: anchorId } : {}),
            });
            doc.acceptRemote(result, snapshot);
          };
          const queued = textApplyQueue.current.then(apply);
          textApplyQueue.current = queued.catch(() => {});
          return queued;
        }}
        onApproveProposal={(proposalId) => {
          const runApprove = async (): Promise<{ conflict?: string }> => {
            const expectedRevision = await doc.flush();
            const baselineSnapshot = JSON.stringify(doc.ref.current);
            const res = await api<{ proposal: unknown; canvas: Project }>(
              `/api/canvases/${project.id}/proposals/${proposalId}/apply`,
              { expected_revision: expectedRevision },
            );
            try {
              doc.acceptRemote(res.canvas, baselineSnapshot, "批准提案");
              notify("提案已批准并落图到当前画布");
              return {};
            } catch {
              const conflictMsg =
                "提案已在服务器落图，但批准期间画布有新的本地修改，已保留本地草稿并标记冲突，请先处理保存冲突。";
              notify(conflictMsg);
              return { conflict: conflictMsg };
            }
          };
          const queued = textApplyQueue.current.then(runApprove);
          textApplyQueue.current = queued.then(
            () => {},
            () => {},
          );
          return queued;
        }}
        onPendingCountChange={setPendingProposals}
        onNotify={notify}
      />
      {leaveFailure && (
        <Modal
          title="保存失败，仍要离开？"
          onClose={() => {
            if (!leaveInFlight.current) setLeaveFailure(null);
          }}
        >
          <p className="error">{leaveFailure.message}</p>
          <p>当前修改尚未同步到服务器。{leaveFailure.retained
            ? "本地草稿已保留。画布或剧本文档仍可访问时，重新打开即可继续编辑。"
            : "浏览器无法保留本地草稿，离开后未保存的修改将丢失。"}</p>
          <div className="dialog-actions" style={{ flexWrap: "wrap" }}>
            <button className="secondary" disabled={retryingLeave} onClick={() => setLeaveFailure(null)}>
              取消
            </button>
            <button
              className="secondary"
              disabled={retryingLeave}
              onClick={() => downloadLocalBackup(doc.ref.current)}
            >
              下载本地副本
            </button>
            <button
              className="secondary"
              disabled={retryingLeave}
              onClick={() => {
                const okCanvas =
                  leaveFailure.target.kind === "reload" ? true : doc.remember();
                const okScripts =
                  scriptWorkspaceRef.current?.rememberAll() ?? true;
                if (leaveFailure.retained && !(okCanvas && okScripts)) {
                  setLeaveFailure({ ...leaveFailure, retained: false });
                  return;
                }
                void executeLeaveTarget(leaveFailure.target).catch((e) =>
                  notify((e as Error).message),
                );
              }}
            >
              仍要离开
            </button>
            <button
              className="primary"
              disabled={
                retryingLeave ||
                (leaveFailure.target.kind !== "reload" &&
                  doc.status === "conflict") ||
                Boolean(scriptWorkspaceRef.current?.hasConflictChanges())
              }
              onClick={() => void guardedTransition(leaveFailure.target)}
            >
              重试保存
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
