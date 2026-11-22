import type { PluginPageEntry } from "@fumiao/plugin-sdk/contributions.js";

export const adminSettingsTabs = [
  "plugins",
  "models",
  "prices",
  "creditAdmin",
  "openai",
  "chatService",
  "workspaces",
  "team",
  "invites",
  "storage",
] as const;

const settingsTabs = [
  "profile",
  "general",
  "credits",
  "gpu",
  ...adminSettingsTabs,
] as const;

type PluginTab = `plugin:${string}:${string}`;
export type SettingsTab = (typeof settingsTabs)[number] | PluginTab | ExtensionTab;

export function pluginTab({ plugin, page }: PluginPageEntry): PluginTab {
  return `plugin:${plugin}:${page}`;
}

export function resolvePluginTab(
  tab: SettingsTab,
  pages: readonly PluginPageEntry[] | undefined,
  hasLegacyPanel: boolean,
): SettingsTab {
  if (tab === "gpu") {
    if (!pages && hasLegacyPanel) return "gpu";
    const first = pages?.find((page) => page.legacy);
    return first ? pluginTab(first) : "general";
  }
  if (
    tab.startsWith("plugin:") &&
    !pages?.some((page) => pluginTab(page) === tab)
  )
    return "general";
  return tab;
}
export type ExtensionTab = `extension/${string}/${string}`;

export const extensionTab = (page: {
  plugin: string;
  id: string;
}): ExtensionTab => `extension/${page.plugin}/${page.id}`;
