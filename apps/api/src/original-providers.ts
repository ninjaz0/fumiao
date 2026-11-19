import { loadProgram } from "../../../packages/platform/src/plugin-program.js";
import {
  StudioPackages,
  upgradeFields,
} from "../../../packages/platform/src/studio-packages.js";
import { StudioUpdates } from "../../../packages/platform/src/studio-updates.js";
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
    return this.admin(req, (actor) =>
      new StudioPackages(this.identity.p).list(actor),
    );
  }
  @Post("plugins/import")
  importPackage(@Req() req: Request, @Body() body: unknown) {
    const input = z.object({
      file: z.unknown(),
      supplements: upgradeFields,
      revision: z.number().int().optional(),
    });
    return this.admin(req, (actor) => {
      const data = input.parse(body);
      return new StudioPackages(this.identity.p).install(
        actor,
        data.file,
        data.revision,
        false,
        data.supplements,
      );
    });
  }
  @Post("plugins/:id/panel")
  panel(@Req() req: Request, @Param("id") id: string, @Body() input: unknown) {
    return this.admin(req, async () => {
      const r = await one(
        this.identity.p.db,
        "SELECT r.package->'settingsPage'->>'render' AS render FROM studio_packages p JOIN studio_package_releases r USING(id,version) WHERE p.id=$1 AND p.installed",
        [id],
      );
      requireValue(r?.render, 404, "未安装此设置页");
      const run = await loadProgram("({view:" + r.render + "})");
      return run("view", input);
    });
  }
  @Post("plugins/preview")
  preview(@Req() req: Request, @Body() value: unknown) {
    return this.admin(req, (actor) =>
      new StudioPackages(this.identity.p).preview(actor, value),
    );
  }
  @Post("plugins/:id/review")
  review(@Req() req: Request, @Param("id") id: string) {
    return this.admin(req, (actor) =>
      new StudioUpdates(this.identity.p).review(actor, id),
    );
  }
  @Post("plugins/:id/model")
  model(@Req() req: Request, @Param("id") id: string, @Body() body: unknown) {
    return this.admin(req, async (actor) => {
      const input = z
        .object({
          model: z.string(),
          label: z.string().trim().min(1).max(80).optional(),
          enabled: z.boolean(),
          service: z.string().uuid().optional(),
          revision: z.number().int(),
        })
        .parse(body);
      const p = this.identity.p;
      return p.db.transaction(async (sql) => {
        await sql.query("SELECT * FROM studio_policy FOR UPDATE");
        const pkg = await one(
          sql,
          "SELECT id FROM studio_packages WHERE id=$1 AND revision=$2 AND installed FOR UPDATE",
          [id, input.revision],
        );
        requireValue(pkg, 409, "插件已变化，请刷新");
        requireValue(
          await one(
            sql,
            "SELECT id FROM studio_catalog WHERE id=$1 AND (plugin_id=$2 OR EXISTS(SELECT 1 FROM studio_shared_models e WHERE e.model_id=$1 AND e.plugin_id=$2)) AND NOT hidden",
            [input.model, id],
          ),
          404,
          "模型不存在",
        );
        if (input.service) {
          const service = await one(
            sql,
            `SELECT c.plugin_id,c.plugin_version FROM models m JOIN connections c ON c.id=m.connection_id JOIN studio_packages p ON p.id=c.plugin_id AND p.installed AND NOT p.removing
            WHERE c.id=$1 AND m.catalog_id=$2 AND c.enabled AND NOT c.removed FOR SHARE OF c`,
            [input.service, input.model],
          );
          requireValue(service, 400, "服务未提供此模型");
          await sql.query(
            "UPDATE studio_catalog SET plugin_id=$2,plugin_version=$3 WHERE id=$1",
            [input.model, service.plugin_id, service.plugin_version],
          );
          await sql.query(
            "INSERT INTO studio_model_service VALUES($1,$2) ON CONFLICT(model_id) DO UPDATE SET connection_id=excluded.connection_id",
            [input.model, input.service],
          );
        }
        if (input.label)
          await sql.query(
            "UPDATE studio_catalog SET display_label=$2 WHERE id=$1",
            [input.model, input.label],
          );
        await sql.query(
          "UPDATE studio_policy SET revision=revision+1,flags=flags||$1::jsonb",
          [JSON.stringify({ [input.model]: input.enabled })],
        );
        await sql.query(
          "UPDATE studio_packages SET revision=revision+1 WHERE id=$1 OR id IN (SELECT plugin_id FROM studio_shared_models WHERE model_id=$2)",
          [id, input.model],
        );
        await p.audit(sql, actor, "plugin.model", input.model);
        return { ok: true };
      });
    });
  }
  @Post("plugins/:id/state")
  change(@Req() req: Request, @Param("id") id: string, @Body() body: unknown) {
    return this.admin(req, (actor) => {
      const data = z
        .object({
          action: z.enum(["enable", "disable", "remove"]),
          revision: z.number().int(),
        })
        .parse(body);
      return new StudioPackages(this.identity.p).change(
        actor,
        id,
        data.revision,
        data.action,
      );
    });
  }
  @Post("plugins/:id/source")
  source(@Req() req: Request, @Param("id") id: string, @Body() body: unknown) {
    return this.admin(req, (actor) =>
      new StudioUpdates(this.identity.p).configure(actor, id, body),
    );
  }
  @Post("plugins/:id/check")
  check(@Req() req: Request, @Param("id") id: string) {
    return this.admin(req, () => new StudioUpdates(this.identity.p).check(id));
  }
  @Post("plugins/:id/update")
  updatePackage(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.admin(req, (actor) =>
      new StudioUpdates(this.identity.p).check(id, {
        actor,
        ...z
          .object({
            revision: z.number().int(),
            sha256: z.string(),
            supplements: upgradeFields,
          })
          .parse(body),
      }),
    );
  }
  @Post("plugins/:id/rollback")
  rollback(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.admin(req, async (actor) => {
      const { revision } = z.object({ revision: z.number().int() }).parse(body);
      const row = await one(
        this.identity.p.db,
        "SELECT r.package FROM studio_packages p JOIN studio_package_releases r ON r.id=p.id AND r.version=p.previous_version WHERE p.installed AND p.id=$1",
        [id],
      );
      requireValue(row, 409, "没有可回退的版本");
      return new StudioPackages(this.identity.p).install(
        actor,
        row.package,
        revision,
        true,
      );
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
    return this.admin(req, (actor) => this.identity.p.studioConnections(actor));
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
