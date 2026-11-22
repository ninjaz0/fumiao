import { remoteForm } from "./form.js";
import {
  requestJson,
  type Manifest,
  type ProviderPlugin,
  type Receipt,
} from "@fumiao/plugin-sdk/index.js";
import { originalRemoteSubmission } from "./original.js";
export function remotePlugin(
  manifest: Manifest,
  endpoint: string,
): ProviderPlugin {
  return {
    manifest,
    ...((manifest.originalSubmission?.version ?? 0) >= 2
      ? {
          originalSubmission: originalRemoteSubmission(manifest),
          modelForm: (model) =>
            remoteForm(model, manifest.originalSubmission?.version === 3),
        }
      : {}),
    async health(config, signal) {
      try {
        return (
          await fetch(`${endpoint}/health`, {
            signal,
            headers: { Authorization: `Bearer ${config.apiKey || ""}` },
            redirect: "error",
          })
        ).ok;
      } catch {
        return false;
      }
    },
    async submit(e) {
      return requestJson(
        { ...e, config: { baseUrl: endpoint, apiKey: e.config.apiKey || "" } },
        "submit",
        {
          ...e,
          signal: undefined,
          reportTiming: undefined,
          reportProviderClock: undefined,
        },
      ) as Promise<Receipt>;
    },
    async inspect(e, remoteId) {
      return requestJson(
        { ...e, config: { baseUrl: endpoint, apiKey: e.config.apiKey || "" } },
        "inspect",
        {
          ...e,
          signal: undefined,
          reportTiming: undefined,
          reportProviderClock: undefined,
          remoteId,
        },
      ) as Promise<Receipt>;
    },
  };
}
