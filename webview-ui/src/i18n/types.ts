/**
 * i18n translation key definitions.
 * Every key used in the UI must be defined here for type safety.
 */
export interface I18nMessages {
  // ── Common ──
  common: {
    save: string;
    delete: string;
    cancel: string;
  };

  // ── Provider Form ──
  provider: {
    title: string;
    name: string;
    apiType: string;
    apiKey: string;
    apiKeyPlaceholder: string;
    apiKeyNote: string;
    apiTypeOptions: Record<string, string>;
    defaultsSection: string;
    defaultsDescription: string;
    listApi: string;
    listApiPlaceholder: string;
    listApiNote: string;
    defaultToolCalling: string;
    defaultVision: string;
    defaultThinking: string;
    defaultStreaming: string;
    defaultMaxInputTokens: string;
    defaultMaxOutputTokens: string;
    quickAddTitle: string;
    quickAddSearchPlaceholder: string;
  };

  // ── Model Form ──
  model: {
    title: string;
    titleBatch: string;
    id: string;
    idPlaceholder: string;
    idSelectPlaceholder: string;
    name: string;
    url: string;
    urlPlaceholder: string;
    maxInputTokens: string;
    maxOutputTokens: string;
    toolCalling: string;
    thinking: string;
    vision: string;
    streaming: string;
    supportsReasoningEffort: string;
  };

  // ── App ──
  app: {
    noSelection: string;
  };
}
