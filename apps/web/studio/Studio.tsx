"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import Auth from "../auth/Auth";
import { ApiError, workspaceURL } from "../canvas/api";
import { ChatWorkspace } from "../canvas-editor/chat/ChatWorkspace";
import {
  resolveChatConfigTarget,
  resolveChatModelScope,
} from "../canvas-editor/chat/guidance";
import { ImageDetail, JobDetail } from "./AssetDetail";
import {
  AssetDialog,
  type AssetDialogState,
  type DialogContent,
} from "./AssetDialog";
import { PluginImport } from "./PluginImport";
import { Library, isOwner, useLibrary, type LibraryFilter } from "./Library";
import { deleteAssetPrompt } from "./media-metadata";
import type {
  AdminOpen,
  AdminRequest,
  SettingsDialogPresentation,
} from "./settings-admin";
import { api } from "./api";
import {
  Composer,
  useEstimate,
  quoteFromEstimate,
  type ComposerEditor,
  type FlowSourceDisplay,
  type ReferenceDisplay,
  type RequestEstimate,
} from "./Composer";
import {
  ComposerMenuContents,
  composerMenuLabel,
  type ComposerMenu,
} from "./ComposerMenu";
import { History, Queue, kindLabel } from "./History";
import { Icon } from "./Icon";
import {
  HistoryHeading,
  MenuContents,
  Sidebar,
  type Destination,
  type Menu,
} from "./Navigation";
import { Settings } from "./Settings";
import { PluginPage, pluginPageClient } from "./PluginPage";
import { WorkspaceDialog } from "./SettingsWorkspaces";
import { adminSettingsTabs, type SettingsTab } from "./settings-tabs";
import {
  addImages,
  assignFrame,
  checkImages,
  composerFeedback,
  estimateBody,
  ensureModel,
  flowIssue,
  frames,
  generationRequest,
  h3Options,
  hasDraftPacks,
  isH3,
  keepUnavailableDraft,
  imageToVideoDraft,
  loadJob,
  modelAvailable,
  normalizeParams,
  packReferences,
  promptLimit,
  pruneDraftAssets,
  pruneDraftPacks,
  referenceAsset,
  referenceIssue,
  referenceType,
  removeDraftPack,
  resultTab,
  selectedModel,
  submittedDraft,
  syncDraftReferences,
  readDraft,
  readDraftBackup,
  writeDraft,
  writeDraftBackup,
  type Asset,
  type DraftSession,
  type FrameSlot,
  type Pack,
  type Job,
  type Member,
  type Space,
  type StudioState,
} from "./state";
import { reducedMotion, scrollMotion } from "../app/motion";
import "./studio-polish.css";

type Page = Exclude<Destination, "canvas"> | "settings";
type Detail = { job: number } | { image: string };
type StudioMenu = Menu | ComposerMenu;
const stateReadTimeout = 20_000;

function isComposerMenu(menu: StudioMenu): menu is ComposerMenu {
  return menu !== "workspaces" && menu !== "account" && menu !== "detail-more";
}
function sameSpace(before: StudioState, after: StudioState | null) {
  return (
    before.me.id === after?.me.id && before.workspace_id === after.workspace_id
  );
}

export default function Studio({ loadingLogo }: { loadingLogo: string }) {
  const [state, setState] = useState<StudioState | null>(null);
  const [session, setSession] = useState<DraftSession | null>(null);
  const [hasDraftBackup, setHasDraftBackup] = useState(false);
  const [expired, setExpired] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");
  const retryBootstrap = useRef(false);
  const [page, setPage] = useState<Page>("home");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("plugins");
  const [settingsVisit, setSettingsVisit] = useState(0);
  const profileDraft = useRef<string | null>(null);
  const modelPreferences = useRef({ scope: "global", search: "" });
  const settingsDialogVersion = useRef(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editing, setEditing] = useState(false);
  const [referencePicking, setReferencePicking] = useState<{
    page: Page;
    filter: LibraryFilter;
    scroll: number;
  } | null>(null);
  const [detailMenuUsed, setDetailMenuUsed] = useState(false);
  const [dialog, setDialog] = useState<AssetDialogState | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [narrowScreen, setNarrowScreen] = useState(false);
  const [menu, setMenu] = useState<StudioMenu | null>(null);
  const [menuShown, setMenuShown] = useState(false);
  const [menuHidden, setMenuHidden] = useState(true);
  const [menuOpenVersion, setMenuOpenVersion] = useState(0);
  const [accountOpened, setAccountOpened] = useState(false);
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cancelling, setCancelling] = useState<ReadonlySet<number>>(() => new Set());
  const [delta, setDelta] = useState(0);
  const receivedAt = useRef(0);
  const shell = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const menuFocusTarget = useRef<HTMLElement | null>(null);
  const menuTimer = useRef(0);
  const toastTimer = useRef(0);
  const busy = useRef(new Set<string>());
  const editor = useRef<ComposerEditor>(null);
  const referenceContents = useRef<ReferenceDisplay>(null);
  const flowSourceContents = useRef<FlowSourceDisplay>(null);
  const composerMenuAria = useRef<string>(undefined);
  const seenComposerMenus = useRef(new Set<ComposerMenu>());
  const retryIds = useRef(new Map<number, string>());
  const focusEditor = () =>
    view.current?.querySelector<HTMLElement>("#prompt")?.focus();
  const active = useRef<StudioState | null>(null);
  const currentDraft = useRef<DraftSession | null>(null);
  const workspaceId = useRef<string | null>(null);
  const stateRead = useRef(0);
  const pendingStateRead = useRef<{
    version: number;
    controller: AbortController;
  } | null>(null);
  const leaving = useRef(false);
  const assetScroll = useRef(0);
  const viewVersion = useRef(0);
  const onLibraryRead = useRef<((before: StudioState, after: StudioState) => void) | null>(null);
  const scrollAfterRender = useRef<(() => void) | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    setToastVisible(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastVisible(false), 4200);
  }, []);

  const library = useLibrary(state, notify);
  const job =
    detail && "job" in detail
      ? state?.jobs.find(({ id }) => id === detail.job)
      : undefined;
  const image =
    detail && "image" in detail
      ? state?.assets.find(({ id }) => id === detail.image)
      : undefined;

  const studioPage = state?.studio_pages?.find((entry) => entry.key === page);
  const plugin = studioPage?.plugin;
  const pluginPage = studioPage?.page;
  const workspace = state?.workspace_id;
  const pageClient = useMemo(
    () =>
      workspace && plugin && pluginPage
        ? pluginPageClient(workspace, plugin, pluginPage)
        : undefined,
    [workspace, plugin, pluginPage],
  );
  const settingsPage = page === "settings";
  const enteredSettings = useRef(false);
  useEffect(() => {
    if (narrowScreen || settingsPage === enteredSettings.current) return;
    enteredSettings.current = settingsPage;
    setCollapsed(
      settingsPage || localStorage.getItem("fm-sidebar") === "collapsed",
    );
  }, [settingsPage, narrowScreen]);
  const ready = !!state && !!session;
  const showsJobTimes =
    (page === "home" || page === "library" || page === "queue" || !!detail) &&
    !!state?.jobs.some((job) => job.status === "running" || job.status === "queued");
  useEffect(() => {
    if (!showsJobTimes) return;
    const update = () => {
      if (!document.hidden) setDelta((Date.now() - receivedAt.current) / 1000);
    };
    update();
    const clock = window.setInterval(update, 1000);
    return () => clearInterval(clock);
  }, [showsJobTimes]);
  const mobileDrawerOpen = narrowScreen && !collapsed;
  const sidebarPopoverOpen =
    !menuHidden &&
    !!anchor.current &&
    (menu === "account" || menu === "workspaces");
  useLayoutEffect(() => {
    // Let the shell measure the initial composer before moving to the receipt.
    if (!ready) return;
    const url = new URL(location.href);
    if (url.searchParams.get("recharge")) setSettingsTab("credits");
    else if (url.searchParams.has("settings")) {
      const requestedSettings = (url.searchParams.get("settings") ||
        "plugins") as SettingsTab;
      if (requestedSettings === "models") {
        const requestedScope = url.searchParams.get("scope");
        modelPreferences.current.scope =
          requestedScope !== null &&
          (requestedScope === "global" ||
            Boolean(
              active.current?.workspaces.some(
                (space) =>
                  space.kind === "team" && String(space.id) === requestedScope,
              ),
            ))
            ? requestedScope
            : resolveChatModelScope(active.current);
      }
      setSettingsTab(requestedSettings);
      url.searchParams.delete("settings");
      url.searchParams.delete("scope");
      history.replaceState(null, "", url);
    } else {
      const requested = url.searchParams.get("page");
      const entry = active.current?.studio_pages?.find(p => p.key === requested);
      if (entry) setPage(entry.key);
      return;
    }
    setPage("settings");
  }, [ready]);

  useLayoutEffect(() => {
    onLibraryRead.current = (before, after) => {
      if (page !== "library" || detail || library.highlight === null) return;
      const content = ({ jobs, assets, favorites }: StudioState) => [
        jobs.map(({ timing, eta, ...job }) => job),
        assets,
        favorites,
      ];
      if (JSON.stringify(content(before)) !== JSON.stringify(content(after)))
        library.clearHighlight();
    };
    scrollAfterRender.current?.();
    scrollAfterRender.current = null;
  });

  const persist = useCallback((space: StudioState, draft: DraftSession) => {
    writeDraft(space, draft);
    currentDraft.current = draft;
    setSession(draft);
  }, []);

  const closeMenu = useCallback((focus = false) => {
    if (!anchor.current) return;
    if (focus || popover.current?.contains(document.activeElement))
      menuFocusTarget.current?.focus({ preventScroll: true });
    anchor.current = null;
    menuFocusTarget.current = null;
    setMenuShown(false);
    clearTimeout(menuTimer.current);
    if (reducedMotion()) setMenuHidden(true);
    else menuTimer.current = window.setTimeout(() => setMenuHidden(true), 150);
  }, []);

  const refresh = useCallback(
    async () => {
      if (leaving.current) return;
      retryBootstrap.current = false;
      setBootstrapError("");
      const version = ++stateRead.current;
      pendingStateRead.current?.controller.abort();
      const controller = new AbortController();
      pendingStateRead.current = { version, controller };
      // Only an open Studio gives up on a read: nothing retries a slow first load.
      const deadline = active.current
        ? window.setTimeout(
            () => controller.abort(new Error("状态刷新超时，正在重试")),
            stateReadTimeout,
          )
        : undefined;
      try {
        const next = await api<StudioState>(
          workspaceId.current,
          "/api/state",
          undefined,
          "GET",
          controller.signal,
        );
        if (version !== stateRead.current || leaving.current) return;
        const previous = active.current;
        if (
          previous &&
          (previous.me.id !== next.me.id ||
            previous.workspace_id !== next.workspace_id)
        ) {
          leaving.current = true;
          location.replace(workspaceURL("/studio", String(next.workspace_id)));
          return;
        }
        if (previous?.me.role === "admin" && next.me.role !== "admin") {
          modelPreferences.current = { scope: "global", search: "" };
          closeMenu();
          setMenuHidden(true);
          setDialog((current) => (current?.adminOnly ? null : current));
          setSettingsTab((tab) =>
            adminSettingsTabs.some((key) => key === tab) ? "profile" : tab,
          );
        }
        const initialDraft = currentDraft.current || readDraft(next);
        if (!previous) setHasDraftBackup(Boolean(readDraftBackup(next)));
        let livePacks: Map<string, Pack> | null = null;
        if (hasDraftPacks(initialDraft)) {
          try {
            const result = await api<{ packs?: Pack[] }>(
              String(next.workspace_id),
              "/api/asset-packs",
              undefined,
              "GET",
              controller.signal,
            );
            if (Array.isArray(result?.packs)) {
              livePacks = new Map(
                result.packs.map((pack) => [pack.id, pack]),
              );
            }
          } catch {
            // Keep existing pack references when /api/asset-packs fails.
          }
          if (version !== stateRead.current || leaving.current) return;
        }
        const priorDraft = currentDraft.current || initialDraft;
        const prevSpace = previous ?? next;
        const model = selectedModel(priorDraft.draft);
        const changedForm =
          previous &&
          JSON.stringify(previous.model_forms?.[model]) !==
            JSON.stringify(next.model_forms?.[model]);
        const keepUnavailable = model && keepUnavailableDraft(next, priorDraft.draft);
        const normalizedDraft = keepUnavailable
          ? priorDraft.draft
          : ensureModel(
              next,
              changedForm
                ? normalizeParams(next, priorDraft.draft, true)
                : priorDraft.draft,
            );
        const afterPacks = livePacks
          ? pruneDraftPacks(prevSpace, next, priorDraft, livePacks)
          : priorDraft;
        const filteredRefs = priorDraft.refs.filter((id) =>
          referenceAsset(next, id),
        );
        const lostRef = filteredRefs.length !== priorDraft.refs.length;
        const refs = lostRef ? filteredRefs : priorDraft.refs;
        const hasParent = next.jobs.some(({ id }) => id === priorDraft.parent);
        const lostParent = priorDraft.parent !== null && !hasParent;
        const draftChanged =
          normalizedDraft !== priorDraft.draft ||
          afterPacks.draft.packs !== priorDraft.draft.packs ||
          afterPacks.draft.h3ReferenceDraft !==
            priorDraft.draft.h3ReferenceDraft;
        const mergedDraft = draftChanged
          ? {
              ...normalizedDraft,
              packs: afterPacks.draft.packs,
              h3ReferenceDraft: afterPacks.draft.h3ReferenceDraft,
            }
          : priorDraft.draft;
        const nextBase: DraftSession = pruneDraftAssets(
          next,
          mergedDraft !== priorDraft.draft ||
            afterPacks !== priorDraft ||
            lostRef ||
            lostParent
            ? {
                ...afterPacks,
                draft: mergedDraft,
                refs,
                ...(lostParent ? { parent: null, retainedSeed: null } : {}),
              }
            : priorDraft,
          (id) => referenceType(prevSpace, id),
        );
        const nextSession =
          nextBase === priorDraft
            ? priorDraft
            : syncDraftReferences(
                prevSpace,
                next,
                priorDraft,
                nextBase,
                editor.current
                  ? (nextRefs) => editor.current!.reindex(nextRefs)
                  : undefined,
              );
        if (nextSession !== priorDraft) {
          persist(next, {
            ...nextSession,
            submitId: crypto.randomUUID(),
          });
        } else if (!previous) {
          currentDraft.current = priorDraft;
          setSession(priorDraft);
        }
        if (
          previous &&
          JSON.stringify(previous.workspaces) !==
            JSON.stringify(next.workspaces) &&
          anchor.current?.dataset.menu === "workspaces"
        )
          closeMenu();
        workspaceId.current = String(next.workspace_id);
        setDialog((current) => {
          if (current?.content.kind !== "preview" || !current.content.manage)
            return current;
          const previewId = current.content.id;
          return next.assets.some((asset) => asset.id === previewId)
            ? current
            : null;
        });
        if (previous) onLibraryRead.current?.(previous, next);
        active.current = next;
        receivedAt.current = Date.now();
        setDelta(0);
        setState(next);
      } catch (error) {
        if (version !== stateRead.current || leaving.current) return;
        if (error instanceof ApiError && error.status === 401) {
          active.current = null;
          currentDraft.current = null;
          closeMenu();
          setDialog(null);
          setState(null);
          setSession(null);
          setHasDraftBackup(false);
          setExpired(true);
        } else if (
          error instanceof ApiError &&
          error.status === 403 &&
          workspaceId.current
        ) {
          active.current = null;
          currentDraft.current = null;
          closeMenu();
          setDialog(null);
          setState(null);
          setSession(null);
          try {
            const spaces = await api<{ workspace_id: number }>(
              workspaceId.current,
              "/api/workspaces",
            );
            if (version !== stateRead.current) return;
            leaving.current = true;
            location.replace(
              workspaceURL("/studio", String(spaces.workspace_id)),
            );
          } catch (recovery) {
            if (version === stateRead.current)
              notify((recovery as Error).message);
          }
        } else if (!active.current) {
          retryBootstrap.current = true;
          setBootstrapError((error as Error).message);
        } else notify((error as Error).message);
      } finally {
        clearTimeout(deadline);
        if (pendingStateRead.current?.controller === controller)
          pendingStateRead.current = null;
      }
    },
    [closeMenu, notify, persist],
  );

  useEffect(() => {
    const narrow = matchMedia("(max-width:760px)");
    setNarrowScreen(narrow.matches);
    setCollapsed(
      narrow.matches || localStorage.getItem("fm-sidebar") === "collapsed",
    );
    const onNarrow = (event: MediaQueryListEvent) => {
      setNarrowScreen(event.matches);
      if (event.matches) {
        setCollapsed(true);
        closeMenu();
      } else {
        setCollapsed(localStorage.getItem("fm-sidebar") === "collapsed");
      }
    };
    narrow.addEventListener("change", onNarrow);
    const params = new URLSearchParams(location.search);
    workspaceId.current = params.get("workspace");
    sessionStorage.removeItem("fm-invite");
    if (new URLSearchParams(location.hash.slice(1)).has("invite")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    void refresh();
    const poll = window.setInterval(() => {
      if (
        (active.current || retryBootstrap.current) &&
        !document.hidden &&
        !busy.current.has("upload") &&
        pendingStateRead.current?.version !== stateRead.current
      )
        void refresh();
    }, 6000);
    return () => {
      ++stateRead.current;
      pendingStateRead.current?.controller.abort();
      narrow.removeEventListener("change", onNarrow);
      clearInterval(poll);
      clearTimeout(menuTimer.current);
      clearTimeout(toastTimer.current);
    };
  }, [closeMenu, refresh]);

  const requestEstimate = useCallback<RequestEstimate>(
    (body) => api(workspaceId.current, "/api/estimate", body),
    [],
  );
  const estimate = useEstimate(state, session, requestEstimate);

  const positionMenu = useCallback(() => {
    const trigger = anchor.current;
    const element = popover.current;
    if (!trigger?.isConnected || !element) return;
    const box = trigger.getBoundingClientRect();
    const beside = trigger.dataset.menu === "workspaces" && innerWidth > 760;
    const left = Math.min(
      Math.max(12, beside ? box.right + 12 : box.left - 16),
      innerWidth - element.offsetWidth - 12,
    );
    let top = beside ? box.top : box.bottom + 8;
    const above = top + element.offsetHeight > innerHeight - 14;
    if (above) top = Math.max(12, box.top - element.offsetHeight - 8);
    Object.assign(element.style, {
      left: left + "px",
      top: top + "px",
    });
    element.style.setProperty("--motion-popover-x", beside ? "-4px" : "0px");
    element.style.setProperty("--motion-popover-y", beside ? "0px" : above ? "4px" : "-4px");
  }, []);

  useLayoutEffect(() => {
    if (!menu || !menuShown || !anchor.current) return;
    positionMenu();
    const element = popover.current;
    if (
      (isComposerMenu(menu) || menu === "workspaces") &&
      menuFocusTarget.current === anchor.current
    ) {
      const visible = (selector: string) =>
        Array.from(element?.querySelectorAll<HTMLElement>(selector) ?? []).find(
          (control) => control.getClientRects().length > 0,
        );
      const option =
        visible(
          '[aria-selected="true"]:not(:disabled), [role="radio"][aria-checked="true"]:not(:disabled)',
        ) ??
        visible(
          'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"], a[href]',
        ) ?? element;
      option?.focus({ preventScroll: true });
    }
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (event.type === "pointerdown") editor.current?.remember();
      if (
        !element?.contains(target) &&
        !anchor.current?.contains(target)
      )
        closeMenu();
    };
    window.addEventListener("resize", positionMenu);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", positionMenu, true);
    };
  }, [menu, menuShown, menuOpenVersion, closeMenu, positionMenu]);

  function openMenu(kind: StudioMenu, button: HTMLButtonElement, focus = true) {
    if (anchor.current === button) {
      closeMenu();
      return;
    }
    clearTimeout(menuTimer.current);
    anchor.current = button;
    menuFocusTarget.current = focus
      ? button
      : document.activeElement as HTMLElement;
    if (isComposerMenu(kind) && active.current && currentDraft.current) {
      seenComposerMenus.current.add(kind);
      composerMenuAria.current = composerMenuLabel(
        kind,
        active.current,
        currentDraft.current.draft,
      );
    }
    if (kind === "account") setAccountOpened(true);
    if (kind === "detail-more") setDetailMenuUsed(true);
    setMenuHidden(false);
    setMenuShown(true);
    setMenu(kind);
    setMenuOpenVersion((version) => version + 1);
  }

  const leaveStudio = useCallback(
    (leave: (space: StudioState) => void) => {
      const space = active.current;
      if (!space || leaving.current) return;
      if (busy.current.has("upload")) {
        notify("图片正在上传，请稍候切换");
        return;
      }
      if (busy.current.has("submit") || busy.current.has("session")) return;
      const draft = currentDraft.current;
      if (draft) writeDraft(space, draft);
      leaving.current = true;
      leave(space);
    },
    [notify],
  );

  function openCanvas(path = "/canvas") {
    leaveStudio((space) =>
      location.assign(workspaceURL(path, String(space.workspace_id))),
    );
  }

  function followCanvas(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 || event.altKey || event.ctrlKey ||
      event.metaKey || event.shiftKey
    ) return;
    event.preventDefault();
    openCanvas(event.currentTarget.pathname);
  }

  function navigate(destination: Destination | "settings") {
    const space = active.current;
    if (!space || leaving.current) return;
    if (destination === page && !detail && !referencePicking) {
      closeMenu();
      if (mobileDrawerOpen) changeSidebar(true, true);
      return;
    }
    setReferencePicking(null);
    if (destination === "canvas") {
      openCanvas();
      return;
    }
    if (page === "library") assetScroll.current = scrollY;
    library.reset();
    if (destination === "library") library.redrawLibrary();
    showDetail(null);
    if (destination === "settings") setSettingsVisit((visit) => visit + 1);
    if (destination.startsWith("plugin:") || page.startsWith("plugin:")) {
      const url = new URL(location.href);
      if (destination.startsWith("plugin:"))
        url.searchParams.set("page", destination);
      else url.searchParams.delete("page");
      history.replaceState(history.state, "", url);
    }
    setPage(destination);
    scrollAfterRender.current = () => scrollTo({ top: 0, behavior: "instant" });
  }

  function openSettingsDialog(
    body: ReactNode,
    opener: HTMLElement | null,
    adminOnly = false,
    presentation?: SettingsDialogPresentation,
  ) {
    if (leaving.current || !active.current) return;
    closeMenu();
    setMenuHidden(true);
    const version = ++settingsDialogVersion.current;
    setDialog((current) => ({
      content: { kind: "settings", body, version, presentation },
      opener: current ? current.opener : opener,
      adminOnly,
    }));
  }

  const saveProfile = useCallback(async (member: Member) => {
    const space = active.current;
    if (leaving.current || space?.me.id !== member.id) return;
    const next = { ...space, me: member };
    active.current = next;
    setState(next);
    await refresh();
  }, [refresh]);

  const adminRequest: AdminRequest = useCallback(
    async (path, body, method) => {
      try {
        return await api(workspaceId.current, path, body, method);
      } catch (error) {
        if (error instanceof ApiError && [401, 403].includes(error.status))
          void refresh();
        throw error;
      }
    },
    [refresh],
  );

  const openAdminDialog: AdminOpen = (body, opener, presentation) => {
    if (active.current?.me.role === "admin")
      openSettingsDialog(body, opener, true, presentation);
  };

  function showWorkspace(opener: HTMLButtonElement, space?: Space) {
    const current = active.current;
    if (!current || current.me.role !== "admin") return;
    openAdminDialog(
      <WorkspaceDialog
        state={current}
        space={space}
        request={adminRequest}
        refresh={refresh}
        notify={notify}
      />,
      opener,
    );
  }

  function confirmAdmin(
    title: string,
    summary: string,
    run: () => Promise<void>,
    opener: HTMLElement,
  ) {
    if (active.current?.me.role !== "admin") return;
    showDialog(
      {
        kind: "confirm",
        title,
        summary,
        run: async () => {
          await run();
          void refresh();
        },
      },
      opener,
      true,
    );
  }

  function showDetail(next: Detail | null) {
    ++viewVersion.current;
    closeMenu();
    library.clearHighlight();
    setDetail(next);
    setEditing(false);
    setDetailMenuUsed(false);
  }

  function changeSidebar(nextCollapsed: boolean, moveFocus: boolean) {
    setCollapsed(nextCollapsed);
    localStorage.setItem("fm-sidebar", nextCollapsed ? "collapsed" : "expanded");
    closeMenu();
    if (moveFocus)
      requestAnimationFrame(() =>
        shell.current
          ?.querySelector<HTMLButtonElement>(
            nextCollapsed ? ".expand-button" : ".collapse-button",
          )
          ?.focus({ preventScroll: true }),
      );
  }

  function collapse(event: MouseEvent<HTMLButtonElement>) {
    changeSidebar(
      !collapsed,
      narrowScreen || event.currentTarget.matches(":focus-visible"),
    );
  }

  async function mutate(key: string, action: () => Promise<void>) {
    if (leaving.current || busy.current.has(key)) return;
    busy.current.add(key);
    try {
      await action();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      busy.current.delete(key);
    }
  }

  function selectWorkspace(id: number) {
    if (id === active.current?.workspace_id) {
      closeMenu(true);
      return;
    }
    if (busy.current.has("upload")) {
      notify("图片正在上传，请稍候切换");
      return;
    }
    if (busy.current.has("submit")) return;
    void mutate("session", async () => {
      if (active.current && currentDraft.current)
        writeDraft(active.current, currentDraft.current);
      await api(workspaceId.current, `/api/workspaces/${id}/select`, {});
      leaving.current = true;
      location.assign(workspaceURL("/studio", String(id)));
    });
  }

  function openJob(id: number) {
    assetScroll.current = scrollY;
    showDetail({ job: id });
    scrollAfterRender.current = () => scrollTo(0, 0);
  }

  function openCredits() {
    setSettingsTab("credits");
    navigate("settings");
  }

  function closeDetail() {
    showDetail(null);
    scrollAfterRender.current = () => scrollTo(0, assetScroll.current);
  }

  function setFilter(filter: LibraryFilter) {
    showDetail(null);
    library.choose(filter);
  }

  function showResult(id: number, tab: LibraryFilter["tab"], locate = false) {
    showDetail(null);
    setPage("library");
    setReferencePicking(null);
    library.choose({ tab, scope: "history" }, id);
    scrollAfterRender.current = () => {
      if (locate)
        document
          .getElementById("job-" + id)
          ?.scrollIntoView({ block: "center", behavior: scrollMotion() });
      else scrollTo(0, 0);
    };
  }

  function cancel(id: number) {
    void mutate(`cancel-${id}`, async () => {
      const space = active.current;
      if (!space) return;
      setCancelling((current) => new Set([...current, id]));
      try {
        await api(workspaceId.current, `/api/jobs/${id}/cancel`, {});
        if (!sameSpace(space, active.current) || leaving.current) return;
        const current = active.current!;
        ++stateRead.current;
        const next = {
          ...current,
          jobs: current.jobs.map((job) =>
            job.id === id ? { ...job, status: "cancelled" as const, note: "" } : job,
          ),
        };
        active.current = next;
        setState(next);
        notify("已取消生成，积分已退回");
        void refresh();
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) void refresh();
        throw error;
      } finally {
        setCancelling((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    });
  }

  function editJob(id: number) {
    const space = active.current;
    const previous = currentDraft.current;
    const job = space?.jobs.find((item) => item.id === id);
    if (!space || !previous || !job || busy.current.has("upload") || busy.current.has("submit")) return;
    if (previous.parent === id && detail && "job" in detail && detail.job === id && editing)
      return;
    if (!detail) assetScroll.current = scrollY;
    setReferencePicking(null);
    if (previous.parent !== id) {
      if (!hasDraftBackup && (previous.draft.prompt.trim() || packReferences(previous).length)) {
        writeDraftBackup(space, previous);
        setHasDraftBackup(true);
      }
      updateDraft(loadJob(space, previous, job));
    }
    showDetail({ job: id });
    setEditing(true);
    scrollAfterRender.current = () => {
      scrollTo(0, 0);
      focusEditor();
    };
  }

  function recoverDraft(space: StudioState) {
    const backup = readDraftBackup(space);
    if (!backup) return false;
    const parentExists = backup.parent === null || space.jobs.some((job) => job.id === backup.parent);
    updateDraft(parentExists ? backup : { ...backup, parent: null, retainedSeed: null });
    writeDraftBackup(space, null);
    setHasDraftBackup(false);
    return true;
  }

  function returnToComposer() {
    showDetail(null);
    scrollAfterRender.current = () => {
      scrollTo(0, 0);
      focusEditor();
    };
  }

  function restoreDraft() {
    const space = active.current;
    if (!space || busy.current.has("upload") || busy.current.has("submit")) return;
    if (recoverDraft(space)) returnToComposer();
  }

  function imageToVideo(id: number) {
    const space = active.current;
    const previous = currentDraft.current;
    const job = space?.jobs.find((item) => item.id === id);
    if (!space || !previous || !job?.result || busy.current.has("upload"))
      return;
    try {
      updateDraft(imageToVideoDraft(space, previous, job.result));
      openHomeComposer();
    } catch (error) {
      notify((error as Error).message);
    }
  }

  function showDialog(
    content: DialogContent,
    opener = document.activeElement as HTMLElement | null,
    adminOnly = false,
  ) {
    if (opener?.closest("#popover"))
      opener = document.querySelector(".workspace-switch");
    closeMenu();
    setMenuHidden(true);
    setDialog({ content, opener, adminOnly });
  }

  function actionButtons(jobId?: number, assetId?: string) {
    const entries = state?.plugin_actions ?? [];
    return entries.flatMap((entry) => {
      const target = entry.target === "asset" ? assetId : jobId;
      if (!target || !state) return [];
      const space = String(state.workspace_id);
      return [
        <button
          className="menu-item"
          key={entry.plugin + "/" + entry.id}
          onClick={() => {
            const requestId = crypto.randomUUID();
            showDialog(
              {
                kind: "plugin-action",
                entry,
                run: async (values) => {
                  const response = await api<{ notice: string }>(
                    space,
                    `/api/plugins/${entry.plugin}/actions/${entry.id}`,
                    { requestId, version: entry.version, target, values },
                  );
                  notify(response.notice);
                  await refresh();
                },
              },
              anchor.current,
              entry.audience === "admin",
            );
          }}
        >
          {entry.title}
        </button>,
      ];
    });
  }

  function preview(id: string, button: HTMLButtonElement, manage = false) {
    showDialog(
      {
        kind: "preview",
        id,
        mediaKind: active.current?.assets.find((asset) => asset.id === id)
          ?.kind,
        manage,
      },
      button,
    );
  }

  function openHomeComposer() {
    showDetail(null);
    setPage("home");
    scrollAfterRender.current = () => {
      scrollTo(0, 0);
      focusEditor();
    };
  }

  function useAsset(id: string): string | null | undefined {
    const space = active.current;
    const session = currentDraft.current;
    if (!space || !session || busy.current.has("upload")) return undefined;
    try {
      const type = referenceType(space, id);
      if (session.draft.kind === "audio")
        throw new Error(
          type === "Picture"
            ? "当前语音生成不支持参考图片，请先切换为视频生成或图片生成"
            : "请先选择 MiniMax H3 全能参考模式",
        );
      let next = session;
      if (
        referencePicking &&
        type === "Picture" &&
        !frames(session.draft) &&
        session.refs.includes(id) &&
        !session.draft.packs?.some((pack) => pack.media.includes(id))
      ) {
        changeRefs(session.refs.filter((ref) => ref !== id), id);
        return null;
      }
      if (type === "Picture") next = addImages(space, session, [id]);
      else if (!isH3(session.draft))
        throw new Error("请先选择 MiniMax H3 全能参考模式");
      else if (frames(session.draft)) next = assignFrame(space, session, id);
      else if (
        packReferences(session).length >=
        (space.model_forms?.[selectedModel(session.draft)]?.references.max ?? 9)
      )
        throw new Error(
          `最多选择 ${space.model_forms?.[selectedModel(session.draft)]?.references.max ?? 9} 个参考素材`,
        );
      else if (!session.refs.includes(id))
        next = { ...session, refs: [...session.refs, id] };
      if (next !== session)
        updateDraft(
          syncDraftReferences(
            space,
            space,
            session,
            next,
            editor.current
              ? (nextRefs) => editor.current!.reindex(nextRefs)
              : undefined,
          ),
        );
      if (!referencePicking) openHomeComposer();
      return null;
    } catch (error) {
      const message = (error as Error).message;
      notify(message);
      return message;
    }
  }

  function startPicking() {
    if (!referencePicking)
      setReferencePicking({ page, filter: library.filter, scroll: scrollY });
    showDetail(null);
    setPage("library");
    library.choose({ tab: "images", scope: "history" });
    scrollAfterRender.current = () => scrollTo(0, 0);
  }

  function finishPicking() {
    if (!referencePicking) return;
    showDetail(null);
    setPage(referencePicking.page);
    library.choose(referencePicking.filter);
    setReferencePicking(null);
    scrollAfterRender.current = () => scrollTo(0, referencePicking.scroll);
  }

  async function changePacks(
    action: (space: StudioState, session: DraftSession) => DraftSession,
    reload = true,
    close = true,
  ) {
    const before = active.current;
    if (!before || busy.current.has("upload"))
      throw new Error("图片正在上传，请稍候切换");
    if (reload) await refresh();
    const space = active.current;
    const session = currentDraft.current;
    if (!space || !session || !sameSpace(before, space) || leaving.current)
      return;
    const next = action(space, session);
    if (next !== session)
      updateDraft(
        syncDraftReferences(
          space,
          space,
          session,
          next,
          editor.current
            ? (nextRefs) => editor.current!.reindex(nextRefs)
            : undefined,
        ),
      );
    if (close) setDialog(null);
  }

  function removePack(id: string) {
    const space = active.current;
    const session = currentDraft.current;
    if (!space || !session || leaving.current) return;
    const next = removeDraftPack(space, session, id, {
      reindexActive: editor.current
        ? (nextRefs) => editor.current!.reindex(nextRefs)
        : undefined,
    });
    if (next !== session) updateDraft(next);
  }

  function openPacks() {
    showDialog({
      kind: "packs",
      importImages: (ids) =>
        changePacks((space, session) => addImages(space, session, ids)),
      importPack: (pack: Pack) =>
        changePacks((space, session) => {
          if (frames(session.draft))
            throw new Error("首尾帧模式请从素材包中选择图片");
          const packs = [
            ...(session.draft.packs || []).filter(({ id }) => id !== pack.id),
            pack,
          ];
          checkImages(
            space,
            session,
            packs.flatMap(({ media }) => media),
            session.refs,
          );
          return { ...session, draft: { ...session.draft, packs } };
        }),
      removePack: (id) =>
        changePacks(
          (_, session) => ({
            ...session,
            draft: {
              ...session.draft,
              packs: session.draft.packs?.filter((pack) => pack.id !== id),
            },
          }),
          false,
        ),
      deletePack: async (id) => {
        const space = active.current;
        const session = currentDraft.current;
        if (!space || !session || leaving.current) return;
        const next = removeDraftPack(space, session, id, {
          allSnapshots: true,
          reindexActive: editor.current
            ? (nextRefs) => editor.current!.reindex(nextRefs)
            : undefined,
        });
        if (next !== session) updateDraft(next);
      },
    });
  }

  function assetAction(
    activity: "favorite" | "download",
    action: () => Promise<void>,
  ) {
    void mutate("library", async () => {
      library.setActivity(activity);
      try {
        await action();
      } catch (error) {
        if (error instanceof ApiError && [401, 403].includes(error.status))
          void refresh();
        throw error;
      } finally {
        library.setActivity(null);
      }
    });
  }

  function saveFavorites(keys: string[], favorite: boolean) {
    assetAction("favorite", async () => {
      const before = active.current;
      const result = await api<{ favorites: string[] }>(
        workspaceId.current,
        "/api/favorites",
        { keys, favorite },
        "PUT",
      );
      const current = active.current;
      if (
        leaving.current ||
        !current ||
        current.me.id !== before?.me.id ||
        current.workspace_id !== before.workspace_id
      )
        return;
      ++stateRead.current;
      active.current = { ...current, favorites: result.favorites };
      setState(active.current);
      if (
        page === "library" &&
        !detail &&
        library.filter.scope === "favorites"
      ) {
        if (!favorite) library.removeSelected(keys);
        library.redrawLibrary();
      }
      notify(favorite ? "已收藏" : "已取消收藏");
    });
  }

  function downloadSelected() {
    const keys = library.keys;
    if (!keys.length) return;
    assetAction("download", async () => {
      const { url, filename } = await api<{ url: string; filename: string }>(
        workspaceId.current,
        "/api/assets/batch-download",
        { keys },
      );
      if (leaving.current || !active.current) return;
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      notify("已开始下载");
    });
  }

  function confirmDelete(
    title: string,
    summary: string,
    remove: () => Promise<void>,
    opener?: HTMLElement | null,
    onCancel?: () => void,
  ) {
    showDialog(
      {
        kind: "confirm",
        title,
        summary,
        onCancel,
        run: async () => {
          try {
            await remove();
          } catch (error) {
            if (error instanceof ApiError && [401, 403].includes(error.status))
              void refresh();
            throw error;
          }
          await refresh();
          library.redrawLibrary();
        },
      },
      opener,
    );
  }

  function deleteSelected() {
    const keys = library.keys;
    if (!keys.length || library.activity) return;
    confirmDelete(
      `删除所选 ${keys.length} 项内容？`,
      "删除后将从团队资产和收藏夹中移除，无法恢复。",
      async () => {
        const { deleted } = await api<{ deleted: number }>(
          workspaceId.current,
          "/api/assets/batch-delete",
          { keys },
        );
        library.reset();
        notify(`已删除 ${deleted} 项内容`);
      },
    );
  }

  function deleteJob(job: Job) {
    confirmDelete(
      `删除该${kindLabel(job)}？`,
      "删除后将从当前工作区移除。",
      async () => {
        await api(
          workspaceId.current,
          "/api/jobs/" + job.id,
          undefined,
          "DELETE",
        );
        showDetail(null);
        setPage("library");
      },
    );
  }

  function deleteAsset(id: string, opener?: HTMLElement | null) {
    const asset = active.current?.assets.find((item) => item.id === id);
    const { title, summary } = deleteAssetPrompt(asset?.kind);
    const previousPreview =
      dialog?.content.kind === "preview" && dialog.content.id === id
        ? dialog
        : null;
    confirmDelete(
      title,
      summary,
      async () => {
        await api(
          workspaceId.current,
          "/api/assets/" + id,
          undefined,
          "DELETE",
        );
        if (detail && "image" in detail && detail.image === id)
          showDetail(null);
      },
      previousPreview ? previousPreview.opener : opener,
      previousPreview
        ? () => {
            setDialog(previousPreview);
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLElement>('#modal [data-act="delete-asset"]')
                ?.focus({ preventScroll: true }),
            );
          }
        : undefined,
    );
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "Tab") return;
      const modalOpen = !!document.querySelector("#modal[open]");
      if (event.key === "Tab") {
        if (!mobileDrawerOpen || modalOpen || event.defaultPrevented) return;
        const buttons = [
          ...(shell.current?.querySelectorAll<HTMLButtonElement>(
            ".side button:enabled",
          ) ?? []),
          ...(sidebarPopoverOpen
            ? popover.current?.querySelectorAll<HTMLButtonElement>("button:enabled") ?? []
            : []),
        ].filter((button) => button.tabIndex >= 0 && button.getClientRects().length);
        const index = buttons.findIndex((button) => button === document.activeElement);
        const boundary = event.shiftKey ? 0 : buttons.length - 1;
        const next = event.shiftKey ? buttons.at(-1) : buttons[0];
        if (next && (index === -1 || index === boundary)) {
          event.preventDefault();
          next.focus();
        }
        return;
      }
      if (anchor.current) {
        if (popover.current?.contains(event.target as Node))
          event.preventDefault();
        closeMenu(true);
      } else if (mobileDrawerOpen && !modalOpen) {
        event.preventDefault();
        changeSidebar(true, true);
      } else if (detail && !modalOpen) closeDetail();
      else if (referencePicking && !modalOpen) finishPicking();
      else if (library.selecting && !modalOpen) library.reset();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  function updateDraft(
    next: DraftSession,
    options?: { keepSubmitId: boolean },
  ) {
    const space = active.current;
    if (space && !leaving.current)
      persist(
        space,
        options?.keepSubmitId
          ? next
          : { ...next, submitId: crypto.randomUUID() },
      );
  }

  function change(prompt: string) {
    const session = currentDraft.current;
    if (session && prompt !== session.draft.prompt)
      updateDraft({ ...session, draft: { ...session.draft, prompt } });
  }

  function submit(jobId?: number) {
    const space = active.current;
    const session = currentDraft.current;
    if (
      !space ||
      !session ||
      busy.current.has("upload") ||
      busy.current.has("session")
    )
      return;
    const job = space.jobs.find(({ id }) => id === jobId);
    if (jobId !== undefined && !job) return;
    const { draft } = session;
    const model = job
      ? job.model ||
        (job.kind === "image" ? space.images.default_model : "MiniMax H3")
      : selectedModel(draft);
    if (!modelAvailable(space, model)) return;
    const issue =
      referenceIssue(space, session, job) || flowIssue(space, session, job);
    if (issue) {
      notify(issue);
      return;
    }
    if (!job && !draft.prompt.trim()) return;
    if (!job && draft.prompt.length > promptLimit(draft)) {
      notify("最多输入 " + promptLimit(draft) + " 字");
      return;
    }
    if (!job) {
      const { priceReason } = composerFeedback(space, session, { offered: quoteFromEstimate(estimate), quoteError: estimate?.quoteError });
      if (priceReason) {
        notify(priceReason);
        return;
      }
    }
    void mutate("submit", async () => {
      const originalView = viewVersion.current;
      const keepCreating = page === "home" && !detail && !job;
      setSubmitting(true);
      try {
        let retryId: string | undefined;
        if (job) {
          retryId = retryIds.current.get(job.id) || crypto.randomUUID();
          retryIds.current.set(job.id, retryId);
        }
        let offered = quoteFromEstimate(estimate);
        if (job) {
          offered = undefined;
          if (space.pricing.published?.some(p => p.model === job.model)) {
            offered = quoteFromEstimate(await requestEstimate(estimateBody(space, loadJob(space, session, job))));
            if (!offered) throw new Error("未取得当前报价，请重试");
            if (!window.confirm(`重新生成最高使用 ${offered.max_charge} 积分？`)) return;
          }
        }
        const request = generationRequest(space, session, job, retryId, offered);
        writeDraft(space, session);
        const { id } = await api<{ id: number }>(
          String(space.workspace_id),
          request.path,
          request.body,
        );
        if (!Number.isSafeInteger(id) || id < 1)
          throw new Error("提交结果尚未确认，请重试");
        if (job) retryIds.current.delete(job.id);
        if (!sameSpace(space, active.current) || leaving.current) return;
        const latest = currentDraft.current!;
        const draftUnchanged = latest.submitId === session.submitId;
        const draftRestored = !job && draftUnchanged && recoverDraft(active.current!);
        if (!job && draftUnchanged) {
          if (!draftRestored) updateDraft(submittedDraft(latest));
          else if (originalView === viewVersion.current && detail) returnToComposer();
        }
        const acceptedDraft = currentDraft.current;
        notify(draftRestored ? "已加入生成队列，原草稿已恢复" : "已加入生成队列，可继续创作");
        await refresh();
        if (
          !keepCreating &&
          !draftRestored &&
          draftUnchanged &&
          acceptedDraft === currentDraft.current &&
          originalView === viewVersion.current &&
          sameSpace(space, active.current) &&
          !leaving.current
        )
          showResult(id, resultTab(request.kind));
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) await refresh();
        throw error;
      } finally {
        setSubmitting(false);
      }
    });
  }

  function upload(files: FileList, frame?: FrameSlot) {
    const space = active.current;
    const session = currentDraft.current;
    if (
      !space ||
      !session ||
      !files.length ||
      session.draft.kind === "audio" ||
      busy.current.has("submit") ||
      busy.current.has("session")
    )
      return;
    const selected = Array.from(files);
    void mutate("upload", async () => {
      setUploading(true);
      try {
        for (const file of selected) {
          const current = currentDraft.current;
          const currentSpace = active.current;
          if (
            !current ||
            !currentSpace ||
            leaving.current ||
            !sameSpace(space, currentSpace)
          )
            return;
          const h3 = isH3(current.draft);
          const frameMode = frames(current.draft);
          const form = currentSpace.model_forms[selectedModel(current.draft)];
          const limit = form?.references.max ?? 0;
          const pictures = form?.references.counts?.image ?? limit;
          const kind = file.type.startsWith("video/")
            ? "video"
            : file.type.startsWith("audio/")
              ? "audio"
              : "image";
          if (!frameMode) {
            if (limit <= 0 || (kind === "image" && pictures <= 0)) {
              notify("当前模型不支持参考图片，请先切换支持参考图的模型");
              break;
            }
            const references = packReferences(current);
            if (
              kind === "image" &&
              pictures < limit &&
              references.filter(
                (id) => referenceType(currentSpace, id) === "Picture",
              ).length >= pictures
            ) {
              notify(`最多选择 ${pictures} 张参考图片，请先移除部分图片`);
              break;
            }
            if (references.length >= limit) {
              notify(
                h3
                  ? `最多选择 ${limit} 个参考素材`
                  : `最多上传 ${limit} 张参考图片`,
              );
              break;
            }
          }
          if (kind !== "image" && (!h3 || frameMode))
            throw new Error("这个模式只接收图片");
          const result = await api<
            Asset & { first_frame?: boolean; resized?: boolean }
          >(
            String(space.workspace_id),
            kind === "image"
              ? "/api/assets"
              : "/api/h3/references?kind=" + kind,
            file,
          );
          const latest = currentDraft.current;
          const refreshed = active.current;
          if (
            !latest ||
            !refreshed ||
            leaving.current ||
            !sameSpace(space, refreshed)
          )
            return;
          ++stateRead.current;
          const withAsset = {
            ...refreshed,
            assets: [
              { ...result, owner: space.me.id },
              ...refreshed.assets.filter((asset) => asset.id !== result.id),
            ],
          };
          active.current = withAsset;
          setState(withAsset);
          if (result.first_frame) notify("动态图或多页图片已按首帧导入");
          else if (result.resized)
            notify(`图片已适配为 ${result.w} × ${result.h}`);
          const nextSession = frameMode
            ? assignFrame(withAsset, latest, result.id, frame)
            : { ...latest, refs: [...latest.refs, result.id] };
          updateDraft(
            syncDraftReferences(
              withAsset,
              withAsset,
              latest,
              nextSession,
              editor.current
                ? (nextRefs) => editor.current!.reindex(nextRefs)
                : undefined,
            ),
          );
          frame = undefined;
        }
        await refresh();
      } finally {
        setUploading(false);
      }
    });
  }

  function changeRefs(refs: string[], removed?: string) {
    const space = active.current;
    const session = currentDraft.current;
    if (!space || !session) return;
    const { draft } = session;
    const options = h3Options(draft.h3);
    const nextSession: DraftSession = {
      ...session,
      refs,
      draft: {
        ...draft,
        ...(removed && isH3(draft)
          ? {
              h3: {
                ...options,
                video_audio: options.video_audio.filter((id) => id !== removed),
              },
            }
          : {}),
      },
    };
    updateDraft(
      syncDraftReferences(
        space,
        space,
        session,
        nextSession,
        editor.current
          ? (nextRefs) => editor.current!.reindex(nextRefs)
          : undefined,
      ),
    );
  }

  const composer = state && session && (
    <Composer
      managePlugins={() => {
        const models = [
          ...Object.keys(state.video_models),
          ...Object.keys(state.images.models),
          ...Object.keys(state.audio_models),
        ].filter((id) => !state.model_catalog[id]?.hidden);
        const globalPolicy = state.model_policy?.enabled;
        const teamPolicy = state.team_model_policies?.[String(state.workspace_id)]?.enabled;
        const globallyAllowed = models.some((id) => globalPolicy?.[id]);
        const allowedHere = models.some((id) => globalPolicy?.[id] && (!teamPolicy || teamPolicy[id]));
        if (models.length && globalPolicy && !allowedHere) {
          modelPreferences.current.scope = globallyAllowed && teamPolicy
            ? String(state.workspace_id)
            : "global";
          setSettingsTab("models");
        } else setSettingsTab("plugins");
        navigate("settings");
      }}
      state={state}
      session={session}
      estimate={estimate}
      submitting={submitting}
      uploading={uploading}
      change={change}
      update={updateDraft}
      submit={() => submit()}
      upload={upload}
      menu={
        menuShown && menu && isComposerMenu(menu)
          ? menu
          : null
      }
      open={openMenu}
      close={closeMenu}
      preview={preview}
      editor={editor}
      seenMenus={seenComposerMenus.current}
      referenceContents={referenceContents}
      flowSourceContents={flowSourceContents}
      restoreDraft={hasDraftBackup ? restoreDraft : undefined}
      onRecharge={openCredits}
    />
  );
  const favorite = (key: string, saved: boolean) => saveFavorites([key], saved);

  if (expired) return <Auth loadingLogo={loadingLogo} expired />;
  return (
    <>
      <div id="app">
        {state && session ? (
          <div
            className={collapsed ? "shell collapsed" : "shell"}
            ref={shell}
          >
            <Sidebar
              state={state}
              page={page}
              collapsed={collapsed}
              menu={menuShown && menu && !isComposerMenu(menu) ? menu : null}
              accountOpened={accountOpened}
              navigate={navigate}
              collapse={collapse}
              open={openMenu}
            />
            <div className="workspace" inert={mobileDrawerOpen}>
              <header className="topbar" aria-hidden="true"></header>
              <main id="view" ref={view}>
                {job ? (
                  <JobDetail
                    state={state}
                    job={job}
                    delta={delta}
                    close={closeDetail}
                    favorite={favorite}
                    cancel={cancel}
                    cancelling={cancelling.has(job.id)}
                    pageTo={(id) => showDetail({ job: id })}
                    locate={(job) =>
                      showResult(job.id, resultTab(job.kind), true)
                    }
                    preview={preview}
                    edit={editJob}
                    again={submit}
                    imageToVideo={imageToVideo}
                    openCanvas={followCanvas}
                    composer={editing ? composer : null}
                    more={(button) => openMenu("detail-more", button)}
                    menuOpen={
                      menuShown && menu === "detail-more"
                    }
                    menuUsed={detailMenuUsed}
                    notify={notify}
                  />
                ) : image ? (
                  <ImageDetail
                    state={state}
                    asset={image}
                    close={closeDetail}
                    favorite={favorite}
                    use={useAsset}
                    more={
                      actionButtons(undefined, image.id).length
                        ? (button) => openMenu("detail-more", button)
                        : undefined
                    }
                    remove={deleteAsset}
                  />
                ) : page === "home" && !detail ? (
                  <div className="home-view">
                    <h1>
                      你好，今天想要<span>创作</span>什么？
                    </h1>
                    <div id="home-composer" className="home-composer">
                      {composer}
                    </div>
                    <section className="recent-section">
                      <HistoryHeading open={state.jobs.length ? () => {
                        navigate("library");
                        library.choose({ tab: resultTab(state.jobs[0].kind), scope: "history" });
                      } : undefined} />
                      <div id="recent-grid">
                        <History
                          state={state}
                          delta={delta}
                          favorite={favorite}
                          detail={openJob}
                          edit={editJob}
                        />
                      </div>
                    </section>
                  </div>
                ) : page === "chat" ? (
                  <div id="chat-root">
                    <ChatWorkspace
                      key={`${state.me.id}:${state.workspace_id}`}
                      userId={state.me.id}
                      workspace={state.workspace_id}
                      isAdmin={state.me.role === "admin"}
                      onConfigureModels={
                        state.me.role === "admin"
                          ? () => {
                              const target = resolveChatConfigTarget(state);
                              if (target === "models") {
                                modelPreferences.current.scope =
                                  resolveChatModelScope(state);
                              }
                              setSettingsTab(target);
                              navigate("settings");
                            }
                          : undefined
                      }
                      openCanvas={followCanvas}
                      onRecharge={openCredits}
                    />
                  </div>
                ) : page.startsWith("plugin:") ? (
                  studioPage && pageClient ? (
                    <PluginPage
                      key={`${state.me.id}:${state.workspace_id}:${studioPage.key}:${studioPage.version}`}
                      page={studioPage}
                      client={pageClient}
                      open={openAdminDialog}
                      refresh={refresh}
                      notify={notify}
                    />
                  ) : <p role="status">此插件页面已不可用</p>
                ) : page === "settings" ? (
                  <Settings
                    state={state}
                    tab={settingsTab}
                    visit={settingsVisit}
                    draft={profileDraft}
                    modelPreferences={modelPreferences.current}
                    navigate={(tab) => {
                      showDetail(null);
                      setSettingsTab(tab);
                      setSettingsVisit((visit) => visit + 1);
                    }}
                    dialogOpen={!!dialog}
                    open={openSettingsDialog}
                    saved={saveProfile}
                    refresh={refresh}
                    notify={notify}
                    viewLibrary={() => navigate("library")}
                    showWorkspace={showWorkspace}
                    selectWorkspace={selectWorkspace}
                    openAdmin={openAdminDialog}
                    confirmAdmin={confirmAdmin}
                    adminRequest={adminRequest}
                  />
                ) : page === "queue" && !detail ? (
                  <Queue
                    state={state}
                    delta={delta}
                    detail={openJob}
                    cancel={cancel}
                    cancelling={cancelling}
                  />
                ) : (
                  <Library
                    importButton={
                      <PluginImport
                        key={state.workspace_id}
                        entries={state.plugin_importers}
                        target="assets"
                        workspace={String(state.workspace_id)}
                        onImported={async ({ assets }) => {
                          const tabs = {
                            image: "images",
                            video: "videos",
                            audio: "audio",
                          } as const;
                          await refresh();
                          if (assets[0])
                            setFilter({
                              tab: tabs[assets[0].kind],
                              scope: "history",
                            });
                          notify("已导入 " + assets.length + " 项素材");
                        }}
                      />
                    }
                    library={library}
                    state={state}
                    delta={delta}
                    composer={composer}
                    referencePicking={
                      referencePicking && session
                        ? {
                            ids: new Set(
                              packReferences(session).filter(
                                (id) => referenceType(state, id) === "Picture",
                              ),
                            ),
                            finish: finishPicking,
                          }
                        : null
                    }
                    pluginButtons={
                      library.keys.length === 1 &&
                      library.keys[0].startsWith("asset:")
                        ? actionButtons(undefined, library.keys[0].slice(6))
                        : []
                    }
                    actions={{
                      favorite,
                      edit: editJob,
                      job: openJob,
                      image: (id) => showDetail({ image: id }),
                      preview: (id, button, manage = true) =>
                        preview(
                          id,
                          button,
                          manage && !library.selecting && !referencePicking,
                        ),
                      use: useAsset,
                      remove: deleteAsset,
                      filter: setFilter,
                      batchFavorite: () =>
                        saveFavorites(library.keys, !library.allSaved),
                      batchDownload: downloadSelected,
                      batchDelete: deleteSelected,
                    }}
                  />
                )}
              </main>
            </div>
          </div>
        ) : (
          <main
            className="loading-screen"
            role={bootstrapError ? "alert" : "status"}
            aria-label={
              bootstrapError ? "工作台加载失败" : "弗淼 AIGC 正在加载"
            }
            aria-busy={!bootstrapError}
          >
            <div className="loading-brand">
              <img src={loadingLogo} width="48" height="48" alt="" />
              <span>
                弗淼 <b>AIGC</b>
              </span>
            </div>
            {bootstrapError ? (
              <>
                <p>工作台加载失败，请稍后重试</p>
                <small>{bootstrapError}</small>
                <button
                  type="button"
                  className="ledger-button"
                  onClick={() => void refresh()}
                >
                  重试
                </button>
              </>
            ) : (
              <div className="loading-track" aria-hidden="true">
                <span />
              </div>
            )}
          </main>
        )}
      </div>
      <div
        role="status"
        id="toast"
        className={toastVisible ? "visible" : toast ? "" : undefined}
      >
        {toast}
      </div>
      <AssetDialog
        key={state?.me.id}
        dialog={dialog}
        admin={state?.me.role === "admin"}
        onClose={() => setDialog(null)}
        notify={notify}
        state={state}
        session={session}
        onFavorite={favorite}
        onUse={useAsset}
        onDelete={deleteAsset}
      />
      <div
        id="popover"
        ref={popover}
        tabIndex={-1}
        hidden={menuHidden}
        inert={!menuShown || (mobileDrawerOpen && !sidebarPopoverOpen)}
        className={
          menu
            ? `popover ${menu === "account" ? "account-menu" : menu}${menuShown ? " open" : ""}`
            : undefined
        }
        role={menu ? "dialog" : undefined}
        aria-label={
          menu && isComposerMenu(menu)
            ? composerMenuAria.current
            : menu === "workspaces"
              ? "选择工作区"
              : menu === "detail-more"
                ? "更多"
                : menu
                  ? "账户"
                  : undefined
        }
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          const options = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              menu === "mention"
                ? ".ref-entry"
                : '[role="option"]:not(:disabled):not([hidden])',
            ),
          );
          if (
            target.getAttribute("role") === "radio" &&
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          ) {
            const radios = Array.from(
              target.parentElement!.querySelectorAll<HTMLButtonElement>(
                '[role="radio"]:not(:disabled)',
              ),
            );
            const direction = ["ArrowLeft", "ArrowUp"].includes(event.key)
              ? -1
              : 1;
            const index = radios.indexOf(target as HTMLButtonElement);
            const next =
              radios[(index + direction + radios.length) % radios.length];
            if (!next) return;
            event.preventDefault();
            const { act, value } = next.dataset;
            next.click();
            requestAnimationFrame(() => {
              popover.current
                ?.querySelector<HTMLElement>(
                  `[data-act="${CSS.escape(act || "")}"][data-value="${CSS.escape(value || "")}"]`,
                )
                ?.focus();
            });
          } else if (
            options.length > 0 &&
            ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) &&
            !target.matches("input, textarea") &&
            (menu !== "mention" || !["Home", "End"].includes(event.key))
          ) {
            event.preventDefault();
            const current = options.indexOf(
              document.activeElement as HTMLElement,
            );
            const index =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : (current +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      options.length) %
                    options.length;
            options[index]?.focus();
          }
        }}
      >
        {state &&
          menu === "detail-more" &&
          !menuHidden &&
          actionButtons(job?.id, job?.result ?? image?.id)}
        {state &&
          menu === "detail-more" &&
          !menuHidden &&
          job &&
          (isOwner(state, job) ? (
            <button
              className="menu-item danger"
              data-act="delete"
              data-id={job.id}
              onClick={() => deleteJob(job)}
            >
              删除
            </button>
          ) : actionButtons(job.id, job.result).length ? null : (
            <span className="empty-note">暂无更多操作</span>
          ))}
        {state && session && menu && isComposerMenu(menu) && !menuHidden && (
          <ComposerMenuContents
            key={menu}
            state={state}
            session={session}
            kind={menu}
            uploading={uploading}
            update={updateDraft}
            close={closeMenu}
            preview={(id) => {
              const opener = anchor.current;
              if (opener) preview(id, opener);
            }}
            insert={(id) => {
              closeMenu();
              editor.current?.insert(id);
            }}
            changeRefs={changeRefs}
            removePack={removePack}
            pickAssets={startPicking}
            openPacks={openPacks}
            notify={notify}
            reposition={positionMenu}
          />
        )}
        {state &&
          menu &&
          menu !== "detail-more" &&
          !isComposerMenu(menu) &&
          !menuHidden && (
            <MenuContents
              kind={menu}
              state={state}
              select={selectWorkspace}
              create={showWorkspace}
              settings={() => navigate("settings")}
              logout={() =>
                void mutate("session", async () => {
                  await api(workspaceId.current, "/api/logout", {});
                  leaving.current = true;
                  location.reload();
                })
              }
            />
          )}
      </div>
    </>
  );
}
