import type { ReactNode } from "react";

export type AdminRequest = (
  path: string,
  body?: object,
  method?: string,
) => Promise<unknown>;

export type AdminSave = {
  request: AdminRequest;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
};

export type SettingsDialogPresentation = "invite-sheet";

export type AdminOpen = (
  body: ReactNode,
  opener: HTMLElement,
  presentation?: SettingsDialogPresentation,
) => void;
export type AdminConfirm = (
  title: string,
  summary: string,
  run: () => Promise<void>,
  opener: HTMLElement,
) => void;
