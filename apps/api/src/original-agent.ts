import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { sendFile } from "@fumiao/original-api/files.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import {
  type Field,
  type Fields,
  pathId,
} from "@fumiao/original-api/validation.js";
import { DomainError } from "@fumiao/platform/security.js";

const optional = { optional: true, nullable: true };
const text = (max: number, defaultValue = ""): Field => ({
  kind: "string",
  max,
  default: defaultValue,
});
const int = (min: number, max: number): Field => ({
  kind: "integer",
  min,
  max,
});
const float = (max: number): Field => ({
  kind: "float",
  min: 0,
  max,
  finite: true,
});
const flag: Field = { kind: "boolean", strict: false };
const profile: Field = {
  kind: "object",
  fields: {
    gpu_name: { kind: "string", max: 120 },
    backend: { kind: "literal", values: ["rocm", "cuda", "cpu", "other"] },
    vram_gib: float(2048),
    available_gpus: int(0, 128),
    used_gpus: int(1, 128),
    runtime: text(80),
    driver: text(120),
    torch_version: text(80),
    precision: text(80),
    attention: text(80),
    memory_mode: text(80),
    cpu_cores: { ...int(0, 4096), default: 0 },
    ram_gib: { ...float(65536), default: 0 },
  },
};
const beatFields: Fields = {
  lane_model: { kind: "string", max: 80, ...optional },
  can_accept: { ...flag, default: true },
  execution_plan: { kind: "dictionary", ...optional },
  stage: { kind: "string", max: 20 },
  detail: text(300),
  ticket: text(128),
  step: { ...int(0, 100), ...optional },
  steps: { ...int(1, 100), ...optional },
  uploading: { ...flag, default: false },
  hardware: text(180),
  workflow: text(80),
  runtime_id: text(96),
  job_phase: {
    kind: "literal",
    values: ["preparing", "generating", "finalizing", "uploading"],
    ...optional,
  },
  timing: {
    kind: "object",
    ...optional,
    fields: {
      h3_input_fingerprint: {
        kind: "string",
        pattern: "^[a-f0-9]{64}$",
        ...optional,
      },
      sampling_steps: { ...int(1, 100), ...optional },
      fast_mode: { ...flag, ...optional },
      peak_vram_bytes: { ...int(0, 2 ** 50), ...optional },
      peak_allocated_vram_bytes: { ...int(0, 2 ** 50), ...optional },
      prepare_s: { ...float(172800), ...optional },
      generate_s: { ...float(172800), ...optional },
      finalize_s: { ...float(172800), ...optional },
      cold: { ...flag, ...optional },
      recovered: { ...flag, default: false },
    },
  },
  profile: { ...profile, ...optional },
  ready_models: {
    kind: "list",
    item: { kind: "string" },
    max: 20,
    ...optional,
  },
  model_profiles: { kind: "dictionary", item: profile, ...optional },
  video_steps: {
    kind: "list",
    item: {
      kind: "literal",
      values: [4, 16, 20, 32, 50],
      pythonLiteral: true,
    },
    min: 1,
    max: 5,
    ...optional,
  },
};

export const originalAgentRoutes = [
  { path: /^\/agent\/heartbeat$/, method: "POST", body: beatFields },
  { path: /^\/agent\/claim$/, method: "POST" },
  { path: /^\/agent\/jobs\/([^/]+)\/receipt$/, method: "GET", nodeId: true },
  {
    path: /^\/agent\/jobs\/([^/]+)\/ref\/[^/]+$/,
    method: "GET",
    nodeId: true,
  },
  {
    path: /^\/agent\/jobs\/([^/]+)\/error$/,
    method: "POST",
    nodeId: true,
    body: beatFields,
  },
  { path: /^\/agent\/jobs\/([^/]+)\/result$/, method: "PUT", nodeId: true },
];

function header(req: Request, name: string) {
  return req.headersDistinct[name]?.[0] ?? "";
}

function credentials(req: Request) {
  return {
    authorization: header(req, "authorization"),
    ticket: header(req, "x-job-ticket"),
    lane: header(req, "x-model-lane"),
  };
}

async function resultBody(req: Request) {
  const limit = 64 * 1024 ** 2;
  if (Number(req.get("content-length")) > limit)
    throw new DomainError(413, "文件过大");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new DomainError(413, "文件过大");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

@Controller()
export class OriginalAgentController {
  constructor(@Inject(OriginalIdentity) private identity: OriginalIdentity) {}
  private async agent() {
    const { Agent } = await this.identity.p.registry.nodeExtension(
      this.identity.p.db,
    );
    return new Agent(this.identity.p);
  }
  @Post("agent/heartbeat")
  @HttpCode(200)
  async heartbeat(@Req() req: Request) {
    const { timing, ...beat } = req.body;
    // Heartbeat telemetry reports progress. Artifact-only fields travel in
    // X-Job-Timing and are checked by the job's installed plugin version.
    const report =
      timing &&
      Object.fromEntries(
        Object.entries(timing).filter(
          ([key, value]) =>
            value !== null &&
            !["sampling_steps", "fast_mode", "h3_input_fingerprint"].includes(
              key,
            ),
        ),
      );
    return (await this.agent()).heartbeat(credentials(req), {
      ...beat,
      timing: report,
    });
  }
  @Post("agent/claim")
  @HttpCode(200)
  async claim(@Req() req: Request) {
    return (await this.agent()).claim(credentials(req));
  }
  @Get("agent/jobs/:i/receipt")
  async receipt(@Req() req: Request, @Param("i") id: string) {
    const credential = credentials(req);
    return (await this.agent()).receipt(credential, pathId(id, "i"));
  }
  @Get("agent/jobs/:i/ref/:key")
  async reference(
    @Req() req: Request,
    @Param("i") id: string,
    @Param("key") key: string,
    @Res() res: Response,
  ) {
    const credential = credentials(req);
    const asset = await (
      await this.agent()
    ).reference(credential, pathId(id, "i"), key);
    const { storage } = this.identity.p;
    const mime = "application/octet-stream";
    if (storage.downloadUrl) {
      res
        .status(307)
        .set({
          Location: await storage.downloadUrl(asset.object_key, { mime }),
          "Content-Length": "0",
        })
        .end();
      return;
    }
    const info = await storage.stat(asset.object_key);
    await sendFile(req, res, {
      size: info.size,
      mime,
      modified: asset.object_modified ?? info.modified,
      open: (start, end) => storage.stream(asset.object_key, start, end),
    });
  }
  @Post("agent/jobs/:i/error")
  @HttpCode(200)
  async error(@Req() req: Request, @Param("i") id: string) {
    const credential = credentials(req);
    return (await this.agent()).error(
      credential,
      pathId(id, "i"),
      req.body.detail,
    );
  }
  @Put("agent/jobs/:i/result")
  async complete(@Req() req: Request, @Param("i") id: string) {
    const credential = credentials(req);
    const number = pathId(id, "i");
    return (await this.agent()).complete(
      credential,
      number,
      () => resultBody(req),
      {
        sha256: header(req, "x-sha256"),
        report: header(req, "x-job-timing"),
      },
    );
  }
}
