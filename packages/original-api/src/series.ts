import { randomUUID } from "node:crypto";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { requireValue } from "@fumiao/platform/security.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import { OriginalIdentity } from "./identity.js";
import { OriginalCanvases } from "./canvases.js";
import {
  episodeCreateFields,
  episodeUpdateFields,
  parseCanvasDocument,
  sceneCreateFields,
  sceneUpdateFields,
  seriesCreateFields,
  seriesUpdateFields,
} from "./canvas-draft.js";
import { parseBody } from "./validation.js";

const workspaceAccess = `((w.kind='personal' AND w.owner_id=$2) OR
  (w.kind='team' AND ($3='admin' OR EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=w.id AND m.user_id=$2))))`;

export class OriginalSeries {
  readonly identity: OriginalIdentity;
  readonly canvases: OriginalCanvases;
  constructor(
    readonly p: Platform,
    readonly clock = () => Date.now() / 1000,
  ) {
    this.identity = new OriginalIdentity(p);
    this.canvases = new OriginalCanvases(p, clock);
  }
  private async findSeries(
    sql: Sql,
    user: Actor,
    key: string,
    lock = false,
  ) {
    requireValue(!key.includes("\0"), 404, "剧集项目不存在或无权访问");
    const row = await one(
      sql,
      `SELECT s.*, w.public_id AS workspace_number, u.public_id AS owner_number
       FROM series s
       JOIN workspaces w ON w.id = s.workspace_id
       JOIN users u ON u.id = s.owner_id
       WHERE s.public_id=$1 AND NOT s.deleted AND ${workspaceAccess}
       ${lock ? "FOR UPDATE OF s" : ""}`,
      [key, user.id, user.role],
    );
    requireValue(row, 404, "剧集项目不存在或无权访问");
    requireValue(
      !user.tokenWorkspaceId || row.workspace_id === user.tokenWorkspaceId,
      403,
      "API Token 无权跨工作区访问该剧集项目",
    );
    return row;
  }
  private async scenesForEpisodes(sql: Sql, episodeIds: string[]) {
    if (!episodeIds.length) return new Map<string, any[]>();
    const hasTable = await one(
      sql,
      "SELECT to_regclass('series_scenes') IS NOT NULL AS ok",
    );
    if (!hasTable?.ok) return new Map<string, any[]>();
    const { rows } = await sql.query(
      `SELECT sc.*, d.public_id AS canvas_public_id
         FROM series_scenes sc
         LEFT JOIN documents d ON d.id = sc.canvas_project_id AND NOT d.deleted
        WHERE sc.episode_id = ANY($1::uuid[])
        ORDER BY sc.position ASC, sc.scene_no ASC, sc.created_at ASC`,
      [episodeIds],
    );
    const map = new Map<string, any[]>();
    for (const r of rows) {
      const list = map.get(r.episode_id) ?? [];
      list.push({
        id: String(r.public_id),
        scene_no: Number(r.scene_no),
        title: String(r.title),
        summary: String(r.summary ?? ""),
        canvas_id: r.canvas_public_id ? String(r.canvas_public_id) : null,
        group_node_id: r.group_node_id ? String(r.group_node_id) : null,
        position: Number(r.position ?? 0),
        created: Math.floor(new Date(r.created_at).getTime() / 1000),
      });
      map.set(r.episode_id, list);
    }
    return map;
  }
  private async episodesForSeries(sql: Sql, seriesIds: string[]) {
    if (!seriesIds.length) return new Map<string, any[]>();
    const { rows } = await sql.query(
      `SELECT e.*, d.public_id AS canvas_public_id
       FROM series_episodes e
       LEFT JOIN documents d ON d.id = e.canvas_project_id AND NOT d.deleted
       WHERE e.series_id = ANY($1::uuid[])
       ORDER BY e.season_no ASC, e.episode_no ASC, e.created_at ASC`,
      [seriesIds],
    );
    const scenesByEp = await this.scenesForEpisodes(
      sql,
      rows.map((r) => String(r.id)),
    );
    const map = new Map<string, any[]>();
    for (const r of rows) {
      const list = map.get(r.series_id) ?? [];
      list.push({
        id: r.public_id,
        season_no: Number(r.season_no),
        episode_no: Number(r.episode_no),
        title: r.title,
        status: r.status,
        canvas_id: r.canvas_public_id ?? null,
        revision: Number(r.revision),
        updated: Math.floor(new Date(r.updated_at).getTime() / 1000),
        scenes: scenesByEp.get(String(r.id)) ?? [],
      });
      map.set(r.series_id, list);
    }
    return map;
  }
  private groupSeasons(episodes: any[]) {
    const bySeason = new Map<number, any[]>();
    for (const ep of episodes) {
      const sn = Number(ep.season_no);
      const bucket = bySeason.get(sn) ?? [];
      bucket.push(ep);
      bySeason.set(sn, bucket);
    }
    return [...bySeason.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([season_no, eps]) => ({
        season_no,
        label: `第 ${season_no} 季`,
        episode_count: eps.length,
        scene_count: eps.reduce(
          (sum, ep) => sum + (Array.isArray(ep.scenes) ? ep.scenes.length : 0),
          0,
        ),
        episodes: eps,
      }));
  }
  private formatSeries(row: any, episodes: any[], user: Actor) {
    return {
      id: row.public_id,
      workspace: Number(row.workspace_number),
      owner: Number(row.owner_number),
      title: row.title,
      synopsis: row.synopsis,
      bible: row.bible ?? {},
      revision: Number(row.revision),
      updated: Math.floor(new Date(row.updated_at).getTime() / 1000),
      can_delete: row.owner_id === user.id || user.role === "admin",
      seasons: this.groupSeasons(episodes),
      episodes,
    };
  }
  async list(user: Actor, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      const { rows } = await sql.query(
        `SELECT s.*, w.public_id AS workspace_number, u.public_id AS owner_number
         FROM series s
         JOIN workspaces w ON w.id = s.workspace_id
         JOIN users u ON u.id = s.owner_id
         WHERE s.workspace_id=$1 AND NOT s.deleted
         ORDER BY s.updated_at DESC, s.public_id DESC
         LIMIT 100`,
        [workspace.id],
      );
      const eps = await this.episodesForSeries(
        sql,
        rows.map((r) => r.id),
      );
      return {
        series: rows.map((row) =>
          this.formatSeries(row, eps.get(row.id) ?? [], user),
        ),
      };
    });
  }
  async get(user: Actor, key: string) {
    return this.p.db.transaction(async (sql) => {
      await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const row = await this.findSeries(sql, user, key);
      const eps = await this.episodesForSeries(sql, [row.id]);
      return this.formatSeries(row, eps.get(row.id) ?? [], user);
    });
  }
  async create(user: Actor, value: unknown, selected?: string) {
    const body = parseBody(value, seriesCreateFields, true);
    const title = pythonStrip(body.title);
    requireValue(title, 400, "请输入剧集名称");
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      const id = randomUUID();
      const publicId = randomUUID().replaceAll("-", "");
      await sql.query(
        `INSERT INTO series(id, public_id, workspace_id, owner_id, title, synopsis, bible)
         VALUES($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          publicId,
          workspace.id,
          user.id,
          title,
          pythonStrip(body.synopsis || ""),
          JSON.stringify(body.bible ?? {}),
        ],
      );
      const row = await this.findSeries(sql, user, publicId);
      return this.formatSeries(row, [], user);
    });
  }
  async update(user: Actor, key: string, value: unknown) {
    const body = parseBody(value, seriesUpdateFields, true);
    return this.p.db.transaction(async (sql) => {
      const row = await this.findSeries(sql, user, key, true);
      requireValue(
        Number(row.revision) === Number(body.expected_revision),
        409,
        "剧集已被修改，请刷新后重试",
      );
      const title =
        body.title !== undefined ? pythonStrip(body.title) : row.title;
      requireValue(title, 400, "请输入剧集名称");
      const synopsis =
        body.synopsis !== undefined
          ? pythonStrip(body.synopsis)
          : row.synopsis;
      const bible = body.bible !== undefined ? body.bible : row.bible;
      await sql.query(
        `UPDATE series SET title=$2, synopsis=$3, bible=$4, revision=revision+1, updated_at=now() WHERE id=$1`,
        [row.id, title, synopsis, JSON.stringify(bible ?? {})],
      );
      const updated = await this.findSeries(sql, user, key);
      const eps = await this.episodesForSeries(sql, [updated.id]);
      return this.formatSeries(updated, eps.get(updated.id) ?? [], user);
    });
  }
  async remove(user: Actor, key: string) {
    return this.p.db.transaction(async (sql) => {
      const row = await this.findSeries(sql, user, key, true);
      requireValue(
        row.owner_id === user.id || user.role === "admin",
        403,
        "只有创建者或管理员可以删除剧集项目",
      );
      await sql.query(
        "UPDATE series SET deleted=true, updated_at=now() WHERE id=$1",
        [row.id],
      );
      return { ok: true };
    });
  }
  async createEpisode(user: Actor, seriesKey: string, value: unknown) {
    const body = parseBody(value, episodeCreateFields, true);
    const title = pythonStrip(body.title);
    requireValue(title, 400, "请输入分集标题");
    return this.p.db.transaction(async (sql) => {
      const series = await this.findSeries(sql, user, seriesKey, true);
      const dup = await one(
        sql,
        "SELECT 1 FROM series_episodes WHERE series_id=$1 AND season_no=$2 AND episode_no=$3",
        [series.id, body.season_no, body.episode_no],
      );
      requireValue(
        !dup,
        409,
        `第 ${body.season_no} 季第 ${body.episode_no} 集已存在`,
      );

      let canvasUuid: string;
      let canvasPublicId: string;
      if (body.canvas_id) {
        const existing = await this.canvases.project(sql, user, body.canvas_id);
        requireValue(
          existing.workspace_id === series.workspace_id,
          403,
          "只能绑定同一工作区的画布",
        );
        canvasUuid = existing.id;
        canvasPublicId = existing.public_id;
      } else {
        const epLabel = `S${String(body.season_no).padStart(2, "0")}E${String(body.episode_no).padStart(2, "0")}`;
        const canvasTitle = `${series.title} · ${epLabel} ${title}`.slice(0, 80);
        const bibleNotes = [
          series.synopsis ? `剧集梗概：${series.synopsis}` : "",
          series.bible && Object.keys(series.bible).length
            ? `世界观与设定：${JSON.stringify(series.bible)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const initialDoc = parseCanvasDocument(
          bibleNotes
            ? {
                nodes: [
                  {
                    id: "series-bible",
                    type: "sticky",
                    title: `${series.title} · 设定圣经`,
                    x: 40,
                    y: 40,
                    width: 360,
                    height: 220,
                    text: bibleNotes.slice(0, 11000),
                    color: "yellow",
                  },
                ],
                edges: [],
              }
            : {},
        );
        const created = await this.canvases.createBoundCanvas(
          sql,
          user,
          series.workspace_id,
          canvasTitle,
          initialDoc,
        );
        canvasUuid = created.id;
        canvasPublicId = created.public_id;
      }

      const epId = randomUUID();
      const epPublicId = randomUUID().replaceAll("-", "");
      await sql.query(
        `INSERT INTO series_episodes(id, public_id, series_id, season_no, episode_no, title, canvas_project_id, status)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          epId,
          epPublicId,
          series.id,
          body.season_no,
          body.episode_no,
          title,
          canvasUuid,
          body.status,
        ],
      );
      await sql.query("UPDATE series SET updated_at=now() WHERE id=$1", [
        series.id,
      ]);
      return {
        id: epPublicId,
        series_id: series.public_id,
        season_no: Number(body.season_no),
        episode_no: Number(body.episode_no),
        title,
        status: body.status,
        canvas_id: canvasPublicId,
        revision: 1,
        scenes: [],
      };
    });
  }
  async updateEpisode(
    user: Actor,
    seriesKey: string,
    episodeKey: string,
    value: unknown,
  ) {
    const body = parseBody(value, episodeUpdateFields, true);
    return this.p.db.transaction(async (sql) => {
      const series = await this.findSeries(sql, user, seriesKey, true);
      const ep = await one(
        sql,
        "SELECT * FROM series_episodes WHERE series_id=$1 AND public_id=$2 FOR UPDATE",
        [series.id, episodeKey],
      );
      requireValue(ep, 404, "分集不存在");
      requireValue(
        Number(ep.revision) === Number(body.expected_revision),
        409,
        "分集已被修改，请刷新后重试",
      );
      const nextSeason = body.season_no ?? ep.season_no;
      const nextEpNo = body.episode_no ?? ep.episode_no;
      const nextTitle =
        body.title !== undefined ? pythonStrip(body.title) : ep.title;
      requireValue(nextTitle, 400, "请输入分集标题");
      const nextStatus = body.status ?? ep.status;
      await sql.query(
        `UPDATE series_episodes
         SET season_no=$2, episode_no=$3, title=$4, status=$5, revision=revision+1, updated_at=now()
         WHERE id=$1`,
        [ep.id, nextSeason, nextEpNo, nextTitle, nextStatus],
      );
      await sql.query("UPDATE series SET updated_at=now() WHERE id=$1", [
        series.id,
      ]);
      const canvas = ep.canvas_project_id
        ? await one(
            sql,
            "SELECT public_id FROM documents WHERE id=$1 AND NOT deleted",
            [ep.canvas_project_id],
          )
        : null;
      return {
        id: ep.public_id,
        series_id: series.public_id,
        season_no: Number(nextSeason),
        episode_no: Number(nextEpNo),
        title: nextTitle,
        status: nextStatus,
        canvas_id: canvas?.public_id ?? null,
        revision: Number(ep.revision) + 1,
      };
    });
  }
  async removeEpisode(user: Actor, seriesKey: string, episodeKey: string) {
    return this.p.db.transaction(async (sql) => {
      const series = await this.findSeries(sql, user, seriesKey, true);
      const ep = await one(
        sql,
        "SELECT id FROM series_episodes WHERE series_id=$1 AND public_id=$2 FOR UPDATE",
        [series.id, episodeKey],
      );
      requireValue(ep, 404, "分集不存在");
      await sql.query("DELETE FROM series_episodes WHERE id=$1", [ep.id]);
      await sql.query("UPDATE series SET updated_at=now() WHERE id=$1", [
        series.id,
      ]);
      return { ok: true };
    });
  }

  // ---- F026: 4th Hierarchy Level — Scenes inside Episodes ----

  async createScene(
    user: Actor,
    seriesKey: string,
    episodeKey: string,
    value: unknown,
  ) {
    const body = parseBody(value, sceneCreateFields, true) as {
      scene_no: number;
      title: string;
      summary: string;
      canvas_id?: string | null;
      group_node_id?: string | null;
      create_canvas: boolean;
    };
    const title = pythonStrip(body.title);
    requireValue(title, 400, "请输入分场标题");
    return this.p.db.transaction(async (sql) => {
      const series = await this.findSeries(sql, user, seriesKey, true);
      const ep = await one(
        sql,
        "SELECT * FROM series_episodes WHERE series_id=$1 AND public_id=$2 FOR UPDATE",
        [series.id, episodeKey],
      );
      requireValue(ep, 404, "分集不存在");
      const dup = await one(
        sql,
        "SELECT 1 FROM series_scenes WHERE episode_id=$1 AND scene_no=$2",
        [ep.id, body.scene_no],
      );
      requireValue(!dup, 409, `第 ${body.scene_no} 场已存在`);

      let canvasUuid: string | null = null;
      let canvasPublicId: string | null = null;
      if (body.canvas_id) {
        const existing = await this.canvases.project(sql, user, body.canvas_id);
        requireValue(
          existing.workspace_id === series.workspace_id,
          403,
          "只能绑定同一工作区的画布",
        );
        canvasUuid = existing.id;
        canvasPublicId = existing.public_id;
      } else if (body.create_canvas && !body.group_node_id) {
        const epLabel = `S${String(ep.season_no).padStart(2, "0")}E${String(ep.episode_no).padStart(2, "0")}`;
        const scLabel = `SC${String(body.scene_no).padStart(2, "0")}`;
        const canvasTitle = `${series.title} · ${epLabel} ${scLabel} ${title}`.slice(
          0,
          80,
        );
        const bibleText =
          series.bible &&
          typeof series.bible === "object" &&
          !Array.isArray(series.bible) &&
          Object.keys(series.bible).length > 0
            ? Object.keys(series.bible).length === 1 &&
              typeof (series.bible as Record<string, unknown>).notes === "string"
              ? ((series.bible as Record<string, string>).notes || "").trim()
              : JSON.stringify(series.bible)
            : "";
        const notes = [
          series.synopsis ? `剧集梗概：${series.synopsis}` : "",
          bibleText ? `世界观与设定：${bibleText}` : "",
          body.summary?.trim() ? `分场梗概：${body.summary.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const initialDoc = parseCanvasDocument(
          notes
            ? {
                nodes: [
                  {
                    id: "scene-brief",
                    type: "sticky",
                    title: `${epLabel} ${scLabel} · 分场说明`,
                    x: 40,
                    y: 40,
                    width: 360,
                    height: 220,
                    text: notes.slice(0, 11000),
                    color: "yellow",
                  },
                ],
                edges: [],
              }
            : {},
        );
        const created = await this.canvases.createBoundCanvas(
          sql,
          user,
          series.workspace_id,
          canvasTitle,
          initialDoc,
        );
        canvasUuid = created.id;
        canvasPublicId = created.public_id;
      } else if (ep.canvas_project_id) {
        const epCanvas = await one(
          sql,
          "SELECT id, public_id FROM documents WHERE id=$1 AND NOT deleted",
          [ep.canvas_project_id],
        );
        if (epCanvas) {
          canvasUuid = String(epCanvas.id);
          canvasPublicId = String(epCanvas.public_id);
        }
      }

      const scId = randomUUID();
      const scPublicId = randomUUID().replaceAll("-", "");
      await sql.query(
        `INSERT INTO series_scenes(id, public_id, episode_id, scene_no, title, summary, canvas_project_id, group_node_id, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $4)`,
        [
          scId,
          scPublicId,
          ep.id,
          body.scene_no,
          title,
          pythonStrip(body.summary || ""),
          canvasUuid,
          body.group_node_id ?? null,
        ],
      );
      await sql.query("UPDATE series SET updated_at=now() WHERE id=$1", [
        series.id,
      ]);
      return {
        id: scPublicId,
        episode_id: ep.public_id,
        scene_no: Number(body.scene_no),
        title,
        summary: pythonStrip(body.summary || ""),
        canvas_id: canvasPublicId,
        group_node_id: body.group_node_id ?? null,
      };
    });
  }

  async updateScene(
    user: Actor,
    seriesKey: string,
    episodeKey: string,
    sceneKey: string,
    value: unknown,
  ) {
    const body = parseBody(value, sceneUpdateFields, true) as {
      scene_no?: number;
      title?: string;
      summary?: string;
      group_node_id?: string | null;
    };
    return this.p.db.transaction(async (sql) => {
      const series = await this.findSeries(sql, user, seriesKey, true);
      const ep = await one(
        sql,
        "SELECT id FROM series_episodes WHERE series_id=$1 AND public_id=$2",
        [series.id, episodeKey],
      );
      requireValue(ep, 404, "分集不存在");
      const sc = await one(
        sql,
        "SELECT * FROM series_scenes WHERE episode_id=$1 AND public_id=$2 FOR UPDATE",
        [ep.id, sceneKey],
      );
      requireValue(sc, 404, "分场不存在");
      const nextSceneNo = body.scene_no ?? Number(sc.scene_no);
      const nextTitle =
        body.title !== undefined ? pythonStrip(body.title) : String(sc.title);
      requireValue(nextTitle, 400, "请输入分场标题");
      const nextSummary =
        body.summary !== undefined
          ? pythonStrip(body.summary)
          : String(sc.summary ?? "");
      const nextGroup =
        body.group_node_id !== undefined ? body.group_node_id : sc.group_node_id;
      await sql.query(
        `UPDATE series_scenes
            SET scene_no = $2, title = $3, summary = $4, group_node_id = $5, position = $2
          WHERE id = $1`,
        [sc.id, nextSceneNo, nextTitle, nextSummary, nextGroup ?? null],
      );
      const canvas = sc.canvas_project_id
        ? await one(
            sql,
            "SELECT public_id FROM documents WHERE id=$1 AND NOT deleted",
            [sc.canvas_project_id],
          )
        : null;
      return {
        id: String(sc.public_id),
        scene_no: nextSceneNo,
        title: nextTitle,
        summary: nextSummary,
        canvas_id: canvas?.public_id ?? null,
        group_node_id: nextGroup ?? null,
      };
    });
  }

  async removeScene(
    user: Actor,
    seriesKey: string,
    episodeKey: string,
    sceneKey: string,
  ) {
    return this.p.db.transaction(async (sql) => {
      const series = await this.findSeries(sql, user, seriesKey, true);
      const ep = await one(
        sql,
        "SELECT id FROM series_episodes WHERE series_id=$1 AND public_id=$2",
        [series.id, episodeKey],
      );
      requireValue(ep, 404, "分集不存在");
      const sc = await one(
        sql,
        "SELECT id FROM series_scenes WHERE episode_id=$1 AND public_id=$2 FOR UPDATE",
        [ep.id, sceneKey],
      );
      requireValue(sc, 404, "分场不存在");
      await sql.query("DELETE FROM series_scenes WHERE id=$1", [sc.id]);
      return { ok: true };
    });
  }
}
