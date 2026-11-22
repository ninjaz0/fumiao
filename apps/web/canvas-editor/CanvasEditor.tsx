"use client";

import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { api, initializeWorkspace, setWorkspace, workspaceURL } from "./api";
import { CanvasWorkspace } from "./CanvasWorkspace";
import "./canvas-overrides.css";
import type { Project, Studio } from "./types";

export default function CanvasEditor({ loadingLogo }: { loadingLogo: string }) {
  const [loaded, setLoaded] = useState<{ project: Project; studio: Studio }>();
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    let active = true;
    setMounted(true);
    initializeWorkspace();
    const id = location.pathname.split("/")[2];
    async function load() {
      const project = await api<Project>("/api/canvases/" + id);
      if (!active) return;
      setWorkspace(project.workspace);
      const studio = await api<Studio>("/api/state");
      if (!active) return;
      setWorkspace(studio.workspace_id);
      setLoaded({ project, studio });
    }
    void load().catch((error) => {
      if (!active) return;
      if (error.status === 401) location.replace("/studio");
      else setError(error.message);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div id="canvas-root">
      {error ? (
        <main className="canvas-error">
          <h1>画布暂时无法打开</h1>
          <p>{error}</p>
          <a href={workspaceURL("/canvas")}>返回画布列表</a>
        </main>
      ) : loaded ? (
        <ReactFlowProvider>
          <CanvasWorkspace key={loaded.project.id} {...loaded} />
        </ReactFlowProvider>
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
