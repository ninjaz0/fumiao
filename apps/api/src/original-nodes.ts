import { one } from "@fumiao/platform/db.js";
import { hasStudioPackages } from "@fumiao/platform/studio-plugin-profile.js";
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
import { pairedPluginAvailable } from "@fumiao/platform/studio-plugin-profile.js";
import type { Response } from "express";
import { resolve } from "node:path";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";

import { readCanvasBody } from "@fumiao/original-api/canvas-http.js";
import {
  parseBody,
  pathId,
  ValidationError,
  type Fields,
} from "@fumiao/original-api/validation.js";
import { DomainError, requireValue } from "@fumiao/platform/security.js";
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
    default: ["MiniMax H3"],
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
    const scoped =
      /^\/agent\/([a-z][a-z0-9-]{1,63})\/(enroll|registration|heartbeat|claim|jobs\/.*|client\/[^/]+)(\/?)$/.exec(
        path,
      );
    const originalPath = path;
    if (scoped) {
      req.nodePool = scoped[1];
      path =
        (scoped[2].startsWith("client/")
          ? "/connect/" + scoped[2].slice(7)
          : "/agent/" + scoped[2]) + scoped[3];
    }
    const target = path.replace(/\/+$/, "");
    if (
      !/^\/(?:api\/(?:pairs|nodes)|agent\/(?:enroll|registration|heartbeat|claim|jobs)|connect)(?:\/|$)/i.test(
        path,
      )
    )
      return false;
    try {
      requireValue(
        req.nodePool
          ? await one(
              identity.p.db,
              `SELECT 1 FROM studio_packages p JOIN studio_package_releases r USING(id,version)
          WHERE p.id=$1 AND p.installed AND r.package->'contributes' ? 'nodePools'`,
              [req.nodePool],
            )
          : await pairedPluginAvailable(identity.p.db),
        404,
        "尚未安装实例接入插件",
      );
      const route = routes.find((r) => r.path.test(path));
      if (
        !route &&
        target !== path &&
        routes.some((r) => r.path.test(target))
      ) {
        const url =
          originalPath
            .replace(/\/+$/, "")
            .split("/")
            .map(encodeURIComponent)
            .join("/") + req.url.slice(req.path.length);
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
      if ("session" in route && route.session) {
        req.actor = await identity.actor(originalSessionToken(req));
        identity.p.admin(req.actor);
      }
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
  constructor(@Inject(OriginalIdentity) private identity: OriginalIdentity) {}
  private async nodes(pool?: string) {
    const { NodeManagement } = await this.identity.p.registry.nodeExtension(
      this.identity.p.db,
      pool,
    );
    return new NodeManagement(this.identity.p, pool ?? "gpu");
  }
  @Get("api/pairs/default-name")
  async defaultName() {
    return (await this.nodes()).suggestedName();
  }
  @Post("api/pairs")
  @HttpCode(200)
  async pair(@Req() req: OriginalAuthRequest) {
    return (await this.nodes()).pair(req.actor, req.body);
  }
  @Post("api/nodes/:i/:action")
  @HttpCode(200)
  async manage(
    @Req() req: OriginalAuthRequest,
    @Param("i") id: string,
    @Param("action") action: string,
  ) {
    return (await this.nodes()).manage(req.actor, pathId(id, "i"), action);
  }
  @Post("agent/enroll")
  @HttpCode(200)
  async enroll(
    @Req() req: OriginalAuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      return await (await this.nodes(req.nodePool)).enroll(req.body);
    } catch (error) {
      if (!(error instanceof Error && error.name === "BoundNodeCredential"))
        throw error;
      // Match the original duplicate-credential failure without exposing SQL.
      res.status(500).type("text/plain").end("Internal Server Error");
    }
  }
  @Get("agent/registration")
  async registration(@Req() req: OriginalAuthRequest) {
    return (await this.nodes(req.nodePool)).registration(
      req.headersDistinct.authorization?.[0] ?? "",
    );
  }
  @Get("connect/:file")
  async download(
    @Param("file") file: string,
    @Req() req: OriginalAuthRequest,
    @Res() res: Response,
  ) {
    requireValue(
      ["install.sh", "agent.tgz", "agent.tgz.sha256"].includes(file),
      404,
      "文件不存在",
    );
    res.type("application/octet-stream");
    if (await hasStudioPackages(this.identity.p.db)) {
      const row = await one(
        this.identity.p.db,
        `SELECT r.package->'nodeClient'->>$1 AS bytes FROM studio_packages p JOIN studio_package_releases r USING(id,version) WHERE p.id=$2 AND p.installed AND r.package ? 'nodeClient'`,
        [file, req.nodePool ?? "gpu"],
      );
      if (row?.bytes) {
        res.send(Buffer.from(row.bytes, "base64"));
        return;
      }
    }
    requireValue(!req.nodePool, 404, "节点安装文件不存在");
    return new Promise<void>((done, reject) => {
      res.sendFile(
        file,
        { root: resolve("plugins/gpu/distribution") },
        (error) => (error ? reject(error) : done()),
      );
    });
  }
}
