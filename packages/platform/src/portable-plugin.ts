import {
  health,
  requestJson,
  ProviderError,
  receiptSchema,
  type Manifest,
  type Execution,
  type ProviderPlugin,
} from "../../plugin-sdk/src/index.js";
import { remoteForm } from "../../../plugins/remote/src/form.js";
import { originalRemoteSubmission } from "../../../plugins/remote/src/original.js";

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
