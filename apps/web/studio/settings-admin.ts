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

export type AdminOpen = (body: ReactNode, opener: HTMLElement) => void;
export type AdminConfirm = (
  title: string,
  summary: string,
  run: () => Promise<void>,
  opener: HTMLElement,
) => void;
