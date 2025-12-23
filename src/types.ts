export interface ModelCapabilities {
  imageInput?: boolean;
  toolCalling?: boolean | number;
}

export type ModelDraft = {
  id: string;
  name: string;
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  requestAdditional?: string;
  sid?: string;
  speedHistory?: number[];
  averageSpeed?: number;
};

export interface Model extends Omit<ModelDraft, "sid"> {
  sid: string;
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

export interface ProviderRepository {
  getProviders(): Provider[];
  findModel(modelSid: string): { provider: Provider; model: Model } | null;
}
