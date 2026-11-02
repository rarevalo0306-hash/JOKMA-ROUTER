export type AdapterInfo = {
  slug: string;
  implemented: boolean;
  summary: string;
};

export type Provider = {
  id: string;
  name: string;
  adapter: string;
  base_url: string;
  enabled: boolean;
  has_api_key: boolean;
  api_key_last4: string | null;
  key_url: string | null;
  label: string | null;
  kind: "chat" | "video";
  created_at: string | null;
  updated_at: string | null;
};

export type CatalogModel = {
  id: string;
  provider_id: string;
  provider_name: string;
  name: string;
  public_id: string;
  alias: string | null;
  enabled: boolean;
  fallback_model_ids: string[];
  fallbacks: { id: string; public_id: string }[];
  input_per_million: number;
  output_per_million: number;
  currency: string;
};

export type ApiKeyRecord = {
  id: string;
  name: string;
  app_name: string;
  key_prefix: string;
  raw_key?: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string | null;
};

export type UsageSummary = {
  requests: number;
  avg_latency_ms: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost: number;
  tokens_by_app: {
    app: string;
    prompt_tokens: number;
    completion_tokens: number;
    requests: number;
  }[];
  cost_by_model: {
    model: string;
    estimated_cost: number;
    prompt_tokens: number;
    completion_tokens: number;
    requests: number;
  }[];
  recent: {
    id: string;
    app_name: string;
    model_requested: string;
    model_served: string | null;
    prompt_tokens: number;
    completion_tokens: number;
    latency_ms: number;
    status: "success" | "fallback" | "error";
    http_status: number | null;
    estimated_cost: number;
    error_message: string | null;
    created_at: string | null;
  }[];
};
