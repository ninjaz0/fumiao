import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Code,
  Columns2,
  Copy,
  Crosshair,
  ExternalLink,
  FilePlus2,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Layers,
  List,
  ListChecks,
  MessageSquarePlus,
  Minus,
  Pencil,
  Plus,
  Quote,
  Redo2,
  RefreshCw,
  Search,
  Sparkles,
  StickyNote,
  Strikethrough,
  Table,
  Trash2,
  Type,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";
import { upload } from "./api";
import {
  scriptApi,
  type ScriptDocKind,
  type ScriptDocumentDetail,
  type ScriptDocumentSummary,
  type WorkspaceCanvasSummary,
} from "./script-api";
import {
  extractScriptAnchorsMap,
  parseScriptBreakdown,
  syncScriptBreakdownToCanvas,
  type ScriptAnchorLink,
  type ScriptSyncOptions,
} from "./script-fusion";
import { ScriptSyncModal } from "./ScriptSyncModal";
import { WorkspaceSearchModal } from "./WorkspaceSearchModal";
import {
  resolveNode,
  type Asset,
  type CanvasNode,
  type CinematographySpec,
  type DialogueLine,
  type Doc,
  type Job,
} from "./types";

export type OpenDocTab =
  | {
      key: string;
      kind: "script";
      docId: string;
      title: string;
      path: string;
      preview?: boolean;
      targetLine?: number;
    }
  | {
      key: string;
      kind: "node";
      nodeId: string;
      title: string;
      preview?: boolean;
    };

type LoadedScriptState = {
  detail: ScriptDocumentDetail;
  draftBody: string;
  savedBody: string;
  revision: number;
  status: "saved" | "dirty" | "saving" | "conflict" | "error";
  error: string;
  undoStack: string[];
  redoStack: string[];
};

const DOC_KIND_LABELS: Record<ScriptDocKind, string> = {
  outline: "故事骨架",
  script: "分集剧本",
  assets: "资产设定",
  shotlist: "分镜片单",
  notes: "创作笔记",
};

const NODE_TYPE_ICONS: Record<CanvasNode["type"], typeof Type> = {
  text: Type,
  image: ImageIcon,
  video: Film,
  sticky: StickyNote,
  plugin: Layers,
  group: Layers,
};

function renderSafeMarkdown(md: string): string {
  const rawHtml = marked.parse(md, { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "del",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "h1",
      "h2",
      "h3",
      "h4",
      "hr",
      "a",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "input",
    ],
    ALLOWED_ATTR: ["href", "title", "src", "alt", "type", "checked", "disabled"],
  });
}

type RichScriptBlock = {
  id: string;
  lineStart: number;
  lineEnd: number;
  rawText: string;
  blockType: "h1" | "h2" | "scene" | "action" | "dialogue" | "markdown";
  sceneCode?: string;
  shotAnchor?: string;
  speaker?: string;
  speech?: string;
};

function splitRichScriptBlocks(
  markdown: string,
  docId: string,
): RichScriptBlock[] {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const breakdown = parseScriptBreakdown(normalized, { docId });
  const shotByLine = new Map<number, string>();
  for (const shot of breakdown.shots) {
    shotByLine.set(shot.lineStart, shot.anchor);
  }

  const lines = normalized.split("\n");
  const blocks: RichScriptBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }

    // Table or fenced code block: group contiguous lines
    if (trimmed.startsWith("|") || trimmed.startsWith("```")) {
      const start = i;
      if (trimmed.startsWith("```")) {
        i++;
        while (i < lines.length && !lines[i].trim().startsWith("```")) i++;
        if (i < lines.length) i++;
      } else {
        while (i < lines.length && lines[i].trim().startsWith("|")) i++;
      }
      blocks.push({
        id: `blk_${start}`,
        lineStart: start + 1,
        lineEnd: i,
        rawText: lines.slice(start, i).join("\n"),
        blockType: "markdown",
      });
      continue;
    }

    // Scene heading
    const sceneMatch = trimmed.match(
      /^(?:#{1,4}\s*)?(S\d{1,3}|SC\d{1,3}|第\s*\d+\s*场)\s+([^\n]+)$/i,
    );
    if (sceneMatch && !trimmed.startsWith("-")) {
      const code = sceneMatch[1].replace(/\s+/g, "").toUpperCase();
      blocks.push({
        id: `blk_${i}`,
        lineStart: i + 1,
        lineEnd: i + 1,
        rawText: line,
        blockType: "scene",
        sceneCode: code,
      });
      i++;
      continue;
    }

    if (/^#\s+/.test(trimmed)) {
      blocks.push({
        id: `blk_${i}`,
        lineStart: i + 1,
        lineEnd: i + 1,
        rawText: line,
        blockType: "h1",
      });
      i++;
      continue;
    }

    if (/^#{2,4}\s+/.test(trimmed)) {
      blocks.push({
        id: `blk_${i}`,
        lineStart: i + 1,
        lineEnd: i + 1,
        rawText: line,
        blockType: "h2",
      });
      i++;
      continue;
    }

    if (/^[△▲]/.test(trimmed)) {
      blocks.push({
        id: `blk_${i}`,
        lineStart: i + 1,
        lineEnd: i + 1,
        rawText: line,
        blockType: "action",
        shotAnchor: shotByLine.get(i + 1),
      });
      i++;
      continue;
    }

    const dlgMatch = trimmed.match(
      /^([^：:*#\-|<>]{1,18})[：:]\s*(.+)$/,
    );
    if (
      dlgMatch &&
      !/^(规格|依据|场号|压缩原则|画幅|画幅与时长|核心钩子|人物|出场人物|出场资产|备注)$/.test(
        dlgMatch[1].trim(),
      )
    ) {
      blocks.push({
        id: `blk_${i}`,
        lineStart: i + 1,
        lineEnd: i + 1,
        rawText: line,
        blockType: "dialogue",
        speaker: dlgMatch[1].trim(),
        speech: dlgMatch[2].trim(),
        shotAnchor: shotByLine.get(i + 1),
      });
      i++;
      continue;
    }

    // Group contiguous bullet/paragraph lines
    const start = i;
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|[△▲]|\||```)/.test(lines[i].trim()) &&
      !/^(S\d{1,3}|SC\d{1,3})\s+/i.test(lines[i].trim())
    ) {
      const nextTrim = lines[i].trim();
      if (
        /^([^：:*#\-|<>]{1,18})[：:]\s*(.+)$/.test(nextTrim) &&
        !nextTrim.startsWith("-")
      ) {
        break;
      }
      i++;
    }
    blocks.push({
      id: `blk_${start}`,
      lineStart: start + 1,
      lineEnd: i,
      rawText: lines.slice(start, i).join("\n"),
      blockType: "markdown",
    });
  }

  return blocks;
}

export function ScriptWorkspace({
  active,
  canvasId,
  canvasTitle,
  canvasDoc,
  runs,
  assets,
  defaultVideoModel,
  defaultImageModel,
  externalOpenRequest,
  onActiveScriptChange,
  onChangeCanvasDoc,
  onEditCanvasNode,
  onFocusCanvasNode,
  onSwitchToCanvas,
  onSwitchCanvasProject,
  onAssetUploaded,
  onNotify,
}: {
  active: boolean;
  canvasId: string;
  canvasTitle: string;
  canvasDoc: Doc;
  runs: Job[];
  assets: Asset[];
  defaultVideoModel: string;
  defaultImageModel: string;
  externalOpenRequest?: {
    docId: string;
    anchor?: string;
    line?: number;
    seq: number;
  } | null;
  onActiveScriptChange?: (
    activeScript: { id: string; path: string; body_md: string } | null,
  ) => void;
  onChangeCanvasDoc: (updater: (current: Doc) => Doc) => void;
  onEditCanvasNode: (
    nodeId: string,
    patch: Partial<CanvasNode>,
    history?: boolean,
  ) => void;
  onFocusCanvasNode: (nodeId: string) => void;
  onSwitchToCanvas: (focusNodeIds?: string[]) => void;
  onSwitchCanvasProject: (targetCanvasId: string) => void;
  onAssetUploaded: (asset: { id: string; w: number; h: number }) => void;
  onNotify: (msg: string) => void;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(268);
  const [items, setItems] = useState<ScriptDocumentSummary[]>([]);
  const [otherCanvases, setOtherCanvases] = useState<WorkspaceCanvasSummary[]>(
    [],
  );
  const [loadingTree, setLoadingTree] = useState(true);
  const [treeError, setTreeError] = useState("");
  const [treeFilter, setTreeFilter] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(["__current_canvas__"]),
  );

  // Inline create / rename states (zero browser prompt())
  const [creatingEntry, setCreatingEntry] = useState<{
    type: "file" | "directory";
    parentPath: string;
    draftName: string;
    template: ScriptDocKind | "blank";
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deletingItem, setDeletingItem] =
    useState<ScriptDocumentSummary | null>(null);
  const [suiteBusy, setSuiteBusy] = useState(false);

  // Loaded script sessions
  const [sessions, setSessions] = useState<Record<string, LoadedScriptState>>(
    {},
  );
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // Multi-tab & split-pane state
  const [tabs, setTabs] = useState<OpenDocTab[]>([]);
  const [leftTabKey, setLeftTabKey] = useState<string | null>(null);
  const [rightTabKey, setRightTabKey] = useState<string | null>(null);
  const [focusedPane, setFocusedPane] = useState<"left" | "right">("left");

  // Modals
  const [syncModalDocId, setSyncModalDocId] = useState<string | null>(null);
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);

  const loadWorkspaceTree = useCallback(async () => {
    setLoadingTree(true);
    setTreeError("");
    try {
      const [scriptList, canvasList] = await Promise.all([
        scriptApi.list(),
        scriptApi.listCanvases().catch(() => ({ projects: [] })),
      ]);
      setItems(scriptList.items);
      setOtherCanvases(
        canvasList.projects.filter((c) => c.id !== canvasId).slice(0, 30),
      );
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        for (const item of scriptList.items) {
          if (item.entry_type === "directory" && !item.parent_path) {
            next.add(`dir:${item.path}`);
          }
        }
        return next;
      });
      return scriptList.items;
    } catch (e) {
      setTreeError(e instanceof Error ? e.message : "加载工作区文件失败");
      return [];
    } finally {
      setLoadingTree(false);
    }
  }, [canvasId]);

  const ensureScriptLoaded = useCallback(async (docId: string) => {
    if (sessionsRef.current[docId]) return sessionsRef.current[docId];
    const detail = await scriptApi.get(docId);
    const loaded: LoadedScriptState = {
      detail,
      draftBody: detail.body_md,
      savedBody: detail.body_md,
      revision: detail.revision,
      status: "saved",
      error: "",
      undoStack: [],
      redoStack: [],
    };
    setSessions((prev) => ({ ...prev, [docId]: prev[docId] ?? loaded }));
    return loaded;
  }, []);

  const openScriptTab = useCallback(
    async (
      summary: { id: string; name: string; path: string },
      options: {
        preview?: boolean;
        pane?: "left" | "right";
        targetLine?: number;
      } = {},
    ) => {
      const key = `script:${summary.id}`;
      const targetPane = options.pane ?? focusedPane;
      await ensureScriptLoaded(summary.id);
      setTabs((prev) => {
        const existing = prev.find((t) => t.key === key);
        if (existing) {
          return prev.map((t) =>
            t.key === key
              ? {
                  ...t,
                  title: summary.name,
                  path: summary.path,
                  preview: options.preview ? t.preview : false,
                  targetLine: options.targetLine,
                }
              : t,
          );
        }
        const nextTab: OpenDocTab = {
          key,
          kind: "script",
          docId: summary.id,
          title: summary.name,
          path: summary.path,
          preview: options.preview ?? false,
          targetLine: options.targetLine,
        };
        if (options.preview) {
          const previewIdx = prev.findIndex((t) => t.preview);
          if (previewIdx >= 0) {
            const copy = [...prev];
            copy[previewIdx] = nextTab;
            return copy;
          }
        }
        return [...prev, nextTab];
      });
      if (targetPane === "right") {
        setRightTabKey(key);
        setFocusedPane("right");
      } else {
        setLeftTabKey(key);
        setFocusedPane("left");
      }
    },
    [ensureScriptLoaded, focusedPane],
  );

  const openNodeTab = useCallback(
    (
      node: CanvasNode,
      options: { preview?: boolean; pane?: "left" | "right" } = {},
    ) => {
      const key = `node:${node.id}`;
      const targetPane = options.pane ?? focusedPane;
      setTabs((prev) => {
        const existing = prev.find((t) => t.key === key);
        if (existing) {
          return prev.map((t) =>
            t.key === key
              ? {
                  ...t,
                  title: node.title,
                  preview: options.preview ? t.preview : false,
                }
              : t,
          );
        }
        return [
          ...prev,
          {
            key,
            kind: "node",
            nodeId: node.id,
            title: node.title,
            preview: options.preview ?? false,
          },
        ];
      });
      if (targetPane === "right") {
        setRightTabKey(key);
        setFocusedPane("right");
      } else {
        setLeftTabKey(key);
        setFocusedPane("left");
      }
    },
    [focusedPane],
  );

  // Initial load & auto-open first script if present
  const initializedRef = useRef(false);
  useEffect(() => {
    void loadWorkspaceTree().then((loaded) => {
      if (initializedRef.current) return;
      initializedRef.current = true;
      const preferred =
        loaded.find(
          (i) =>
            i.entry_type === "file" &&
            i.canvas_id === canvasId &&
            i.doc_kind === "script",
        ) ??
        loaded.find((i) => i.entry_type === "file" && i.doc_kind === "script") ??
        loaded.find((i) => i.entry_type === "file");
      if (preferred) {
        void openScriptTab(preferred, { pane: "left" });
      }
    });
  }, [canvasId, loadWorkspaceTree, openScriptTab]);

  // Handle external jump request (e.g. clicking "查看剧本段落" from a Canvas node)
  const handledReqSeq = useRef(0);
  useEffect(() => {
    if (
      !externalOpenRequest ||
      externalOpenRequest.seq === handledReqSeq.current
    )
      return;
    handledReqSeq.current = externalOpenRequest.seq;
    void scriptApi
      .get(externalOpenRequest.docId)
      .then((detail) =>
        openScriptTab(
          { id: detail.id, name: detail.name, path: detail.path },
          { pane: "left", targetLine: externalOpenRequest.line },
        ),
      )
      .catch((e) =>
        onNotify(e instanceof Error ? e.message : "无法打开关联剧本文档"),
      );
  }, [externalOpenRequest, onNotify, openScriptTab]);

  // Auto-save dirty scripts with 700ms debounce
  const flushScript = useCallback(async (docId: string) => {
    const current = sessionsRef.current[docId];
    if (!current || current.draftBody === current.savedBody) return;
    if (current.status === "saving" || current.status === "conflict") return;

    const bodySnapshot = current.draftBody;
    const expectedRev = current.revision;
    setSessions((prev) => ({
      ...prev,
      [docId]: { ...prev[docId], status: "saving", error: "" },
    }));

    try {
      const updated = await scriptApi.update(docId, {
        expected_revision: expectedRev,
        body_md: bodySnapshot,
      });
      setSessions((prev) => {
        const latest = prev[docId];
        if (!latest) return prev;
        const stillDirty = latest.draftBody !== bodySnapshot;
        return {
          ...prev,
          [docId]: {
            ...latest,
            detail: updated,
            savedBody: bodySnapshot,
            revision: updated.revision,
            status: stillDirty ? "dirty" : "saved",
            error: "",
          },
        };
      });
      setItems((prev) =>
        prev.map((item) =>
          item.id === docId
            ? {
                ...item,
                revision: updated.revision,
                char_count: updated.char_count,
                line_count: updated.line_count,
                preview: updated.preview,
                updated: updated.updated,
              }
            : item,
        ),
      );
    } catch (e: any) {
      const isConflict = e?.status === 409;
      setSessions((prev) => {
        const latest = prev[docId];
        if (!latest) return prev;
        return {
          ...prev,
          [docId]: {
            ...latest,
            status: isConflict ? "conflict" : "error",
            error:
              e instanceof Error ? e.message : "保存失败，本地草稿已保留",
          },
        };
      });
    }
  }, []);

  useEffect(() => {
    const dirtyIds = Object.entries(sessions)
      .filter(([, s]) => s.status === "dirty")
      .map(([id]) => id);
    if (!dirtyIds.length) return;
    const timer = setTimeout(() => {
      for (const id of dirtyIds) {
        void flushScript(id);
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [sessions, flushScript]);

  const updateScriptDraft = useCallback(
    (docId: string, nextBody: string, recordUndo = true) => {
      setSessions((prev) => {
        const cur = prev[docId];
        if (!cur || cur.draftBody === nextBody) return prev;
        const undoStack = recordUndo
          ? [...cur.undoStack.slice(-50), cur.draftBody]
          : cur.undoStack;
        return {
          ...prev,
          [docId]: {
            ...cur,
            draftBody: nextBody,
            undoStack,
            redoStack: recordUndo ? [] : cur.redoStack,
            status:
              cur.status === "conflict"
                ? "conflict"
                : nextBody === cur.savedBody
                  ? "saved"
                  : "dirty",
          },
        };
      });
      // Pin preview tab once modified
      setTabs((prev) =>
        prev.map((t) =>
          t.kind === "script" && t.docId === docId && t.preview
            ? { ...t, preview: false }
            : t,
        ),
      );
    },
    [],
  );

  const travelScriptHistory = useCallback((docId: string, redo = false) => {
    setSessions((prev) => {
      const cur = prev[docId];
      if (!cur) return prev;
      const source = redo ? cur.redoStack : cur.undoStack;
      if (!source.length) return prev;
      const targetBody = source[source.length - 1];
      const nextUndo = redo
        ? [...cur.undoStack, cur.draftBody]
        : cur.undoStack.slice(0, -1);
      const nextRedo = redo
        ? cur.redoStack.slice(0, -1)
        : [...cur.redoStack, cur.draftBody];
      return {
        ...prev,
        [docId]: {
          ...cur,
          draftBody: targetBody,
          undoStack: nextUndo,
          redoStack: nextRedo,
          status: targetBody === cur.savedBody ? "saved" : "dirty",
        },
      };
    });
  }, []);

  // Report active script to parent (for AI Agent context!)
  useEffect(() => {
    if (!onActiveScriptChange) return;
    const activeKey = focusedPane === "right" ? rightTabKey : leftTabKey;
    const tab = tabs.find((t) => t.key === activeKey);
    if (tab?.kind === "script" && sessions[tab.docId]) {
      const s = sessions[tab.docId];
      onActiveScriptChange({
        id: tab.docId,
        path: s.detail.path,
        body_md: s.draftBody,
      });
    } else {
      onActiveScriptChange(null);
    }
  }, [focusedPane, leftTabKey, rightTabKey, tabs, sessions, onActiveScriptChange]);

  // Global keyboard shortcuts inside Document Workspace
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setWorkspaceSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  const handleBootstrapSuite = async () => {
    if (suiteBusy) return;
    setSuiteBusy(true);
    try {
      const cleanTitle =
        canvasTitle.replace(/\s*·.*$/, "").trim() || "新短剧企划";
      const res = await scriptApi.createSuite({
        folder: cleanTitle,
        project_title: cleanTitle,
        canvas_id: canvasId,
      });
      await loadWorkspaceTree();
      const epFile =
        res.created.find(
          (i) => i.entry_type === "file" && i.doc_kind === "script",
        ) ?? res.created.find((i) => i.entry_type === "file");
      if (epFile) {
        await openScriptTab(epFile, { pane: "left" });
      }
      onNotify(`已初始化「${cleanTitle}」短剧剧本四件套`);
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "初始化短剧套件失败");
    } finally {
      setSuiteBusy(false);
    }
  };

  const handleCreateEntrySubmit = async () => {
    if (!creatingEntry || !creatingEntry.draftName.trim()) {
      setCreatingEntry(null);
      return;
    }
    const fullPath = creatingEntry.parentPath
      ? `${creatingEntry.parentPath}/${creatingEntry.draftName.trim()}`
      : creatingEntry.draftName.trim();
    try {
      const created = await scriptApi.create({
        path: fullPath,
        entry_type: creatingEntry.type,
        doc_kind:
          creatingEntry.template === "blank"
            ? "script"
            : creatingEntry.template,
        template:
          creatingEntry.type === "file" ? creatingEntry.template : null,
        canvas_id: canvasId,
      });
      setCreatingEntry(null);
      await loadWorkspaceTree();
      if (created.entry_type === "file") {
        setSessions((prev) => ({
          ...prev,
          [created.id]: {
            detail: created,
            draftBody: created.body_md,
            savedBody: created.body_md,
            revision: created.revision,
            status: "saved",
            error: "",
            undoStack: [],
            redoStack: [],
          },
        }));
        await openScriptTab(created, { pane: "left" });
      } else {
        setExpandedFolders((prev) => new Set([...prev, `dir:${created.path}`]));
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "新建失败");
    }
  };

  const handleRenameSubmit = async (item: ScriptDocumentSummary) => {
    const trimmed = renameDraft.trim();
    setRenamingId(null);
    if (!trimmed || trimmed === item.name) return;
    const nextPath = item.parent_path
      ? `${item.parent_path}/${trimmed}`
      : trimmed;
    try {
      const curRev = sessions[item.id]?.revision ?? item.revision;
      const updated = await scriptApi.update(item.id, {
        expected_revision: curRev,
        path: nextPath,
      });
      await loadWorkspaceTree();
      setSessions((prev) =>
        prev[item.id]
          ? {
              ...prev,
              [item.id]: {
                ...prev[item.id],
                detail: updated,
                revision: updated.revision,
              },
            }
          : prev,
      );
      setTabs((prev) =>
        prev.map((t) =>
          t.kind === "script" && t.docId === item.id
            ? { ...t, title: updated.name, path: updated.path }
            : t,
        ),
      );
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "重命名失败");
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    const target = deletingItem;
    setDeletingItem(null);
    try {
      await scriptApi.remove(target.id, target.entry_type === "directory");
      await loadWorkspaceTree();
      const closedKeys = new Set<string>();
      for (const tab of tabs) {
        if (
          tab.kind === "script" &&
          (tab.docId === target.id || tab.path.startsWith(target.path + "/"))
        ) {
          closedKeys.add(tab.key);
        }
      }
      if (closedKeys.size > 0) {
        setTabs((prev) => prev.filter((t) => !closedKeys.has(t.key)));
        if (leftTabKey && closedKeys.has(leftTabKey)) setLeftTabKey(null);
        if (rightTabKey && closedKeys.has(rightTabKey)) setRightTabKey(null);
      }
      onNotify(`已删除「${target.name}」`);
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "删除失败");
    }
  };

  const closeTab = (key: string) => {
    const tab = tabs.find((t) => t.key === key);
    if (tab?.kind === "script") {
      void flushScript(tab.docId);
    }
    const remaining = tabs.filter((t) => t.key !== key);
    setTabs(remaining);
    if (leftTabKey === key) {
      const next = remaining.find((t) => t.key !== rightTabKey) ?? remaining[0];
      setLeftTabKey(next?.key ?? null);
    }
    if (rightTabKey === key) {
      setRightTabKey(null);
    }
  };

  // Keep leftTabKey valid if tabs exist
  useEffect(() => {
    if (!leftTabKey && tabs.length > 0) {
      setLeftTabKey(tabs[0].key);
    }
  }, [leftTabKey, tabs]);

  // Filter tree items + canvas nodes
  const filterLower = treeFilter.trim().toLowerCase();
  const visibleScriptRows = useMemo(() => {
    if (filterLower) {
      return items
        .filter(
          (i) =>
            i.entry_type === "file" &&
            (i.path.toLowerCase().includes(filterLower) ||
              i.preview.toLowerCase().includes(filterLower)),
        )
        .map((item) => ({ item, depth: 0 }));
    }
    const byParent = new Map<string, ScriptDocumentSummary[]>();
    for (const item of items) {
      const list = byParent.get(item.parent_path) ?? [];
      list.push(item);
      byParent.set(item.parent_path, list);
    }
    const rows: { item: ScriptDocumentSummary; depth: number }[] = [];
    const walk = (parent: string, depth: number) => {
      for (const entry of byParent.get(parent) ?? []) {
        rows.push({ item: entry, depth });
        if (
          entry.entry_type === "directory" &&
          expandedFolders.has(`dir:${entry.path}`)
        ) {
          walk(entry.path, depth + 1);
        }
      }
    };
    walk("", 0);
    return rows;
  }, [items, filterLower, expandedFolders]);

  const visibleCanvasNodes = useMemo(() => {
    if (!filterLower) return canvasDoc.nodes;
    return canvasDoc.nodes.filter((n) =>
      `${n.title} ${n.text} ${n.prompt}`.toLowerCase().includes(filterLower),
    );
  }, [canvasDoc.nodes, filterLower]);

  // Resize left sidebar
  const startSidebarResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      setSidebarWidth(
        Math.max(200, Math.min(420, startW + (ev.clientX - startX))),
      );
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  const syncModalState = useMemo(() => {
    if (!syncModalDocId || !sessions[syncModalDocId]) return null;
    const s = sessions[syncModalDocId];
    const breakdown = parseScriptBreakdown(s.draftBody, {
      docId: syncModalDocId,
      docPath: s.detail.path,
    });
    const links = extractScriptAnchorsMap(canvasDoc, syncModalDocId);
    return { breakdown, links };
  }, [syncModalDocId, sessions, canvasDoc]);

  const handleApplyScriptSync = async (
    options: ScriptSyncOptions,
    switchAfterSync: boolean,
  ) => {
    if (!syncModalDocId || !syncModalState) return;
    await flushScript(syncModalDocId);
    let focusTargets: string[] = [];
    let createdCount = 0;
    let updatedCount = 0;

    onChangeCanvasDoc((current) => {
      const synced = syncScriptBreakdownToCanvas(
        current,
        syncModalState.breakdown,
        options,
      );
      focusTargets =
        synced.shotNodeIds.length > 0
          ? synced.shotNodeIds
          : synced.createdNodeIds;
      createdCount = synced.createdNodeIds.length;
      updatedCount = synced.updatedNodeIds.length;
      return synced.document;
    });

    onNotify(
      `已融合同步至画布：新增 ${createdCount} 个节点，更新 ${updatedCount} 个节点`,
    );
    if (switchAfterSync) {
      onSwitchToCanvas(focusTargets);
    }
  };

  return (
    <section
      className="fm-doc-workspace"
      aria-label="剧本文档与节点融合工作区"
      hidden={!active}
    >
      {/* Left Workspace File & Canvas Node Tree */}
      <aside
        className="fm-doc-sidebar"
        style={{ width: sidebarWidth }}
        aria-label="工作区文件与画布节点树"
      >
        <header className="fm-doc-tree-head">
          <span className="fm-doc-tree-title">
            <Folder size={15} />
            工作区文件
          </span>
          <div className="fm-doc-tree-actions">
            <button
              type="button"
              className="icon-button"
              title="新建剧本文档"
              aria-label="新建剧本文档"
              onClick={() =>
                setCreatingEntry({
                  type: "file",
                  parentPath: "",
                  draftName: `0${items.filter((i) => i.entry_type === "file").length + 1}_新分集剧本.md`,
                  template: "script",
                })
              }
            >
              <FilePlus2 size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="新建文件夹"
              aria-label="新建文件夹"
              onClick={() =>
                setCreatingEntry({
                  type: "directory",
                  parentPath: "",
                  draftName: "新剧集目录",
                  template: "blank",
                })
              }
            >
              <FolderPlus size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="一键初始化短剧剧本四件套"
              aria-label="一键初始化短剧剧本四件套"
              disabled={suiteBusy}
              onClick={() => void handleBootstrapSuite()}
            >
              <Sparkles size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="刷新文件与节点树"
              aria-label="刷新文件与节点树"
              onClick={() => void loadWorkspaceTree()}
            >
              <RefreshCw size={14} className={loadingTree ? "spin" : undefined} />
            </button>
          </div>
        </header>

        <div className="fm-doc-tree-search">
          <div className="fm-doc-filter-box">
            <Search size={14} />
            <input
              value={treeFilter}
              placeholder="搜索文件与画布节点"
              aria-label="搜索工作区文件与节点"
              onChange={(e) => setTreeFilter(e.target.value)}
            />
            {treeFilter && (
              <button
                type="button"
                aria-label="清除筛选"
                onClick={() => setTreeFilter("")}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            title="工作区全文搜索与替换 (⌘⇧F)"
            aria-label="工作区全文搜索与替换"
            onClick={() => setWorkspaceSearchOpen(true)}
          >
            <ExternalLink size={14} />
          </button>
        </div>

        {creatingEntry && (
          <form
            className="fm-doc-inline-create"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateEntrySubmit();
            }}
          >
            <input
              autoFocus
              aria-label={
                creatingEntry.type === "file" ? "新文档名称" : "新文件夹名称"
              }
              value={creatingEntry.draftName}
              onChange={(e) =>
                setCreatingEntry({ ...creatingEntry, draftName: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Escape") setCreatingEntry(null);
              }}
            />
            {creatingEntry.type === "file" && (
              <select
                aria-label="文档模板类型"
                value={creatingEntry.template}
                onChange={(e) =>
                  setCreatingEntry({
                    ...creatingEntry,
                    template: e.target.value as ScriptDocKind | "blank",
                  })
                }
              >
                <option value="script">分集剧本模板</option>
                <option value="outline">故事骨架模板</option>
                <option value="assets">资产设定清单</option>
                <option value="shotlist">导演分镜片单</option>
                <option value="blank">空白 Markdown</option>
              </select>
            )}
            <div className="fm-doc-inline-btns">
              <button
                type="button"
                className="secondary"
                onClick={() => setCreatingEntry(null)}
              >
                取消
              </button>
              <button type="submit" className="primary">
                创建
              </button>
            </div>
          </form>
        )}

        {treeError && (
          <p className="fm-doc-tree-error" role="alert">
            {treeError}
          </p>
        )}

        <div className="fm-doc-tree-scroll" role="tree" aria-label="工作区目录">
          <div className="fm-doc-tree-section-label">剧本文档</div>
          {items.length === 0 && !loadingTree ? (
            <div className="fm-doc-tree-onboarding">
              <p>像 Toonflow 一样在同一工作区编写分集剧本、人物资产与分镜片单，并一键同步到画布。</p>
              <button
                type="button"
                className="primary"
                disabled={suiteBusy}
                onClick={() => void handleBootstrapSuite()}
              >
                <Sparkles size={14} />
                {suiteBusy ? "正在创建…" : "初始化短剧剧本四件套"}
              </button>
            </div>
          ) : (
            visibleScriptRows.map(({ item, depth }) => {
              const dirKey = `dir:${item.path}`;
              const isExpanded = expandedFolders.has(dirKey);
              const tabKey = `script:${item.id}`;
              const isSelected =
                leftTabKey === tabKey || rightTabKey === tabKey;
              const isDirty = sessions[item.id]?.status === "dirty";

              return (
                <div
                  key={item.id}
                  role="treeitem"
                  aria-selected={isSelected}
                  className={
                    "fm-doc-tree-row" + (isSelected ? " active" : "")
                  }
                  style={{ paddingLeft: 10 + depth * 14 }}
                  onClick={() => {
                    if (item.entry_type === "directory") {
                      setExpandedFolders((prev) => {
                        const next = new Set(prev);
                        if (next.has(dirKey)) next.delete(dirKey);
                        else next.add(dirKey);
                        return next;
                      });
                    } else {
                      void openScriptTab(item, { preview: true });
                    }
                  }}
                  onDoubleClick={() => {
                    if (item.entry_type === "file") {
                      void openScriptTab(item, { preview: false });
                    }
                  }}
                >
                  {item.entry_type === "directory" ? (
                    <>
                      <span className="fm-tree-chevron">
                        {isExpanded ? (
                          <ChevronDown size={13} />
                        ) : (
                          <ChevronRight size={13} />
                        )}
                      </span>
                      {isExpanded ? (
                        <FolderOpen size={15} className="fm-tree-icon" />
                      ) : (
                        <Folder size={15} className="fm-tree-icon" />
                      )}
                    </>
                  ) : (
                    <>
                      <span className="fm-tree-chevron" />
                      <FileText size={15} className="fm-tree-icon" />
                    </>
                  )}

                  {renamingId === item.id ? (
                    <input
                      autoFocus
                      className="fm-tree-rename-input"
                      value={renameDraft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => void handleRenameSubmit(item)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") void handleRenameSubmit(item);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                  ) : (
                    <span className="fm-tree-name" title={item.path}>
                      {item.name}
                      {isDirty && <em className="fm-dirty-dot">●</em>}
                    </span>
                  )}

                  <span
                    className="fm-tree-row-btns"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {item.entry_type === "directory" ? (
                      <button
                        type="button"
                        title="在此目录新建文件"
                        aria-label={`在 ${item.name} 新建文件`}
                        onClick={() =>
                          setCreatingEntry({
                            type: "file",
                            parentPath: item.path,
                            draftName: "新剧本文档.md",
                            template: "script",
                          })
                        }
                      >
                        <Plus size={13} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        title="在右侧分屏打开"
                        aria-label={`向右分屏打开 ${item.name}`}
                        onClick={() =>
                          void openScriptTab(item, {
                            pane: "right",
                            preview: false,
                          })
                        }
                      >
                        <Columns2 size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      title="重命名"
                      aria-label={`重命名 ${item.name}`}
                      onClick={() => {
                        setRenamingId(item.id);
                        setRenameDraft(item.name);
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                    {item.can_delete && (
                      <button
                        type="button"
                        title="删除"
                        aria-label={`删除 ${item.name}`}
                        onClick={() => setDeletingItem(item)}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </span>
                </div>
              );
            })
          )}

          {/* Expandable Live Canvas & Nodes Section (1:1 Toonflow canvas JSON expansion!) */}
          <div className="fm-doc-tree-section-label">画布与实时节点</div>
          <div
            role="treeitem"
            aria-expanded={expandedFolders.has("__current_canvas__")}
            className="fm-doc-tree-row fm-canvas-root-row"
            onClick={() =>
              setExpandedFolders((prev) => {
                const next = new Set(prev);
                if (next.has("__current_canvas__"))
                  next.delete("__current_canvas__");
                else next.add("__current_canvas__");
                return next;
              })
            }
          >
            <span className="fm-tree-chevron">
              {expandedFolders.has("__current_canvas__") ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
            </span>
            <Layers size={15} className="fm-tree-icon" />
            <span className="fm-tree-name">
              {canvasTitle || "当前画布"}{" "}
              <small>({visibleCanvasNodes.length})</small>
            </span>
          </div>

          {(expandedFolders.has("__current_canvas__") || !!filterLower) &&
            visibleCanvasNodes.map((node) => {
              const Icon = NODE_TYPE_ICONS[node.type] ?? Layers;
              const tabKey = `node:${node.id}`;
              const isSelected =
                leftTabKey === tabKey || rightTabKey === tabKey;
              const resolved = resolveNode(node, runs);
              return (
                <div
                  key={node.id}
                  role="treeitem"
                  aria-selected={isSelected}
                  className={
                    "fm-doc-tree-row fm-node-tree-row" +
                    (isSelected ? " active" : "")
                  }
                  style={{ paddingLeft: 26 }}
                  onClick={() => openNodeTab(node, { preview: true })}
                  onDoubleClick={() => openNodeTab(node, { preview: false })}
                >
                  <Icon size={14} className="fm-tree-icon" />
                  <span className="fm-tree-name" title={node.title}>
                    {node.title}
                    {resolved.media && (
                      <span
                        className="fm-node-ready-dot"
                        title="已有媒体产物"
                      />
                    )}
                  </span>
                  <span
                    className="fm-tree-row-btns"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      title="向右分屏打开此节点"
                      aria-label={`向右分屏打开节点 ${node.title}`}
                      onClick={() =>
                        openNodeTab(node, { pane: "right", preview: false })
                      }
                    >
                      <Columns2 size={13} />
                    </button>
                    <button
                      type="button"
                      title="切换到画布并聚焦此节点"
                      aria-label={`在画布上聚焦 ${node.title}`}
                      onClick={() => onFocusCanvasNode(node.id)}
                    >
                      <Crosshair size={13} />
                    </button>
                  </span>
                </div>
              );
            })}

          {otherCanvases.length > 0 && !filterLower && (
            <>
              <div className="fm-doc-tree-section-label">同工作区其他画布</div>
              {otherCanvases.slice(0, 8).map((c) => (
                <div
                  key={c.id}
                  role="treeitem"
                  className="fm-doc-tree-row"
                  style={{ paddingLeft: 12 }}
                  onClick={() => onSwitchCanvasProject(c.id)}
                >
                  <span className="fm-tree-chevron" />
                  <Layers size={14} className="fm-tree-icon" />
                  <span className="fm-tree-name" title={`切换到画布 ${c.title}`}>
                    {c.title} <small>({c.count})</small>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </aside>

      <div
        className="fm-doc-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整工作区文件栏宽度"
        onPointerDown={startSidebarResize}
      />

      {/* Main Multi-Tab + Split-Screen Document Surface */}
      <div className="fm-doc-main">
        {tabs.length === 0 ? (
          <div className="fm-doc-empty-stage">
            <FileText size={36} strokeWidth={1.4} />
            <h2>选择或创建一份剧本文档</h2>
            <p>
              支持 Markdown 剧本富文本/原文双模式编辑、一键识别人物场景与镜头落图到画布，或从左侧展开画布节点直接双屏联调。
            </p>
            <div className="fm-doc-empty-actions">
              <button
                type="button"
                className="primary"
                disabled={suiteBusy}
                onClick={() => void handleBootstrapSuite()}
              >
                <Sparkles size={15} />
                一键创建短剧剧本四件套
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setCreatingEntry({
                    type: "file",
                    parentPath: "",
                    draftName: "01_分集剧本_EP01.md",
                    template: "script",
                  })
                }
              >
                <FilePlus2 size={15} />
                新建单集剧本文档
              </button>
            </div>
          </div>
        ) : (
          <div
            className={
              "fm-doc-split-grid" + (rightTabKey ? " is-split" : "")
            }
          >
            {/* Left Editor Group */}
            <div
              className={
                "fm-doc-pane" + (focusedPane === "left" ? " is-focused" : "")
              }
              onPointerDown={() => setFocusedPane("left")}
            >
              <EditorTabBar
                tabs={tabs}
                activeKey={leftTabKey}
                onSelect={(k) => {
                  setLeftTabKey(k);
                  setFocusedPane("left");
                }}
                onPin={(k) =>
                  setTabs((prev) =>
                    prev.map((t) =>
                      t.key === k ? { ...t, preview: false } : t,
                    ),
                  )
                }
                onSplitRight={(k) => {
                  setRightTabKey(k);
                  setFocusedPane("right");
                }}
                onClose={closeTab}
                sessions={sessions}
              />
              <EditorPaneBody
                tab={tabs.find((t) => t.key === leftTabKey) ?? null}
                sessions={sessions}
                canvasDoc={canvasDoc}
                runs={runs}
                assets={assets}
                onUpdateScript={updateScriptDraft}
                onTravelHistory={travelScriptHistory}
                onFlushScript={flushScript}
                onReloadScript={async (docId) => {
                  const fresh = await scriptApi.get(docId);
                  setSessions((prev) => ({
                    ...prev,
                    [docId]: {
                      detail: fresh,
                      draftBody: fresh.body_md,
                      savedBody: fresh.body_md,
                      revision: fresh.revision,
                      status: "saved",
                      error: "",
                      undoStack: [],
                      redoStack: [],
                    },
                  }));
                }}
                onOpenSyncModal={(docId) => setSyncModalDocId(docId)}
                onEditCanvasNode={onEditCanvasNode}
                onFocusCanvasNode={onFocusCanvasNode}
                onOpenNodeInSplit={(nodeId) => {
                  const found = canvasDoc.nodes.find((n) => n.id === nodeId);
                  if (found) openNodeTab(found, { pane: "right" });
                }}
                onOpenLinkedScript={(docId, line) => {
                  const item = items.find((i) => i.id === docId);
                  if (item) {
                    void openScriptTab(item, {
                      pane: "left",
                      targetLine: line,
                    });
                  }
                }}
                onAssetUploaded={onAssetUploaded}
                onNotify={onNotify}
              />
            </div>

            {/* Optional Right Split Pane (Toonflow Dockview splitRight replica!) */}
            {rightTabKey && (
              <div
                className={
                  "fm-doc-pane fm-doc-pane-right" +
                  (focusedPane === "right" ? " is-focused" : "")
                }
                onPointerDown={() => setFocusedPane("right")}
              >
                <div className="fm-doc-split-head">
                  <EditorTabBar
                    tabs={tabs.filter((t) => t.key === rightTabKey)}
                    activeKey={rightTabKey}
                    onSelect={(k) => setRightTabKey(k)}
                    onPin={(k) =>
                      setTabs((prev) =>
                        prev.map((t) =>
                          t.key === k ? { ...t, preview: false } : t,
                        ),
                      )
                    }
                    onClose={() => setRightTabKey(null)}
                    sessions={sessions}
                  />
                  <button
                    type="button"
                    className="icon-button fm-close-split-btn"
                    title="关闭右侧分屏"
                    aria-label="关闭右侧分屏"
                    onClick={() => setRightTabKey(null)}
                  >
                    <X size={15} />
                  </button>
                </div>
                <EditorPaneBody
                  tab={tabs.find((t) => t.key === rightTabKey) ?? null}
                  sessions={sessions}
                  canvasDoc={canvasDoc}
                  runs={runs}
                  assets={assets}
                  onUpdateScript={updateScriptDraft}
                  onTravelHistory={travelScriptHistory}
                  onFlushScript={flushScript}
                  onReloadScript={async (docId) => {
                    const fresh = await scriptApi.get(docId);
                    setSessions((prev) => ({
                      ...prev,
                      [docId]: {
                        detail: fresh,
                        draftBody: fresh.body_md,
                        savedBody: fresh.body_md,
                        revision: fresh.revision,
                        status: "saved",
                        error: "",
                        undoStack: [],
                        redoStack: [],
                      },
                    }));
                  }}
                  onOpenSyncModal={(docId) => setSyncModalDocId(docId)}
                  onEditCanvasNode={onEditCanvasNode}
                  onFocusCanvasNode={onFocusCanvasNode}
                  onOpenNodeInSplit={(nodeId) => {
                    const found = canvasDoc.nodes.find((n) => n.id === nodeId);
                    if (found) openNodeTab(found, { pane: "right" });
                  }}
                  onOpenLinkedScript={(docId, line) => {
                    const item = items.find((i) => i.id === docId);
                    if (item) {
                      void openScriptTab(item, {
                        pane: "left",
                        targetLine: line,
                      });
                    }
                  }}
                  onAssetUploaded={onAssetUploaded}
                  onNotify={onNotify}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {deletingItem && (
        <div
          className="fm-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="确认删除文档"
        >
          <div className="fm-confirm-card">
            <h3>删除「{deletingItem.name}」？</h3>
            <p>
              {deletingItem.entry_type === "directory"
                ? "将删除该文件夹及其内部剧本文档，画布上的已生成节点与媒体不受影响。"
                : "删除该剧本文档后，画布上已同步的镜头节点仍会保留。"}
            </p>
            <div className="fm-script-sync-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setDeletingItem(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="primary danger"
                onClick={() => void handleConfirmDelete()}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Script -> Canvas Interactive Fusion Modal */}
      {syncModalDocId && syncModalState && (
        <ScriptSyncModal
          breakdown={syncModalState.breakdown}
          existingLinks={syncModalState.links}
          defaultVideoModel={defaultVideoModel}
          defaultImageModel={defaultImageModel}
          onSync={handleApplyScriptSync}
          onClose={() => setSyncModalDocId(null)}
        />
      )}

      {/* Workspace-wide Full-text Search & Replace Modal */}
      {workspaceSearchOpen && (
        <WorkspaceSearchModal
          canvasId={canvasId}
          canvasTitle={canvasTitle}
          canvasDoc={canvasDoc}
          onOpenScriptMatch={(docId, path, line) => {
            const name = path.split("/").at(-1) || path;
            void openScriptTab(
              { id: docId, name, path },
              { pane: "left", targetLine: line },
            );
          }}
          onFocusCanvasNode={onFocusCanvasNode}
          onReplaceCanvasDoc={onChangeCanvasDoc}
          onScriptsChanged={async () => {
            await loadWorkspaceTree();
            for (const docId of Object.keys(sessionsRef.current)) {
              const fresh = await scriptApi.get(docId).catch(() => null);
              if (fresh) {
                setSessions((prev) => ({
                  ...prev,
                  [docId]: {
                    detail: fresh,
                    draftBody: fresh.body_md,
                    savedBody: fresh.body_md,
                    revision: fresh.revision,
                    status: "saved",
                    error: "",
                    undoStack: [],
                    redoStack: [],
                  },
                }));
              }
            }
          }}
          onClose={() => setWorkspaceSearchOpen(false)}
        />
      )}
    </section>
  );
}

function EditorTabBar({
  tabs,
  activeKey,
  onSelect,
  onPin,
  onSplitRight,
  onClose,
  sessions,
}: {
  tabs: OpenDocTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onPin: (key: string) => void;
  onSplitRight?: (key: string) => void;
  onClose: (key: string) => void;
  sessions: Record<string, LoadedScriptState>;
}) {
  return (
    <div className="fm-doc-tabs" role="tablist" aria-label="已打开文档标签">
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        const dirty =
          tab.kind === "script" && sessions[tab.docId]?.status === "dirty";
        return (
          <div
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            className={
              "fm-doc-tab" +
              (isActive ? " active" : "") +
              (tab.preview ? " preview" : "")
            }
            onClick={() => onSelect(tab.key)}
            onDoubleClick={() => onPin(tab.key)}
          >
            {tab.kind === "script" ? (
              <FileText size={13} />
            ) : (
              <Layers size={13} />
            )}
            <span className="fm-doc-tab-label">{tab.title}</span>
            {dirty && <span className="fm-dirty-dot">●</span>}
            {onSplitRight && isActive && (
              <button
                type="button"
                className="fm-tab-icon-btn"
                title="向右分屏对照"
                aria-label={`向右分屏 ${tab.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSplitRight(tab.key);
                }}
              >
                <Columns2 size={12} />
              </button>
            )}
            <button
              type="button"
              className="fm-tab-icon-btn"
              title={`关闭 ${tab.title}`}
              aria-label={`关闭 ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.key);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function EditorPaneBody({
  tab,
  sessions,
  canvasDoc,
  runs,
  assets,
  onUpdateScript,
  onTravelHistory,
  onFlushScript,
  onReloadScript,
  onOpenSyncModal,
  onEditCanvasNode,
  onFocusCanvasNode,
  onOpenNodeInSplit,
  onOpenLinkedScript,
  onAssetUploaded,
  onNotify,
}: {
  tab: OpenDocTab | null;
  sessions: Record<string, LoadedScriptState>;
  canvasDoc: Doc;
  runs: Job[];
  assets: Asset[];
  onUpdateScript: (docId: string, body: string, recordUndo?: boolean) => void;
  onTravelHistory: (docId: string, redo?: boolean) => void;
  onFlushScript: (docId: string) => Promise<void>;
  onReloadScript: (docId: string) => Promise<void>;
  onOpenSyncModal: (docId: string) => void;
  onEditCanvasNode: (
    nodeId: string,
    patch: Partial<CanvasNode>,
    history?: boolean,
  ) => void;
  onFocusCanvasNode: (nodeId: string) => void;
  onOpenNodeInSplit: (nodeId: string) => void;
  onOpenLinkedScript: (docId: string, line?: number) => void;
  onAssetUploaded: (asset: { id: string; w: number; h: number }) => void;
  onNotify: (msg: string) => void;
}) {
  if (!tab) return null;
  if (tab.kind === "node") {
    const node = canvasDoc.nodes.find((n) => n.id === tab.nodeId);
    if (!node) {
      return (
        <div className="fm-doc-empty-stage">
          <p>该画布节点已被移除。</p>
        </div>
      );
    }
    return (
      <CanvasNodeDocumentEditor
        node={node}
        canvasDoc={canvasDoc}
        runs={runs}
        onEditNode={onEditCanvasNode}
        onFocusCanvasNode={onFocusCanvasNode}
        onOpenLinkedScript={onOpenLinkedScript}
      />
    );
  }

  const session = sessions[tab.docId];
  if (!session) {
    return (
      <div className="fm-doc-empty-stage">
        <p>正在读取剧本文档…</p>
      </div>
    );
  }

  return (
    <MarkdownScriptEditor
      session={session}
      targetLine={tab.targetLine}
      canvasDoc={canvasDoc}
      assets={assets}
      onUpdate={(next) => onUpdateScript(tab.docId, next, true)}
      onUndo={() => onTravelHistory(tab.docId, false)}
      onRedo={() => onTravelHistory(tab.docId, true)}
      onFlush={() => onFlushScript(tab.docId)}
      onReload={() => onReloadScript(tab.docId)}
      onOpenSync={() => onOpenSyncModal(tab.docId)}
      onFocusCanvasNode={onFocusCanvasNode}
      onOpenNodeInSplit={onOpenNodeInSplit}
      onAssetUploaded={onAssetUploaded}
      onNotify={onNotify}
    />
  );
}

function MarkdownScriptEditor({
  session,
  targetLine,
  canvasDoc,
  assets,
  onUpdate,
  onUndo,
  onRedo,
  onFlush,
  onReload,
  onOpenSync,
  onFocusCanvasNode,
  onOpenNodeInSplit,
  onAssetUploaded,
  onNotify,
}: {
  session: LoadedScriptState;
  targetLine?: number;
  canvasDoc: Doc;
  assets: Asset[];
  onUpdate: (next: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFlush: () => Promise<void>;
  onReload: () => Promise<void>;
  onOpenSync: () => void;
  onFocusCanvasNode: (nodeId: string) => void;
  onOpenNodeInSplit: (nodeId: string) => void;
  onAssetUploaded: (asset: { id: string; w: number; h: number }) => void;
  onNotify: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"rich" | "source">("rich");
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const sourceRef = useRef<HTMLTextAreaElement>(null);

  const breakdown = useMemo(
    () =>
      parseScriptBreakdown(session.draftBody, {
        docId: session.detail.id,
        docPath: session.detail.path,
      }),
    [session.draftBody, session.detail.id, session.detail.path],
  );

  const anchorLinks = useMemo(
    () => extractScriptAnchorsMap(canvasDoc, session.detail.id),
    [canvasDoc, session.detail.id],
  );

  const linkedShotCount = Object.keys(anchorLinks).length;

  const richBlocks = useMemo(
    () =>
      mode === "rich"
        ? splitRichScriptBlocks(session.draftBody, session.detail.id)
        : [],
    [mode, session.draftBody, session.detail.id],
  );

  // Scroll to target line when requested
  useEffect(() => {
    if (!targetLine) return;
    if (mode === "source" && sourceRef.current) {
      const lines = session.draftBody.split("\n");
      const offset = lines
        .slice(0, Math.max(0, targetLine - 1))
        .reduce((sum, l) => sum + l.length + 1, 0);
      sourceRef.current.focus();
      sourceRef.current.setSelectionRange(offset, offset);
    }
  }, [targetLine, mode, session.draftBody]);

  const insertSnippet = (snippet: string, wrapPair?: [string, string]) => {
    if (mode === "source" && sourceRef.current) {
      const el = sourceRef.current;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = session.draftBody.slice(start, end);
      const inserted = wrapPair
        ? `${wrapPair[0]}${selected || snippet}${wrapPair[1]}`
        : snippet;
      const next =
        session.draftBody.slice(0, start) +
        inserted +
        session.draftBody.slice(end);
      onUpdate(next);
      requestAnimationFrame(() => {
        el.focus();
        const cursor = start + inserted.length;
        el.setSelectionRange(cursor, cursor);
      });
      return;
    }
    const base = session.draftBody.replace(/\s+$/, "");
    const next = base ? `${base}\n\n${snippet}\n` : `${snippet}\n`;
    onUpdate(next);
  };

  const replaceBlockLines = (
    lineStart: number,
    lineEnd: number,
    nextBlockText: string,
  ) => {
    const lines = session.draftBody.replace(/\r\n?/g, "\n").split("\n");
    const updated = [
      ...lines.slice(0, lineStart - 1),
      ...nextBlockText.split("\n"),
      ...lines.slice(lineEnd),
    ].join("\n");
    onUpdate(updated);
  };

  const nextSceneNumber = String(breakdown.scenes.length + 1).padStart(2, "0");

  const handlePasteImages = async (
    e: React.ClipboardEvent<HTMLElement>,
  ) => {
    const imageFiles = [...(e.clipboardData?.files ?? [])].filter((f) =>
      f.type.startsWith("image/"),
    );
    if (!imageFiles.length) return;
    e.preventDefault();
    setUploadingImage(true);
    try {
      for (const file of imageFiles) {
        const uploaded = await upload(file, () => {});
        onAssetUploaded(uploaded);
        insertSnippet(`![${file.name}](/media/${uploaded.id})`);
      }
      onNotify("图片已上传并插入剧本文档");
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "粘贴图片失败");
    } finally {
      setUploadingImage(false);
    }
  };

  const inDocMatchCount = useMemo(() => {
    if (!findQuery) return 0;
    const hay = session.draftBody.toLowerCase();
    const needle = findQuery.toLowerCase();
    let count = 0;
    let idx = 0;
    while ((idx = hay.indexOf(needle, idx)) >= 0) {
      count++;
      idx += Math.max(1, needle.length);
    }
    return count;
  }, [findQuery, session.draftBody]);

  return (
    <div className="fm-md-editor" onPaste={(e) => void handlePasteImages(e)}>
      {/* Top Mode & Script-to-Canvas Fusion Strip */}
      <div className="fm-md-modebar">
        <div className="fm-md-modes" role="group" aria-label="剧本编辑模式">
          <button
            type="button"
            className={mode === "rich" ? "active" : ""}
            aria-pressed={mode === "rich"}
            onClick={() => setMode("rich")}
          >
            富文本
          </button>
          <button
            type="button"
            className={mode === "source" ? "active" : ""}
            aria-pressed={mode === "source"}
            onClick={() => setMode("source")}
          >
            原文
          </button>
          <span className="fm-md-kind-pill">
            {DOC_KIND_LABELS[session.detail.doc_kind]}
          </span>
          <span className="fm-md-save-status">
            {uploadingImage
              ? "正在导入图片…"
              : session.status === "saving" || session.status === "dirty"
                ? "自动保存中…"
                : session.status === "conflict"
                  ? "版本冲突（本地草稿已保留）"
                  : `✓ 已保存 v${session.revision}`}
          </span>
        </div>

        <div className="fm-md-fusion-actions">
          <span className="fm-md-stats fm-number">
            识别 {breakdown.assets.length} 资产 · {breakdown.shots.length} 镜
            {linkedShotCount > 0 && (
              <strong className="fm-linked-count">
                {" "}
                · 已关联画布 {linkedShotCount} 镜
              </strong>
            )}
          </span>
          <button
            type="button"
            className="primary fm-sync-canvas-btn"
            onClick={onOpenSync}
          >
            <Clapperboard size={14} />
            同步分镜到画布
          </button>
        </div>
      </div>

      {session.status === "conflict" && (
        <div className="fm-md-conflict-bar" role="alert">
          <span>{session.error || "该剧本文档已被其他协作者修改，你的修改已保留在当前编辑器中。"}</span>
          <button
            type="button"
            className="secondary"
            onClick={() => void onReload()}
          >
            读取服务器最新版
          </button>
        </div>
      )}

      {/* Rich Formatting + Screenplay Quick-Insert Toolbar (Toonflow ext/md + Drama Tools) */}
      <div className="fm-md-toolbar" role="toolbar" aria-label="文档与剧本排版工具栏">
        <div className="fm-md-tool-group">
          <button
            type="button"
            title="撤销"
            aria-label="撤销文档编辑"
            disabled={session.undoStack.length === 0}
            onClick={onUndo}
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            title="重做"
            aria-label="重做文档编辑"
            disabled={session.redoStack.length === 0}
            onClick={onRedo}
          >
            <Redo2 size={15} />
          </button>
        </div>

        <div className="fm-md-tool-group">
          <button
            type="button"
            title="一级标题"
            aria-label="插入一级标题"
            onClick={() => insertSnippet("# 剧集标题")}
          >
            <Heading1 size={15} />
          </button>
          <button
            type="button"
            title="二级分集标题"
            aria-label="插入二级标题"
            onClick={() => insertSnippet("## EP01 分集标题")}
          >
            <Heading2 size={15} />
          </button>
          <button
            type="button"
            title="三级场次标题"
            aria-label="插入三级标题"
            onClick={() =>
              insertSnippet(`### S${nextSceneNumber} 场景地点 夜 内`)
            }
          >
            <Heading3 size={15} />
          </button>
        </div>

        <div className="fm-md-tool-group">
          <button
            type="button"
            title="加粗"
            aria-label="加粗"
            onClick={() => insertSnippet("重点内容", ["**", "**"])}
          >
            <Bold size={15} />
          </button>
          <button
            type="button"
            title="斜体"
            aria-label="斜体"
            onClick={() => insertSnippet("强调内容", ["*", "*"])}
          >
            <Italic size={15} />
          </button>
          <button
            type="button"
            title="删除线"
            aria-label="删除线"
            onClick={() => insertSnippet("修订内容", ["~~", "~~"])}
          >
            <Strikethrough size={15} />
          </button>
          <button
            type="button"
            title="行内代码/锚点"
            aria-label="行内代码"
            onClick={() => insertSnippet("S01-01", ["`", "`"])}
          >
            <Code size={15} />
          </button>
          <button
            type="button"
            title="无序列表"
            aria-label="无序列表"
            onClick={() => insertSnippet("- 列表条目")}
          >
            <List size={15} />
          </button>
          <button
            type="button"
            title="任务清单"
            aria-label="任务清单"
            onClick={() => insertSnippet("- [ ] 待确认事项")}
          >
            <ListChecks size={15} />
          </button>
          <button
            type="button"
            title="引用说明"
            aria-label="引用说明"
            onClick={() => insertSnippet("> 导演阐述：")}
          >
            <Quote size={15} />
          </button>
          <button
            type="button"
            title="插入分镜表格"
            aria-label="插入分镜表格"
            onClick={() =>
              insertSnippet(
                "| 镜号 | 场次 | 景别/运镜 | 时长 | 画面提示词摘要 | 台词/旁白 |\n| --- | --- | --- | --- | --- | --- |\n| 01 | S01 | 中近景 / 缓推 | 5s | 角色在光影中抬头 | 角色：台词内容 |",
              )
            }
          >
            <Table size={15} />
          </button>
          <button
            type="button"
            title="插入分隔线"
            aria-label="插入分隔线"
            onClick={() => insertSnippet("---")}
          >
            <Minus size={15} />
          </button>
        </div>

        {/* Screenplay Specific Quick-Insert Pills */}
        <div className="fm-md-tool-group fm-screenplay-pills">
          <button
            type="button"
            className="fm-pill-btn"
            onClick={() =>
              insertSnippet(
                `### S${nextSceneNumber} 新场景 夜 内\n\n人物：主角\n\n△中景缓推，人物走进房间环顾四周。`,
              )
            }
          >
            + 场次 S{nextSceneNumber}
          </button>
          <button
            type="button"
            className="fm-pill-btn"
            onClick={() =>
              insertSnippet("△特写镜头缓慢推进，光影在人物脸庞明暗交错。")
            }
          >
            + △动作镜头
          </button>
          <button
            type="button"
            className="fm-pill-btn"
            onClick={() => insertSnippet("林墨：先别出声，仔细听座钟的声音。")}
          >
            <MessageSquarePlus size={13} />
            对白
          </button>
          <button
            type="button"
            className="fm-pill-btn"
            onClick={() =>
              insertSnippet(
                "- **CH03 新角色**：25岁，造型干练，电影写实光影，角色三视图一致。",
              )
            }
          >
            <UserPlus size={13} />
            角色设定
          </button>
        </div>

        <div className="fm-md-tool-group fm-md-tool-right">
          <div className="fm-asset-insert-wrap">
            <button
              type="button"
              className="fm-pill-btn"
              aria-label="插入资产图片"
              onClick={() => setAssetMenuOpen((v) => !v)}
            >
              <ImageIcon size={14} />
              插入图片
            </button>
            {assetMenuOpen && (
              <div className="fm-asset-insert-popover">
                <header>
                  <strong>插入工作区图片资产</strong>
                  <button
                    type="button"
                    aria-label="关闭图片选择"
                    onClick={() => setAssetMenuOpen(false)}
                  >
                    <X size={13} />
                  </button>
                </header>
                {assets.length === 0 ? (
                  <p className="fm-doc-muted">
                    可直接粘贴截图至编辑器自动上传，或在画布上传图片。
                  </p>
                ) : (
                  <div className="fm-asset-mini-grid">
                    {assets.slice(0, 12).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          insertSnippet(
                            `![${a.name || "参考图"}](/media/${a.id})`,
                          );
                          setAssetMenuOpen(false);
                        }}
                      >
                        <img src={`/media/${a.id}`} alt={a.name || ""} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            title="复制全部 Markdown"
            aria-label="复制 Markdown"
            onClick={() => {
              void navigator.clipboard
                .writeText(session.draftBody)
                .then(() => onNotify("已复制剧本 Markdown"))
                .catch(() => onNotify("复制失败，请手动选中复制"));
            }}
          >
            <Copy size={15} />
          </button>
          <button
            type="button"
            className={findOpen ? "active" : ""}
            title="页内查找"
            aria-label="页内查找"
            onClick={() => setFindOpen((v) => !v)}
          >
            <Search size={15} />
          </button>
        </div>
      </div>

      {findOpen && (
        <div className="fm-md-findbar">
          <Search size={14} />
          <input
            autoFocus
            value={findQuery}
            placeholder="在当前剧本中查找…"
            aria-label="页内查找词"
            onChange={(e) => setFindQuery(e.target.value)}
          />
          {findQuery && (
            <span className="fm-number">{inDocMatchCount} 处匹配</span>
          )}
          <button
            type="button"
            aria-label="关闭页内查找"
            onClick={() => {
              setFindOpen(false);
              setFindQuery("");
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Editor Body: Rich Screenplay View OR Lossless Markdown Source */}
      {mode === "source" ? (
        <textarea
          ref={sourceRef}
          className="fm-md-source-textarea"
          aria-label="剧本文档原文编辑器"
          value={session.draftBody}
          placeholder="在此编写短剧剧本、场次 S01、△动作镜头、角色对白或 Markdown 文档…"
          onChange={(e) => onUpdate(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              void onFlush().then(() => onNotify("剧本文档已保存"));
            }
          }}
        />
      ) : (
        <div className="fm-md-rich-scroll">
          <article className="fm-md-rich-paper">
            {richBlocks.length === 0 ? (
              <div
                className="fm-md-rich-placeholder"
                onClick={() => setMode("source")}
              >
                点击上方「+ 场次 S01」「+ △动作镜头」或切换到「原文」开始编写剧本…
              </div>
            ) : (
              richBlocks.map((block) => {
                const isEditing = editingBlockId === block.id;
                const linkedShot = block.shotAnchor
                  ? anchorLinks[block.shotAnchor]
                  : undefined;

                if (isEditing) {
                  return (
                    <div key={block.id} className="fm-rich-block-editing">
                      <textarea
                        autoFocus
                        rows={Math.max(
                          2,
                          block.rawText.split("\n").length + 1,
                        )}
                        defaultValue={block.rawText}
                        onBlur={(e) => {
                          setEditingBlockId(null);
                          if (e.target.value !== block.rawText) {
                            replaceBlockLines(
                              block.lineStart,
                              block.lineEnd,
                              e.target.value,
                            );
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setEditingBlockId(null);
                          } else if (
                            (e.metaKey || e.ctrlKey) &&
                            e.key === "Enter"
                          ) {
                            e.currentTarget.blur();
                          }
                        }}
                      />
                      <small>点击外部或按 ⌘+Enter 完成段落修改 · Esc 取消</small>
                    </div>
                  );
                }

                if (block.blockType === "scene") {
                  return (
                    <div
                      key={block.id}
                      className="fm-rich-scene-banner"
                      onClick={() => setEditingBlockId(block.id)}
                    >
                      <span className="fm-scene-tag">{block.sceneCode}</span>
                      <strong>
                        {block.rawText.replace(/^#{1,4}\s*/, "")}
                      </strong>
                      <span className="fm-block-edit-hint">点击编辑</span>
                    </div>
                  );
                }

                if (block.blockType === "action") {
                  return (
                    <div
                      key={block.id}
                      className="fm-rich-action-beat"
                      onClick={() => setEditingBlockId(block.id)}
                    >
                      <div className="fm-beat-top">
                        <span className="fm-beat-triangle">△ 镜头动作</span>
                        {block.shotAnchor && (
                          <span className="fm-beat-anchor">
                            {block.shotAnchor}
                          </span>
                        )}
                        {linkedShot && (
                          <span
                            className="fm-beat-canvas-links"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="fm-canvas-jump-pill"
                              onClick={() =>
                                onFocusCanvasNode(linkedShot.videoNodeId)
                              }
                            >
                              <Crosshair size={12} />
                              画布聚焦 {linkedShot.hasMedia ? "· 已出片" : ""}
                            </button>
                            <button
                              type="button"
                              className="fm-canvas-jump-pill secondary"
                              onClick={() =>
                                onOpenNodeInSplit(linkedShot.videoNodeId)
                              }
                            >
                              <Columns2 size={12} />
                              右侧联调节点
                            </button>
                          </span>
                        )}
                      </div>
                      <p>{block.rawText.replace(/^[△▲]\s*/, "")}</p>
                    </div>
                  );
                }

                if (block.blockType === "dialogue") {
                  return (
                    <div
                      key={block.id}
                      className="fm-rich-dialogue-row"
                      onClick={() => setEditingBlockId(block.id)}
                    >
                      <span className="fm-dialogue-speaker">
                        {block.speaker}
                      </span>
                      <p className="fm-dialogue-speech">{block.speech}</p>
                      {linkedShot && (
                        <button
                          type="button"
                          className="fm-canvas-jump-pill"
                          onClick={(e) => {
                            e.stopPropagation();
                            onFocusCanvasNode(linkedShot.videoNodeId);
                          }}
                        >
                          <Crosshair size={11} />
                          {linkedShot.anchor}
                        </button>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={block.id}
                    className="fm-rich-markdown-block"
                    onClick={() => setEditingBlockId(block.id)}
                    dangerouslySetInnerHTML={{
                      __html: renderSafeMarkdown(block.rawText),
                    }}
                  />
                );
              })
            )}

            <div className="fm-rich-append-box">
              <input
                aria-label="快速追加剧本段落"
                placeholder="继续输入新台词或 △ 镜头描写并按回车追加（例如：△齐夏缓缓起身走向圆桌中央…）"
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.nativeEvent.isComposing &&
                    e.currentTarget.value.trim()
                  ) {
                    const line = e.currentTarget.value.trim();
                    e.currentTarget.value = "";
                    insertSnippet(line);
                  }
                }}
              />
            </div>
          </article>
        </div>
      )}
    </div>
  );
}

function CanvasNodeDocumentEditor({
  node,
  canvasDoc,
  runs,
  onEditNode,
  onFocusCanvasNode,
  onOpenLinkedScript,
}: {
  node: CanvasNode;
  canvasDoc: Doc;
  runs: Job[];
  onEditNode: (
    nodeId: string,
    patch: Partial<CanvasNode>,
    history?: boolean,
  ) => void;
  onFocusCanvasNode: (nodeId: string) => void;
  onOpenLinkedScript: (docId: string, line?: number) => void;
}) {
  const resolved = resolveNode(node, runs);
  const incomingNodes = canvasDoc.edges
    .filter((e) => e.target === node.id)
    .map((e) => canvasDoc.nodes.find((n) => n.id === e.source))
    .filter((n): n is CanvasNode => Boolean(n));

  const isTextKind = node.type === "text" || node.type === "sticky";
  const scriptDocId =
    typeof node.extra_params?.script_doc_id === "string"
      ? node.extra_params.script_doc_id
      : null;
  const scriptAnchor =
    typeof node.extra_params?.script_anchor === "string"
      ? node.extra_params.script_anchor
      : null;
  const scriptLine =
    typeof node.extra_params?.script_line === "number"
      ? node.extra_params.script_line
      : undefined;

  const updateCine = (patch: Partial<CinematographySpec>) => {
    onEditNode(node.id, {
      cinematography: { ...(node.cinematography ?? {}), ...patch },
    });
  };

  const dialogues = node.dialogue_lines ?? [];
  const updateDialogue = (index: number, patch: Partial<DialogueLine>) => {
    const next = dialogues.map((d, i) => (i === index ? { ...d, ...patch } : d));
    onEditNode(node.id, { dialogue_lines: next }, false);
  };

  return (
    <div className="fm-node-doc-editor">
      <header className="fm-node-doc-head">
        <div className="fm-node-doc-title-wrap">
          <span className="fm-md-kind-pill">画布节点 · {node.type}</span>
          <input
            aria-label="画布节点标题"
            value={node.title}
            maxLength={80}
            onChange={(e) =>
              onEditNode(node.id, { title: e.target.value }, false)
            }
          />
        </div>
        <div className="fm-node-doc-actions">
          {scriptDocId && (
            <button
              type="button"
              className="secondary"
              onClick={() => onOpenLinkedScript(scriptDocId, scriptLine)}
            >
              <FileText size={14} />
              查看源剧本 {scriptAnchor ? `(${scriptAnchor})` : ""}
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => onFocusCanvasNode(node.id)}
          >
            <Crosshair size={14} />
            在画布上聚焦
          </button>
        </div>
      </header>

      <div className="fm-node-doc-scroll">
        {resolved.media && (
          <div className="fm-node-doc-media">
            {node.type === "video" ? (
              <video src={`/media/${resolved.media}`} controls playsInline />
            ) : (
              <img src={`/media/${resolved.media}`} alt={node.title} />
            )}
          </div>
        )}

        {incomingNodes.length > 0 && (
          <section className="fm-node-doc-section">
            <h4>上游连线参考（{incomingNodes.length}）</h4>
            <div className="fm-node-doc-refs">
              {incomingNodes.map((ref) => {
                const refMedia = resolveNode(ref, runs).media;
                return (
                  <button
                    key={ref.id}
                    type="button"
                    className="fm-node-doc-ref-chip"
                    onClick={() => onFocusCanvasNode(ref.id)}
                  >
                    {refMedia ? (
                      <img src={`/media/${refMedia}`} alt="" />
                    ) : (
                      <Type size={13} />
                    )}
                    <span>{ref.title}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section className="fm-node-doc-section">
          <h4>{isTextKind ? "节点文本内容（与画布实时双向同步）" : "生成提示词 Prompt"}</h4>
          <textarea
            rows={7}
            maxLength={12000}
            value={isTextKind ? node.text : node.prompt}
            placeholder={
              isTextKind
                ? "输入连接到下游图片/视频节点的剧本提示词…"
                : "输入该节点的画面与镜头描述…"
            }
            onChange={(e) =>
              onEditNode(
                node.id,
                isTextKind
                  ? { text: e.target.value }
                  : { prompt: e.target.value },
                false,
              )
            }
          />
        </section>

        {node.type === "video" && (
          <>
            <section className="fm-node-doc-section">
              <h4>导演摄影参数</h4>
              <div className="fm-node-cine-grid">
                <label>
                  <span>景别</span>
                  <input
                    value={node.cinematography?.shot_size ?? ""}
                    placeholder="如：特写 / 中近景 / 全景"
                    onChange={(e) => updateCine({ shot_size: e.target.value })}
                  />
                </label>
                <label>
                  <span>机位角度</span>
                  <input
                    value={node.cinematography?.camera_angle ?? ""}
                    placeholder="如：平视 / 过肩 / 俯拍"
                    onChange={(e) =>
                      updateCine({ camera_angle: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span>运镜方式</span>
                  <input
                    value={node.cinematography?.camera_movement ?? ""}
                    placeholder="如：缓推 / 跟拍 / 固定"
                    onChange={(e) =>
                      updateCine({ camera_movement: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span>光影氛围</span>
                  <input
                    value={node.cinematography?.lighting ?? ""}
                    placeholder="如：戏剧暖光 / 暗调冷光"
                    onChange={(e) => updateCine({ lighting: e.target.value })}
                  />
                </label>
              </div>
            </section>

            <section className="fm-node-doc-section">
              <div className="fm-sync-section-head">
                <h4>角色对白轨道（{dialogues.length} 条）</h4>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    onEditNode(node.id, {
                      dialogue_lines: [
                        ...dialogues,
                        {
                          id: `dlg_${crypto.randomUUID().slice(0, 8)}`,
                          speaker: "角色",
                          text: "",
                        },
                      ],
                    })
                  }
                >
                  <Plus size={13} />
                  添加对白
                </button>
              </div>
              {dialogues.map((dlg, idx) => (
                <div key={dlg.id} className="fm-node-dlg-row">
                  <input
                    className="fm-dlg-speaker-input"
                    value={dlg.speaker}
                    placeholder="角色名"
                    maxLength={40}
                    onChange={(e) =>
                      updateDialogue(idx, { speaker: e.target.value })
                    }
                  />
                  <input
                    className="fm-dlg-text-input"
                    value={dlg.text}
                    placeholder="台词内容"
                    maxLength={300}
                    onChange={(e) =>
                      updateDialogue(idx, { text: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="移除该条对白"
                    onClick={() =>
                      onEditNode(node.id, {
                        dialogue_lines: dialogues.filter((_, i) => i !== idx),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </section>

            <section className="fm-node-doc-section">
              <h4>旁白 / 字幕文案</h4>
              <textarea
                rows={3}
                maxLength={300}
                value={node.narration_text ?? ""}
                placeholder="输入该镜头的旁白配音或字幕文本…"
                onChange={(e) =>
                  onEditNode(
                    node.id,
                    { narration_text: e.target.value },
                    false,
                  )
                }
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
