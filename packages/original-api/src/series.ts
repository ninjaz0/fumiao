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
    return row;
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
      });
      map.set(r.series_id, list);
    }
    return map;
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
      await sql.query("UPDATE series SET deleted=true, updated_at=now() WHERE id=$1", [
        row.id,
      ]);
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
}
