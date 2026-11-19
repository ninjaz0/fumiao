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
import { Operations } from "../../../packages/platform/src/operations.js";
import { DomainError } from "../../../packages/platform/src/security.js";
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
      this.identity.p.createConnection(actor, body),
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
