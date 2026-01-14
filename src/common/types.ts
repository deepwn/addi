import { JSONSchema7 } from 'ai';

export interface ModelCapabilities {
  imageInput?: boolean;
  toolCalling?: boolean | number;
}

export interface RemoteModelInfo {
  id: string;
  name?: string;
  description?: string;
  family?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  capabilities?: ModelCapabilities;
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

/**
 * Represents a specific AI model configuration.
 */
export interface Model extends Omit<ModelDraft, 'sid'> {
  /**
   * Internal unique identifier (UUID) for this model instance.
   * Distinct from `id` which is the provider-specific model identifier (e.g. 'gpt-4').
   */
  sid: string;
}

export type ProviderType = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'generic';

/**
 * Represents an AI Provider (e.g. OpenAI, DeepSeek, or a custom OAI-compatible provider).
 */
export interface Provider {
  /** Internal unique identifier for this provider. */
  id: string;
  /** Display name. */
  name: string;
  /** Type of the provider (determines API compatibility). */
  providerType: ProviderType;
  description?: string;
  website?: string;
  /** Base URL for the API (e.g. https://api.openai.com/v1). */
  apiEndpoint?: string;
  /** API Key (stored securely). */
  apiKey?: string;
  /** List of models associated with this provider. */
  models: Model[];
}

export interface ProviderRepository {
  getProviders(): Provider[];
  findModel(modelSid: string): { provider: Provider; model: Model } | null;
  onDidUpdate?: (listener: () => any) => any;
}

export type ChatMessageRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

export interface ToolStep {
  name?: string;
  id?: string;
  if?: string;
  env?: Record<string, string>;
  shell?: string;
  // `run` can be a string (script) or a structured command.
  // If string, it will be executed in a shell.
  run?:
    | string
    | {
        command: string;
        args?: string[];
      };
}

export interface CustomTool {
  id: string;
  name: string;
  description: string;
  parameters: JSONSchema7; // JSON Schema object
  steps: ToolStep[];
  source?: 'global' | 'workspace';
  visibility?: 'public' | 'private' | 'global';
  fileName?: string;
}
