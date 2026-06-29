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
    apiUrl: string;
    apiUrlPlaceholder: string;
    apiUrlNote: string;
    apiKey: string;
    apiKeyPlaceholder: string;
    apiKeyNote: string;
    apiTypeOptions: Record<string, string>;
    listApi: string;
    listApiPlaceholder: string;
    listApiNote: string;
    defaultsSection: string;
    defaultsDescription: string;
    defaultMaxInputTokens: string;
    defaultMaxOutputTokens: string;
    defaultCapabilities: string;
    defaultToolCalling: string;
    defaultVision: string;
    defaultThinking: string;
    defaultStreaming: string;
    defaultReasoningEffort: string;
    defaultReasoningEffortNote: string;
    reasoningEffortNone: string;
    reasoningEffortLow: string;
    reasoningEffortMedium: string;
    reasoningEffortHigh: string;
    reasoningEffortAll: string;
    quickAddTitle: string;
    quickAddSearchPlaceholder: string;
    codingPlanToggle: string;
    codingPlanHint: string;
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
    capabilities: string;
    toolCalling: string;
    thinking: string;
    vision: string;
    streaming: string;
    supportsReasoningEffort: string;
    supportsReasoningEffortNote: string;
    reasoningEffortFormat: string;
    reasoningEffortFormatNote: string;
  };

  // ── App ──
  app: {
    noSelection: string;
  };
}
