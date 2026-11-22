import {
  health,
  requestJson,
  ProviderError,
  receiptSchema,
  type Manifest,
  type Execution,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
import { remoteForm } from "@fumiao/plugin-remote/form.js";
import { originalRemoteSubmission } from "@fumiao/plugin-remote/original.js";

// The host owns HTTP, authentication and the immutable task identity. The
// package maps JSON inputs and receipts without receiving the service key.
export function portablePlugin(manifest: Manifest): ProviderPlugin {
  async function send(e: Execution) {
    if (!e.mappedRequest || !e.mapResult)
      throw new ProviderError("缺少冻结的插件版本", "rejected");
    const raw = await requestJson(
      e,
      e.mappedRequest.path.slice(1),
      e.mappedRequest.body,
    );
    try {
      return receiptSchema.parse(e.mapResult(raw));
    } catch {
      throw new ProviderError("插件无法确认上游结果", "uncertain");
    }
  }
  return {
    manifest,
    health,
    submit: send,
    inspect: send,
    originalSubmission: originalRemoteSubmission(manifest),
    modelForm: (m) => remoteForm(m, manifest.originalSubmission?.version === 3),
  };
}
