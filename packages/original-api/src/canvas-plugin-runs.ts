import {
  canvasResultSchema,
  validCanvasResult,
} from "@fumiao/plugin-sdk/canvas-nodes.js";
import { packageContributions } from "@fumiao/plugin-sdk/contributions.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import type { Actor } from "@fumiao/platform/platform.js";
import { PluginHost } from "@fumiao/platform/plugin-host.js";
import { PluginMedia } from "@fumiao/platform/plugin-media.js";
import { runProgram } from "@fumiao/platform/plugin-program.js";
import { requireValue } from "@fumiao/platform/security.js";
import { canvasConflict, type OriginalCanvases } from "./canvases.js";
import { canvasPluginRunFields, parseCanvasDocument } from "./canvas-draft.js";
import {
  canvasBytes,
  canvasDocumentJson,
  canvasText,
} from "./canvas-values.js";
import { parseBody } from "./validation.js";

export async function runCanvasPlugin(
  canvases: OriginalCanvases,
  actor: Actor,
  project: string,
  nodeId: string,
  value: unknown,
) {
  const body = parseBody(value, canvasPluginRunFields, true);
  const media = new PluginMedia(canvases.p.storage);
  let audit:
    | ((sql: Sql, outcome: "failed" | "succeeded") => Promise<unknown>)
    | undefined;
  try {
    return await canvases.p.db.transaction(async (sql) => {
      const row = await canvases.project(sql, actor, project, true);
      const receipt = await one(
        sql,
        "SELECT node,expected_revision FROM canvas_plugin_runs WHERE project_id=$1 AND owner_id=$2 AND uid=$3",
        [row.id, actor.id, body.uid],
      );
      if (receipt) {
        requireValue(
          receipt.node === nodeId &&
            receipt.expected_revision === body.expected_revision &&
            row.revision === receipt.expected_revision + 1,
          409,
          "这次运行已处理，请刷新画布",
        );
        return canvases.publicProject(row, actor);
      }
      requireValue(
        row.revision === body.expected_revision,
        409,
        canvasConflict,
      );
      const document = parseCanvasDocument(canvasDocumentJson(row.document));
      const nodes = new Map(document.nodes.map((n) => [n.id, n]));
      const extension = nodes.get(nodeId)?.extension;
      requireValue(extension, 400, "请选择插件节点");
      const definition = extension.definition;
      const pkg = await one(
        sql,
        `SELECT p.version,r.package->'contributes' AS contributes FROM studio_packages p
        JOIN studio_package_releases r USING(id,version) WHERE p.id=$1 AND p.installed AND p.enabled
        AND NOT p.removing FOR SHARE OF p`,
        [definition.plugin],
      );
      requireValue(
        pkg?.version === definition.version,
        409,
        "此版本的插件节点不可运行，请检查已启用的插件",
      );
      const grants = packageContributions(pkg);
      const decl = grants.canvasNodes?.find((n) => n.id === definition.id);
      requireValue(decl, 409, "插件已移除此节点");
      const inputs: Record<string, string> = Object.create(null);
      for (const port of decl.inputs) {
        const edge = document.edges.find(
          (e) => e.target === nodeId && e.targetPort === port.id,
        );
        const source = edge && nodes.get(edge.source);
        requireValue(source, 400, "请连接输入端口「" + port.title + "」");
        const input = source.extension
          ? source.extension.result?.[edge!.sourcePort!]
          : source.type === "text"
            ? source.text
            : await canvases.mediaForNode(sql, row.id, source);
        requireValue(
          typeof input === "string" && input.trim(),
          409,
          "输入端口「" + port.title + "」尚未就绪",
        );
        inputs[port.id] = input;
      }
      const host = new PluginHost(
        sql,
        {
          pluginId: definition.plugin,
          workspace: row.workspace_id,
          contributions: grants,
          mode: "write",
          scopes: ["workspace"],
        },
        undefined,
        { session: media, actor: actor.id },
      );
      audit = (sql, outcome) =>
        sql.query(
          `INSERT INTO studio_plugin_audit(plugin_id,package_version,page_id,action_id,kind,actor_id,workspace_id,target,outcome,detail)
        VALUES($1,$2,'canvas',$3,'program',$4,$5,$6,$7,$8)`,
          [
            definition.plugin,
            pkg.version,
            definition.id,
            actor.id,
            row.workspace_id,
            nodeId,
            outcome,
            host.summary(),
          ],
        );
      const result = canvasResultSchema.safeParse(
        await runProgram(
          decl.program,
          "run",
          [{ inputs, values: extension.values, uid: body.uid }],
          host.granted,
          host.call,
        ),
      );
      requireValue(
        result.success && validCanvasResult(decl.outputs, result.data),
        422,
        "插件节点返回的输出无效",
      );
      extension.result = result.data;
      await canvases.saveLocked(
        sql,
        actor,
        row,
        canvasText(row.original_title),
        document,
      );
      await sql.query(
        `INSERT INTO canvas_plugin_runs(project_id,owner_id,uid,node,expected_revision,plugin_id,package_version,inputs,parameters,outputs)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          row.id,
          actor.id,
          body.uid,
          nodeId,
          row.revision,
          definition.plugin,
          pkg.version,
          canvasBytes(JSON.stringify(inputs)),
          canvasBytes(JSON.stringify(extension.values)),
          canvasBytes(JSON.stringify(result.data)),
        ],
      );
      await audit(sql, "succeeded");
      return canvases.publicProject(
        await canvases.project(sql, actor, project),
        actor,
      );
    });
  } catch (error) {
    await media.rollback();
    if (audit) await audit(canvases.p.db, "failed");
    throw error;
  }
}
