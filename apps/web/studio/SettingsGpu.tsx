import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { api } from "./api";
import { openDialogFor } from "./AssetDialog";
import { Icon } from "./Icon";
import type { AdminConfirm, AdminRequest } from "./settings-admin";
import { H3, type GpuNode, type StudioState } from "./state";

const stages = {
  preparing: "准备模型",
  ready: "就绪",
  busy: "生成中",
  error: "准备失败",
  offline: "离线",
};
const controls = {
  drain: ["完成后下线", "当前任务回传后停止接单。"],
  stop: ["立即断开", "当前任务可能需要重新生成。"],
  resume: ["恢复接单", "实例在线后将继续接单。"],
  remove: ["移除", "此实例的接入凭据将失效。"],
} as const;
const activeActions = ["drain", "stop", "remove"] as const;
const inactiveActions = ["resume", "remove"] as const;
type Operation = keyof typeof controls;

function nodeStatus({ stage, control }: GpuNode) {
  if (stage === "offline") return stages.offline;
  if (control === "paused") return "已暂停";
  if (control === "draining") return "完成后下线";
  return stages[stage];
}

export function GpuSettings({
  state,
  open,
  confirm,
  manage,
  notify,
}: {
  state: StudioState;
  open: (body: ReactNode, opener: HTMLElement) => void;
  confirm: AdminConfirm;
  manage: AdminRequest;
  notify: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const workspace = String(state.workspace_id);
  const admin = state.me.role === "admin";

  async function start(opener: HTMLButtonElement) {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    try {
      const { name } = await api<{ name: string }>(
        workspace,
        "/api/pairs/default-name",
      );
      if (opener.isConnected) {
        const focused = document.activeElement as HTMLElement | null;
        open(
          <PairNode
            suggested={name}
            models={state.gpu_models}
            workspace={workspace}
            notify={notify}
          />,
          (focused?.closest("#popover")
            ? document.querySelector<HTMLElement>(".workspace-switch")
            : focused) || opener,
        );
      }
    } catch (error) {
      if (opener.isConnected) notify((error as Error).message);
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }

  function control(node: GpuNode, operation: Operation, opener: HTMLElement) {
    const [label, detail] = controls[operation];
    const running = state.jobs.find(
      (job) => job.node === node.id && job.status === "running",
    );
    confirm(
      label + "？",
      (running ? `正在生成 #${running.id}。` : "") + detail,
      async () => {
        await manage(`/api/nodes/${node.id}/${operation}`, {});
      },
      opener,
    );
  }

  return (
    <div className="management-view">
      <div className="page-heading">
        <h2>GPU 实例</h2>
        <button
          className="primary"
          data-act="pair"
          disabled={loading}
          onClick={(event) => void start(event.currentTarget)}
        >
          <Icon name="plus" />
          接入GPU实例
        </button>
      </div>
      <div className="list-surface">
        {state.nodes.length ? (
          state.nodes.map((node) => (
            <article className="node-row" key={node.id}>
              <div className="node-heading">
                <span className="node-icon">
                  <Icon name="gpu" />
                </span>
                <h2>{node.name}</h2>
                <span className="node-state">{nodeStatus(node)}</span>
              </div>
              <div className="metadata">
                <span>{node.contributor}</span>
                <span>
                  {(node.models || [H3])
                    .map((model) => state.gpu_models?.[model]?.label || model)
                    .join(" · ")}
                </span>
                {node.profile?.gpu_name && (
                  <span>
                    {`${node.profile.gpu_name} · ${node.profile.vram_gib} GiB`}
                  </span>
                )}
              </div>
              {node.detail &&
                node.stage !== "ready" &&
                node.detail !== "完整模式已就绪" && (
                  <p className="install-detail">{node.detail}</p>
                )}
              {admin && (
                <div className="node-actions">
                  {(node.control === "active"
                    ? activeActions
                    : inactiveActions
                  ).map((operation) => (
                    <button
                      className="quiet-button"
                      data-act="node"
                      data-id={node.id}
                      data-op={operation}
                      key={operation}
                      onClick={(event) =>
                        control(node, operation, event.currentTarget)
                      }
                    >
                      {controls[operation][0]}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))
        ) : (
          <div className="empty-state">暂无接入实例</div>
        )}
      </div>
    </div>
  );
}

type Pairing = { name: string; command: string };

function PairNode({
  suggested,
  models,
  workspace,
  notify,
}: {
  suggested: string;
  models: StudioState["gpu_models"];
  workspace: string;
  notify: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const command = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const dialog = command.current && openDialogFor(command.current);
    if (!dialog) return;
    // The shared dialog retains closed content for transitions. Drop the
    // one-time command as soon as the native dialog closes.
    const clear = () => setPairing(null);
    dialog.addEventListener("close", clear);
    return () => dialog.removeEventListener("close", clear);
  }, [pairing]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const name = String(fields.get("node")).trim();
    pending.current = true;
    setSaving(true);
    try {
      const result = await api<Pairing>(workspace, "/api/pairs", {
        name: name === suggested ? "" : name,
        models: fields.getAll("models"),
      });
      if (openDialogFor(form)) setPairing(result);
    } catch (error) {
      if (openDialogFor(form)) notify((error as Error).message);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify("已复制");
    } catch {
      notify("请选中内容后手动复制");
    }
  }

  if (pairing)
    return (
      <>
        <h2 id="modal-heading">{`接入命令 · ${pairing.name}`}</h2>
        <p>在实例终端运行。30 分钟内有效，限用一次。</p>
        <label className="formlabel">
          <textarea
            className="mono"
            readOnly
            rows={4}
            value={pairing.command}
            ref={command}
          />
        </label>
        <button
          className="primary"
          id="copy"
          onClick={() => void copy(pairing.command)}
        >
          复制
        </button>
      </>
    );

  return (
    <>
      <h2 id="modal-heading">接入GPU实例</h2>
      <form id="pair" onSubmit={submit}>
        <label className="formlabel">
          实例名称
          <input name="node" defaultValue={suggested} required maxLength={45} />
        </label>
        <fieldset className="install-models">
          <legend>安装模型</legend>
          {Object.entries(models || {}).map(([model, spec]) => (
            <label className="check" key={model}>
              <input
                type="checkbox"
                name="models"
                value={model}
                defaultChecked={model === H3}
              />
              {spec.label}
              <small>{`${spec.min_vram_gib} GiB 显存起`}</small>
            </label>
          ))}
        </fieldset>
        <button className="primary" disabled={saving}>
          生成接入命令
        </button>
      </form>
    </>
  );
}
