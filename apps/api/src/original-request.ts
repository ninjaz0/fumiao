import type { Request } from "express";
import type { OriginalActor } from "@fumiao/original-api/identity.js";

export type OriginalAuthRequest = Request & {
  actor: OriginalActor;
  nodePool?: string;
};

export function originalSessionToken(req: Request) {
  return (
    req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("fm_session="))
      ?.slice(11) || ""
  );
}

export function requestQuery(req: Request) {
  return new URL(req.originalUrl, "http://localhost").searchParams;
}

export function originalWorkspace(
  req: Request,
  header = req.headers["x-workspace-id"],
) {
  return header ? String(header) : requestQuery(req).getAll("workspace").at(-1);
}
