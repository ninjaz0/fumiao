import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z, ZodError } from "zod";
import {
  OriginalIdentity,
  type OriginalActor,
} from "../../../packages/original-api/src/identity.js";
import { StudioCatalog } from "../../../packages/platform/src/catalog.js";
import { Operations } from "../../../packages/platform/src/operations.js";
import { one } from "../../../packages/platform/src/db.js";
import {
  DomainError,
  requireValue,
} from "../../../packages/platform/src/security.js";
import { originalSessionToken } from "./original-request.js";

const install = z.object({
  manifest: z.record(z.string(), z.unknown()),
  endpoint: z.string().min(1),
});

@Controller("api/admin")
export class OriginalProviderController {
  constructor(
    @Inject(OriginalIdentity) private readonly identity: OriginalIdentity,
  ) {}

  private async admin<T>(
    req: Request,
    action: (actor: OriginalActor) => Promise<T>,
  ) {
    const actor = await this.identity.actor(originalSessionToken(req));
    this.identity.p.admin(actor);
    try {
      return await action(actor);
    } catch (error) {
      if (error instanceof ZodError)
        throw new DomainError(400, "插件或连接配置无效");
      throw error;
    }
  }

  @Get("plugins")
  packages(@Req() req: Request) {
    return this.admin(req, async () => {
      const rows = await this.identity.p.db.query<{
        id: string;
        version: string;
        label: string;
        configSchema: Record<string, unknown>;
        models: string[];
        singleton: boolean;
        active: boolean;
      }>(
        `SELECT v.id,v.version,v.manifest->>'label' AS label,
                v.manifest->'configSchema' AS "configSchema",
                v.manifest ? 'originalState' AS singleton,
                ARRAY(SELECT m->>'label' FROM jsonb_array_elements(v.manifest->'models') m WHERE m ? 'studio') AS models,
                NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v.manifest->'models') m
                  WHERE m ? 'studio' AND NOT EXISTS (SELECT 1 FROM studio_catalog c
                    WHERE (c.plugin_id,c.plugin_version,c.id)=(v.id,v.version,m->>'id'))) AS active
         FROM plugin_versions v WHERE NOT (v.manifest ? 'fmworkerResources')
           AND (EXISTS(SELECT 1 FROM studio_catalog c WHERE (c.plugin_id,c.plugin_version)=(v.id,v.version))
             OR (v.endpoint IS NOT NULL AND v.manifest->'originalSubmission'->>'version'='2'))
         ORDER BY v.id,v.version`,
      );
      const packages = this.identity.p.registry.studioPackages();
      const active = rows.rows.map((row) => ({
        ...row,
        installed: true,
        label:
          packages.find((p) => p.manifest.id === row.id)?.label ?? row.label,
      }));
      for (const { manifest, label } of packages) {
        if (active.some((p) => p.id === manifest.id)) continue;
        active.push({
          id: manifest.id,
          version: manifest.version,
          label,
          installed: false,
          active: false,
          configSchema: manifest.configSchema,
          singleton: Boolean(manifest.originalState),
          models: manifest.models.filter((m) => m.studio).map((m) => m.label),
        });
      }
      return active.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    });
  }

  @Post("plugins/activate")
  activate(@Req() req: Request, @Body() body: unknown) {
    return this.admin(req, async (actor) => {
      const { id, version } = z
        .object({ id: z.string(), version: z.string() })
        .parse(body);
      const p = this.identity.p;
      return p.db.transaction(async (sql) => {
        await sql.query(
          "SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))",
        );
        const plugin = await p.registry.resolve(sql, id, version);
        requireValue(
          plugin.manifest.originalSubmission?.version === 2,
          400,
          "请选择已注册的远程工作台插件",
        );
        requireValue(
          !(await one(sql, "SELECT id FROM connections WHERE plugin_id=$1", [
            id,
          ])),
          409,
          "请通过现有连接切换版本",
        );
        await new StudioCatalog(p.db).activate(sql, plugin.manifest);
        await p.audit(sql, actor, "studio.plugin.activate", id);
        return { ok: true };
      });
    });
  }

  @Post("plugins/builtin")
  builtin(@Req() req: Request, @Body() body: unknown) {
    return this.admin(req, async (actor) => {
      const spec = z
        .object({ id: z.string(), version: z.string() })
        .parse(body);
      const p = this.identity.p;
      return p.db.transaction(async (sql) => {
        const m = await p.registry.installStudioPackage(
          sql,
          spec.id,
          spec.version,
        );
        if (
          m.mode === "pull" &&
          !(await one(
            sql,
            "SELECT id FROM connections WHERE plugin_id=$1 AND plugin_version=$2 AND NOT fmworker_resource_driver",
            [m.id, m.version],
          ))
        ) {
          const { id } = await p.createConnectionOn(
            sql,
            actor,
            {
              name: m.label,
              pluginId: m.id,
              version: m.version,
              config: {},
              concurrency: 1,
            },
            true,
          );
          await sql.query("UPDATE connections SET enabled=true WHERE id=$1", [
            id,
          ]);
        }
        return { id: m.id, version: m.version };
      });
    });
  }

  @Post("plugins")
  install(@Req() req: Request, @Body() body: unknown) {
    return this.admin(req, async () => {
      const { manifest, endpoint } = install.parse(body);
      const { p } = this.identity;
      return p.registry.install(p.db, manifest, endpoint);
    });
  }

  @Get("connections")
  connections(@Req() req: Request) {
    return this.admin(req, (actor) => this.identity.p.connections(actor));
  }

  @Post("connections")
  create(@Req() req: Request, @Body() body: unknown) {
    return this.admin(req, (actor) =>
      this.identity.p.createConnection(actor, body, true),
    );
  }

  @Put("connections/:id")
  update(@Req() req: Request, @Param("id") id: string, @Body() body: unknown) {
    return this.admin(req, (actor) =>
      this.identity.p.updateConnection(actor, id, body),
    );
  }

  @Post("connections/:id/upgrade")
  upgrade(@Req() req: Request, @Param("id") id: string, @Body() body: unknown) {
    return this.admin(req, (actor) =>
      new Operations(this.identity.p).upgrade(actor, id, body),
    );
  }

  @Post("connections/:id/health")
  health(@Req() req: Request, @Param("id") id: string) {
    return this.admin(req, (actor) =>
      this.identity.p.connectionHealth(actor, id),
    );
  }
}
