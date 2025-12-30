# Addi 重构计划：集成 Vercel AI SDK

## 1. 目标
将 `addi` 的底层 LLM 调用逻辑从手动维护的 `fetch` 实现迁移到成熟的 `ai` SDK (Vercel AI SDK)。
这将极大地简化多供应商支持（OpenAI, Anthropic, Google, DeepSeek 等），统一流式处理逻辑，并提高代码的可维护性和扩展性。

## 2. 核心依赖
我们需要引入以下核心包：
- `ai`: AI SDK Core，提供统一的接口 (`streamText`, `generateText`) 和注册表机制。
- `@ai-sdk/openai`: 支持 OpenAI 及兼容接口（DeepSeek, Ollama, LocalAI 等）。
- `@ai-sdk/anthropic`: 支持 Anthropic Claude 系列。
- `@ai-sdk/google`: 支持 Google Gemini 系列。
- `@ai-sdk/deepseek`: (可选) 如果 OpenAI 兼容模式不够用，可以使用专用包。
- `zod`: 用于工具定义和结构化输出（AI SDK 强依赖）。

```bash
npm install ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google zod
```

## 3. 架构变更

### 3.1 移除/废弃
- `src/apiClient.ts`: 手动的 HTTP 请求和 SSE 解析逻辑将被废弃。
- `src/services/llmClient.ts`: 现有的 `LLMClient` 类将被重写，不再包含具体的厂商 API 调用逻辑。

### 3.2 新增/重构
- **`src/services/aiRegistry.ts` (新增)**:
  - 负责维护一个动态的 `ProviderRegistry`。
  - 根据用户的 VS Code 配置（API Key, Endpoint）动态创建和更新 AI SDK 的 Provider 实例。
  - 处理 "OpenAI Compatible" 的通用逻辑（用于 Ollama, LocalAI）。

- **`src/services/llmService.ts` (重构 `LLMClient`)**:
  - 使用 `streamText` 统一处理所有请求。
  - 将 VS Code 的 `LanguageModelChatRequestMessage` 转换为 AI SDK 的 `CoreMessage`。
  - 将 AI SDK 的 `textStream` 或 `fullStream` 转换为 VS Code 的 `LanguageModelResponsePart`。

## 4. 详细设计

### 4.1 供应商管理 (Provider Management)
我们需要一个可扩展的工厂模式来根据配置生成 Provider。为了支持动态扩展（如后续添加 DeepSeek 专用包），我们将建立一个供应商注册表。

**设计思路：**
1. 定义 `ProviderFactory` 接口，每个 SDK 包对应一个实现。
2. 维护一个 `SUPPORTED_PROVIDERS` 映射表，将供应商 ID（如 `openai`, `anthropic`）映射到对应的 Factory。
3. 用户配置中的 `providerType` 将直接从这个映射表的键中获取（或验证）。

```typescript
// 伪代码示例

// 1. 定义接口
type CreateProviderFn = (config: ProviderConfig) => LanguageModelV1;

interface ProviderDefinition {
  id: string;
  label: string; // 用于 UI 显示
  create: CreateProviderFn;
}

// 2. 注册表
const providerRegistry: Record<string, ProviderDefinition> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    create: (config) => createOpenAI({ ... }),
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    create: (config) => createAnthropic({ ... }),
  },
  // 后续添加 DeepSeek 只需在此处注册
  // deepseek: { ... }
};

// 3. 工厂方法
export function createProvider(type: string, config: any) {
  const definition = providerRegistry[type];
  if (!definition) {
    // 尝试作为兼容模式处理，或者抛错
    return createOpenAI({ baseURL: config.endpoint, ... }); 
  }
  return definition.create(config);
}

// 4. 获取可用列表（供 UI 使用）
export function getAvailableProviderTypes() {
  return Object.values(providerRegistry).map(p => ({ label: p.label, value: p.id }));
}
```

### 4.2 模型调用 (Streaming)
使用 `streamText` 替代原本的 `fetch` 循环。

```typescript
import { streamText } from 'ai';

// 在 handleRequest 中
const result = streamText({
  model: provider(modelId), // 从 registry 获取
  messages: convertMessages(messages), // 转换消息格式
  abortSignal: token, // VS Code 的 CancellationToken
});

for await (const part of result.fullStream) {
  if (part.type === 'text-delta') {
    progress.report({ index: 0, part: new vscode.LanguageModelTextPart(part.textDelta) });
  }
  // 处理 tool-call 等其他类型
}
```

### 4.3 消息转换
需要编写适配器将 VS Code 的消息格式转换为 AI SDK 的格式。
- VS Code: `LanguageModelChatRequestMessage` (User, Assistant)
- AI SDK: `CoreMessage` (system, user, assistant, tool)

### 4.4 错误处理
AI SDK 提供了统一的错误类型（`APICallError`, `NoSuchModelError` 等），我们需要将其映射为 VS Code 的友好提示或日志。

## 5. 迁移步骤

1.  **环境准备**: 安装 `ai` 及相关 SDK 包。
2.  **原型验证**: 创建一个新的测试文件，尝试使用 `ai-sdk` 连接一个已配置的 OpenAI 接口，并输出流。
3.  **实现 Registry**: 创建 `aiRegistry.ts`，实现根据 `addi` 的配置对象生成 AI SDK Provider 的逻辑。
4.  **重构 LLMClient**:
    - 替换 `callOpenAiApi` 和 `callAnthropicApi` 为统一的 `callModel` 方法。
    - 实现消息转换逻辑。
    - 实现流式响应适配。
5.  **清理代码**: 移除旧的 `apiClient.ts` 和手动解析逻辑。改造过程中应即时删除旧代码、已废弃的文件，不需要考虑兼容性问题，但应该以`bracking change` 标记记录在变更日志中。并提供config转换脚本方便终端用户快速转移已配置的模型（如果需要）。
6.  **测试**: 验证所有支持的供应商（OpenAI, Anthropic, Google, DeepSeek, Ollama）是否正常工作。
7.  **文档更新**: 更新 `README.md` 和 `CHANGELOG.md` 相关文档，说明新的配置方式和使用方法。（待开发者回复明确确认后）

## 6. 风险与对策
- **包体积**: 引入多个 SDK 可能会增加插件体积。
  - *对策*: 使用 `esbuild` 进行 tree-shaking，确保只打包用到的部分。
- **兼容性**: 某些非标准 OpenAI 兼容接口（如某些旧版 LocalAI）可能与 `@ai-sdk/openai` 不完全兼容。
  - *对策*: `@ai-sdk/openai` 提供了 `compatibility: 'compatible'` 选项，专门用于处理这些情况。

## 7. 参考文档
- [AI SDK Provider Management](./refer_documents/ai-sdk-provider-management.md)
- [AI SDK Stream Text](./refer_documents/ai-sdk-stream-text.md)
