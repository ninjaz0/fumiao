import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { pairedPluginAvailable } from "../../../packages/platform/src/studio-plugin-profile.js";
import type { Request, Response } from "express";
import { resolve } from "node:path";
import { OriginalIdentity } from "../../../packages/original-api/src/identity.js";
import {
  BoundNodeCredential,
  defaultPairModels,
  OriginalNodes,
} from "../../../packages/original-api/src/nodes.js";
import { readCanvasBody } from "../../../packages/original-api/src/canvas-http.js";
import {
  parseBody,
  pathId,
  ValidationError,
  type Fields,
} from "../../../packages/original-api/src/validation.js";
import {
  DomainError,
  requireValue,
} from "../../../packages/platform/src/security.js";
import {
  originalSessionToken,
  type OriginalAuthRequest,
} from "./original-request.js";
import { originalAgentRoutes } from "./original-agent.js";

const pairFields: Fields = {
  name: { kind: "string", max: 45, default: "" },
  models: {
    kind: "list",
    item: { kind: "string" },
    max: 20,
    default: defaultPairModels,
  },
};
const enrollFields: Fields = {
  code: { kind: "string", min: 30, max: 128 },
  secret: { kind: "string", min: 40, max: 128 },
};
const routes = [
  { path: /^\/api\/pairs$/, method: "POST", session: true, body: pairFields },
  { path: /^\/api\/pairs\/default-name$/, method: "GET", session: true },
  {
    path: /^\/api\/nodes\/([^/]+)\/[^/]+$/,
    method: "POST",
    session: true,
    nodeId: true,
  },
  { path: /^\/agent\/enroll$/, method: "POST", body: enrollFields },
  { path: /^\/agent\/registration$/, method: "GET" },
  { path: /^\/connect\/[^/]+$/, method: "GET" },
  ...originalAgentRoutes,
];

export function originalNodeRequest(
  identity: OriginalIdentity,
  failure: (error: unknown, res: Response) => void,
) {
  return async (
    path: string,
    req: OriginalAuthRequest,
    res: Response,
    next: () => void,
  ) => {
    const target = path.replace(/\/+$/, "");
    if (
      !/^\/(?:api\/(?:pairs|nodes)|agent\/(?:enroll|registration|heartbeat|claim|jobs)|connect)(?:\/|$)/i.test(
        path,
      )
    )
      return false;
    try {
      requireValue(await pairedPluginAvailable(identity.p.db), 404, "尚未安装实例接入插件");
      const route = routes.find((r) => r.path.test(path));
      if (
        !route &&
        target !== path &&
        routes.some((r) => r.path.test(target))
      ) {
        const url =
          target.split("/").map(encodeURIComponent).join("/") +
          req.url.slice(req.path.length);
        res
          .status(307)
          .location(req.protocol + "://" + req.get("host") + url)
          .end();
        return true;
      }
      requireValue(route, 404, "Not Found");
      if (route.method !== req.method) {
        res.setHeader("Allow", route.method);
        throw new DomainError(405, "Method Not Allowed");
      }
      if (route.nodeId) pathId(path.match(route.path)![1], "i");
      if (route.body) {
        const body = await readCanvasBody(req, false, 3 * 1024 * 1024);
        try {
          req.body = parseBody(body, route.body);
        } catch (error) {
          // FastAPI echoes invalid input, including both fields for a missing
          // field error. Keep the validation envelope without reflecting secrets.
          if (route.body === enrollFields && error instanceof ValidationError)
            throw new ValidationError(
              error.detail.map((issue) => ({ ...issue, input: null })),
            );
          throw error;
        }
      }
      if ("session" in route && route.session)
        req.actor = await identity.actor(originalSessionToken(req));
      req.url =
        path.split("/").map(encodeURIComponent).join("/") +
        req.url.slice(req.path.length);
      next();
    } catch (error) {
      failure(error, res);
    }
    return true;
  };
}

@Controller()
export class OriginalNodesController {
  private nodes: OriginalNodes;
  constructor(@Inject(OriginalIdentity) identity: OriginalIdentity) {
    this.nodes = new OriginalNodes(identity.p);
  }
  @Get("api/pairs/default-name")
  defaultName() {
    return this.nodes.suggestedName();
  }
  @Post("api/pairs")
  @HttpCode(200)
  pair(@Req() req: OriginalAuthRequest) {
    return this.nodes.pair(req.actor, req.body);
  }
  @Post("api/nodes/:i/:action")
  @HttpCode(200)
  manage(
    @Req() req: OriginalAuthRequest,
    @Param("i") id: string,
    @Param("action") action: string,
  ) {
    return this.nodes.manage(req.actor, pathId(id, "i"), action);
  }
  @Post("agent/enroll")
  @HttpCode(200)
  async enroll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return await this.nodes.enroll(req.body);
    } catch (error) {
      if (!(error instanceof BoundNodeCredential)) throw error;
      // Match the original duplicate-credential failure without exposing SQL.
      res.status(500).type("text/plain").end("Internal Server Error");
    }
  }
  @Get("agent/registration")
  registration(@Req() req: Request) {
    return this.nodes.registration(
      req.headersDistinct.authorization?.[0] ?? "",
    );
  }
  @Get("connect/:file")
  download(@Param("file") file: string, @Res() res: Response) {
    requireValue(
      ["install.sh", "agent.tgz", "agent.tgz.sha256"].includes(file),
      404,
      "文件不存在",
    );
    res.type("application/octet-stream");
    return new Promise<void>((done, reject) => {
      res.sendFile(file, { root: resolve("legacy/pure/agent") }, (error) =>
        error ? reject(error) : done(),
      );
    });
  }
}
