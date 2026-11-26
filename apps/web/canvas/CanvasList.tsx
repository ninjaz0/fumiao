"use client";

import { useEffect, useState } from "react";
import { canvasLoginPath } from "../auth/return-path";
import { api, ApiError, type Studio } from "./api";
import ProjectList from "./ProjectList";
import "./dialog.css";

export default function CanvasList({ loadingLogo }: { loadingLogo: string }) {
  const [studio, setStudio] = useState<Studio | null>(null);
  const [workspaceChanged, setWorkspaceChanged] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setMounted(true);
    const workspace = new URLSearchParams(location.search).get("workspace");
    api<Studio>(workspace, "/api/state")
      .catch(async (error: Error) => {
        if (!(workspace && error instanceof ApiError && [400, 403].includes(error.status)))
          throw error;
        const fallback = await api<Studio>(null, "/api/state");
        if (current) setWorkspaceChanged(true);
        return fallback;
      })
      .then((state) => {
        if (!current) return;
        const url = new URL(location.href);
        url.searchParams.set("workspace", String(state.workspace_id));
        history.replaceState(null, "", url);
        setStudio(state);
      })
      .catch((error: Error) => {
        if (!current) return;
        if (error instanceof ApiError && error.status === 401)
          location.replace(canvasLoginPath(location.pathname, new URLSearchParams(location.search)));
        else if (error.message) setError(error.message);
      });
    return () => {
      current = false;
    };
  }, []);

  return (
    <div id="canvas-root">
      {error ? (
        <main className="canvas-error">
          <h1>画布暂时无法打开</h1>
          <p>{error}</p>
          <button type="button" onClick={() => location.reload()}>重试</button>
        </main>
      ) : studio ? (
        <ProjectList studio={studio} workspaceChanged={workspaceChanged} />
      ) : (
        <div className="canvas-loading">
          <img
            src={mounted ? "/static/mark.svg" : loadingLogo}
            alt=""
            width={mounted ? undefined : 48}
            height={mounted ? undefined : 48}
          />
          <strong>弗淼 AIGC</strong>
        </div>
      )}
    </div>
  );
}
