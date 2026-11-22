import { z } from "zod";

export const artifactDownloadPolicySchema = z
  .object({ version: z.literal(1) })
  .strict();
export type ArtifactDownloadPolicy = z.infer<
  typeof artifactDownloadPolicySchema
>;
export type ArtifactDownloadRequest = {
  url: string;
  config: Record<string, unknown>;
  /** A receipt persisted before this execution is a save recovery. */
  recovering: boolean;
};
export class ArtifactDownloadError extends Error {
  constructor(
    message: string,
    readonly disposition: "retry" | "failed",
  ) {
    super(message);
  }
}

export { splitArtifactUrl } from "./artifact-url.js";

export async function fetchArtifact(
  url: string,
  headers: Record<string, string>,
  options: {
    signal: AbortSignal;
    timeout: number;
    maxBytes: number;
    oversized: string;
  },
): Promise<Uint8Array> {
  const idle = new AbortController(),
    timer = setTimeout(() => idle.abort(), options.timeout);
  try {
    const response = await fetch(url, {
      headers,
      redirect: "error",
      signal: AbortSignal.any([options.signal, idle.signal]),
    });
    timer.refresh();
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error("Artifact request failed");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body as any) {
      timer.refresh();
      size += chunk.length;
      if (size > options.maxBytes)
        throw new ArtifactDownloadError(options.oversized, "failed");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}
