import { requestWorkbench } from "@fumiao/plugin-sdk/request-workbench.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import { pythonJsonText } from "@fumiao/plugin-sdk/json.js";
import models from "../models.json" with { type: "json" };
import {
  submissionPolicy,
  estimatePolicy,
  statePolicy,
  timingFeatures,
} from "../src/studio-policies.ts";
import { queuePolicy } from "../src/queue-policy.ts";
import {
  flowResult,
  flowSafeError,
  FlowFailure,
  collectFlowEvent,
  truthy,
} from "../src/stream-policy.ts";
import { flowDownloadPlan } from "../src/artifact-plan.ts";

const fallback = "Flow 生成或保存失败，请从后台检查结果后重试";
const recovery = "Flow 成品保存失败，请从后台检查生成结果";
const fail = (note) => ({ disposition: { action: "fail", note } });
const generic = (e) => fail(e instanceof FlowFailure ? e.message : fallback);

export default {
  ...requestWorkbench(
    submissionPolicy(pythonStrip),
    estimatePolicy,
    {
      ...statePolicy,
      project(job) {
        const result = statePolicy.project(job);
        if (result.actual && !job.usage.flow_media_id)
          delete result.actual.flow_media_id;
        return result;
      },
    },
    {
      ...queuePolicy,
      requestCapacity: ({ health, stamp }) =>
        health.ready && stamp - (health.checked ?? 0) < 90 ? 1 : 0,
    },
    timingFeatures,
    MODEL_FORMS,
  ),
  request({ kind, model, prompt, params, references }) {
    const content = [
      { type: "text", text: prompt },
      ...references.map((r) => ({
        type: "image_url",
        image_url: { url: r.value },
      })),
    ];
    if (params.source_media_id)
      content.push({
        type: "image_url",
        image_url: { url: "extend://" + params.source_media_id },
      });
    return {
      path: "/v1/chat/completions",
      timeoutMs: 600000,
      publicAlias: "https://backend.nvmes.com/flow",
      body: {
        model: models[model].upstream,
        messages: [{ role: "user", content }],
        stream: true,
      },
    };
  },
  stream(kind) {
    const chunks = [],
      diagnostics = [];
    return {
      line(text) {
        let data;
        try {
          data = pythonJsonText(text);
        } catch {
          return null;
        }
        try {
          collectFlowEvent(data, chunks, diagnostics);
          return { note: "Flow 正在生成" };
        } catch (e) {
          return { outcome: generic(e) };
        }
      },
      finish() {
        try {
          return { receipt: flowResult(kind, chunks.join(""), diagnostics) };
        } catch (e) {
          return generic(e);
        }
      },
    };
  },
  result({ status, text, failure }) {
    if (failure === "connection")
      return fail(
        "与 Flow 的连接中断，生成结果未确认；请核对后台记录后再重新生成",
      );
    if (failure === "oversized") return fail("Flow 返回内容过大，未保存结果");
    return fail(failure ? fallback : flowSafeError(status, text));
  },
  async serviceProbe(host) {
    const reply = await host.service.read("/v1/models");
    if (reply.status < 200 || reply.status >= 300) return { ready: false };
    try {
      const data = JSON.parse(reply.text).data;
      if (Array.isArray(data) && data.every((m) => typeof m?.id === "string"))
        return { ready: true, models: data.map((m) => m.id) };
    } catch {}
    return { ready: true };
  },
  async queueHealth(host) {
    async function read(path, limit) {
      const reply = await host.service.read(path, limit);
      if (reply.status < 200 || reply.status >= 300 || reply.text === null)
        throw Error();
      return pythonJsonText(reply.text);
    }
    try {
      const catalog = await read("/v1/models", 262144),
        health = await read("/health", 65536);
      return {
        ready:
          truthy(catalog.data) &&
          truthy(health.backend_running) &&
          truthy(health.has_active_tokens),
      };
    } catch {
      return { ready: false };
    }
  },
  artifact(url, base, alias, recovering) {
    try {
      const p = flowDownloadPlan(
        url,
        base,
        alias ?? { netloc: "backend.nvmes.com", path: "/flow" },
      );
      return p.error
        ? { error: recovering ? recovery : p.error }
        : { ...p, timeoutMs: 90000 };
    } catch {
      return { error: recovering ? recovery : fallback };
    }
  },
  downloadError(reason, recovering) {
    return {
      disposition: "failed",
      note: recovering
        ? recovery
        : reason === "oversized"
          ? "Flow 成品超过 64 MB，未保存"
          : fallback,
    };
  },
};
