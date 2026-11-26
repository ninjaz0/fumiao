import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FileText, Layers, Replace, Search, X } from "lucide-react";
import {
  scriptApi,
  type ScriptSearchCanvasResult,
  type ScriptSearchFileResult,
} from "./script-api";
import {
  applyMatchSpansReplacement,
  replaceCanvasNodeText,
  searchCanvasTextNodes,
  type CanvasNodeSearchMatch,
} from "./script-fusion";
import type { Doc } from "./types";

type SearchSnapshot = {
  query: string;
  caseSensitive: boolean;
  scriptResults: ScriptSearchFileResult[];
  localNodeResults: CanvasNodeSearchMatch[];
  remoteCanvasResults: ScriptSearchCanvasResult[];
};

const MAX_BATCH_ITEMS = 25;
const MAX_BATCH_BYTES = 1_500_000;

export function WorkspaceSearchModal({
  canvasId,
  canvasTitle,
  canvasDoc,
  dirtyScriptIds,
  onOpenScriptMatch,
  onFocusCanvasNode,
  onSwitchCanvasProject,
  onReplaceCanvasDoc,
  onScriptsChanged,
  onClose,
}: {
  canvasId: string;
  canvasTitle: string;
  canvasDoc: Doc;
  dirtyScriptIds: ReadonlySet<string>;
  onOpenScriptMatch: (docId: string, path: string, line: number) => void;
  onFocusCanvasNode: (nodeId: string) => void;
  onSwitchCanvasProject: (targetCanvasId: string) => void;
  onReplaceCanvasDoc: (updater: (current: Doc) => Doc) => void;
  onScriptsChanged: (savedScriptIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searching, setSearching] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [snapshot, setSnapshot] = useState<SearchSnapshot | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Changing query or case-sensitivity invalidates previous search snapshot so preview & apply
  // NEVER run with mismatched search parameters!
  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery);
    if (snapshot) {
      setSnapshot(null);
      setPreviewing(false);
      setSelectedKeys(new Set());
    }
  };

  const handleCaseSensitiveChange = (nextCase: boolean) => {
    setCaseSensitive(nextCase);
    if (snapshot) {
      setSnapshot(null);
      setPreviewing(false);
      setSelectedKeys(new Set());
    }
  };

  const runSearch = async (
    overrideQuery?: string,
    overrideCase?: boolean,
    preserveStatus = false,
  ) => {
    const q = overrideQuery ?? query;
    const cs = overrideCase ?? caseSensitive;
    if (!q) return;
    setSearching(true);
    setError("");
    if (!preserveStatus) setStatusMessage("");
    setPreviewing(false);
    try {
      const [remote, localNodes] = await Promise.all([
        scriptApi.search(q, cs),
        Promise.resolve(
          searchCanvasTextNodes(
            canvasDoc,
            { id: canvasId, title: canvasTitle },
            q,
            cs,
            200,
          ),
        ),
      ]);
      const otherCanvases = (remote.canvases ?? []).filter(
        (c) => c.canvas_id !== canvasId,
      );
      const nextSnapshot: SearchSnapshot = {
        query: q,
        caseSensitive: cs,
        scriptResults: remote.files,
        localNodeResults: localNodes,
        remoteCanvasResults: otherCanvases,
      };
      setSnapshot(nextSnapshot);

      const allKeys = new Set<string>();
      for (const f of remote.files) {
        // Never auto-select truncated files or files with unsaved local editor changes
        if (!f.truncated && !dirtyScriptIds.has(f.id)) {
          allKeys.add(`script:${f.id}`);
        }
      }
      for (const n of localNodes) {
        if (!n.truncated) allKeys.add(`localnode:${n.nodeId}`);
      }
      for (const c of otherCanvases) {
        for (const n of c.nodes) {
          if (!n.truncated) {
            allKeys.add(`remotenode:${c.canvas_id}:${n.node_id}`);
          }
        }
      }
      setSelectedKeys(allKeys);
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  };

  const applyReplacements = async () => {
    if (!snapshot || !selectedKeys.size || replacing) return;
    setReplacing(true);
    setError("");
    setStatusMessage("");
    try {
      const chosenScripts = snapshot.scriptResults.filter(
        (f) => !f.truncated && selectedKeys.has(`script:${f.id}`),
      );
      const chosenLocalNodes = snapshot.localNodeResults.filter(
        (n) => !n.truncated && selectedKeys.has(`localnode:${n.nodeId}`),
      );

      let savedCount = 0;
      const failures: string[] = [];
      const savedScriptIds: string[] = [];

      // 1. Chunked script replacements (respecting <= 25 items and <= 1.5 MiB per request)
      if (chosenScripts.length > 0) {
        const encoder = new TextEncoder();
        const items = chosenScripts
          .filter((f) => {
            if (dirtyScriptIds.has(f.id)) {
              failures.push(
                `「${f.path}」有尚未保存的本地草稿，已跳过替换以保护草稿`,
              );
              return false;
            }
            return true;
          })
          .map((f) => ({
            id: f.id,
            expected_revision: f.revision,
            expected_text: f.body_md,
            next_text: applyMatchSpansReplacement(
              f.body_md,
              f.matches,
              replacement,
            ),
          }));

        let batch: typeof items = [];
        let batchBytes = 0;
        const flushBatch = async (chunk: typeof items) => {
          if (!chunk.length) return;
          const res = await scriptApi.replace(chunk);
          for (const r of res.results) {
            if (r.saved) {
              savedCount++;
              savedScriptIds.push(r.id);
            } else if (r.error) {
              failures.push(r.error);
            }
          }
        };

        for (const item of items) {
          const itemBytes = encoder.encode(JSON.stringify(item)).length;
          if (
            batch.length > 0 &&
            (batch.length >= MAX_BATCH_ITEMS ||
              batchBytes + itemBytes > MAX_BATCH_BYTES)
          ) {
            await flushBatch(batch);
            batch = [];
            batchBytes = 0;
          }
          batch.push(item);
          batchBytes += itemBytes;
        }
        await flushBatch(batch);

        if (savedScriptIds.length > 0) {
          await onScriptsChanged(savedScriptIds);
        }
      }

      // 2. Other workspace canvases replacement (optimistic expected_revision per canvas)
      const remoteCanvasPayloads: {
        canvas_id: string;
        expected_revision: number;
        nodes: { node_id: string; expected_text: string; next_text: string }[];
      }[] = [];

      for (const c of snapshot.remoteCanvasResults) {
        const picked = c.nodes.filter(
          (n) =>
            !n.truncated &&
            selectedKeys.has(`remotenode:${c.canvas_id}:${n.node_id}`),
        );
        if (!picked.length) continue;
        remoteCanvasPayloads.push({
          canvas_id: c.canvas_id,
          expected_revision: c.revision,
          nodes: picked.map((n) => ({
            node_id: n.node_id,
            expected_text: n.current_text,
            next_text: applyMatchSpansReplacement(
              n.current_text,
              n.matches,
              replacement,
            ),
          })),
        });
      }

      for (let i = 0; i < remoteCanvasPayloads.length; i += 10) {
        const slice = remoteCanvasPayloads.slice(i, i + 10);
        const res = await scriptApi.replace([], slice);
        for (const cr of res.canvas_results ?? []) {
          if (cr.saved) {
            const nodeCount =
              slice.find((x) => x.canvas_id === cr.canvas_id)?.nodes.length ?? 1;
            savedCount += nodeCount;
          } else if (cr.error) {
            failures.push(cr.error);
          }
        }
      }

      // 3. Active canvas nodes replacement (exact span replacement + expectedText verification)
      if (chosenLocalNodes.length > 0) {
        let localSaved = 0;
        onReplaceCanvasDoc((current) => {
          let next = current;
          for (const item of chosenLocalNodes) {
            try {
              next = replaceCanvasNodeText(
                next,
                item.nodeId,
                item.currentText,
                applyMatchSpansReplacement(
                  item.currentText,
                  item.matches,
                  replacement,
                ),
              );
              localSaved++;
            } catch (err) {
              failures.push(
                err instanceof Error ? err.message : "节点替换冲突",
              );
            }
          }
          return next;
        });
        savedCount += localSaved;
      }

      setPreviewing(false);
      setStatusMessage(
        `已完成替换 ${savedCount} 项${failures.length ? `（${failures.length} 项未覆盖：${failures[0]}）` : ""}`,
      );
      await runSearch(snapshot.query, snapshot.caseSensitive, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量替换失败");
    } finally {
      setReplacing(false);
    }
  };

  const summaryStats = useMemo(() => {
    if (!snapshot) return { scriptFiles: 0, nodeCount: 0, totalMatches: 0 };
    const remoteNodeCount = snapshot.remoteCanvasResults.reduce(
      (sum, c) => sum + c.nodes.length,
      0,
    );
    const totalMatches =
      snapshot.scriptResults.reduce((s, f) => s + f.matches.length, 0) +
      snapshot.localNodeResults.reduce((s, n) => s + n.matches.length, 0) +
      snapshot.remoteCanvasResults.reduce(
        (s, c) => s + c.nodes.reduce((ns, n) => ns + n.matches.length, 0),
        0,
      );
    return {
      scriptFiles: snapshot.scriptResults.length,
      nodeCount: snapshot.localNodeResults.length + remoteNodeCount,
      totalMatches,
    };
  }, [snapshot]);

  return (
    <div
      className="fm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="工作区全文搜索与替换"
      onClick={(e) => {
        if (e.target === e.currentTarget && !replacing) onClose();
      }}
    >
      <div className="fm-ws-search-dialog">
        <header className="fm-script-sync-head">
          <div>
            <h2>
              <Search size={18} />
              工作区全文搜索与替换（剧本 + 全部画布节点）
            </h2>
            <p>跨工作区所有剧本文档与全部画布节点统一检索，预览与提交共用精确匹配区间与乐观锁保护。</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭全文搜索"
            disabled={replacing}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <form
          className="fm-ws-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
        >
          <div className="fm-ws-search-row">
            <input
              ref={inputRef}
              value={query}
              placeholder="查找文本（同时检索剧本文档与工作区所有画布节点）"
              aria-label="查找文本"
              disabled={replacing}
              onChange={(e) => handleQueryChange(e.target.value)}
            />
            <label className="fm-sync-checkbox">
              <input
                type="checkbox"
                checked={caseSensitive}
                disabled={replacing}
                onChange={(e) => handleCaseSensitiveChange(e.target.checked)}
              />
              <span>区分大小写</span>
            </label>
            <button
              type="submit"
              className="primary"
              disabled={!query || searching || replacing}
            >
              {searching ? "搜索中…" : "搜索"}
            </button>
          </div>
          <div className="fm-ws-search-row">
            <input
              value={replacement}
              placeholder="替换为（留空表示删除匹配词）"
              aria-label="替换文本"
              disabled={replacing}
              onChange={(e) => setReplacement(e.target.value)}
            />
            <button
              type="button"
              className="secondary"
              disabled={
                !snapshot || selectedKeys.size === 0 || searching || replacing
              }
              onClick={() => setPreviewing((v) => !v)}
            >
              <Replace size={15} />
              {previewing ? "返回结果列表" : `预览替换 (${selectedKeys.size})`}
            </button>
          </div>
        </form>

        {statusMessage && (
          <p className="fm-pack-notice" role="status">
            <Check size={14} /> {statusMessage}
          </p>
        )}
        {error && (
          <p className="fm-sync-error" role="alert">
            {error}
          </p>
        )}

        {snapshot && (
          <p className="fm-ws-search-summary fm-number">
            命中 {summaryStats.scriptFiles} 个剧本文档与 {summaryStats.nodeCount}{" "}
            个画布节点，共 {summaryStats.totalMatches} 处匹配。
          </p>
        )}

        <div className="fm-ws-search-results">
          {snapshot?.scriptResults.map((file) => {
            const key = `script:${file.id}`;
            const isDirty = dirtyScriptIds.has(file.id);
            if (previewing && !selectedKeys.has(key)) return null;
            return (
              <section key={key} className="fm-ws-hit-group">
                <header>
                  {!previewing && (
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(key)}
                      disabled={file.truncated || isDirty || replacing}
                      onChange={(e) =>
                        setSelectedKeys((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(key);
                          else next.delete(key);
                          return next;
                        })
                      }
                    />
                  )}
                  <FileText size={14} />
                  <strong>{file.path}</strong>
                  <span className="fm-ws-hit-badge">
                    剧本 · {file.matches.length} 处
                    {file.truncated
                      ? "（超限截断，请缩小查找词后替换）"
                      : isDirty
                        ? "（有未保存草稿，已保护跳过）"
                        : ""}
                  </span>
                </header>
                {file.matches.map((m, idx) =>
                  previewing ? (
                    <div key={idx} className="fm-ws-diff-row">
                      <span className="fm-ws-pos">
                        {m.line}:{m.column}
                      </span>
                      <div>
                        <div className="fm-ws-diff-before">
                          − {m.before}
                          <mark>{m.text}</mark>
                          {m.after}
                        </div>
                        <div className="fm-ws-diff-after">
                          + {m.before}
                          <mark>{replacement}</mark>
                          {m.after}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      key={idx}
                      type="button"
                      className="fm-ws-match-btn"
                      onClick={() => {
                        onOpenScriptMatch(file.id, file.path, m.line);
                        onClose();
                      }}
                    >
                      <span className="fm-ws-pos">
                        {m.line}:{m.column}
                      </span>
                      <span className="fm-ws-snippet">
                        {m.before}
                        <mark>{m.text}</mark>
                        {m.after}
                      </span>
                    </button>
                  ),
                )}
              </section>
            );
          })}

          {snapshot?.localNodeResults.map((node) => {
            const key = `localnode:${node.nodeId}`;
            if (previewing && !selectedKeys.has(key)) return null;
            return (
              <section key={key} className="fm-ws-hit-group">
                <header>
                  {!previewing && (
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(key)}
                      disabled={node.truncated || replacing}
                      onChange={(e) =>
                        setSelectedKeys((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(key);
                          else next.delete(key);
                          return next;
                        })
                      }
                    />
                  )}
                  <Layers size={14} />
                  <strong>
                    {node.canvasTitle} / {node.nodeTitle}
                  </strong>
                  <span className="fm-ws-hit-badge">
                    当前画布节点 · {node.matches.length} 处
                    {node.truncated ? "（超限截断，请缩小查找词后替换）" : ""}
                  </span>
                </header>
                {node.matches.map((m, idx) =>
                  previewing ? (
                    <div key={idx} className="fm-ws-diff-row">
                      <span className="fm-ws-pos">
                        {m.line}:{m.column}
                      </span>
                      <div>
                        <div className="fm-ws-diff-before">
                          − {m.before}
                          <mark>{m.text}</mark>
                          {m.after}
                        </div>
                        <div className="fm-ws-diff-after">
                          + {m.before}
                          <mark>{replacement}</mark>
                          {m.after}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      key={idx}
                      type="button"
                      className="fm-ws-match-btn"
                      onClick={() => {
                        onFocusCanvasNode(node.nodeId);
                        onClose();
                      }}
                    >
                      <span className="fm-ws-pos">
                        {m.line}:{m.column}
                      </span>
                      <span className="fm-ws-snippet">
                        {m.before}
                        <mark>{m.text}</mark>
                        {m.after}
                      </span>
                    </button>
                  ),
                )}
              </section>
            );
          })}

          {snapshot?.remoteCanvasResults.flatMap((c) =>
            c.nodes.map((node) => {
              const key = `remotenode:${c.canvas_id}:${node.node_id}`;
              if (previewing && !selectedKeys.has(key)) return null;
              return (
                <section key={key} className="fm-ws-hit-group">
                  <header>
                    {!previewing && (
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(key)}
                        disabled={node.truncated || replacing}
                        onChange={(e) =>
                          setSelectedKeys((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(key);
                            else next.delete(key);
                            return next;
                          })
                        }
                      />
                    )}
                    <Layers size={14} />
                    <strong>
                      {c.canvas_title} / {node.node_title || node.node_id}
                    </strong>
                    <span className="fm-ws-hit-badge">
                      其他画布节点 · {node.matches.length} 处
                      {node.truncated ? "（超限截断，请缩小查找词后替换）" : ""}
                    </span>
                  </header>
                  {node.matches.map((m, idx) =>
                    previewing ? (
                      <div key={idx} className="fm-ws-diff-row">
                        <span className="fm-ws-pos">
                          {m.line}:{m.column}
                        </span>
                        <div>
                          <div className="fm-ws-diff-before">
                            − {m.before}
                            <mark>{m.text}</mark>
                            {m.after}
                          </div>
                          <div className="fm-ws-diff-after">
                            + {m.before}
                            <mark>{replacement}</mark>
                            {m.after}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        key={idx}
                        type="button"
                        className="fm-ws-match-btn"
                        onClick={() => {
                          onSwitchCanvasProject(c.canvas_id);
                          onClose();
                        }}
                      >
                        <span className="fm-ws-pos">
                          {m.line}:{m.column}
                        </span>
                        <span className="fm-ws-snippet">
                          {m.before}
                          <mark>{m.text}</mark>
                          {m.after}
                        </span>
                      </button>
                    ),
                  )}
                </section>
              );
            }),
          )}
        </div>

        <footer className="fm-script-sync-foot">
          <span className="fm-ws-foot-hint">
            冲突或未保存草稿自动保留原文，不会覆盖未读取的最新修改。
          </span>
          <div className="fm-script-sync-actions">
            <button
              type="button"
              className="secondary"
              disabled={replacing}
              onClick={onClose}
            >
              关闭
            </button>
            {previewing && (
              <button
                type="button"
                className="primary"
                disabled={replacing || selectedKeys.size === 0}
                onClick={() => void applyReplacements()}
              >
                {replacing
                  ? "正在替换…"
                  : `确认替换已选 (${selectedKeys.size})`}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
