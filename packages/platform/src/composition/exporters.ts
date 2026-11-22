import { z } from "zod";
import type { Sql } from "../db.js";
import { packageContributions } from "@fumiao/plugin-sdk/contributions.js";
import { loadProgram } from "../plugin-program.js";
import { requireValue } from "../security.js";
import type { Shot } from "./renderer.js";

export async function canvasExporters(sql: Sql, plugin?: string) {
  const { rows } = await sql.query(
    `SELECT p.id,p.version,r.package->'contributes' AS contributes
     FROM studio_packages p JOIN studio_package_releases r USING(id,version)
     WHERE p.installed AND p.enabled AND NOT p.removing AND r.package->'contributes' ? 'exporters'
     AND ($1::text IS NULL OR p.id=$1) ORDER BY p.id FOR SHARE OF p`,
    [plugin ?? null],
  );
  return rows.flatMap((row) =>
    (packageContributions(row).exporters ?? []).map((decl) => ({
      key: row.id + "/" + decl.id,
      plugin: String(row.id),
      version: String(row.version),
      ...decl,
    })),
  );
}

const segments = z
  .array(
    z
      .object({
        index: z.number().int().nonnegative(),
        narration: z.boolean(),
        subtitles: z.boolean(),
      })
      .strict(),
  )
  .min(1)
  .max(30);

export async function planComposition(program: string, shots: Shot[]) {
  const run = await loadProgram(program);
  const plan = segments.safeParse(run("plan", { shots }));
  requireValue(plan.success, 400, "导出器返回了无效的分镜计划");
  return plan.data.map(({ index, narration, subtitles }) => {
    const shot = shots[index];
    requireValue(shot, 400, "导出器引用了当前画布之外的镜头");
    return {
      ...shot,
      voice: narration ? shot.voice : null,
      text: narration && subtitles ? shot.text : "",
    };
  });
}
