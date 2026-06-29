// BYOK-compatible types for the webview UI (Addi BYOK Edition)

/** Provider-level model default settings (capabilities + limits) */
export interface ByokModelDefaultSettings {
  toolCalling?: boolean;
  vision?: boolean;
  thinking?: boolean;
  streaming?: boolean;
  supportsReasoningEffort?: 'low' | 'medium' | 'high' | ('low' | 'medium' | 'high')[];
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

/** Info about a remote model (from listApi) */
export interface RemoteModelInfo {
  id: string;
  name?: string;
}

export interface ByokModelFormData {
  id: string;                    // Model identifier (required)
  name?: string;                 // Optional display name
  url?: string;                  // Model-specific endpoint
  toolCalling?: boolean;
  vision?: boolean;
  thinking?: boolean;
  streaming?: boolean;
  supportsReasoningEffort?: 'low' | 'medium' | 'high' | ('low' | 'medium' | 'high')[];
  reasoningEffortFormat?: 'api-token' | 'api-header-proxy' | 'api-key';
  editTools?: boolean | string[];
  maxInputTokens?: number;
  maxOutputTokens?: number;
  requestHeaders?: Record<string, string>;
  parentProviderName?: string;
  isBatchMode?: boolean;
  batchCount?: number;
}

export interface ByokProviderFormData {
  vendor?: string;
  name: string;
  apiKey?: string;
  apiType?: string;
  /** Provider-level API URL (stored in _addi_defaults.url) */
  url?: string;
  /** Model list API endpoint — for fetching available models (optional) */
  listApi?: string;
  models?: ByokModelFormData[];
  defaultSettings?: ByokModelDefaultSettings;
  settings?: Record<string, Record<string, unknown>>;
}

/** Message received from the extension (VS Code -> Webview) */
export interface WebviewUpdateMessage {
  type: "update";
  locale: string;
  mode: "edit" | "create";
  item: {
    type: "provider" | "model";
    isBatchMode?: boolean;
    batchCount?: number;
    data: ByokProviderFormData | (ByokModelFormData & { parentProviderName?: string; providerDefaults?: ByokModelDefaultSettings; remoteModels?: RemoteModelInfo[] });
    parentId?: string;
  };
}
