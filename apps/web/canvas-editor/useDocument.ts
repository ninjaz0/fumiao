import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { draftEquals } from "./performance";
import type { Draft, Project } from "./types";
const clone = <T>(v: T): T => structuredClone(v);
export function useDocument(project: Project, userId: number) {
  const [editorId] = useState(() => {
    let id = sessionStorage.getItem("fm-canvas-editor");
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem("fm-canvas-editor", id); }
    return id;
  });
  const key = `fm-canvas-${userId}-${project.id}-${editorId}`;
  const initial = useRef<{
    draft: Draft;
    revision: number;
    conflict: boolean;
    dirty: boolean;
  } | null>(null);
  if (!initial.current) {
    let draft: Draft = { title: project.title, document: project.document },
      revision = project.revision,
      conflict = false,
      dirty = false;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null") as
        | { draft: Draft; revision: number }
        | null;
      if (
        saved?.draft &&
        saved.draft.document.schemaVersion === 1 &&
        JSON.stringify(saved.draft) !== JSON.stringify(draft)
      ) {
        draft = saved.draft;
        revision = saved.revision;
        dirty = true;
        conflict = revision !== project.revision;
      }
    } catch {}
    initial.current = { draft, revision, conflict, dirty };
  }
  const [value, setValue] = useState(initial.current.draft),
    ref = useRef(value);
  const revision = useRef(initial.current.revision),
    serial = useRef(initial.current.dirty ? 1 : 0),
    ack = useRef(0);
  const hasUnsavedChanges = useCallback(() => serial.current !== ack.current, []);
  const [status, setStatus] = useState(
    initial.current.conflict
      ? "conflict"
      : initial.current.dirty
        ? "dirty"
        : "saved",
  );
  const blocked = useRef(initial.current.conflict),
    busy = useRef<Promise<number> | null>(null),
    gesture = useRef<Draft | null>(null),
    allowUnload = useRef(false);
  const undo = useRef<Draft[]>([]),
    redo = useRef<Draft[]>([]),
    [historyTick, setHistoryTick] = useState(0);
  const [error, setError] = useState(""),
    alive = useRef(true),
    rememberTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remember = useCallback(() => {
    if (rememberTimer.current !== null) {
      clearTimeout(rememberTimer.current);
      rememberTimer.current = null;
    }
    try {
      if (serial.current === ack.current) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(
          key,
          JSON.stringify({ revision: revision.current, draft: ref.current }),
        );
      }
      return true;
    } catch {
      setError("浏览器无法保留本地草稿，请保持页面打开并保存");
      return false;
    }
  }, [key]);
  const scheduleRemember = useCallback(() => {
    if (!gesture.current) {
      remember();
      return;
    }
    if (rememberTimer.current !== null) return;
    rememberTimer.current = setTimeout(() => {
      rememberTimer.current = null;
      remember();
    }, 300);
  }, [remember]);
  const apply = useCallback(
    (next: Draft, history = true) => {
      if (draftEquals(ref.current, next)) return;
      if (history) {
        undo.current.push(clone(ref.current));
        undo.current = undo.current.slice(-80);
        redo.current = [];
        setHistoryTick((n) => n + 1);
      }
      ref.current = next;
      serial.current++;
      setValue(next);
      if (!blocked.current) setStatus("dirty");
      if (history) remember();
      else scheduleRemember();
    },
    [remember, scheduleRemember],
  );
  const change = useCallback(
    (fn: (v: Draft) => Draft, history = true) =>
      apply(fn(ref.current), history),
    [apply],
  );
  const begin = useCallback(() => {
    if (!gesture.current) gesture.current = clone(ref.current);
  }, []);
  const end = useCallback(() => {
    if (gesture.current && !draftEquals(gesture.current, ref.current)) {
      undo.current.push(gesture.current);
      undo.current = undo.current.slice(-80);
      redo.current = [];
      setHistoryTick((n) => n + 1);
    }
    gesture.current = null;
    if (rememberTimer.current !== null) remember();
  }, [remember]);
  const travel = useCallback(
    (forward = false) => {
      end();
      const source = forward ? redo.current : undo.current,
        dest = forward ? undo.current : redo.current;
      const next = source.pop();
      if (!next) return;
      dest.push(clone(ref.current));
      apply(next, false);
      setHistoryTick((n) => n + 1);
    },
    [apply, end],
  );
  const flush = useCallback(async (): Promise<number> => {
    if (blocked.current) throw new Error("请先处理保存冲突");
    if (busy.current) {
      await busy.current;
      return flush();
    }
    if (serial.current === ack.current) return revision.current;
    const snapshot = clone(ref.current),
      seq = serial.current;
    setStatus("saving");
    setError("");
    const work = api<Draft & { revision: number }>(
      `/api/canvases/${project.id}/document`,
      { ...snapshot, expected_revision: revision.current },
      "PUT",
    )
      .then((result) => {
        revision.current = result.revision;
        ack.current = seq;
        if (alive.current) {
          if (serial.current === seq) {
            const serverDraft = {
              title: result.title,
              document: result.document,
            };
            if (!draftEquals(ref.current, serverDraft)) {
              ref.current = serverDraft;
              setValue(ref.current);
            }
          }
          setStatus(serial.current === seq ? "saved" : "dirty");
          remember();
        }
        return revision.current;
      })
      .catch((e) => {
        const conflict = e instanceof ApiError && e.status === 409;
        const saveError = conflict
          ? new ApiError("画布已被其他成员修改，请先处理保存冲突。", e.status)
          : e;
        if (alive.current) {
          if (conflict) {
            blocked.current = true;
            setStatus("conflict");
          } else setStatus("error");
          setError(saveError.message);
        }
        throw saveError;
      })
      .finally(() => {
        busy.current = null;
      });
    busy.current = work;
    await work;
    if (serial.current !== ack.current) return flush();
    return revision.current;
  }, [project.id, remember]);
  useEffect(() => {
    if (status !== "dirty") return;
    const timer = setTimeout(() => {
      if (!gesture.current) void flush().catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [value, status, historyTick, flush]);
  useEffect(() => {
    alive.current = true;
    const persistPending = () => {
      if (serial.current !== ack.current) remember();
    };
    const before = (event: BeforeUnloadEvent) => {
      if (allowUnload.current) {
        allowUnload.current = false;
        return;
      }
      if (serial.current !== ack.current) {
        remember();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const onVisibility = () => {
      if (document.hidden) persistPending();
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("pagehide", persistPending);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive.current = false;
      if (rememberTimer.current !== null) {
        clearTimeout(rememberTimer.current);
        rememberTimer.current = null;
      }
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("pagehide", persistPending);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [remember]);
  const acceptRemote = (result: Project, expectedDraft: string, operation = "采用回答") => {
    if (JSON.stringify(ref.current) !== expectedDraft) {
      blocked.current = true; setStatus("conflict");
      setError(operation + "期间画布发生了修改，请先处理保存冲突。");
      remember(); throw new Error("画布有新的本地修改，请先处理保存冲突");
    }
    undo.current.push(clone(ref.current)); redo.current = []; setHistoryTick(n => n + 1);
    revision.current = result.revision; ref.current = {title: result.title, document: result.document};
    setValue(ref.current); serial.current++; ack.current = serial.current; setStatus("saved"); remember();
  };
  const reload = () => {
    ack.current = serial.current;
    blocked.current = false;
    localStorage.removeItem(key);
    location.reload();
  };
  const leave = (url: string) => {
    allowUnload.current = true;
    location.assign(url);
  };
  return {
    value,
    ref,
    revision,
    change,
    begin,
    end,
    travel,
    flush,
    remember,
    leave,
    status,
    error,
    reload,
    acceptRemote,
    canUndo: undo.current.length > 0,
    canRedo: redo.current.length > 0,
    dirty: hasUnsavedChanges(),
    hasUnsavedChanges,
  };
}
