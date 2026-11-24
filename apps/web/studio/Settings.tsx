import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { AdminRequest, AdminOpen, AdminConfirm } from "./settings-admin";
import { api } from "./api";
import { openDialogFor } from "./AssetDialog";
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
import { PluginPage, pluginPageClient } from "./PluginPage";
import { PluginPanel } from "./PluginPanel";
import { Members } from "./SettingsMembers";
import { ModelSettings, type ModelSettingsPreferences } from "./SettingsModels";
import { PluginSettings } from "./SettingsPlugins";
import { PriceSettings } from "./SettingsPrices";
import { ChatSettings, OpenAISettings } from "./SettingsServices";
import { SettingsShell } from "./SettingsShell";
import { StorageSettings } from "./SettingsStorage";
import { Workspaces } from "./SettingsWorkspaces";
import type { Member, Space, StudioState } from "./state";
import {
  extensionTab,
  pluginTab,
  resolvePluginTab,
  type SettingsTab,
} from "./settings-tabs";
import { PluginSettingsPage } from "./PluginSettingsPage";
import { SettingsApiTokens } from "./SettingsApiTokens";
import { SettingsObservability } from "./SettingsObservability";
import { SettingsBudgets } from "./SettingsBudgets";
import { SettingsRedeem } from "./SettingsRedeem";

const adminTabs = [
  ["observability", "运营大盘", "sliders", "billing"],
  ["plugins", "插件", "link", "services"],
  ["models", "模型管理", "model", "services"],
  ["prices", "生成定价", "sliders", "billing"],
  ["creditAdmin", "积分管理", "drive", "billing"],
  ["redeemAdmin", "兑换码", "drive", "billing"],
  ["openai", "OpenAI", "picture", "services"],
  ["chatService", "对话服务", "chat", "services"],
  ["workspaces", "团队空间", "library", "organization"],
  ["team", "成员管理", "team", "organization"],
  ["invites", "邀请码", "link", "organization"],
  ["storage", "存储空间", "drive", "organization"],
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
      <p className="console-description">选择工作台的外观主题。</p>
      <div className="ledger-card ledger-appearance">
        <h3>外观主题</h3>
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
                <span className="ledger-theme-swatch" aria-hidden="true" />
                <strong>{theme === "dark" ? "深色模式" : "浅色模式"}</strong>
                {selected && <small>当前使用</small>}
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
  tab: requestedTab,
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

  const pages = state.plugin_pages?.filter(
    (page) => admin || page.audience === "member",
  );
  const legacyPanel = admin && !!state.gpu_node_settings;
  const forms = admin ? (state.settings_pages ?? []) : [];
  const titles = [
    ...(pages?.map((p) => p.title) ?? [state.gpu_node_settings?.title]),
    ...forms.map((p) => p.title),
  ];
  const sections = [
    ["profile", "个人资料", "account", "account"],
    ["general", "常规", "settings", "account"],
    ["credits", "积分", "drive", "account"],
    ["budgets", "预算与风控", "sliders", "account"],
    ["apiTokens", "API 与 MCP", "link", "account"],
    ...(!pages && legacyPanel && state.gpu_node_settings
      ? [["gpu", state.gpu_node_settings.title, "gpu", "account"] as const]
      : []),
    ...forms.map(
      (page) =>
        [
          extensionTab(page),
          titles.filter((title) => title === page.title).length > 1
            ? page.title + " · " + page.label + " (" + page.plugin + ")"
            : page.title,
          "settings",
          "extensions",
        ] as const,
    ),
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
    ...(pages ?? []).map(
      (page) =>
        [
          pluginTab(page),
          titles.filter((title) => title === page.title).length > 1
            ? page.title + " · " + page.plugin + " (" + page.page + ")"
            : page.title,
          page.icon,
          page.legacy ? "account" : page.group,
        ] as const,
    ),
  ] as const;
  const resolved = resolvePluginTab(requestedTab, pages, legacyPanel);
  const tab = sections.some(([key]) => key === resolved)
    ? resolved
    : admin && state.studio_plugins
      ? "plugins"
      : "profile";
  useEffect(() => {
    if (requestedTab !== tab) navigate(tab);
  }, [requestedTab, tab, navigate]);
  const selected = pages?.find((page) => pluginTab(page) === tab);
  const legacy = pages?.find((page) => page.legacy);
  const plugin = selected?.plugin,
    pageId = selected?.page;
  const client = useMemo(
    () =>
      plugin && pageId
        ? pluginPageClient(workspace, plugin, pageId)
        : undefined,
    [workspace, plugin, pageId],
  );
  const extension = forms.find((p) => extensionTab(p) === tab);
  return (
    <SettingsShell
      state={state}
      tab={tab}
      sections={sections}
      legacyTab={legacy && pluginTab(legacy)}
      navigate={(key) => {
        ++request.current;
        navigate(key);
      }}
    >
      {admin && (
        <PriceSettings
          key={`${state.me.id}:${workspace}`}
          visible={tab === "prices"}
          state={state}
          request={adminRequest}
          refresh={refresh}
          notify={notify}
        />
      )}
      {tab !== "prices" && <div className="settings-content" key={visit}>
        {extension && (
          <PluginSettingsPage
            key={tab}
            page={extension}
            request={adminRequest}
            refresh={refresh}
            notify={notify}
          />
        )}
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
            key={`${creditState.me.id}:${workspace}`}
            state={creditState}
            recharge={(button) => void openRecharge("recharge", button)}
            history={(button) => void openRecharge("history", button)}
            refresh={refresh}
            notify={notify}
          />
        )}
        {tab === "budgets" && (
          <SettingsBudgets key={workspace} workspace={workspace} notify={notify} />
        )}
        {tab === "apiTokens" && (
          <SettingsApiTokens
            key={workspace}
            workspace={workspace}
            canEditPolicy={
              admin ||
              state.workspaces.find((w) => w.id === workspace)?.kind ===
                "personal"
            }
            notify={notify}
          />
        )}
        {admin && ((legacyPanel && tab === "gpu") || selected?.legacy) && (
          <PluginPanel
            key={`${state.me.id}:${workspace}:${tab}:${selected?.version ?? ""}`}
            client={client}
            refresh={refresh}
            state={state}
            open={client ? openAdmin : open}
            confirm={confirmAdmin}
            manage={adminRequest}
            notify={notify}
          />
        )}
        {selected && !selected.legacy && client && (
          <PluginPage
            key={`${state.me.id}:${workspace}:${tab}:${selected.version}`}
            page={selected}
            client={client}
            open={openAdmin}
            refresh={refresh}
            notify={notify}
          />
        )}
        {admin && tab === "observability" && (
          <SettingsObservability notify={notify} />
        )}
        {admin && tab === "redeemAdmin" && <SettingsRedeem notify={notify} />}
        {admin && tab === "plugins" && (
          <PluginSettings
            key={workspace}
            workspace={workspace}
            gpuTab={legacy ? pluginTab(legacy) : !pages && legacyPanel ? "gpu" : undefined}
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
            editModels={id => {
              modelPreferences.scope = String(id);
              navigate("models");
            }}
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
      </div>}
    </SettingsShell>
  );
}
