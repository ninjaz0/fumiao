import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { AdminRequest, AdminOpen, AdminConfirm } from "./settings-admin";
import { api } from "./api";
import { openDialogFor } from "./AssetDialog";
import { Icon } from "./Icon";
import {
  Credits,
  readOrder,
  RechargeForm,
  RechargeHistory,
  RechargeOrder,
  type RechargeConfig,
} from "./SettingsCredits";
import { AvatarPicker, PasswordDialog, Profile } from "./SettingsProfile";
import { CreditAdmin } from "./SettingsCreditAdmin";
import { Invites } from "./SettingsInvites";
import { GpuSettings } from "./SettingsGpu";
import { Members } from "./SettingsMembers";
import { ModelSettings, type ModelSettingsPreferences } from "./SettingsModels";
import { PluginSettings } from "./SettingsPlugins";
import { PriceSettings } from "./SettingsPrices";
import { ChatSettings, OpenAISettings } from "./SettingsServices";
import { SettingsShell } from "./SettingsShell";
import { StorageSettings } from "./SettingsStorage";
import { Workspaces } from "./SettingsWorkspaces";
import type { Member, Space, StudioState } from "./state";
import type { SettingsTab } from "./settings-tabs";

const adminTabs = [
  ["plugins", "插件", "link"],
  ["models", "模型管理", "model"],
  ["prices", "生成定价", "sliders"],
  ["creditAdmin", "积分管理", "drive"],
  ["openai", "OpenAI", "picture"],
  ["chatService", "对话服务", "chat"],
  ["workspaces", "团队空间", "library"],
  ["team", "成员管理", "team"],
  ["invites", "邀请码", "link"],
  ["storage", "存储空间", "drive"],
] as const;

function General() {
  const read = () => document.documentElement.dataset.theme === "dark";
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const sync = () => setDark(read());
    window.addEventListener("storage", sync);
    window.addEventListener("fumiao-theme", sync);
    sync();
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("fumiao-theme", sync);
    };
  }, []);
  return (
    <div className="settings-section">
      <h2>常规</h2>
      <div className="setting-row">
        <div className="setting-label">外观</div>
        <div className="theme-choices" role="radiogroup" aria-label="外观">
          {(["light", "dark"] as const).map((theme) => {
            const selected = dark === (theme === "dark");
            return (
              <button
                key={theme}
                role="radio"
                aria-checked={selected}
                data-act="set-theme"
                data-value={theme}
                className={selected ? "selected" : ""}
                onClick={() => window.setFumiaoTheme?.(theme)}
              >
                <Icon name={theme === "dark" ? "moon" : "sun"} />
                {theme === "dark" ? "深色" : "浅色"}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Settings({
  state,
  tab,
  visit,
  draft,
  modelPreferences,
  navigate,
  dialogOpen,
  open,
  saved,
  refresh,
  notify,
  viewLibrary,
  showWorkspace,
  selectWorkspace,
  openAdmin,
  confirmAdmin,
  adminRequest,
}: {
  state: StudioState;
  tab: SettingsTab;
  visit: number;
  draft: RefObject<string | null>;
  modelPreferences: ModelSettingsPreferences;
  navigate: (tab: SettingsTab) => void;
  dialogOpen: boolean;
  open: (body: ReactNode, opener: HTMLElement | null) => void;
  saved: (member: Member) => Promise<void>;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  viewLibrary: () => void;
  showWorkspace: (opener: HTMLButtonElement, space?: Space) => void;
  selectWorkspace: (id: number) => void;
  openAdmin: AdminOpen;
  confirmAdmin: AdminConfirm;
  adminRequest: AdminRequest;
}) {
  const admin = state.me.role === "admin";
  const workspace = state.workspace_id;
  const request = useRef(0);
  const [creditState, setCreditState] = useState(state);
  useLayoutEffect(() => {
    if (!dialogOpen) setCreditState(state);
  }, [dialogOpen, state]);
  useLayoutEffect(
    () => () => {
      ++request.current;
    },
    [workspace, state.me.id],
  );

  function showOrder(
    order: Awaited<ReturnType<typeof readOrder>>,
    opener: HTMLElement | null,
  ) {
    open(
      <RechargeOrder
        key={order.id}
        initial={order}
        state={state}
        refresh={refresh}
        notify={notify}
      />,
      opener,
    );
  }
  async function openOrder(id: string, opener: HTMLButtonElement | null) {
    const version = ++request.current;
    try {
      const order = await readOrder(workspace, id);
      if (version === request.current && (!opener || openDialogFor(opener)))
        showOrder(order, opener);
    } catch (error) {
      if (version === request.current) notify((error as Error).message);
    }
  }
  async function openRecharge(
    kind: "recharge" | "history",
    opener: HTMLButtonElement | null,
  ) {
    const version = ++request.current;
    try {
      const config = await api<RechargeConfig>(
        String(workspace),
        "/api/recharge",
      );
      if (version !== request.current || (opener && !opener.isConnected))
        return;
      open(
        kind === "history" ? (
          <RechargeHistory
            config={config}
            workspace={workspace}
            detail={openOrder}
            notify={notify}
          />
        ) : (
          <RechargeForm
            config={config}
            state={state}
            detail={(order) => showOrder(order, opener)}
          />
        ),
        opener,
      );
    } catch (error) {
      if (version === request.current) notify((error as Error).message);
    }
  }

  useEffect(() => {
    const url = new URL(location.href);
    const returnedOrder = url.searchParams.get("recharge");
    if (!returnedOrder) return;
    url.searchParams.delete("recharge");
    history.replaceState(null, "", url);
    if (returnedOrder === "history") void openRecharge("history", null);
    else void openOrder(returnedOrder, null);
  }, []);

  const sections = [
    ["profile", "个人资料", "account"],
    ["general", "常规", "settings"],
    ["credits", "积分", "drive"],
    ...(!state.studio_plugins || Object.keys(state.gpu_models || {}).length
      ? [
          [
            "gpu",
            state.studio_plugins ? "实例接入" : admin ? "GPU 实例" : "GPU 接入",
            "gpu",
          ] as const,
        ]
      : []),
    ...(admin
      ? adminTabs.filter(([key]) =>
          key === "plugins"
            ? state.studio_plugins
            : key === "openai"
              ? !state.studio_plugins ||
                Boolean(state.model_catalog["gpt-image-2.6-sunburst"])
              : key === "chatService"
                ? !state.studio_plugins ||
                  Object.values(state.model_groups).some(
                    (g) => g.kind === "chat",
                  )
                : true,
        )
      : []),
  ] as const;
  return (
    <SettingsShell
      state={state}
      tab={tab}
      sections={sections}
      navigate={(key) => {
        ++request.current;
        navigate(key);
      }}
    >
      <div className="settings-content" key={visit}>
        {tab === "profile" && (
          <Profile
            state={state}
            draft={draft}
            avatar={(button) =>
              open(
                <AvatarPicker state={state} saved={saved} notify={notify} />,
                button,
              )
            }
            password={(button) =>
              open(
                <PasswordDialog
                  request={(path, body) => api(String(workspace), path, body)}
                  notify={notify}
                />,
                button,
              )
            }
            saved={saved}
            notify={notify}
          />
        )}
        {tab === "general" && <General />}
        {tab === "credits" && (
          <Credits
            key={JSON.stringify([
              creditState.credits,
              creditState.credit_history,
            ])}
            state={creditState}
            recharge={(button) => void openRecharge("recharge", button)}
            history={(button) => void openRecharge("history", button)}
            notify={notify}
          />
        )}
        {tab === "gpu" && (
          <GpuSettings
            key={`${state.me.id}:${workspace}`}
            state={state}
            open={open}
            confirm={confirmAdmin}
            manage={adminRequest}
            notify={notify}
          />
        )}
        {admin && tab === "plugins" && (
          <PluginSettings
            key={workspace}
            workspace={workspace}
            refresh={refresh}
            navigate={navigate}
          />
        )}
        {admin && tab === "models" && (
          <ModelSettings
            state={state}
            preferences={modelPreferences}
            request={adminRequest}
            refresh={refresh}
            notify={notify}
          />
        )}
        {admin && tab === "prices" && (
          <PriceSettings
            state={state}
            request={adminRequest}
            refresh={refresh}
            notify={notify}
          />
        )}
        {admin && tab === "creditAdmin" && state.credit_accounts && (
          <CreditAdmin
            accounts={state.credit_accounts}
            dialogOpen={dialogOpen}
            open={openAdmin}
            request={adminRequest}
            refresh={refresh}
            notify={notify}
          />
        )}
        {admin && tab === "openai" && (
          <OpenAISettings
            key={JSON.stringify(state.images)}
            configured={state.images.configured}
            request={adminRequest}
          />
        )}
        {admin && tab === "chatService" && (
          <ChatSettings request={adminRequest} notify={notify} />
        )}
        {admin && tab === "workspaces" && (
          <Workspaces
            state={state}
            show={showWorkspace}
            select={selectWorkspace}
          />
        )}
        {admin && tab === "team" && (
          <Members
            state={state}
            open={openAdmin}
            confirm={confirmAdmin}
            request={adminRequest}
            refresh={refresh}
            notify={notify}
          />
        )}
        {admin && tab === "invites" && (
          <Invites
            state={state}
            open={openAdmin}
            confirm={confirmAdmin}
            request={adminRequest}
            refresh={refresh}
            notify={notify}
          />
        )}
        {admin && tab === "storage" && (
          <StorageSettings state={state} viewLibrary={viewLibrary} />
        )}
      </div>
    </SettingsShell>
  );
}
