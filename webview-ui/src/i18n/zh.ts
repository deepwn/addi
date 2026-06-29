import type { I18nMessages } from "./types";

const zh: I18nMessages = {
  common: {
    save: "保存",
    delete: "删除",
    cancel: "取消",
  },

  provider: {
    title: "提供商",
    name: "名称",
    apiType: "API 类型",
    apiKey: "API 密钥",
    apiKeyPlaceholder: "输入你的 API 密钥",
    apiKeyNote: "直接存储在 chatLanguageModels.json 中。",
    apiTypeOptions: {
      "chat-completions": "Chat Completions",
      responses: "Responses",
      messages: "Messages",
    },
    defaultsSection: "模型默认值（可选）",
    defaultsDescription: "在此提供商下新建模型时，将使用这些值作为预填项。",
    listApi: "模型列表 API",
    listApiPlaceholder: "如 https://api.openai.com/v1/models",
    listApiNote: "用于获取可用模型列表的接口地址。",
    defaultToolCalling: "Tool Calling",
    defaultVision: "Vision",
    defaultThinking: "Thinking",
    defaultStreaming: "Streaming",
    defaultMaxInputTokens: "最大输入 Tokens",
    defaultMaxOutputTokens: "最大输出 Tokens",
    quickAddTitle: "快速添加提供商",
    quickAddSearchPlaceholder: "搜索提供商...",
  },

  model: {
    title: "模型",
    titleBatch: "批量编辑 ({count} 个模型)",
    id: "模型 ID",
    idPlaceholder: "如 gpt-4o",
    idSelectPlaceholder: "输入筛选或自定义 ID...",
    name: "显示名称",
    url: "接口地址（可选）",
    urlPlaceholder: "如 https://api.example.com/v1/chat/completions",
    maxInputTokens: "最大输入 Tokens",
    maxOutputTokens: "最大输出 Tokens",
    toolCalling: "Tool Calling",
    thinking: "Thinking",
    vision: "Vision",
    streaming: "Streaming",
    supportsReasoningEffort: "支持 Reasoning Effort",
  },

  app: {
    noSelection: "请选择要编辑的项目",
  },
};

export default zh;
