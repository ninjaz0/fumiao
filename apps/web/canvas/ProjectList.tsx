import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Copy,
  LayoutGrid,
  Plus,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { api, workspaceURL, type Studio } from "./api";

type Project = {
  id: string;
  title: string;
  count: number;
  updated: number;
  covers?: { id: string; type: "image" | "video" }[];
  can_delete: boolean;
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
export default function ProjectList({ studio }: { studio: Studio }) {
  const workspace = String(studio.workspace_id);
  const [projects, setProjects] = useState<Project[]>([]),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deleteBusy, setDeleteBusy] = useState(false),
    [deleteError, setDeleteError] = useState(""),
    [deleting, setDeleting] = useState<Project | null>(null);
  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleting(null);
    setDeleteError("");
  };
  const load = useCallback(
    () =>
      api<{ projects: Project[] }>(workspace, "/api/canvases")
        .then((r) => {
          setProjects(r.projects);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false)),
    [workspace],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const p = await api<{ id: string }>(workspace, "/api/canvases", {});
      location.assign(workspaceURL("/canvas/" + p.id, workspace));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const duplicate = async (p: Project) => {
    setBusy(true);
    try {
      const next = await api<{ id: string }>(
        workspace,
        `/api/canvases/${p.id}/duplicate`,
        {},
      );
      location.assign(workspaceURL("/canvas/" + next.id, workspace));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
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
        <span>{studio.me.nickname || studio.me.name}</span>
      </header>
      <div className="project-list-body">
        <div className="project-list-heading">
          <h1>画布</h1>
          <button className="primary" disabled={busy} onClick={() => create()}>
            <Plus size={18} />
            新建画布
          </button>
        </div>
        {projects.length > 0 && (
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
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <div className="empty">正在加载画布</div>
        ) : !projects.length ? (
          <div className="project-empty">
            <LayoutGrid size={40} />
            <h2>从一张画布开始</h2>
            <button
              className="secondary"
              onClick={() => create()}
              disabled={busy}
            >
              新建画布
            </button>
          </div>
        ) : (
          <div className="project-grid">
            {projects
              .filter((p) =>
                p.title.toLowerCase().includes(search.toLowerCase()),
              )
              .map((p) => (
                <article className="project-card" key={p.id}>
                  <a
                    href={workspaceURL("/canvas/" + p.id, workspace)}
                    className="project-cover"
                    aria-label={"打开画布 " + p.title}
                  >
                    {p.covers?.length ? (
                      <div className={"cover-grid count-" + p.covers.length}>
                        {p.covers.map((c) =>
                          c.type === "video" ? (
                            <video
                              key={c.id}
                              src={"/media/" + c.id + "#t=0.05"}
                              muted
                              preload="metadata"
                            />
                          ) : (
                            <img
                              key={c.id}
                              src={"/media/" + c.id}
                              alt=""
                              loading="lazy"
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
                        {p.count} 个节点 ·{" "}
                        {new Date(p.updated * 1000).toLocaleDateString()}
                      </span>
                    </a>
                    <div className="project-actions">
                      <IconButton
                        icon={Copy}
                        label={"复制画布 " + p.title}
                        onClick={() => duplicate(p)}
                        disabled={busy}
                      />
                      {p.can_delete && (
                        <IconButton
                          icon={Trash2}
                          label={"删除画布 " + p.title}
                          onClick={() => {
                            setDeleteError("");
                            setDeleting(p);
                          }}
                        />
                      )}
                    </div>
                  </div>
                </article>
              ))}
          </div>
        )}
      </div>
      {deleting && (
        <Modal
          title={"删除“" + deleting.title + "”？"}
          onClose={closeDelete}
        >
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
                  setDeleting(null);
                  await load();
                } catch (e) {
                  setDeleteError((e as Error).message);
                } finally {
                  setDeleteBusy(false);
                }
              }}
            >
              删除画布
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
