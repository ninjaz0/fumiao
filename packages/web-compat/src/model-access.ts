/** Wire contract for the session-only /api/admin/model-access endpoints. */
export type ModelPurpose = "chat" | "image" | "video";
export type VideoProtocol = "new-api-videos" | "openrouter-videos";
export type ModelProtocol =
  "openai-chat" | "openai-images" | "openrouter-images" | VideoProtocol;
export type ModelDirectory = "models" | "images/models" | "videos/models";
export type DirectoryStatus =
  | "ok"
  | "empty"
  | "partial"
  | "invalid_credentials"
  | "forbidden"
  | "timeout"
  | "unavailable";
export type ParameterDefinition =
  | { type: "enum"; values: (string | number)[] }
  | { type: "range"; min: number; max: number }
  | { type: "boolean" };
export interface ModelParameters {
  names?: string[];
  /** Informational names whose gateway constraints still need confirmation. */
  unconfirmed_parameters?: string[];
  definitions?: Record<string, ParameterDefinition>;
  durations?: number[];
  automatic_duration?: boolean;
  resolutions?: string[];
  aspect_ratios?: string[];
  sizes?: string[];
  frame_images?: string[];
  upscale_only?: boolean;
  input_modalities?: string[];
  output_modalities?: string[];
  context_length?: number;
  max_completion_tokens?: number;
}
export interface ModelCandidate {
  upstream_id: string;
  name: string;
  purpose: ModelPurpose | null;
  purpose_source:
    "output_modalities" | "image_directory" | "video_directory" | null;
  parameters: ModelParameters;
  directories: ModelDirectory[];
  change: "added" | "changed" | "unchanged" | "missing";
  metadata_status: "declared" | "needs_confirmation" | "missing" | "stale";
}
export interface CreateModelConnection {
  name?: string;
  base_url: string;
  api_key: string;
  default_video_protocol?: VideoProtocol | null;
}
export interface EditModelConnection extends Partial<CreateModelConnection> {
  expected_revision: number;
}
export interface ModelConnection {
  id: string;
  name: string;
  revision: number;
  revision_id: string;
  base_url: string;
  directory_url: string;
  credentials_configured: boolean;
  default_video_protocol: VideoProtocol | null;
}
export interface ModelDiscovery {
  revision: number;
  checked_at: string;
  directories: Partial<Record<ModelDirectory, DirectoryStatus>>;
  candidates: ModelCandidate[];
}
export interface ChatPrices {
  input: string | null;
  output: string | null;
  cache_read?: string | null;
  cache_write?: string | null;
}
export interface DraftOverrides {
  protocol?: VideoProtocol | "openrouter-images" | null;
  durations?: number[];
  duration_range?: { min: number; max: number };
  resolutions?: string[];
  aspect_ratios?: string[];
  sizes?: string[];
  frame_images?: "first_frame"[];
  requires_first_frame?: boolean;
  input_references?: { min: number; max: number };
  chat_response?: "stream" | "json";
  tools?: boolean;
}
export interface SaveModelDraft {
  expected_revision: number;
  connection_id: string;
  connection_revision: number;
  upstream_id: string;
  purpose?: ModelPurpose | null;
  price?: string | null;
  chat_prices?: ChatPrices;
  overrides?: DraftOverrides;
}
export interface ModelDraft extends Omit<
  SaveModelDraft,
  "expected_revision" | "chat_prices"
> {
  id: string;
  revision: number;
  purpose: ModelPurpose | null;
  price: string | null;
  chat_prices: ChatPrices | null;
  overrides: DraftOverrides;
  protocol: ModelProtocol | null;
  parameters: ModelParameters &
    Omit<DraftOverrides, "protocol" | "frame_images">;
  status: "ready" | "draft";
  missing: string[];
}
export interface ModelAccessView {
  connections: ModelConnection[];
  discoveries: (ModelDiscovery & {
    connection_id: string;
    connection_revision_id: string;
  })[];
  drafts: ModelDraft[];
}
