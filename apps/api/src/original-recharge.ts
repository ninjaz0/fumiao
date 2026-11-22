import { unescape as decodePath } from "node:querystring";
import {
  All,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { DomainError } from "@fumiao/platform/security.js";
import { pythonJsonText } from "@fumiao/plugin-sdk/json.js";
import { readOriginalBody } from "@fumiao/original-api/canvas-http.js";
import type { OriginalIdentity } from "@fumiao/original-api/identity.js";
import {
  OriginalRecharge,
  originalOrderId,
  type CreateRecharge,
} from "@fumiao/original-api/recharge.js";
import { parseBody } from "@fumiao/original-api/validation.js";
import { paymentJson } from "@fumiao/platform/payment/values.js";
import {
  originalSessionToken,
  originalWorkspace,
  requestQuery,
  type OriginalAuthRequest,
} from "./original-request.js";

const routes = [
  { path: /^\/api\/recharge$/, methods: ["GET"], session: true },
  {
    path: /^\/api\/recharge\/orders$/,
    methods: ["POST"],
    session: true,
    body: true,
  },
  {
    path: /^\/api\/recharge\/orders\/[^/]+(?:\/pay)?$/,
    methods: ["GET"],
    session: true,
  },
  { path: /^\/api\/recharge\/notify\/[^/]+$/, methods: ["GET", "POST"] },
  { path: /^\/payments\/return$/, methods: ["GET"] },
];
const endpoints = /^\/(?:api\/recharge(?:\/|$)|payments\/return(?:\/|$))/i;
const fields = {
  yuan: {
    kind: "integer",
    min: 1,
    max: 10_000,
    strict: true,
    exactInteger: true,
  },
  workspace: { kind: "integer", strict: true, exactInteger: true },
  method: { kind: "string" },
  uid: { kind: "uuid" },
} as const;

function rechargeJson(source: string) {
  return pythonJsonText(source, (key, value, context) => {
    if ((key !== "yuan" && key !== "workspace") || typeof value !== "number")
      return value;
    if (context.source && /^-?\d+$/.test(context.source))
      return Number.isSafeInteger(value) ? value : BigInt(context.source);
    // Pydantic's StrictInt rejects JSON decimals even when their value is integral.
    return { toJSON: () => value };
  });
}

export function isOriginalRechargeRequest(path: string) {
  return endpoints.test(path);
}

export function originalRechargeRequest(
  identity: OriginalIdentity,
  failure: (error: any, response: Response) => void,
) {
  return async (req: OriginalAuthRequest, res: Response, next: () => void) => {
    res.locals.originalRecharge = true;
    try {
      const path = decodePath(req.path);
      const route = routes.find((entry) => entry.path.test(path));
      if (!route) {
        const trimmed = path.replace(/\/$/, "");
        if (
          trimmed !== path &&
          routes.some((entry) => entry.path.test(trimmed))
        ) {
          res
            .status(307)
            .setHeader(
              "Location",
              req.protocol +
                "://" +
                req.get("host") +
                trimmed +
                req.url.slice(req.path.length),
            )
            .end();
          return;
        }
        throw new DomainError(404, "Not Found");
      }
      if (!route.methods.includes(req.method)) {
        res.setHeader("Allow", route.methods.join(", "));
        throw new DomainError(405, "Method Not Allowed");
      }
      if (route.body)
        req.body = parseBody(
          await readOriginalBody(req, rechargeJson, true),
          fields,
        );
      if (route.session)
        req.actor = await identity.actor(originalSessionToken(req));
      req.url =
        path.split("/").map(encodeURIComponent).join("/") +
        req.url.slice(req.path.length);
      next();
    } catch (error) {
      failure(error, res);
    }
  };
}

function uniqueParams(params: URLSearchParams) {
  const values: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (Object.hasOwn(values, key)) throw new Error("Duplicate callback field");
    values[key] = value;
  }
  return values;
}

async function callbackValues(req: Request) {
  if (req.method === "GET") return uniqueParams(requestQuery(req));
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16384) throw new Error("Oversize callback");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (req.headers["content-type"]?.includes("application/json"))
    return paymentJson(bytes, true);
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  if (text.split("&").length > 50) throw new Error("Too many callback fields");
  // parse_qsl treats a literal initial '?' as part of the first field name.
  return uniqueParams(
    new URLSearchParams(text.startsWith("?") ? "%3F" + text.slice(1) : text),
  );
}

function redirect(res: Response, target: string) {
  // Starlette keeps existing URL escapes and quotes any raw Unicode in the URL.
  const location = [...target]
    .map((char) =>
      /^[A-Za-z0-9_.~:/%#?=@\[\]!$&'()*+,;-]$/.test(char)
        ? char
        : encodeURIComponent(char),
    )
    .join("");
  res.status(303).setHeader("Location", location).end();
}

@Controller()
export class OriginalRechargeController {
  constructor(@Inject(OriginalRecharge) private recharge: OriginalRecharge) {}

  @Get("api/recharge")
  list(@Req() req: OriginalAuthRequest) {
    return this.recharge.list(
      req.actor,
      originalWorkspace(req, req.headersDistinct["x-workspace-id"]?.[0]) ??
        undefined,
      requestQuery(req).getAll("before").at(-1),
    );
  }

  @Post("api/recharge/orders")
  @HttpCode(200)
  create(@Req() req: OriginalAuthRequest) {
    return this.recharge.create(req.actor, req.body as CreateRecharge);
  }

  @Get("api/recharge/orders/:id")
  detail(@Req() req: OriginalAuthRequest, @Param("id") id: string) {
    return this.recharge.detail(req.actor, id);
  }

  @Get("api/recharge/orders/:id/pay")
  async pay(
    @Req() req: OriginalAuthRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    redirect(res, await this.recharge.checkout(req.actor, id));
  }

  @All("api/recharge/notify/:method")
  async notify(
    @Req() req: Request,
    @Param("method") method: string,
    @Res() res: Response,
  ) {
    let acknowledgement: string;
    try {
      const values = await callbackValues(req);
      if (Object.keys(values).length > 50)
        throw new Error("Too many callback fields");
      acknowledgement = await this.recharge.notify(method, values);
    } catch {
      req.resume();
      res.status(400).type("text/plain; charset=utf-8").end("fail");
      return;
    }
    res.status(200).type("text/plain; charset=utf-8").end(acknowledgement);
  }

  @Get("payments/return")
  returnToStudio(@Req() req: Request, @Res() res: Response) {
    const query = requestQuery(req);
    const id =
      query.getAll("order").at(-1) || query.getAll("out_trade_no").at(-1) || "";
    redirect(
      res,
      "/studio?recharge=" + (originalOrderId.test(id) ? id : "history"),
    );
  }
}
