import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { Response } from "express";
import { OriginalIdentity } from "../../../packages/original-api/src/identity.js";
import { OriginalChats } from "../../../packages/original-api/src/chats.js";
import { OriginalChatApplications } from "../../../packages/original-api/src/chat-applications.js";
import { DomainError } from "../../../packages/platform/src/security.js";
import { chatJson } from "../../../packages/platform/src/chat-values.js";
import {
  originalSessionToken,
  originalWorkspace,
  requestQuery,
  type OriginalAuthRequest,
} from "./original-request.js";

@Controller("api/chats")
export class OriginalChatController implements OnModuleDestroy {
  private readonly chats: OriginalChats;
  private readonly applications: OriginalChatApplications;
  private readonly subscriptions = new Set<AbortController>();

  constructor(
    @Inject(OriginalIdentity) private readonly identity: OriginalIdentity,
  ) {
    this.chats = new OriginalChats(identity.p);
    this.applications = new OriginalChatApplications(identity.p);
  }

  @Get()
  list(@Req() req: OriginalAuthRequest) {
    const query = requestQuery(req);
    return this.chats.list(
      req.actor,
      originalWorkspace(req),
      query.getAll("project").at(-1),
      query.getAll("node").at(-1),
    );
  }

  @Post()
  @HttpCode(200)
  create(@Req() req: OriginalAuthRequest, @Body() body: unknown) {
    return this.chats.create(req.actor, body, originalWorkspace(req));
  }

  @Get(":cid")
  get(@Req() req: OriginalAuthRequest, @Param("cid") cid: string) {
    return this.chats.get(req.actor, cid, originalWorkspace(req));
  }

  @Patch(":cid")
  rename(
    @Req() req: OriginalAuthRequest,
    @Param("cid") cid: string,
    @Body() body: unknown,
  ) {
    return this.chats.rename(req.actor, cid, body, originalWorkspace(req));
  }

  @Delete(":cid")
  remove(@Req() req: OriginalAuthRequest, @Param("cid") cid: string) {
    return this.chats.remove(req.actor, cid, originalWorkspace(req));
  }

  @Post(":cid/restore")
  @HttpCode(200)
  restore(@Req() req: OriginalAuthRequest, @Param("cid") cid: string) {
    return this.chats.restore(req.actor, cid, originalWorkspace(req));
  }

  @Post(":cid/messages")
  @HttpCode(200)
  send(
    @Req() req: OriginalAuthRequest,
    @Param("cid") cid: string,
    @Body() body: unknown,
  ) {
    return this.chats.send(req.actor, cid, body, originalWorkspace(req));
  }

  @Post(":cid/stop")
  @HttpCode(200)
  stop(@Req() req: OriginalAuthRequest, @Param("cid") cid: string) {
    return this.chats.stop(req.actor, cid, originalWorkspace(req));
  }

  @Post(":cid/apply")
  @HttpCode(200)
  apply(
    @Req() req: OriginalAuthRequest,
    @Param("cid") cid: string,
    @Body() body: unknown,
  ) {
    return this.applications.apply(
      req.actor,
      cid,
      body,
      originalWorkspace(req),
    );
  }

  @Get(":cid/events")
  async events(
    @Req() req: OriginalAuthRequest,
    @Param("cid") cid: string,
    @Res() res: Response,
  ) {
    const session = originalSessionToken(req),
      selected = originalWorkspace(req);
    const subscription = new AbortController(),
      { signal } = subscription;
    const close = () => subscription.abort();
    this.subscriptions.add(subscription);
    res.once("close", close);
    try {
      // Initial access failures are ordinary HTTP errors, before any SSE headers.
      await this.chats.requireAccess(req.actor, cid, selected);
      if (res.destroyed || signal.aborted) return;
      res.status(200).set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
        "Cache-Control": "private, no-store",
      });
      res.flushHeaders();

      let previous = "",
        lastFrame = performance.now();
      while (!signal.aborted) {
        let frame: string | undefined;
        try {
          const actor = await this.identity.actor(session);
          const snapshot = chatJson(
            await this.chats.get(actor, cid, selected),
            false,
          );
          if (snapshot !== previous) {
            frame = `data: ${snapshot}\n\n`;
            previous = snapshot;
          } else if (performance.now() - lastFrame > 15_000) {
            frame = ": keepalive\n\n";
          }
        } catch (error) {
          if (!(error instanceof DomainError) || error.status >= 500)
            throw error;
          if (!signal.aborted) res.end("event: unavailable\ndata: {}\n\n");
          return;
        }
        if (signal.aborted) break;
        if (frame) {
          if (!res.write(frame)) await once(res, "drain", { signal });
          lastFrame = performance.now();
        }
        await delay(350, undefined, { signal });
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      this.subscriptions.delete(subscription);
      res.off("close", close);
      if (signal.aborted && !res.destroyed) res.end();
    }
  }

  onModuleDestroy() {
    for (const subscription of this.subscriptions) subscription.abort();
  }
}
