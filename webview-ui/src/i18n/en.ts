import type { I18nMessages } from "./types";

const en: I18nMessages = {
  common: {
    save: "Save",
    delete: "Delete",
    cancel: "Cancel",
  },

  provider: {
    title: "Provider Details",
    name: "Name",
    apiType: "API Type",
    apiKey: "API Key",
    apiKeyPlaceholder: "Paste your API key here",
    apiKeyNote: "Stored directly in chatLanguageModels.json.",
    apiTypeOptions: {
      "chat-completions": "Chat Completions",
      responses: "Responses",
      messages: "Messages",
    },
    defaultsSection: "Model Defaults (optional)",
    defaultsDescription: "These values will be pre-filled when creating new models under this provider.",
    listApi: "List API URL",
    listApiPlaceholder: "e.g. https://api.openai.com/v1/models",
    listApiNote: "Endpoint for fetching available models list.",
    defaultToolCalling: "Tool Calling",
    defaultVision: "Vision",
    defaultThinking: "Thinking",
    defaultStreaming: "Streaming",
    defaultMaxInputTokens: "Max Input Tokens",
    defaultMaxOutputTokens: "Max Output Tokens",
    quickAddTitle: "Quick Add Provider",
    quickAddSearchPlaceholder: "Search providers...",
  },

  model: {
    title: "Model Details",
    titleBatch: "Edit Multiple Models ({count})",
    id: "Model ID",
    idPlaceholder: "e.g. gpt-4o",
    idSelectPlaceholder: "Type to filter or enter custom ID...",
    name: "Display Name",
    url: "Endpoint URL (optional)",
    urlPlaceholder: "e.g. https://api.example.com/v1/chat/completions",
    maxInputTokens: "Max Input Tokens",
    maxOutputTokens: "Max Output Tokens",
    toolCalling: "Tool Calling",
    thinking: "Thinking",
    vision: "Vision",
    streaming: "Streaming",
    supportsReasoningEffort: "Supports Reasoning Effort",
  },

  app: {
    noSelection: "Select an item to edit",
  },
};

export default en;
