export type BibleEditMode = "structured" | "notes";

export type SeriesBibleEditorSession = {
  seriesId: string;
  expectedRevision: number;
  mode: BibleEditMode;
  draft: string;
  conflicted?: boolean;
};

export function isStructuredBible(
  bible: Record<string, unknown> | undefined | null,
): boolean {
  if (!bible || typeof bible !== "object" || Array.isArray(bible)) return false;
  const keys = Object.keys(bible);
  if (keys.length === 0) return false;
  if (keys.length === 1 && typeof bible.notes === "string") return false;
  return true;
}

export function formatBibleText(
  bible: Record<string, unknown> | undefined | null,
): string {
  if (!bible) return "";
  const keys = Object.keys(bible);
  if (keys.length === 0) return "";
  if (keys.length === 1 && typeof bible.notes === "string") {
    return bible.notes;
  }
  return JSON.stringify(bible, null, 2);
}

export function parseBibleDraft(
  raw: string,
  mode: BibleEditMode = "notes",
): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (mode === "structured") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(
        "结构化世界观 JSON 格式有误（请检查括号、引号或尾随逗号），草稿已保留",
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        "结构化世界观必须是 JSON 对象（例如 {\"era\": \"2088\"}），草稿已保留",
      );
    }
    return parsed as Record<string, unknown>;
  }
  return { notes: trimmed };
}

export function openSeriesBibleSession(item: {
  id: string;
  revision: number;
  bible?: Record<string, unknown> | null;
}): SeriesBibleEditorSession {
  return {
    seriesId: item.id,
    expectedRevision: item.revision,
    mode: isStructuredBible(item.bible) ? "structured" : "notes",
    draft: formatBibleText(item.bible),
    conflicted: false,
  };
}

export function applyLoadedSeriesListToBibleSession(
  session: SeriesBibleEditorSession | null,
  loadedSeries: readonly { id: string; revision: number }[],
): SeriesBibleEditorSession | null {
  if (!session) return null;
  if (!loadedSeries.some((s) => s.id === session.seriesId)) return null;
  return session;
}

export async function submitSeriesBibleSession<T>(
  session: SeriesBibleEditorSession,
  updater: (
    seriesId: string,
    payload: { expected_revision: number; bible: Record<string, unknown> },
  ) => Promise<T>,
): Promise<
  | { ok: true; result: T; nextBible: Record<string, unknown> }
  | {
      ok: false;
      status?: number;
      error: string;
      session: SeriesBibleEditorSession;
    }
> {
  let nextBible: Record<string, unknown>;
  try {
    nextBible = parseBibleDraft(session.draft, session.mode);
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
      session,
    };
  }
  try {
    const result = await updater(session.seriesId, {
      expected_revision: session.expectedRevision,
      bible: nextBible,
    });
    return { ok: true, result, nextBible };
  } catch (e) {
    const status =
      typeof (e as { status?: unknown })?.status === "number"
        ? (e as { status: number }).status
        : undefined;
    if (status === 409) {
      return {
        ok: false,
        status: 409,
        error:
          "世界观设定已被其他协作者更新，当前草稿已保留。请先复制需要保留的内容，再加载最新设定。",
        session: { ...session, conflicted: true },
      };
    }
    return {
      ok: false,
      status,
      error: (e as Error).message || "保存失败",
      session,
    };
  }
}
