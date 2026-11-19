import {
  imagesLifecycle,
  apiKey,
  readPrefix,
  imageResponse,
  imageSafeError,
  ConnectionFailure,
} from "./lifecycle.js";
import { museJson } from "../../muse/src/json.js";
import {
  OriginalProviderCheckError,
  type ProviderPlugin,
} from "../../../packages/plugin-sdk/src/index.js";
export const imagesSettings: ProviderPlugin = {
  ...imagesLifecycle,
  manifest: {
    ...imagesLifecycle.manifest,
    version: "1.8.0",
    queue: {
      ...imagesLifecycle.manifest.queue!,
      timingVersions: [
        ...imagesLifecycle.manifest.queue!.timingVersions,
        "1.8.0",
      ],
    },
    originalImageSettings: {
      version: 1,
      namespace: "openai",
      defaultModel: "gpt-image-2.6-sunburst",
      controlledModels: ["gpt-image-2.6-sunburst", "muse-image"],
    },
  },
  async checkOriginalSettings(config, signal) {
    const key = apiKey(config);
    if (!key)
      throw new OriginalProviderCheckError("图片生成尚未配置，请联系管理员");
    const idle = new AbortController(),
      timer = setTimeout(() => idle.abort(), 30000);
    let errorResponse = false;
    try {
      const url = new URL(
          "v1/models/" +
            imagesSettings.manifest.originalImageSettings!.defaultModel,
          String(config.baseUrl).replace(/\/+$/, "") + "/",
        ),
        response = await imageResponse(
          url,
          "GET",
          { Authorization: "Bearer " + key },
          undefined,
          AbortSignal.any([signal, idle.signal]),
          () => timer.refresh(),
        );
      if (!response.ok) {
        errorResponse = true;
        throw new OriginalProviderCheckError(
          imageSafeError(
            response.status,
            await readPrefix(response, 65536, () => timer.refresh()),
          ),
        );
      }
      const bytes = await readPrefix(response, 64 * 1024 ** 2 + 1, () =>
        timer.refresh(),
      );
      if (bytes.length > 64 * 1024 ** 2)
        throw new OriginalProviderCheckError("生成结果过大，未保存");
      // The original probe accepts any successfully decoded JSON, regardless of fields.
      museJson(bytes);
    } catch (error) {
      if (error instanceof OriginalProviderCheckError) throw error;
      if (
        !errorResponse &&
        (error instanceof ConnectionFailure ||
          (error instanceof TypeError && error.message === "fetch failed") ||
          idle.signal.aborted ||
          signal.aborted)
      )
        throw new OriginalProviderCheckError(
          "与 OpenAI 的连接中断，结果未确认；请检查平台记录后再重新生成",
        );
      throw new OriginalProviderCheckError("Internal Server Error", 500);
    } finally {
      clearTimeout(timer);
    }
  },
};
