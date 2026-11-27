import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Copy,
  Ellipsis,
  LayoutGrid,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { api, ApiError, workspaceURL, type Studio } from "./api";

import { PluginImport } from "../studio/PluginImport";
import { VideoThumb } from "../canvas-editor/VideoThumb";
import { SeriesTree } from "./SeriesTree";

const COVER_VIDEO_PLACEHOLDER_STYLE = {
  display: "block",
  width: "100%",
  height: "100%",
  background: "#111",
} as const;

type Project = {
  id: string;
  title: string;
  count: number;
  updated: number;
  archived_at: number | null;
  covers?: { id: string; type: "image" | "video" }[];
  can_delete: boolean;
};

type ArchiveNotice = {
  project: Project;
  archived: boolean;
  undoToken: string | null;
};

// The markup and interactions are from the pinned canvas bundle's ProjectList.
function IconButton({
  icon: Icon,
  label,
  ...props
}: {
  icon: LucideIcon;
  label: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="icon-button "
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon size={18} />
    </button>
  );
}

function ProjectActions({
  project,
  archived,
  opening,
  copying,
  pending,
  busy,
  onCopy,
  onArchive,
  onDelete,
}: {
  project: Project;
  archived: boolean;
  opening: boolean;
  copying: boolean;
  pending: boolean;
  busy: boolean;
  onCopy: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => {
    trigger.current?.focus();
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const restore = archived && project.can_delete;
  return (
    <div className="project-actions canvas-card-actions" ref={root}>
      <IconButton
        icon={
          restore
            ? pending
              ? LoaderCircle
              : ArchiveRestore
            : copying
              ? LoaderCircle
              : Copy
        }
        label={(restore ? "恢复画布 " : "复制画布 ") + project.title}
        onClick={
          restore
            ? () => {
                if (!busy) onArchive();
              }
            : onCopy
        }
        disabled={opening}
        aria-disabled={restore && busy}
        aria-busy={restore ? pending : copying}
      />
      {project.can_delete && (
        <button
          ref={trigger}
          type="button"
          className="icon-button"
          title="更多操作"
          aria-label={"更多操作 " + project.title}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-busy={!archived && pending}
          disabled={opening}
          aria-disabled={busy}
          onClick={() => {
            if (!busy) setOpen(!open);
          }}
        >
          {!archived && pending ? (
            <LoaderCircle size={18} />
          ) : (
            <Ellipsis size={18} />
          )}
        </button>
      )}
      {open && (
        <div
          className="cv-menu canvas-card-menu"
          role="menu"
          aria-label={project.title + "的操作"}
          ref={menu}
          onBlur={(e) => {
            if (
              e.relatedTarget !== trigger.current &&
              !e.currentTarget.contains(e.relatedTarget as Node)
            )
              setOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
              return;
            }
            const items = Array.from(
              e.currentTarget.querySelectorAll("button"),
            );
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              e.key === "ArrowDown"
                ? (index + 1) % items.length
                : e.key === "ArrowUp"
                  ? (index + items.length - 1) % items.length
                  : e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? items.length - 1
                      : -1;
            if (next >= 0) {
              e.preventDefault();
              items[next].focus();
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              if (archived) onCopy();
              else onArchive();
            }}
          >
            {archived ? <Copy size={16} /> : <Archive size={16} />}
            {archived ? "复制" : "归档"}
          </button>
          <div className="menu-divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="canvas-card-delete"
            onClick={() => {
              close();
              onDelete();
            }}
          >
            <Trash2 size={16} /> 删除
          </button>
        </div>
      )}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="cv-dialog "
      onCancel={(e) => {
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
export default function ProjectList({
  studio,
  workspaceChanged,
}: {
  studio: Studio;
  workspaceChanged: boolean;
}) {
  const workspace = String(studio.workspace_id);
  const workspaceName = studio.workspaces?.find(
    ({ id }) => id === studio.workspace_id,
  )?.name;
  const [archivedView, setArchivedView] = useState(
    () =>
      new URLSearchParams(location.search).getAll("view").at(-1) === "archived",
  );
  const view = useRef(archivedView);
  const loadedView = useRef<boolean | null>(null);
  const loadSequence = useRef(0);
  const archiveLock = useRef(false);
  const tabs = useRef<HTMLDivElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const [archivePending, setArchivePending] = useState<string | null>(null);
  const [notice, setNotice] = useState<ArchiveNotice | null>(null);
  const [projects, setProjects] = useState<Project[]>([]),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [opening, setOpening] = useState<
      { kind: "create" } | { kind: "copy"; id: string } | null
    >(null),
    [error, setError] = useState(""),
    [deleteBusy, setDeleteBusy] = useState(false),
    [deleteError, setDeleteError] = useState(""),
    [deleting, setDeleting] = useState<Project | null>(null);
  const copying = opening?.kind === "copy" ? opening.id : null;
  const query = search.trim().toLowerCase();
  const [loadError, setLoadError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const noticeUndo = notice?.undoToken;
  const noticeText = notice
    ? `${notice.archived ? "已归档" : "已恢复"}「${notice.project.title}」`
    : "";
  const visibleProjects = query
    ? projects.filter((p) => p.title.trim().toLowerCase().includes(query))
    : projects;
  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleting(null);
    setDeleteError("");
  };
  const load = useCallback(
    async (showLoading = true) => {
      const sequence = ++loadSequence.current;
      const requestedView = view.current;
      const background = !showLoading && loadedView.current === requestedView;
      if (!background) setLoading(true);
      setLoadError("");
      setRefreshError("");
      try {
        const result = await api<{ projects: Project[] }>(
          workspace,
          requestedView ? "/api/canvases?view=archived" : "/api/canvases",
        );
        if (sequence === loadSequence.current) {
          loadedView.current = requestedView;
          setProjects(result.projects);
        }
      } catch (error) {
        if (sequence === loadSequence.current) {
          const message = (error as Error).message;
          if (background) setRefreshError(message);
          else setLoadError(message);
        }
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [workspace],
  );
  const selectView = useCallback(
    (archived: boolean, updateUrl = true) => {
      if (archived === view.current) return;
      view.current = archived;
      setArchivedView(archived);
      setError("");
      if (updateUrl) {
        const url = new URL(location.href);
        if (archived) url.searchParams.set("view", "archived");
        else url.searchParams.delete("view");
        history.pushState(null, "", url);
      }
      void load();
    },
    [load],
  );
  useEffect(() => {
    void load();
    const onPopState = () =>
      selectView(
        new URLSearchParams(location.search).getAll("view").at(-1) ===
          "archived",
        false,
      );
    window.addEventListener("popstate", onPopState);
    return () => {
      loadSequence.current++;
      loadedView.current = null;
      window.removeEventListener("popstate", onPopState);
    };
  }, [load, selectView]);
  const focusSelectedTab = useCallback(() => {
    tabs.current
      ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?.focus({ preventScroll: true });
  }, []);
  const dismissNotice = () => {
    setNotice(null);
    focusSelectedTab();
  };
  useEffect(() => {
    if (notice && document.activeElement === document.body) {
      if (undoButton.current) undoButton.current.focus({ preventScroll: true });
      else focusSelectedTab();
    }
  }, [notice, focusSelectedTab]);
  const changeArchive = async (
    p: Project,
    archived: boolean,
    undoToken?: string,
  ) => {
    if (archiveLock.current || opening) return;
    archiveLock.current = true;
    setArchivePending(p.id);
    setError("");
    try {
      const query = undoToken
        ? `?expected_archive_change=${encodeURIComponent(undoToken)}`
        : "";
      const result = await api<{
        archived_at: number | null;
        undo_token: string | null;
      }>(
        workspace,
        `/api/canvases/${p.id}/archive${query}`,
        undefined,
        archived ? "PUT" : "DELETE",
      );
      const next = result.archived_at !== null;
      if (view.current !== next)
        setProjects((rows) => rows.filter((row) => row.id !== p.id));
      setNotice({ project: p, archived: next, undoToken: result.undo_token });
      void load(false);
    } catch (error) {
      setError((error as Error).message);
      if (
        undoToken &&
        error instanceof ApiError &&
        [404, 409].includes(error.status)
      ) {
        setNotice((current) =>
          current?.undoToken === undoToken ? null : current,
        );
        if (document.activeElement === undoButton.current) focusSelectedTab();
        void load(false);
      }
    } finally {
      archiveLock.current = false;
      setArchivePending(null);
    }
  };
  const create = async () => {
    if (opening) return;
    setOpening({ kind: "create" });
    setError("");
    try {
      const p = await api<{ id: string }>(workspace, "/api/canvases", {});
      location.assign(workspaceURL("/canvas/" + p.id, workspace));
    } catch (e) {
      setError((e as Error).message);
      setOpening(null);
    }
  };
  const duplicate = async (p: Project) => {
    if (opening) return;
    setOpening({ kind: "copy", id: p.id });
    setError("");
    try {
      const next = await api<{ id: string }>(
        workspace,
        `/api/canvases/${p.id}/duplicate`,
        {},
      );
      location.assign(workspaceURL("/canvas/" + next.id, workspace));
    } catch (e) {
      setError((e as Error).message);
      setOpening(null);
    }
  };
  return (
    <main className="project-list">
      <header className="list-header">
        <div>
          <a
            className="cv-brand"
            href={workspaceURL("/studio", workspace)}
            title="返回工作台"
            aria-label="返回工作台"
          >
            <img src="/static/mark.svg" alt="弗淼 AIGC" />
          </a>
          <a href={workspaceURL("/studio", workspace)} className="back-link">
            <ArrowLeft size={16} />
            工作台
          </a>
        </div>
        <span>
          {[workspaceName, studio.me.nickname || studio.me.name]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </header>
      <div className="project-list-body">
        {workspaceChanged && (
          <p role="status">
            无法进入原工作区，已打开
            {workspaceName ? `「${workspaceName}」` : "可访问的工作区"}。
          </p>
        )}
        <div className="project-list-heading">
          <h1>画布</h1>
          <PluginImport
            key={workspace}
            entries={studio.plugin_importers}
            target="canvas"
            workspace={workspace}
            onImported={({ canvas }) => {
              if (canvas)
                location.assign(
                  workspaceURL("/canvas/" + canvas.id, workspace),
                );
            }}
          />
          <button
            className="primary"
            disabled={!!opening}
            aria-label="新建画布"
            aria-busy={opening?.kind === "create"}
            onClick={() => create()}
          >
            <Plus size={18} />
            {opening?.kind === "create" ? "正在新建…" : "新建画布"}
          </button>
        </div>
        <SeriesTree workspace={workspace} />
        <div className="canvas-list-toolbar">
          <div>
            {(projects.length > 0 || search) && (
              <div className="list-search">
                <Search size={17} />
                <input
                  aria-label="搜索画布"
                  placeholder="搜索画布"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}
          </div>
          <div
            className="canvas-list-tabs"
            ref={tabs}
            role="tablist"
            aria-label="画布列表视图"
          >
            {[false, true].map((archived) => (
              <button
                key={String(archived)}
                id={archived ? "archived-canvases-tab" : "current-canvases-tab"}
                type="button"
                role="tab"
                tabIndex={archivedView === archived ? 0 : -1}
                aria-selected={archivedView === archived}
                aria-controls="canvas-list-results"
                onClick={() => selectView(archived)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                    return;
                  event.preventDefault();
                  const next = archived
                    ? event.currentTarget.previousElementSibling
                    : event.currentTarget.nextElementSibling;
                  if (next instanceof HTMLButtonElement) next.focus();
                  selectView(!archived);
                }}
              >
                {archived ? "已归档" : "当前"}
              </button>
            ))}
          </div>
        </div>
        <div
          id="canvas-list-results"
          role="tabpanel"
          aria-labelledby={
            archivedView ? "archived-canvases-tab" : "current-canvases-tab"
          }
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {refreshError && (
            <div className="canvas-list-refresh-error">
              <p className="error" role="alert">
                刷新画布列表失败。{refreshError}
              </p>
              <button className="secondary" onClick={() => void load(false)}>
                重试刷新
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty" role="status">
              正在加载画布…
            </div>
          ) : loadError ? (
            <div className="project-empty">
              <h2>画布列表暂时无法加载</h2>
              <p className="error" role="alert">
                {loadError}
              </p>
              <button className="secondary" onClick={() => void load()}>
                重试
              </button>
            </div>
          ) : !projects.length ? (
            <div className="project-empty">
              {archivedView ? <Archive size={40} /> : <LayoutGrid size={40} />}
              <h2>{archivedView ? "暂无已归档画布" : "暂无画布"}</h2>
              {archivedView && (
                <p>归档的画布会显示在这里，仍可通过原链接打开和编辑。</p>
              )}
            </div>
          ) : !visibleProjects.length ? (
            <div className="project-empty">
              <Search size={40} />
              <h2>
                {archivedView ? "已归档中没有匹配的画布" : "没有找到匹配的画布"}
              </h2>
              <button className="secondary" onClick={() => setSearch("")}>
                清除搜索
              </button>
            </div>
          ) : (
            <div className="project-grid">
              {visibleProjects.map((p) => (
                <article
                  className="project-card"
                  data-archived={archivedView || undefined}
                  key={p.id}
                >
                  <a
                    href={workspaceURL("/canvas/" + p.id, workspace)}
                    className="project-cover"
                    aria-label={"打开画布 " + p.title}
                  >
                    {p.covers?.length ? (
                      <div className={"cover-grid count-" + p.covers.length}>
                        {p.covers.map((c) =>
                          c.type === "video" ? (
                            <VideoThumb
                              key={c.id}
                              mediaId={c.id}
                              placeholderStyle={COVER_VIDEO_PLACEHOLDER_STYLE}
                            />
                          ) : (
                            <img
                              key={c.id}
                              src={"/media/" + c.id}
                              alt=""
                              loading="lazy"
                              decoding="async"
                            />
                          ),
                        )}
                      </div>
                    ) : (
                      <LayoutGrid size={32} />
                    )}
                  </a>
                  <div className="project-card-info">
                    <a href={workspaceURL("/canvas/" + p.id, workspace)}>
                      <strong>{p.title}</strong>
                      <span>
                        {p.count} 个节点 · {archivedView && "归档于 "}
                        {new Date(
                          (p.archived_at ?? p.updated) * 1000,
                        ).toLocaleDateString()}
                      </span>
                    </a>
                    <ProjectActions
                      project={p}
                      archived={archivedView}
                      opening={!!opening}
                      copying={copying === p.id}
                      pending={archivePending === p.id}
                      busy={archivePending !== null}
                      onCopy={() => void duplicate(p)}
                      onArchive={() => void changeArchive(p, !archivedView)}
                      onDelete={() => {
                        setDeleteError("");
                        setDeleting(p);
                      }}
                    />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
      <span className="canvas-list-announcement" role="status">
        {noticeText}
      </span>
      {notice && (
        <div
          className="canvas-toast canvas-list-toast"
          onKeyDown={(event) => {
            if (event.key === "Escape") dismissNotice();
          }}
        >
          <span aria-hidden="true">{noticeText}</span>
          {noticeUndo && (
            <button
              type="button"
              className="canvas-list-undo"
              ref={undoButton}
              aria-disabled={archivePending !== null || !!opening}
              onClick={() =>
                void changeArchive(
                  notice.project,
                  !notice.archived,
                  noticeUndo,
                )
              }
            >
              撤销
            </button>
          )}
          <IconButton icon={X} label="关闭归档提示" onClick={dismissNotice} />
        </div>
      )}
      {deleting && (
        <Modal title={"删除“" + deleting.title + "”？"} onClose={closeDelete}>
          <p>素材和已经提交的任务会保留。</p>
          {deleteError && (
            <p className="error" role="alert">
              {deleteError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="secondary"
              disabled={deleteBusy}
              onClick={closeDelete}
            >
              取消
            </button>
            <button
              className="primary danger"
              disabled={deleteBusy}
              aria-label="删除画布"
              aria-busy={deleteBusy}
              onClick={async () => {
                if (deleteBusy) return;
                setDeleteBusy(true);
                setDeleteError("");
                try {
                  await api(
                    workspace,
                    `/api/canvases/${deleting.id}`,
                    undefined,
                    "DELETE",
                  );
                  setNotice((current) =>
                    current?.project.id === deleting.id ? null : current,
                  );
                  setDeleting(null);
                  await load();
                } catch (e) {
                  setDeleteError((e as Error).message);
                } finally {
                  setDeleteBusy(false);
                }
              }}
            >
              {deleteBusy ? "正在删除…" : "删除画布"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
