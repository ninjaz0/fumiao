import { unescape as decodePath } from "node:querystring";
import express, {
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import type { OriginalIdentity } from "../../../packages/original-api/src/identity.js";
import { DomainError } from "../../../packages/platform/src/security.js";
import {
  decodePythonJson,
  pythonJsonText,
} from "../../../packages/plugin-sdk/src/json.js";
import {
  parseBody,
  ValidationError,
  type Fields,
} from "../../../packages/original-api/src/validation.js";
import {
  chatApplyFields,
  chatCreateFields,
  chatRenameFields,
  chatSendFields,
} from "../../../packages/original-api/src/chat-draft.js";
import {
  originalSessionToken,
  type OriginalAuthRequest,
} from "./original-request.js";

const routes: { path: RegExp; methods: Record<string, Fields | null> }[] = [
  { path: /^\/api\/chats$/, methods: { GET: null, POST: chatCreateFields } },
  {
    path: /^\/api\/chats\/[^/]+$/,
    methods: { GET: null, PATCH: chatRenameFields, DELETE: null },
  },
  {
    path: /^\/api\/chats\/[^/]+\/messages$/,
    methods: { POST: chatSendFields },
  },
  { path: /^\/api\/chats\/[^/]+\/(?:stop|restore)$/, methods: { POST: null } },
  { path: /^\/api\/chats\/[^/]+\/apply$/, methods: { POST: chatApplyFields } },
  { path: /^\/api\/chats\/[^/]+\/events$/, methods: { GET: null } },
];

export const isOriginalChatRequest = (req: Request) =>
  /^\/api\/chats(?:\/|$)/i.test(decodePath(req.path));

export function originalChatRequest(
  identity: OriginalIdentity,
  failure: (error: unknown, res: Response) => void,
): RequestHandler {
  const raw = express.raw({ limit: "3mb", type: () => true });
  return async (req, res, next) => {
    try {
      const path = decodePath(req.path);
      const route = routes.find(({ path: pattern }) => pattern.test(path));
      if (!route) {
        const trimmed = path.replace(/\/+$/, "");
        if (
          path !== trimmed &&
          routes.some(({ path: pattern }) => pattern.test(trimmed))
        ) {
          const location = new URL(
            req.originalUrl,
            `${req.protocol}://${req.get("host")}`,
          );
          location.pathname = trimmed
            .split("/")
            .map(encodeURIComponent)
            .join("/");
          res.status(307).set("Location", location.href).end();
          return;
        }
        throw new DomainError(404, "Not Found");
      }
      if (!Object.hasOwn(route.methods, req.method)) {
        res.set("Allow", Object.keys(route.methods)[0]);
        throw new DomainError(405, "Method Not Allowed");
      }
      // FastAPI validates declared bodies before invoking the handler's actor lookup.
      const fields = route.methods[req.method];
      if (fields) {
        await new Promise<void>((resolve, reject) =>
          raw(req, res, (error) => (error ? reject(error) : resolve())),
        );
        req.body = readChatBody(req);
        parseBody(req.body, fields, true);
      }
      (req as OriginalAuthRequest).actor = await identity.actor(
        originalSessionToken(req),
      );
      // Route Express on the same once-decoded path used for contract matching.
      req.url =
        path.split("/").map(encodeURIComponent).join("/") +
        req.url.slice(req.path.length);
      next();
    } catch (error) {
      failure(error, res);
    }
  };
}

function readChatBody(req: Request): unknown {
  const bytes = req.body;
  if (!Buffer.isBuffer(bytes) || !bytes.length) return undefined;
  if (
    !/^application\/(?:json|[^/;\s]+\+json)(?:\s*;|$)/i.test(
      req.get("content-type") ?? "",
    )
  )
    return bytes.toString("utf8");
  let source: string;
  try {
    source = decodePythonJson(bytes);
  } catch {
    throw new DomainError(400, "There was an error parsing the body");
  }
  try {
    return pythonJsonText(source);
  } catch {
    // V8's SyntaxError text and indices differ from Python's 422 envelope.
    return invalidChatJson(source);
  }
}

function invalidChatJson(source: string): never {
  let cursor = 0;
  const read = (pattern: RegExp) => {
    pattern.lastIndex = cursor;
    if (!pattern.test(source)) return false;
    cursor = pattern.lastIndex;
    return true;
  };
  const whitespace = () => read(/[ \n\r\t]*/y);
  const fail = (error: string, position = cursor): never => {
    throw new ValidationError([
      {
        type: "json_invalid",
        loc: ["body", [...source.slice(0, position)].length],
        msg: "JSON decode error",
        input: {},
        ctx: { error },
      },
    ]);
  };
  const string = () => {
    const start = cursor++;
    while (!read(/"/y)) {
      if (read(/[^"\\\x00-\x1f]+/y)) continue;
      if (cursor === source.length)
        fail("Unterminated string starting at", start);
      if (!read(/\\/y)) fail("Invalid control character at");
      if (read(/["\\/bfnrt]/y)) continue;
      if (read(/u[0-9a-fA-F]{4}/y)) continue;
      if (source[cursor] === "u") fail("Invalid \\uXXXX escape");
      if (cursor === source.length)
        fail("Unterminated string starting at", start);
      fail("Invalid \\escape", cursor - 1);
    }
  };
  const value = () => {
    if (source[cursor] === '"') return string();
    if (read(/\{/y)) return sequence(true);
    if (read(/\[/y)) return sequence(false);
    if (
      !read(
        /(?:true|false|null|NaN|-?Infinity|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/y,
      )
    )
      fail("Expecting value");
  };
  const sequence = (object: boolean) => {
    const end = object ? /\}/y : /\]/y;
    whitespace();
    if (read(end)) return;
    while (true) {
      if (object) {
        if (source[cursor] !== '"')
          fail("Expecting property name enclosed in double quotes");
        string();
        whitespace();
        if (!read(/:/y)) fail("Expecting ':' delimiter");
        whitespace();
      }
      value();
      whitespace();
      if (read(end)) return;
      if (!read(/,/y)) fail("Expecting ',' delimiter");
      whitespace();
    }
  };
  whitespace();
  value();
  whitespace();
  if (cursor !== source.length) fail("Extra data");
  throw new DomainError(400, "There was an error parsing the body");
}
