import type { Request } from "express";
import type { OriginalActor } from "@fumiao/original-api/identity.js";
import type { TokenAuthContext } from "@fumiao/original-api/tokens.js";

export type OriginalAuthRequest = Request & {
  actor: OriginalActor;
  tokenAuth?: TokenAuthContext;
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

export function originalBearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+(fmk_[A-Za-z0-9_-]+)$/i);
  return match ? match[1] : "";
}

export function requestQuery(req: Request) {
  return new URL(req.originalUrl, "http://localhost").searchParams;
}

export function originalWorkspace(
  req: Request,
  header = req.headers["x-workspace-id"],
) {
  const authReq = req as OriginalAuthRequest;
  if (authReq.tokenAuth) return String(authReq.tokenAuth.workspacePublicId);
  return header ? String(header) : requestQuery(req).getAll("workspace").at(-1);
}
