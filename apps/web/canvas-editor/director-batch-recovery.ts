import { useCallback, useEffect, useState } from "react";
import type { PendingDirectorBatch } from "./director-batch";

function readBatch(value: string | null): PendingDirectorBatch | null {
  try {
    const batch = JSON.parse(value ?? "null") as PendingDirectorBatch | null;
    return batch && /^[0-9a-f-]{36}$/i.test(batch.request?.uid) &&
      Array.isArray(batch.request.director?.targets) ? batch : null;
  } catch {
    return null;
  }
}

function findBatches(scope: string): PendingDirectorBatch[] {
  try {
    const entries = new Map<string, PendingDirectorBatch>();
    const existing = readBatch(localStorage.getItem(scope));
    if (existing) entries.set(existing.request.uid, existing);
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(scope + ":")) continue;
      const batch = readBatch(localStorage.getItem(key));
      if (batch && key === `${scope}:${batch.request.uid}`) entries.set(batch.request.uid, batch);
    }
    return [...entries.values()];
  } catch {
    return [];
  }
}

export function useDirectorBatchRecovery(scope: string) {
  const selectionKey = scope + ":selected";
  const [batches, setBatches] = useState(() => findBatches(scope));
  const [preferredUid, setPreferredUid] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(selectionKey);
    } catch {
      return null;
    }
  });
  const prefer = useCallback((uid: string | null) => {
    try {
      if (uid) sessionStorage.setItem(selectionKey, uid);
      else sessionStorage.removeItem(selectionKey);
    } catch {
      // The durable entries remain available from other tabs.
    }
    setPreferredUid(uid);
  }, [selectionKey]);
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.storageArea === localStorage &&
        (!event.key || event.key === scope || event.key.startsWith(scope + ":"))) {
        setBatches(findBatches(scope));
      }
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [scope]);

  const save = (batch: PendingDirectorBatch) => {
    const uid = batch.request.uid;
    const key = `${scope}:${uid}`;
    try {
      const existing = readBatch(localStorage.getItem(key));
      if (!existing?.attachment || batch.attachment) localStorage.setItem(key, JSON.stringify(batch));
    } catch {
      if (!batch.receipt && !batch.rejected) throw new Error("浏览器无法保存提交号，请允许本地存储后重试。");
    }
    setBatches((current) => {
      const existing = current.find((entry) => entry.request.uid === uid);
      if (existing?.attachment && !batch.attachment) return current;
      return [...current.filter((entry) => entry.request.uid !== uid), batch];
    });
    prefer(uid);
  };
  const clear = (uid: string) => {
    try {
      localStorage.removeItem(`${scope}:${uid}`);
      if (readBatch(localStorage.getItem(scope))?.request.uid === uid) localStorage.removeItem(scope);
    } catch {
      throw new Error("浏览器无法清理已确认的提交回执。");
    }
    setBatches((current) => current.filter((batch) => batch.request.uid !== uid));
    if (preferredUid === uid) prefer(null);
  };
  return { batches, preferredUid, prefer, save, clear };
}
