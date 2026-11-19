"use client";

import { useEffect, useState } from "react";
import { api, ApiError, workspaceURL, type Studio } from "./api";
import ProjectList from "./ProjectList";

export default function CanvasList({ loadingLogo }: { loadingLogo: string }) {
  const [studio, setStudio] = useState<Studio | null>(null);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<{
    message: string;
    workspace: string | null;
  } | null>(null);

  useEffect(() => {
    let current = true;
    setMounted(true);
    const workspace = new URLSearchParams(location.search).get("workspace");
    api<Studio>(workspace, "/api/state")
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
          location.replace("/studio");
        else if (error.message) setError({ message: error.message, workspace });
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
          <p>{error.message}</p>
          <a href={workspaceURL("/canvas", error.workspace)}>返回画布列表</a>
        </main>
      ) : studio ? (
        <ProjectList studio={studio} />
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
