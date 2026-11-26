import { useEffect, useRef, useState } from "react";
import { Check, FileText, Layers, Replace, Search, X } from "lucide-react";
import { scriptApi, type ScriptSearchFileResult } from "./script-api";
import {
  replaceCanvasNodeText,
  searchCanvasTextNodes,
  type CanvasNodeSearchMatch,
} from "./script-fusion";
import type { Doc } from "./types";

export function WorkspaceSearchModal({
  canvasId,
  canvasTitle,
  canvasDoc,
  onOpenScriptMatch,
  onFocusCanvasNode,
  onReplaceCanvasDoc,
  onScriptsChanged,
  onClose,
}: {
  canvasId: string;
  canvasTitle: string;
  canvasDoc: Doc;
  onOpenScriptMatch: (docId: string, path: string, line: number) => void;
  onFocusCanvasNode: (nodeId: string) => void;
  onReplaceCanvasDoc: (updater: (current: Doc) => Doc) => void;
  onScriptsChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searching, setSearching] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [searched, setSearched] = useState(false);
  const [scriptResults, setScriptResults] = useState<ScriptSearchFileResult[]>(
    [],
  );
  const [nodeResults, setNodeResults] = useState<CanvasNodeSearchMatch[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = async () => {
    if (!query) return;
    setSearching(true);
    setError("");
    setStatusMessage("");
    setPreviewing(false);
    try {
      const [remote, localNodes] = await Promise.all([
        scriptApi.search(query, caseSensitive),
        Promise.resolve(
          searchCanvasTextNodes(
            canvasDoc,
            { id: canvasId, title: canvasTitle },
            query,
            caseSensitive,
          ),
        ),
      ]);
      setScriptResults(remote.files);
      setNodeResults(localNodes);
      const allKeys = new Set<string>();
      for (const f of remote.files) {
        if (!f.truncated) allKeys.add(`script:${f.id}`);
      }
      for (const n of localNodes) {
        allKeys.add(`node:${n.nodeId}`);
      }
      setSelectedKeys(allKeys);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  };

  const replaceLiteral = (source: string) => {
    if (!query) return source;
    if (caseSensitive) return source.split(query).join(replacement);
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return source.replace(new RegExp(escaped, "gi"), () => replacement);
  };

  const applyReplacements = async () => {
    if (!selectedKeys.size || replacing) return;
    setReplacing(true);
    setError("");
    setStatusMessage("");
    try {
      const chosenScripts = scriptResults.filter((f) =>
        selectedKeys.has(`script:${f.id}`),
      );
      const chosenNodes = nodeResults.filter((n) =>
        selectedKeys.has(`node:${n.nodeId}`),
      );

      let savedCount = 0;
      const failures: string[] = [];

      if (chosenScripts.length > 0) {
        const res = await scriptApi.replace(
          chosenScripts.map((f) => ({
            id: f.id,
            expected_revision: f.revision,
            expected_text: f.body_md,
            next_text: replaceLiteral(f.body_md),
          })),
        );
        for (const r of res.results) {
          if (r.saved) savedCount++;
          else if (r.error) failures.push(r.error);
        }
        await onScriptsChanged();
      }

      if (chosenNodes.length > 0) {
        onReplaceCanvasDoc((current) => {
          let next = current;
          for (const item of chosenNodes) {
            try {
              next = replaceCanvasNodeText(
                next,
                item.nodeId,
                item.currentText,
                replaceLiteral(item.currentText),
              );
              savedCount++;
            } catch (err) {
              failures.push(
                err instanceof Error ? err.message : "节点替换冲突",
              );
            }
          }
          return next;
        });
      }

      setPreviewing(false);
      setStatusMessage(
        `已完成替换 ${savedCount} 项${failures.length ? `（${failures.length} 项因并发修改保留原文）` : ""}`,
      );
      await runSearch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量替换失败");
    } finally {
      setReplacing(false);
    }
  };

  const totalMatches =
    scriptResults.reduce((s, f) => s + f.matches.length, 0) +
    nodeResults.reduce((s, n) => s + n.matches.length, 0);

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
              工作区全文搜索与替换（剧本 + 画布节点）
            </h2>
            <p>跨工作区所有剧本文档与当前画布文本/提示词节点统一检索与乐观锁替换。</p>
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
              placeholder="查找文本（同时检索剧本文档与画布节点）"
              aria-label="查找文本"
              disabled={replacing}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="fm-sync-checkbox">
              <input
                type="checkbox"
                checked={caseSensitive}
                disabled={replacing}
                onChange={(e) => setCaseSensitive(e.target.checked)}
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
                !searched || selectedKeys.size === 0 || searching || replacing
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

        {searched && (
          <p className="fm-ws-search-summary fm-number">
            命中 {scriptResults.length} 个剧本文档与 {nodeResults.length}{" "}
            个画布节点，共 {totalMatches} 处匹配。
          </p>
        )}

        <div className="fm-ws-search-results">
          {scriptResults.map((file) => {
            const key = `script:${file.id}`;
            if (previewing && !selectedKeys.has(key)) return null;
            return (
              <section key={key} className="fm-ws-hit-group">
                <header>
                  {!previewing && (
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(key)}
                      disabled={file.truncated || replacing}
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
                  <span className="fm-ws-hit-badge">剧本 · {file.matches.length} 处</span>
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

          {nodeResults.map((node) => {
            const key = `node:${node.nodeId}`;
            if (previewing && !selectedKeys.has(key)) return null;
            return (
              <section key={key} className="fm-ws-hit-group">
                <header>
                  {!previewing && (
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(key)}
                      disabled={replacing}
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
                    画布节点 · {node.matches.length} 处
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
        </div>

        <footer className="fm-script-sync-foot">
          <span className="fm-ws-foot-hint">
            冲突文件自动保留原文，不会覆盖其他协作者未读取的最新修改。
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
