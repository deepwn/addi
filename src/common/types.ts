import { JSONSchema7 } from 'ai';

/**
 * AI SDK Core Message Types
 * Based on @ai-sdk/core
 */
export type ModelMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | Array<MessageContentPart> }
  | { role: 'assistant'; content: string | Array<MessageContentPart> }
  | { role: 'tool'; content: Array<ToolResultPart> };

export type MessageContentPart = TextPart | ReasoningPart | ImagePart | ToolCallPart;

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ReasoningPart {
  type: 'reasoning';
  reasoning: string;
}

export interface ImagePart {
  type: 'image';
  image: string | Uint8Array | Buffer | URL;
  mediaType?: string;
}

export interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: any;
}

export interface ToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  result: any;
}

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
  // Stats - Optional in draft, managed separately in runtime
  speedHistory?: number[];
  averageSpeed?: number;
};

/**
 * Persisted configuration for a model (Synced).
 */
export interface ModelConfig {
  sid: string;
  id: string;
  name: string;
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  requestAdditional?: string;
}

/**
 * Runtime statistics for a model (Local only).
 */
export interface ModelStats {
  speedHistory?: number[];
  averageSpeed?: number;
}

/**
 * Represents a specific AI model configuration.
 * Combines static config and runtime stats.
 */
export interface Model extends ModelConfig, ModelStats {}

/**
 * API Types based on the API interface format.
 * This simplifies provider selection to 4 main types.
 */
export type ProviderType =
  | 'openai-completions'   // OpenAI (/completions) - Most common, used by OpenAI, DeepSeek, local models, etc.
  | 'openai-responses'     // OpenAI (/responses) - Newer API with built-in tool support
  | 'anthropic-messages'   // Anthropic (/messages)
  | 'google-generateContent'; // Google (/name:generateContent)

/**
 * Persisted configuration for a provider (Synced).
 */
export interface ProviderConfig {
  id: string;
  name: string;
  providerType: ProviderType;
  description?: string;
  website?: string;
  apiEndpoint?: string;
  models: ModelConfig[];
}

/**
 * Represents an AI Provider (e.g. OpenAI, DeepSeek, or a custom OAI-compatible provider).
 * runtime object with secrets and full models.
 */
export interface Provider extends Omit<ProviderConfig, 'models'> {
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
