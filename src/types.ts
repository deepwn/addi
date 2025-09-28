export interface ModelCapabilities {
  imageInput?: boolean;
  toolCalling?: boolean | number;
}

export interface Model {
  id: string;
  name: string;
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  tooltip?: string;
  detail?: string;
  capabilities: ModelCapabilities;
}

export type ProviderType = "openai" | "anthropic" | "google" | "generic";

export interface Provider {
  id: string;
  name: string;
  providerType: ProviderType;
  description?: string;
  website?: string;
  apiEndpoint?: string;
  apiKey?: string;
  models: Model[];
}

export type ModelDraft = {
  id: string;
  name: string;
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  tooltip?: string;
  detail?: string;
  capabilities: ModelCapabilities;
};

export interface ProviderRepository {
  getProviders(): Provider[];
  findModel(modelId: string): { provider: Provider; model: Model } | null;
}
