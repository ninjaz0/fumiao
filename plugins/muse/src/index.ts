import {
  connectionSchema,
  health,
  requestJson,
  ProviderError,
  type ProviderPlugin,
  type Receipt,
  type Execution,
} from "@fumiao/plugin-sdk/index.js";
export function museReceipt(value: any): Receipt {
  if (["completed", "done", "succeeded", "success"].includes(value.status)) {
    const entries = value.data || value.output || [];
    const urls = Array.isArray(entries)
      ? entries.map((x: any) => x.url).filter(Boolean)
      : [];
    const url = value.url || value.video_url || value.result?.url;
    if (url) urls.push(url);
    if (!urls.length)
      throw new ProviderError("Muse 结果缺少媒体地址", "uncertain");
    return {
      state: "completed",
      artifacts: [...new Set(urls)].map((url) => ({ url })),
    };
  }
  if (value.status === "failed")
    return { state: "failed", error: "Muse 任务失败" };
  const remoteId = value.task_id || value.id;
  if (typeof remoteId !== "string")
    throw new ProviderError("Muse 未返回任务标识", "uncertain");
  return { state: "pending", remoteId };
}
const schema = (video: boolean) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    ratio: {
      type: "string",
      enum: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
      default: "16:9",
    },
    ...(video
      ? { seconds: { type: "integer", enum: [5, 6, 8, 10], default: 5 } }
      : {}),
  },
});
export const muse: ProviderPlugin = {
  manifest: {
    id: "muse",
    version: "1.0.0",
    contractVersion: 1,
    label: "Muse",
    mode: "request",
    configSchema: connectionSchema,
    models: [
      {
        id: "muse-image",
        label: "Muse 图片",
        kind: "image",
        inputSchema: schema(false),
      },
      {
        id: "muse-video",
        label: "Muse 视频",
        kind: "video",
        inputSchema: schema(true),
      },
    ],
  },
  health,
  async submit(e) {
    return museReceipt(await submitMuse(e));
  },
  async inspect(e: Execution, id: string) {
    return museReceipt(await inspectMuse(e, id));
  },
};
// Shared transport keeps already accepted 1.0–1.3 tasks on their original wire
// contract. New versions can observe timestamps without changing old receipts.
export function submitMuse(e: Execution): Promise<any> {
  return requestJson(e, e.kind === "image" ? "v1/images/tasks" : "v1/videos", {
    model: e.model,
    prompt: e.input.prompt,
    aspect_ratio: e.input.params.ratio || "16:9",
    images: e.input.references
      .filter((r) => r.mime.startsWith("image/"))
      .map((r) => r.url),
    videos: e.input.references
      .filter((r) => r.mime.startsWith("video/"))
      .map((r) => r.url),
    audios: e.input.references
      .filter((r) => r.mime.startsWith("audio/"))
      .map((r) => r.url),
    timeout: 600,
    ...(e.kind === "video"
      ? { duration: e.input.params.seconds || 5 }
      : { response_format: "url" }),
  });
}
export function inspectMuse(e: Execution, id: string): Promise<any> {
  return requestJson(
    e,
    `${e.kind === "image" ? "v1/images/tasks/" : "v1/videos/"}${encodeURIComponent(id)}`,
  );
}
