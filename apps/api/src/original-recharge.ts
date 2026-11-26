import { unescape as decodePath } from "node:querystring";
import {
  All,
  Controller,
  Get,
  HttpCode,
  HttpException,
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
      if (
        req.method === "GET" &&
        /^\/api\/recharge\/orders\/[^/]+\/pay$/.test(decodePath(req.path)) &&
        req.headers.accept?.includes("text/html") &&
        !res.headersSent
      ) {
        const { status, message } = extractRechargePayError(error);
        sendRechargeErrorHtml(res, status, message);
        return;
      }
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function extractRechargePayError(error: unknown): {
  status: number;
  message: string;
} {
  const err = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    getStatus?: () => number;
    getResponse?: () => unknown;
  } | null;
  if (error instanceof DomainError) {
    return { status: error.status, message: error.message || "请求处理失败" };
  }
  if (error instanceof HttpException || typeof err?.getStatus === "function") {
    const rawStatus = err!.getStatus!();
    const status =
      typeof rawStatus === "number" && rawStatus >= 400 && rawStatus <= 599
        ? rawStatus
        : 500;
    const resp =
      typeof err?.getResponse === "function" ? err.getResponse() : undefined;
    let msg = typeof err?.message === "string" ? err.message : "";
    if (typeof resp === "string" && resp) {
      msg = resp;
    } else if (resp && typeof resp === "object") {
      const record = resp as Record<string, unknown>;
      if (typeof record.detail === "string" && record.detail) {
        msg = record.detail;
      } else if (Array.isArray(record.message) && record.message.length > 0) {
        msg = record.message.map(String).join("；");
      } else if (typeof record.message === "string" && record.message) {
        msg = record.message;
      }
    }
    return { status, message: msg || "请求处理失败" };
  }
  const code = typeof err?.code === "string" ? err.code : "";
  const rawStatus =
    code === "P1001" || code === "P1002"
      ? 507
      : code === "23505" || code === "P1003"
        ? 409
        : typeof err?.status === "number"
          ? err.status
          : 500;
  const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
  const message =
    status < 500 && typeof err?.message === "string" && err.message
      ? err.message
      : "请求处理失败";
  return { status, message };
}

function renderRechargeErrorHtml(status: number, message: string) {
  const safeStatus = escapeHtml(String(status));
  const safeMessage = escapeHtml(message);
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>弗淼 AIGC · 支付提示</title>" +
    "<style>" +
    ":root{--bg:#f8f9fa;--surface:#ffffff;--text:#09090b;--secondary:#52525b;--line:#e4e4e7;--blue:#3686ad;--blue-hover:#2d7396;--accent-soft:rgba(54,134,173,0.12);--btn-fg:#ffffff;--shadow:0 1px 3px rgba(9,9,11,0.06)}" +
    "@media (prefers-color-scheme: dark){:root{--bg:#111111;--surface:#1e1e1e;--text:#f4f5f7;--secondary:#a1a8b3;--line:rgba(255,255,255,0.09);--blue:#68a8db;--blue-hover:#7bb5e3;--accent-soft:rgba(104,168,219,0.15);--btn-fg:#0b141c;--shadow:0 8px 24px rgba(0,0,0,0.36)}}" +
    '[data-theme="dark"]{--bg:#111111;--surface:#1e1e1e;--text:#f4f5f7;--secondary:#a1a8b3;--line:rgba(255,255,255,0.09);--blue:#68a8db;--blue-hover:#7bb5e3;--accent-soft:rgba(104,168,219,0.15);--btn-fg:#0b141c;--shadow:0 8px 24px rgba(0,0,0,0.36)}' +
    "*{box-sizing:border-box}" +
    'body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif}' +
    ".card{width:100%;max-width:420px;padding:28px 26px;border-radius:12px;border:1px solid var(--line);background:var(--surface);box-shadow:var(--shadow);display:flex;flex-direction:column;gap:14px}" +
    ".head{display:flex;align-items:center;justify-content:space-between;gap:12px}" +
    ".brand{display:inline-flex;align-items:center;gap:9px;font-size:14px;font-weight:600}" +
    ".badge{padding:2px 9px;border-radius:999px;background:var(--accent-soft);color:var(--blue);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}" +
    "h1{margin:2px 0 0;font-size:18px;font-weight:600;line-height:1.4}" +
    "p{margin:0;font-size:13.5px;line-height:1.6;color:var(--secondary);overflow-wrap:anywhere}" +
    ".actions{margin-top:6px;display:flex;align-items:center}" +
    ".btn{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 16px;border-radius:8px;background:var(--blue);color:var(--btn-fg);font-size:13.5px;font-weight:600;text-decoration:none}" +
    ".btn:hover{background:var(--blue-hover)}" +
    ".btn:focus-visible{outline:2px solid var(--blue);outline-offset:2px}" +
    "</style></head><body>" +
    '<main class="card"><div class="head"><span class="brand">' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" viewBox="0 0 48 48" aria-hidden="true"><path fill="#a9eee4" d="M7 33 18 7h8L15 33z"/><path fill="#6db6fb" d="m18 39 12-29h8L26 39z"/><path fill="#b7a9fc" d="m31 36 6-15h7l-6 15z"/></svg>' +
    `<span>弗淼 AIGC</span></span><span class="badge">${safeStatus}</span></div>` +
    "<h1>无法跳转支付页面</h1>" +
    `<p>${safeMessage}</p>` +
    '<div class="actions"><a class="btn" href="/studio">返回工作台</a></div>' +
    "</main></body></html>"
  );
}

function sendRechargeErrorHtml(res: Response, status: number, message: string) {
  res
    .status(status)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .setHeader("Cache-Control", "private, no-store")
    .setHeader("X-Content-Type-Options", "nosniff")
    .setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
    )
    .end(renderRechargeErrorHtml(status, message));
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
    let target: string;
    try {
      target = await this.recharge.checkout(req.actor, id);
    } catch (error) {
      if (!req.headers.accept?.includes("text/html")) throw error;
      const { status, message } = extractRechargePayError(error);
      sendRechargeErrorHtml(res, status, message);
      return;
    }
    redirect(res, target);
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
