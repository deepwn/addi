export interface Model {
  id: string;
  name: string;
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  imageInput?: boolean;
  toolCalling?: boolean;
}

export interface Provider {
  id: string;
  name: string;
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
  imageInput: boolean;
  toolCalling: boolean;
};

export interface ProviderRepository {
  getProviders(): Provider[];
  findModel(modelId: string): { provider: Provider; model: Model } | null;
}
