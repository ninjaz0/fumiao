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

export type ExtensionTab = `extension/${string}/${string}`;
export type SettingsTab = (typeof settingsTabs)[number] | ExtensionTab;

export const extensionTab = (page: {
  plugin: string;
  id: string;
}): ExtensionTab => `extension/${page.plugin}/${page.id}`;
