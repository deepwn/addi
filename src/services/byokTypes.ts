/**
 * BYOK (Bring Your Own Key) Types
 *
 * These types match VS Code's native `chatLanguageModels.json` schema.
 * @see https://github.com/microsoft/vscode-copilot/blob/main/docs/schemas/chatLanguageModels.schema.json
 */

/** VS Code BYOK provider vendor types */
export type ByokVendor =
  | 'copilot'
  | 'github'
  | 'openai'
  | 'azure'
  | 'anthropic'
  | 'google'
  | 'custom'
  | 'customendpoint';

/** VS Code BYOK API types */
export type ByokApiType =
  | 'chat-completions'
  | 'azure-chat-completions'
  | 'completions'
  | 'realtime'
  | 'messages'
  | 'responses';

/** VS Code BYOK model definition */
export interface ByokModel {
  /** Model identifier sent to the API */
  id: string;
  /** Display name in the model picker */
  name?: string;
  /** Custom endpoint URL (overrides provider-level url) */
  url?: string;
  /** Per-model API type override */
  apiType?: ByokApiType;
  /** Whether the model supports tool/function calling */
  toolCalling?: boolean;
  /** Whether the model supports vision/images */
  vision?: boolean;
  /** Maximum input tokens */
  maxInputTokens?: number;
  /** Maximum output tokens */
  maxOutputTokens?: number;
  /** Whether the model supports edit tools */
  editTools?: boolean | string[];
  /** Whether the model supports thinking/reasoning */
  thinking?: boolean;
  /** Whether the model supports streaming */
  streaming?: boolean;
  /** Supported reasoning effort levels */
  supportsReasoningEffort?: 'low' | 'medium' | 'high' | ('low' | 'medium' | 'high')[];
  /** How reasoning effort is communicated to the API */
  reasoningEffortFormat?: 'api-token' | 'api-header-proxy' | 'api-key';
  /** Custom request headers */
  requestHeaders?: Record<string, string>;
  /** Zero data retention */
  zeroDataRetentionEnabled?: boolean;
}

/** VS Code BYOK provider definition */
export interface ByokProvider {
  /** Display name */
  name: string;
  /** Provider vendor type */
  vendor: ByokVendor;
  /** API key (can use ${input:...} syntax for secret storage) */
  apiKey?: string;
  /** API type (e.g. "chat-completions", "messages") */
  apiType?: ByokApiType;
  /** List of models */
  models?: ByokModel[];
  /** Provider-level settings (BYOK standard) */
  settings?: Record<string, Record<string, unknown>>;
  /**
   * Addi-private provider default settings.
   * Stored at provider root level to avoid polluting the BYOK settings schema.
   */
  _addi_defaults?: Record<string, unknown>;
}

/** Top-level chatLanguageModels.json format (array of providers) */
export type ByokConfig = ByokProvider[];

/**
 * Addi-private provider default settings stored in `_addi_defaults`.
 * Used as fallback values when creating new models under this provider.
 *
 * Note: `url` and `listApi` are visually presented as top-level provider fields
 * in the UI, but stored within `_addi_defaults` for Addi compatibility.
 */
export interface ByokDefaultSettings {
  /** Default API endpoint URL (provider-level, stored in _addi_defaults) */
  url?: string;
  /** API endpoint for listing available models (stored in _addi_defaults) */
  listApi?: string;
  /** Default values applied to new models */
  toolCalling?: boolean;
  vision?: boolean;
  thinking?: boolean;
  streaming?: boolean;
  supportsReasoningEffort?: 'low' | 'medium' | 'high' | ('low' | 'medium' | 'high')[];
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

/** Helper to get the _addi_defaults from a provider */
export function getProviderDefaults(provider: ByokProvider): ByokDefaultSettings {
  return (provider._addi_defaults as ByokDefaultSettings) ?? {};
}

/** Helper to set the _addi_defaults on a provider */
export function setProviderDefaults(provider: ByokProvider, defaults: ByokDefaultSettings): void {
  provider._addi_defaults = defaults as Record<string, unknown>;
}

/**
 * Unique identifier for a provider in the Addi tree view.
 * BYOK doesn't have a native id field, so we use index-based or name-based identity.
 */
export function getProviderId(provider: ByokProvider): string {
  return provider.name;
}

/**
 * Unique identifier for a model within a provider context.
 */
export function getModelId(providerName: string, model: ByokModel): string {
  return `${providerName}::${model.id}`;
}
