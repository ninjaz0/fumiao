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
  enabled?: boolean;
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
  reused_from: { id: string; revision: number; models: string[] } | null;
  enabled: boolean;
  credential_scope: {
    endpoints: readonly string[];
    upstream_ids: readonly string[] | null;
  };
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
export type PublishedPrice =
  | {
      kind: "chat";
      input: string;
      output: string;
      cache_read: string | null;
      cache_write: string | null;
    }
  | { kind: "image" | "video"; unit: string };
export type PublicationItem =
  | {
      action: "price";
      catalog_id: string;
      expected_revision: number;
      price: PublishedPrice;
    }
  | {
      draft_id: string;
      draft_revision: number;
      action: "create" | "standby" | "activate";
      catalog_id?: string;
      expected_revision?: number;
      label?: string;
      replace_price?: boolean;
    }
  | {
      action: "activate";
      catalog_id: string;
      expected_revision: number;
      route_revision_id: string;
    };
export interface ModelPublication {
  catalog_id: string;
  revision: number;
  price_revision_id: string;
  route_revision_id: string;
  label: string;
  price: PublishedPrice;
  routes: {
    route_revision_id: string;
    connection_id: string;
    connection_revision_id: string;
    model_id: string;
    draft_id: string;
    draft_revision: number;
    upstream_id: string;
    protocol: ModelProtocol;
    directory: Pick<ModelDiscovery, "checked_at" | "directories"> | null;
    health: {
      state: string;
      at: string;
      missing_usage: number;
      last_missing_usage: string | null;
    } | null;
    capabilities: ModelDraft["parameters"];
    enabled: boolean;
  }[];
}
export interface ModelAccessView {
  publications: ModelPublication[];
  reusable_connections: {
    id: string;
    revision: number;
    name: string;
    base_url: string;
    models: string[];
    borrowed: boolean;
  }[];
  connections: ModelConnection[];
  discoveries: (ModelDiscovery & {
    connection_id: string;
    connection_revision_id: string;
  })[];
  drafts: ModelDraft[];
}

export interface ModelTrialSample {
  uid: string;
  workspace: number;
  prompt: string;
  route_revision: string;
  price_revision: string;
  params?: Record<string, unknown>;
  refs?: string[];
}
export interface ModelTrialQuote {
  route_revision: string;
  price_revision: string;
  max_charge: string;
  quote_context: string;
  max_output_tokens?: number;
}
export type ModelTrialReceipt = Pick<
  ModelTrialQuote,
  "route_revision" | "price_revision" | "max_charge"
> &
  ({ cid: string; turn: string } | { job: number });
