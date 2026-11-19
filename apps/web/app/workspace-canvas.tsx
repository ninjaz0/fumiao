"use client";
import { useEffect, useState, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
type Row = Record<string, any>;
export default function WorkspaceCanvas({
  api,
  models,
  assets,
  workspaceId,
  onError,
}: {
  api: any;
  models: Row[];
  assets: Row[];
  workspaceId: string;
  onError: (s: string) => void;
}) {
  const submitting = useRef(false);
  const [documents, setDocuments] = useState<Row[]>([]),
    [document, setDocument] = useState<Row | null>(null),
    [nodes, setNodes] = useState<Node[]>([]),
    [edges, setEdges] = useState<Edge[]>([]),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setDocuments(await api("/api/documents/canvas"));
  }
  useEffect(() => {
    setDocument(null);
    setNodes([]);
    setEdges([]);
    void load().catch((e) => onError(e.message));
  }, [workspaceId]);
  function open(d: Row) {
    setDocument(d);
    setNodes(d.body.nodes || []);
    setEdges(d.body.edges || []);
  }
  function add() {
    const id = crypto.randomUUID();
    setNodes((v) => [
      ...v,
      {
        id,
        position: { x: 100 + v.length * 40, y: 100 + v.length * 40 },
        data: { label: "新镜头", prompt: "", modelId: models[0]?.id || "" },
      },
    ]);
    setSelected(id);
  }
  const current = nodes.find((n) => n.id === selected);
  function edit(values: Row) {
    setNodes((v) =>
      v.map((n) =>
        n.id === selected ? { ...n, data: { ...n.data, ...values } } : n,
      ),
    );
  }
  async function save() {
    if (!document) return;
    setBusy(true);
    try {
      const result = await api(
        "/api/documents",
        {
          id: document.id,
          kind: "canvas",
          title: document.title,
          revision: document.revision,
          body: { nodes, edges },
          assets: nodes.map((n) => n.data.assetId).filter(Boolean),
        },
        "PUT",
      );
      setDocument({ ...document, revision: result.revision });
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="actions">
        <select
          aria-label="选择画布"
          value={document?.id || ""}
          onChange={(e) => {
            const d = documents.find((d) => d.id === e.target.value);
            if (d) open(d);
          }}
        >
          <option value="">选择画布</option>
          {documents.map((d) => (
            <option value={d.id} key={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            open({
              id: crypto.randomUUID(),
              title: "新画布",
              revision: 0,
              body: {},
            })
          }
        >
          新建画布
        </button>
        {document && (
          <>
            <input
              aria-label="画布名称"
              value={document.title}
              onChange={(e) =>
                setDocument({ ...document, title: e.target.value })
              }
            />
            <button onClick={add}>添加镜头</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void save()}
            >
              保存画布
            </button>
          </>
        )}
      </div>
      {document && (
        <div className="canvas-layout">
          <div className="flow">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={(changes) =>
                setNodes((v) => applyNodeChanges(changes, v))
              }
              onEdgesChange={(changes) =>
                setEdges((v) => applyEdgeChanges(changes, v))
              }
              onConnect={(connection) =>
                setEdges((v) => addEdge(connection, v))
              }
              onNodeClick={(_, node) => setSelected(node.id)}
              fitView
            >
              <Background />
              <Controls />
            </ReactFlow>
          </div>
          {current && (
            <section className="node-editor">
              <label>
                镜头名称
                <input
                  value={String(current.data.label || "")}
                  onChange={(e) => edit({ label: e.target.value })}
                />
              </label>
              <label>
                提示词
                <textarea
                  rows={7}
                  value={String(current.data.prompt || "")}
                  onChange={(e) => edit({ prompt: e.target.value })}
                />
              </label>
              <label>
                模型
                <select
                  value={String(current.data.modelId || "")}
                  onChange={(e) => edit({ modelId: e.target.value })}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                参考素材
                <select
                  value={String(current.data.assetId || "")}
                  onChange={(e) => edit({ assetId: e.target.value })}
                >
                  <option value="">无</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.mime} · {a.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                onClick={async () => {
                  if (submitting.current) return;
                  submitting.current = true;
                  try {
                    const request = {
                      modelId: current.data.modelId,
                      prompt: current.data.prompt,
                      params: {},
                      references: current.data.assetId
                        ? [current.data.assetId]
                        : [],
                    };
                    const fingerprint = JSON.stringify(request);
                    const key =
                      current.data.requestFingerprint === fingerprint &&
                      current.data.requestKey
                        ? current.data.requestKey
                        : crypto.randomUUID();
                    edit({ requestKey: key, requestFingerprint: fingerprint });
                    const job = await api("/api/jobs", { ...request, key });
                    edit({ jobId: job.id, requestKey: null });
                  } catch (e) {
                    onError((e as Error).message);
                  } finally {
                    submitting.current = false;
                  }
                }}
              >
                生成镜头
              </button>
              {current.data.jobId ? <p>任务已提交，可在创作页查看</p> : null}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
