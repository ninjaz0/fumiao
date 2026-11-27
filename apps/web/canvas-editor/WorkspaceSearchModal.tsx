import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FileText, Layers, Replace, Search, X } from "lucide-react";
import {
  scriptApi,
  type ScriptSearchCanvasResult,
  type ScriptSearchFileResult,
} from "./script-api";
import {
  MAX_CANVAS_NODE_TEXT_CHARS,
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
  scannedFiles: number;
  totalFiles: number;
  scannedCanvases: number;
  totalCanvases: number;
  truncated: boolean;
};

const MAX_BATCH_ITEMS = 25;
const MAX_BATCH_BYTES = 1_200_000;
const MAX_SCRIPT_BODY_BYTES = 512 * 1024;

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
  const searchSeqRef = useRef(0);
  const liveCriteriaRef = useRef({ query: "", caseSensitive: false });
  const latestCanvasDocRef = useRef<Doc>(canvasDoc);
  latestCanvasDocRef.current = canvasDoc;
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

  // Changing query or case-sensitivity invalidates in-flight searches AND previous search snapshot
  // so slow responses, preview, and apply NEVER run with mismatched search parameters.
  const handleQueryChange = (nextQuery: string) => {
    ++searchSeqRef.current;
    liveCriteriaRef.current = { ...liveCriteriaRef.current, query: nextQuery };
    setQuery(nextQuery);
    setSearching(false);
    setSnapshot(null);
    setPreviewing(false);
    setSelectedKeys(new Set());
  };

  const handleCaseSensitiveChange = (nextCase: boolean) => {
    ++searchSeqRef.current;
    liveCriteriaRef.current = {
      ...liveCriteriaRef.current,
      caseSensitive: nextCase,
    };
    setCaseSensitive(nextCase);
    setSearching(false);
    setSnapshot(null);
    setPreviewing(false);
    setSelectedKeys(new Set());
  };

  const runSearch = async (
    overrideQuery?: string,
    overrideCase?: boolean,
    preserveStatus = false,
    overrideCanvasDoc?: Doc,
  ) => {
    const q = overrideQuery ?? query;
    const cs = overrideCase ?? caseSensitive;
    if (!q) return;
    liveCriteriaRef.current = { query: q, caseSensitive: cs };
    const reqSeq = ++searchSeqRef.current;
    const activeCanvasDoc = overrideCanvasDoc ?? latestCanvasDocRef.current;
    setSearching(true);
    setError("");
    if (!preserveStatus) setStatusMessage("");
    setPreviewing(false);
    try {
      const [remote, localNodes] = await Promise.all([
        scriptApi.search(q, cs),
        Promise.resolve(
          searchCanvasTextNodes(
            activeCanvasDoc,
            { id: canvasId, title: canvasTitle },
            q,
            cs,
            200,
          ),
        ),
      ]);
      if (
        reqSeq !== searchSeqRef.current ||
        q !== liveCriteriaRef.current.query ||
        cs !== liveCriteriaRef.current.caseSensitive
      ) {
        return;
      }
      const otherCanvases = (remote.canvases ?? []).filter(
        (c) => c.canvas_id !== canvasId,
      );
      const localTruncated = localNodes.some((n) => n.truncated);
      const nextSnapshot: SearchSnapshot = {
        query: q,
        caseSensitive: cs,
        scriptResults: remote.files,
        localNodeResults: localNodes,
        remoteCanvasResults: otherCanvases,
        scannedFiles: remote.scanned_files,
        totalFiles: remote.total_files ?? remote.scanned_files,
        scannedCanvases: remote.scanned_canvases ?? 0,
        totalCanvases: remote.total_canvases ?? remote.scanned_canvases ?? 0,
        truncated: Boolean(remote.truncated) || localTruncated,
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
      if (reqSeq === searchSeqRef.current) {
        setError(e instanceof Error ? e.message : "搜索失败");
      }
    } finally {
      if (reqSeq === searchSeqRef.current) {
        setSearching(false);
      }
    }
  };

  const applyReplacements = async () => {
    if (!snapshot || !selectedKeys.size || replacing) return;
    if (snapshot.query !== query || snapshot.caseSensitive !== caseSensitive) {
      setSnapshot(null);
      setPreviewing(false);
      setSelectedKeys(new Set());
      setError("搜索条件已变更，请重新搜索后再执行替换");
      return;
    }
    setReplacing(true);
    setError("");
    setStatusMessage("");
    try {
      const encoder = new TextEncoder();
      const chosenScripts = snapshot.scriptResults.filter(
        (f) => !f.truncated && selectedKeys.has(`script:${f.id}`),
      );
      const chosenLocalNodes = snapshot.localNodeResults.filter(
        (n) => !n.truncated && selectedKeys.has(`localnode:${n.nodeId}`),
      );

      let savedCount = 0;
      const failures: string[] = [];

      // 1. Chunked script replacements (actual JSON payload <= 1.2 MB & <= 25 items; refresh per batch)
      if (chosenScripts.length > 0) {
        const items: {
          id: string;
          expected_revision: number;
          expected_text: string;
          next_text: string;
        }[] = [];
        for (const f of chosenScripts) {
          if (dirtyScriptIds.has(f.id)) {
            failures.push(
              `「${f.path}」有尚未保存的本地草稿，已跳过替换以保护草稿`,
            );
            continue;
          }
          const nextText = applyMatchSpansReplacement(
            f.body_md,
            f.matches,
            replacement,
          );
          if (encoder.encode(nextText).length > MAX_SCRIPT_BODY_BYTES) {
            failures.push(`「${f.path}」替换后超出单文件体积上限，已保留原文`);
            continue;
          }
          items.push({
            id: f.id,
            expected_revision: f.revision,
            expected_text: f.body_md,
            next_text: nextText,
          });
        }

        let batch: typeof items = [];
        const flushBatch = async (chunk: typeof items) => {
          if (!chunk.length) return;
          try {
            const res = await scriptApi.replace(chunk);
            const batchSavedIds: string[] = [];
            for (const r of res.results) {
              if (r.saved) {
                savedCount++;
                batchSavedIds.push(r.id);
              } else if (r.error) {
                failures.push(r.error);
              }
            }
            if (batchSavedIds.length > 0) {
              await onScriptsChanged(batchSavedIds);
            }
          } catch (batchErr) {
            failures.push(
              batchErr instanceof Error ? batchErr.message : "部分剧本批次替换失败",
            );
          }
        };

        for (const item of items) {
          const candidateBytes = encoder.encode(
            JSON.stringify({ replacements: [...batch, item] }),
          ).length;
          if (
            batch.length > 0 &&
            (batch.length >= MAX_BATCH_ITEMS || candidateBytes > MAX_BATCH_BYTES)
          ) {
            await flushBatch(batch);
            batch = [];
          }
          batch.push(item);
        }
        await flushBatch(batch);
      }

      // 2. Other workspace canvases replacement (node-level byte-bounded batching + revision chaining)
      type CanvasPatchItem = {
        canvas_id: string;
        expected_revision: number;
        nodes: { node_id: string; expected_text: string; next_text: string }[];
      };

      const flushCanvasBatch = async (
        slice: CanvasPatchItem[],
      ): Promise<Map<string, { saved: boolean; revision?: number }>> => {
        const outcomes = new Map<string, { saved: boolean; revision?: number }>();
        if (!slice.length) return outcomes;
        try {
          const res = await scriptApi.replace([], slice);
          for (const cr of res.canvas_results ?? []) {
            outcomes.set(cr.canvas_id, {
              saved: cr.saved,
              revision: cr.revision,
            });
            if (cr.saved) {
              const nodeCount =
                slice.find((x) => x.canvas_id === cr.canvas_id)?.nodes.length ?? 1;
              savedCount += nodeCount;
            } else if (cr.error) {
              failures.push(cr.error);
            }
          }
        } catch (batchErr) {
          failures.push(
            batchErr instanceof Error ? batchErr.message : "远端画布批次替换失败",
          );
        }
        return outcomes;
      };

      let pendingCanvasBatch: CanvasPatchItem[] = [];
      for (const c of snapshot.remoteCanvasResults) {
        const validNodes: {
          node_id: string;
          expected_text: string;
          next_text: string;
        }[] = [];
        for (const n of c.nodes) {
          if (
            n.truncated ||
            !selectedKeys.has(`remotenode:${c.canvas_id}:${n.node_id}`)
          ) {
            continue;
          }
          const nextText = applyMatchSpansReplacement(
            n.current_text,
            n.matches,
            replacement,
          );
          if ([...nextText].length > MAX_CANVAS_NODE_TEXT_CHARS) {
            failures.push(
              `画布「${c.canvas_title}」节点「${n.node_title}」替换后超出 ${MAX_CANVAS_NODE_TEXT_CHARS} 字上限，已保留原文`,
            );
            continue;
          }
          validNodes.push({
            node_id: n.node_id,
            expected_text: n.current_text,
            next_text: nextText,
          });
        }
        if (!validNodes.length) continue;

        // Split nodes of a single canvas into byte-safe nodeChunks if necessary
        const nodeChunks: (typeof validNodes)[] = [];
        let curNodes: typeof validNodes = [];
        for (const nodePatch of validNodes) {
          const probePayload = {
            replacements: [],
            canvas_replacements: [
              {
                canvas_id: c.canvas_id,
                expected_revision: c.revision,
                nodes: [...curNodes, nodePatch],
              },
            ],
          };
          const probeBytes = encoder.encode(JSON.stringify(probePayload)).length;
          if (curNodes.length > 0 && (curNodes.length >= 20 || probeBytes > MAX_BATCH_BYTES)) {
            nodeChunks.push(curNodes);
            curNodes = [];
          }
          curNodes.push(nodePatch);
        }
        if (curNodes.length > 0) nodeChunks.push(curNodes);

        if (nodeChunks.length === 1) {
          const entry: CanvasPatchItem = {
            canvas_id: c.canvas_id,
            expected_revision: c.revision,
            nodes: nodeChunks[0],
          };
          const combinedBytes = encoder.encode(
            JSON.stringify({
              replacements: [],
              canvas_replacements: [...pendingCanvasBatch, entry],
            }),
          ).length;
          if (
            pendingCanvasBatch.length > 0 &&
            (pendingCanvasBatch.length >= 10 || combinedBytes > MAX_BATCH_BYTES)
          ) {
            await flushCanvasBatch(pendingCanvasBatch);
            pendingCanvasBatch = [];
          }
          pendingCanvasBatch.push(entry);
        } else {
          // Multi-chunk single canvas: flush pending batch first, then chain revisions sequentially
          if (pendingCanvasBatch.length > 0) {
            await flushCanvasBatch(pendingCanvasBatch);
            pendingCanvasBatch = [];
          }
          let expectedRev = c.revision;
          for (const chunkNodes of nodeChunks) {
            const outcomes = await flushCanvasBatch([
              {
                canvas_id: c.canvas_id,
                expected_revision: expectedRev,
                nodes: chunkNodes,
              },
            ]);
            const outcome = outcomes.get(c.canvas_id);
            if (!outcome?.saved || typeof outcome.revision !== "number") {
              break;
            }
            expectedRev = outcome.revision;
          }
        }
      }
      if (pendingCanvasBatch.length > 0) {
        await flushCanvasBatch(pendingCanvasBatch);
      }

      // 3. Active canvas nodes replacement (exact span replacement + expectedText + max length check)
      let postReplaceCanvasDoc = latestCanvasDocRef.current;
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
          postReplaceCanvasDoc = next;
          latestCanvasDocRef.current = next;
          return next;
        });
        savedCount += localSaved;
      }

      setPreviewing(false);
      setStatusMessage(
        `已完成替换 ${savedCount} 项${failures.length ? `（${failures.length} 项未覆盖：${failures[0]}）` : ""}`,
      );
      await runSearch(
        snapshot.query,
        snapshot.caseSensitive,
        true,
        postReplaceCanvasDoc,
      );
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
                !snapshot ||
                snapshot.query !== query ||
                snapshot.caseSensitive !== caseSensitive ||
                selectedKeys.size === 0 ||
                searching ||
                replacing
              }
              onClick={() => {
                if (
                  !snapshot ||
                  snapshot.query !== query ||
                  snapshot.caseSensitive !== caseSensitive
                ) {
                  setSnapshot(null);
                  setPreviewing(false);
                  return;
                }
                setPreviewing((v) => !v);
              }}
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
            已扫描 {snapshot.scannedFiles}/{snapshot.totalFiles} 个剧本、
            {snapshot.scannedCanvases}/{snapshot.totalCanvases} 个画布；命中{" "}
            {summaryStats.scriptFiles} 个剧本文档与 {summaryStats.nodeCount}{" "}
            个画布节点，共 {summaryStats.totalMatches} 处匹配
            {snapshot.truncated
              ? "（结果较多已达到单次展示上限，请缩小查找词后分批替换）"
              : "。"}
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
