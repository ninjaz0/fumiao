export const adminSettingsTabs = [
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

export type SettingsTab = (typeof settingsTabs)[number];
