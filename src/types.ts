import { JSONSchema7 } from 'ai';

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

export type ProviderType = "openai" | "anthropic" | "google" | "deepseek" | "generic";

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
  onDidUpdate?: (listener: () => any) => any;
}

export type ChatMessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

export interface ToolStep {
  name?: string;
  id?: string;
  run?: string;
  http?: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  };
}

export interface CustomTool {
  id: string;
  name: string;
  description: string;
  parameters: JSONSchema7; // JSON Schema object
  steps: ToolStep[];
  source?: 'global' | 'workspace';
  fileName?: string;
}
