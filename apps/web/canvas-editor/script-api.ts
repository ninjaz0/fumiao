import { api } from "./api";

export type ScriptDocKind =
  | "outline"
  | "script"
  | "assets"
  | "shotlist"
  | "notes";

export type ScriptEntryType = "file" | "directory";

export type ScriptDocumentSummary = {
  id: string;
  path: string;
  name: string;
  parent_path: string;
  entry_type: ScriptEntryType;
  doc_kind: ScriptDocKind;
  canvas_id: string | null;
  series_id: string | null;
  revision: number;
  char_count: number;
  line_count: number;
  preview: string;
  updated: number;
  can_delete: boolean;
};

export type ScriptDocumentDetail = ScriptDocumentSummary & {
  body_md: string;
};

export type ScriptSearchMatch = {
  start: number;
  end: number;
  line: number;
  column: number;
  before: string;
  text: string;
  after: string;
};

export type ScriptSearchFileResult = {
  id: string;
  path: string;
  doc_kind: string;
  revision: number;
  body_md: string;
  matches: ScriptSearchMatch[];
  truncated: boolean;
};

export type ScriptSearchCanvasResult = {
  canvas_id: string;
  canvas_title: string;
  revision: number;
  nodes: {
    node_id: string;
    node_title: string;
    node_type: string;
    field: "text" | "prompt";
    current_text: string;
    matches: ScriptSearchMatch[];
    truncated: boolean;
  }[];
};

export type WorkspaceCanvasSummary = {
  id: string;
  title: string;
  count: number;
  updated: number;
};

export const scriptApi = {
  list: () => api<{ items: ScriptDocumentSummary[] }>("/api/workspace/scripts"),

  get: (id: string) =>
    api<ScriptDocumentDetail>(`/api/workspace/scripts/${encodeURIComponent(id)}`),

  create: (body: {
    path: string;
    entry_type?: ScriptEntryType;
    doc_kind?: ScriptDocKind;
    body_md?: string;
    template?: "blank" | ScriptDocKind | null;
    canvas_id?: string | null;
    series_id?: string | null;
  }) => api<ScriptDocumentDetail>("/api/workspace/scripts", body, "POST"),

  createSuite: (body: {
    folder?: string;
    project_title: string;
    canvas_id?: string | null;
    series_id?: string | null;
  }) =>
    api<{ created: ScriptDocumentSummary[] }>(
      "/api/workspace/scripts/suite",
      body,
      "POST",
    ),

  update: (
    id: string,
    body: {
      expected_revision: number;
      path?: string;
      doc_kind?: ScriptDocKind;
      body_md?: string;
      canvas_id?: string | null;
      series_id?: string | null;
    },
  ) =>
    api<ScriptDocumentDetail>(
      `/api/workspace/scripts/${encodeURIComponent(id)}`,
      body,
      "PUT",
    ),

  remove: (id: string, recursive = false) =>
    api<{ ok: boolean }>(
      `/api/workspace/scripts/${encodeURIComponent(id)}${recursive ? "?recursive=true" : ""}`,
      undefined,
      "DELETE",
    ),

  search: (query: string, caseSensitive = false) =>
    api<{
      scanned_files: number;
      scanned_canvases?: number;
      total_matches: number;
      files: ScriptSearchFileResult[];
      canvases?: ScriptSearchCanvasResult[];
    }>(
      "/api/workspace/scripts/search",
      { query, case_sensitive: caseSensitive },
      "POST",
    ),

  replace: (
    replacements: {
      id: string;
      expected_revision: number;
      expected_text: string;
      next_text: string;
    }[],
    canvasReplacements: {
      canvas_id: string;
      expected_revision: number;
      nodes: {
        node_id: string;
        expected_text: string;
        next_text: string;
      }[];
    }[] = [],
  ) =>
    api<{
      results: {
        id: string;
        saved: boolean;
        revision?: number;
        error?: string;
      }[];
      canvas_results?: {
        canvas_id: string;
        saved: boolean;
        revision?: number;
        error?: string;
      }[];
    }>(
      "/api/workspace/scripts/replace",
      {
        replacements,
        ...(canvasReplacements.length
          ? { canvas_replacements: canvasReplacements }
          : {}),
      },
      "POST",
    ),

  listCanvases: () =>
    api<{ projects: WorkspaceCanvasSummary[] }>("/api/canvases"),
};
