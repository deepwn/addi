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

/**
 * AI SDK UI Message Types
 * Based on @ai-sdk/ui
 */
export interface UIMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: Array<UIPart>;
  metadata?: Record<string, any>;
}

export type UIPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; reasoning: string }
  | { type: 'image'; image: string; mediaType?: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: any }
  | { type: 'tool-result'; toolCallId: string; result: any };

export type ScrubStrategy = 'stop' | 'retry';

export interface ScrubSettings {
  enabled: boolean;
  patterns: string[];
  strategy: ScrubStrategy;
  flags?: string; // e.g. "gis"
}

export interface ModelCapabilities {
  imageInput?: boolean;
  toolCalling?: boolean | number;
  scrubSettings?: ScrubSettings;
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
