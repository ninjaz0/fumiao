import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { OriginalModelAccess } from "@fumiao/original-api/model-access.js";
import type { OriginalAuthRequest } from "./original-request.js";

@Controller("api/admin/model-access")
export class OriginalModelAccessController {
  constructor(
    @Inject(OriginalModelAccess) private readonly service: OriginalModelAccess,
  ) {}

  @Get()
  view(@Req() req: OriginalAuthRequest) {
    return this.service.view(req.actor);
  }

  @Post("connections")
  @HttpCode(200)
  create(@Req() req: OriginalAuthRequest, @Body() body: unknown) {
    return this.service.create(req.actor, body);
  }

  @Post("connections/reuse")
  @HttpCode(200)
  reuse(@Req() req: OriginalAuthRequest, @Body() body: unknown) {
    return this.service.reuse(req.actor, body);
  }
  @Post("publications")
  @HttpCode(200)
  publish(@Req() req: OriginalAuthRequest, @Body() body: unknown) {
    return this.service.publish(req.actor, body);
  }
  @Patch("connections/:id")
  edit(
    @Req() req: OriginalAuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.edit(req.actor, id, body);
  }

  @Post("connections/:id/discover")
  @HttpCode(200)
  discover(
    @Req() req: OriginalAuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.discover(req.actor, id, body);
  }

  @Put("drafts/:id")
  saveDraft(
    @Req() req: OriginalAuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.saveDraft(req.actor, id, body);
  }
}
