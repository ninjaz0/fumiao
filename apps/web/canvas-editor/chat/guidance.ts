export type ChatConfigTarget = "modelAccess" | "plugins" | "chatService" | "models";

type PolicyFlags = { revision: number; enabled: Record<string, boolean> };

export type ChatGuidanceState = {
  workspace_id?: number;
  workspaces?: { id: number; kind: string }[];
  studio_plugins?: boolean;
  model_groups?: Record<string, { kind: string; models: string[] }>;
  model_policy?: PolicyFlags;
  team_model_policies?: Record<string, PolicyFlags>;
};

export function hasAvailableChatModels(
  config: { models: Record<string, unknown> } | null | undefined,
): boolean | null {
  if (!config) return null;
  return Object.keys(config.models).length > 0;
}

export function resolveChatConfigTarget(
  state?: ChatGuidanceState | null,
): ChatConfigTarget {
  if (!state) return "plugins";
  const chatModels = Object.values(state.model_groups || {})
    .filter((group) => group.kind === "chat")
    .flatMap((group) => group.models);
  if (chatModels.length > 0 && state.model_policy) {
    const teamPolicy =
      state.workspace_id != null
        ? state.team_model_policies?.[String(state.workspace_id)]
        : undefined;
    const allowedByPolicy = chatModels.some(
      (id) =>
        Boolean(state.model_policy?.enabled[id]) &&
        (teamPolicy ? Boolean(teamPolicy.enabled[id]) : true),
    );
    if (!allowedByPolicy) return "models";
  }
  if (state.studio_plugins && !chatModels.length) return "modelAccess";
  return state.studio_plugins ? "plugins" : "chatService";
}

export function resolveChatModelScope(
  state?: ChatGuidanceState | null,
): string {
  if (!state || state.workspace_id == null) return "global";
  const workspaceKey = String(state.workspace_id);
  const teamPolicy = state.team_model_policies?.[workspaceKey];
  const isTeam =
    state.workspaces?.some(
      (space) => space.id === state.workspace_id && space.kind === "team",
    ) ?? Boolean(teamPolicy);
  if (!isTeam) return "global";
  const chatModels = Object.values(state.model_groups || {})
    .filter((group) => group.kind === "chat")
    .flatMap((group) => group.models);
  if (
    teamPolicy &&
    chatModels.length > 0 &&
    !chatModels.some((id) => Boolean(teamPolicy.enabled[id]))
  ) {
    return workspaceKey;
  }
  const globalAllowed = chatModels.some((id) =>
    Boolean(state.model_policy?.enabled[id]),
  );
  return globalAllowed ? workspaceKey : "global";
}

export function chatSettingsPath(state?: ChatGuidanceState | null): string {
  const target = resolveChatConfigTarget(state);
  const params = new URLSearchParams({ settings: target });
  if (target === "models") {
    const scope = resolveChatModelScope(state);
    if (scope !== "global") params.set("scope", scope);
  }
  return `/studio?${params.toString()}`;
}

export function chatSettingsHref(
  workspace: number,
  target: ChatConfigTarget = "modelAccess",
  scope?: string,
): string {
  const params = new URLSearchParams({
    settings: target,
    workspace: String(workspace),
  });
  if (target === "models" && scope && scope !== "global") {
    params.set("scope", scope);
  }
  if (
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("studio_ui") === "react"
  ) {
    params.set("studio_ui", "react");
  }
  return `/studio?${params.toString()}`;
}
