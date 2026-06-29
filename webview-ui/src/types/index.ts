// BYOK-compatible types for the webview UI (Addi BYOK Edition)

/** Provider-level model default settings */
export interface ByokModelDefaultSettings {
  listApi?: string;
  toolCalling?: boolean;
  vision?: boolean;
  thinking?: boolean;
  streaming?: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  url?: string;
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
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsReasoningEffort?: unknown;
  editTools?: unknown;
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
  models?: ByokModelFormData[];
  defaultSettings?: ByokModelDefaultSettings;
  settings?: Record<string, Record<string, unknown>>;
  url?: string;
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
