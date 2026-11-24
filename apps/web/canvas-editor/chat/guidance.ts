export type ChatConfigTarget = "plugins" | "chatService" | "models";

type PolicyFlags = { revision: number; enabled: Record<string, boolean> };

export type ChatGuidanceState = {
  workspace_id?: number;
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
  return state.studio_plugins ? "plugins" : "chatService";
}

export function chatSettingsHref(
  workspace: number,
  target: ChatConfigTarget = "plugins",
): string {
  const params = new URLSearchParams({
    settings: target,
    workspace: String(workspace),
  });
  if (
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("studio_ui") === "react"
  ) {
    params.set("studio_ui", "react");
  }
  return `/studio?${params.toString()}`;
}
