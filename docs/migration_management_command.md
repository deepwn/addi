# Chat Model Provider Configuration 迁移方案

> 基于 VS Code v1.109 预发布 API 详细规划
>
> 文档版本：1.0  
> 创建日期：2026年2月11日  
> 目标 API：`vscode.proposed.lmConfiguration.d.ts`

---

## 目录

1. [API 概述与背景](#api-概述与背景)
2. [当前架构分析](#当前架构分析)
3. [迁移范围与影响评估](#迁移范围与影响评估)
4. [分阶段迁移方案](#分阶段迁移方案)
5. [核心代码改造](#核心代码改造)
6. [配置迁移策略](#配置迁移策略)
7. [向后兼容性保障](#向后兼容性保障)
8. [测试策略](#测试策略)
9. [风险评估与应对](#风险评估与应对)
10. [时间线与里程碑](#时间线与里程碑)

---

## 1. API 概述与背景

### 1.1 新 API 核心特性

VS Code v1.109 引入的 `languageModelChatProviders` 贡献点和 `lmConfiguration` API 代表了模型提供商配置方式的重大转变：

| 特性       | 传统方式 (managementCommand) | 新方式 (lmConfiguration) |
| ---------- | ---------------------------- | ------------------------ |
| 配置声明   | 手动实现 UI 命令             | 声明式 JSON Schema       |
| 配置存储   | 扩展自行管理                 | VS Code 原生管理         |
| 安全处理   | 自行实现加密                 | `secret: true` 自动处理  |
| 多模型支持 | 自行实现                     | 原生数组支持             |
| UI 一致性  | 各扩展不统一                 | VS Code 原生 UI          |
| 配置验证   | 自行实现                     | JSON Schema 验证         |

### 1.2 声明式配置模式

新 API 允许在 `package.json` 中声明配置模式：

```json
{
  "contributes": {
    "languageModelChatProviders": [
      {
        "vendor": "addi-custom",
        "displayName": "Addi Custom Provider",
        "configuration": {
          "properties": {
            "apiKey": {
              "type": "string",
              "secret": true,
              "description": "API key for authentication",
              "title": "API Key"
            },
            "endpoint": {
              "type": "string",
              "description": "API endpoint URL",
              "title": "Endpoint",
              "default": "https://api.example.com"
            },
            "models": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": { "type": "string" },
                  "name": { "type": "string" },
                  "url": { "type": "string" },
                  "maxInputTokens": { "type": "number" },
                  "maxOutputTokens": { "type": "number" }
                },
                "required": ["id", "name", "url"]
              }
            }
          },
          "required": ["apiKey"]
        }
      }
    ]
  }
}
```

### 1.3 API 注册回调

扩展需要实现 `registerLanguageModelChatProvider` 回调：

```typescript
vscode.lm.registerLanguageModelChatProvider('addi-custom', {
  provideLanguageModelResponse: (
    messages,
    options,
    extensionToken,
    configuration, // 用户配置
    token
  ) => {
    const { apiKey, endpoint, models } = configuration;
    // 使用配置发起请求
  },
});
```

---

## 2. 当前架构分析

### 2.1 现有配置模型

Addi 当前的配置架构涉及多个层次：

```
src/
├── common/
│   ├── types.ts          # Provider, Model 类型定义
│   └── utils/
│       ├── index.ts      # 配置工具函数
│       └── mcpDownloader.ts
├── core/
│   ├── llm/
│   │   ├── llmService.ts         # LLM 执行服务
│   │   ├── aiRegistry.ts         # AI SDK 适配器
│   │   └── messageConverter.ts   # 消息转换
│   └── providers/
│       ├── AddiChatProvider.ts   # VS Code Chat Provider 实现
│       └── ProviderModelManager.ts # 模型提供商业务逻辑
├── infrastructure/
│   ├── mcp/
│   │   ├── mcpServerService.ts  # MCP 服务器管理
│   │   └── customToolManager.ts  # 自定义工具管理
│   └── storage/
│       └── storageService.ts     # 配置持久化
└── presentation/
    ├── extension.ts      # 扩展入口
    └── commands.ts       # 配置命令
```

### 2.2 现有配置流程

**当前流程**：

1. 用户通过 Addi UI 添加提供商配置
2. 配置存储在 `storageService` 中（VS Code Secret/Setting）
3. `ProviderModelManager` 加载并管理配置
4. `AddiChatProvider` 提供模型信息给 VS Code Copilot
5. `LLMService` 执行实际的模型调用

**关键文件**：

| 文件                                           | 职责                    | 迁移影响            |
| ---------------------------------------------- | ----------------------- | ------------------- |
| `src/common/types.ts`                          | Provider/Model 类型定义 | 需要适配新 API 类型 |
| `src/core/providers/AddiChatProvider.ts`       | Chat Provider 实现      | 需要迁移到新 API    |
| `src/core/providers/ProviderModelManager.ts`   | 配置业务逻辑            | 部分逻辑可复用      |
| `src/infrastructure/storage/storageService.ts` | 配置持久化              | 存储方式改变        |
| `src/presentation/extension.ts`                | 扩展入口                | 注册方式改变        |

### 2.3 现有类型定义

```typescript
// src/common/types.ts
export interface Provider {
  sid: string;
  name: string;
  providerType: string;
  apiEndpoint: string;
  apiKey?: string; // Secret
  models: Model[];
}

export interface Model {
  sid: string;
  name: string;
  id: string; // 远程模型 ID
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  capabilities?: {
    imageInput?: boolean;
    toolCalling?: boolean;
  };
}
```

---

## 3. 迁移范围与影响评估

### 3.1 需要改造的组件

| 组件                   | 改造内容                             | 优先级 |
| ---------------------- | ------------------------------------ | ------ |
| `package.json`         | 添加 languageModelChatProviders 声明 | P0     |
| `AddiChatProvider`     | 重构为使用 lmConfiguration API       | P0     |
| `ProviderModelManager` | 适配新的配置模型                     | P1     |
| `storageService`       | 支持新配置存储方式                   | P1     |
| `LLMService`           | 适配配置获取方式变化                 | P1     |
| 配置 UI                | 迁移到声明式配置                     | P2     |
| 自定义工具集成         | 保持或优化                           | P2     |

### 3.2 不需要改造的组件

以下组件基本保持不变：

- `src/core/llm/messageConverter.ts` - 消息转换逻辑
- `src/core/llm/toolOrchestrator.ts` - 工具编排
- `src/core/llm/aiRegistry.ts` - AI SDK 适配
- `src/infrastructure/mcp/mcpServerService.ts` - MCP 服务器管理
- `src/infrastructure/mcp/customToolManager.ts` - 自定义工具管理
- `src/presentation/views/*` - 树视图 UI

### 3.3 关键依赖关系

```
package.json (新增配置声明)
    ↓
AddiChatProvider (重构注册逻辑)
    ↓
ProviderModelManager (配置获取适配)
    ↓
storageService (配置迁移)
    ↓
LLMService (配置使用)
```

---

## 4. 分阶段迁移方案

### 阶段 1：基础架构准备 (Week 1)

**目标**：完成 package.json 修改和类型适配

**任务清单**：

```json
// package.json 新增 contributes
{
  "contributes": {
    "languageModelChatProviders": [
      {
        "vendor": "addi",
        "displayName": "Addi",
        "configuration": {
          "properties": {
            "providers": {
              "type": "array",
              "description": "AI 模型提供商配置",
              "items": {
                "type": "object",
                "properties": {
                  "id": { "type": "string" },
                  "name": { "type": "string" },
                  "apiEndpoint": { "type": "string" },
                  "apiKey": {
                    "type": "string",
                    "secret": true,
                    "description": "API Key"
                  },
                  "models": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "id": { "type": "string" },
                        "name": { "type": "string" },
                        "family": { "type": "string" },
                        "version": { "type": "string" },
                        "maxInputTokens": { "type": "number" },
                        "maxOutputTokens": { "type": "number" }
                      }
                    }
                  }
                },
                "required": ["id", "name", "apiKey"]
              }
            }
          }
        }
      }
    ]
  }
}
```

**类型适配代码** (`src/common/types.ts`)：

```typescript
/**
 * lmConfiguration API 配置类型
 * 用于适配 VS Code 新版语言模型配置 API
 */
export interface AddiLmConfiguration {
  providers: AddiProviderConfiguration[];
}

export interface AddiProviderConfiguration {
  id: string;
  name: string;
  apiEndpoint: string;
  apiKey: string; // secret: true
  models: AddiModelConfiguration[];
}

export interface AddiModelConfiguration {
  id: string;
  name: string;
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
}

/**
 * 兼容旧版配置的适配器
 */
export function adaptLmConfigToLegacy(config: AddiLmConfiguration): Provider[] {
  return config.providers.map((p) => ({
    sid: p.id,
    name: p.name,
    providerType: inferProviderType(p.apiEndpoint),
    apiEndpoint: p.apiEndpoint,
    apiKey: p.apiKey,
    models: p.models.map((m) => ({
      sid: `${p.id}:${m.id}`,
      name: m.name,
      id: m.id,
      family: m.family,
      version: m.version,
      maxInputTokens: m.maxInputTokens,
      maxOutputTokens: m.maxOutputTokens,
      capabilities: {},
    })),
  }));
}

export function inferProviderType(endpoint: string): string {
  const lower = endpoint.toLowerCase();
  if (lower.includes('openai.com')) return 'openai';
  if (lower.includes('anthropic.com')) return 'anthropic';
  if (lower.includes('googleapis.com')) return 'google';
  return 'generic';
}
```

### 阶段 2：Provider 核心迁移 (Week 2)

**目标**：完成 AddiChatProvider 重构

**改造代码** (`src/core/providers/AddiChatProvider.ts`)：

```typescript
import * as vscode from 'vscode';
import { Provider, Model, AddiLmConfiguration, adaptLmConfigToLegacy } from '../../common/types';
import { logger } from '../../common/logger';
import { LLMService } from '../llm/llmService';

export class AddiChatProvider implements vscode.LanguageModelChatProvider {
  private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
  public readonly onDidChangeLanguageModelChatInformation =
    this._onDidChangeLanguageModelChatInformation.event;

  constructor(private llmService: LLMService) {}

  /**
   * 提供语言模型列表给 VS Code
   *
   * 新 API 方式：配置通过 configuration 参数传入
   */
  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    // 注意：新 API 中信息获取方式可能变化
    // 可能需要通过 context.secrets 获取存储的配置
    logger.debug('provideLanguageModelChatInformation (new API)', {
      silent: options.silent,
    });

    // TODO: 实现从新配置源获取模型列表
    return [];
  }

  /**
   * 提供语言模型响应
   *
   * 新 API 签名：
   * provideLanguageModelResponse(
   *   messages: readonly vscode.LanguageModelChatRequestMessage[],
   *   options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
   *   extensionToken: string,
   *   configuration: AddiLmConfiguration,  // 用户配置直接传入
   *   token: vscode.CancellationToken
   * ): Promise<void>
   */
  async provideLanguageModelChatResponse(
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    extensionToken: string,
    configuration: AddiLmConfiguration,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    logger.info('provideLanguageModelChatResponse (new API)', {
      messageCount: messages.length,
      providerCount: configuration.providers?.length ?? 0,
    });

    try {
      // 1. 将新配置格式转换为内部格式
      const providers = configuration.providers ? adaptLmConfigToLegacy(configuration) : [];

      if (providers.length === 0) {
        progress.report(
          new vscode.LanguageModelTextPart(
            'No providers configured. Please configure your AI provider first.'
          )
        );
        return;
      }

      // 2. 选择默认提供商和模型
      const defaultProvider = providers[0];
      const defaultModel = defaultProvider.models[0];

      if (!defaultModel) {
        progress.report(new vscode.LanguageModelTextPart('No models configured for the provider.'));
        return;
      }

      // 3. 调用 LLMService 执行请求
      await this.llmService.chat(defaultProvider, defaultModel, messages, options, progress, token);
    } catch (error) {
      logger.error('Error in provideLanguageModelChatResponse', error);
      progress.report(
        new vscode.LanguageModelTextPart(
          `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * 刷新通知
   */
  refresh(): void {
    this._onDidChangeLanguageModelChatInformation.fire();
  }
}
```

### 阶段 3：存储层适配 (Week 3)

**目标**：适配新配置存储方式

**改造代码** (`src/infrastructure/storage/storageService.ts`)：

```typescript
import * as vscode from 'vscode';
import { IStorageService, Provider } from '../../common/interfaces';
import { AddiLmConfiguration, AddiProviderConfiguration } from '../../common/types';

/**
 * 适配新 lmConfiguration API 的存储服务
 *
 * 新 API 模式下：
 * - 配置声明在 package.json
 * - 用户输入通过 VS Code UI 收集
 * - 配置存储在 VS Code Secret/Setting 中
 * - 通过 extensionToken 访问配置
 */
export class StorageService implements IStorageService {
  private readonly secrets: vscode.SecretStorage;
  private readonly configuration: vscode.WorkspaceConfiguration;
  private _onDidUpdate = new vscode.EventEmitter<void>();
  public readonly onDidUpdate = this._onDidUpdate.event;

  // 旧版存储键
  private readonly LEGACY_PROVIDERS_KEY = 'addi.providers';
  private readonly SETTINGS_SYNC_KEY = 'addi.saveConfigToSettingsSync';

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
    this.configuration = vscode.workspace.getConfiguration('addi');
  }

  /**
   * 初始化存储
   *
   * 新策略：优先尝试新 API 配置，兼容旧版配置
   */
  async initialize(onNormalize?: (providers: Provider[]) => { mutated: boolean }): Promise<void> {
    // 检查是否有旧版配置需要迁移
    const legacyData = await this.loadLegacyProviders();

    if (legacyData && legacyData.length > 0) {
      // 存在旧配置，标记需要迁移
      await this.secrets.store('addi.needsMigration', 'true');
      logger.info('Legacy configuration found, migration needed');
    }
  }

  /**
   * 获取配置（兼容新旧 API）
   */
  async getProviders(): Promise<Provider[]> {
    // 优先使用新 API 配置
    const newConfig = await this.loadFromLmConfiguration();

    if (newConfig && newConfig.providers && newConfig.providers.length > 0) {
      return this.adaptToLegacyFormat(newConfig);
    }

    // 回退到旧版配置
    return this.loadLegacyProviders();
  }

  /**
   * 从新 API 配置加载
   */
  private async loadFromLmConfiguration(): Promise<AddiLmConfiguration | null> {
    // 新 API 下配置通过 registerLanguageModelChatProvider 的
    // configuration 参数传入，这里主要用于初始化检查
    // 实际配置由 VS Code 管理

    try {
      // 检查是否有迁移标记
      const needsMigration = await this.secrets.get('addi.needsMigration');
      if (needsMigration === 'true') {
        logger.info('Configuration migration pending');
        return null;
      }

      // TODO: 实现新配置加载逻辑
      // 这部分需要根据实际 API 实现调整
      return null;
    } catch (error) {
      logger.warn('Error loading from lmConfiguration', error);
      return null;
    }
  }

  /**
   * 加载旧版配置（兼容）
   */
  private async loadLegacyProviders(): Promise<Provider[]> {
    try {
      const data = await this.secrets.get(this.LEGACY_PROVIDERS_KEY);
      if (!data) {
        return [];
      }

      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed as Provider[];
    } catch (error) {
      logger.warn('Error loading legacy providers', error);
      return [];
    }
  }

  /**
   * 转换新配置到旧格式
   */
  private adaptToLegacyFormat(config: AddiLmConfiguration): Provider[] {
    return config.providers.map((p) => ({
      sid: p.id,
      name: p.name,
      providerType: this.inferProviderType(p.apiEndpoint),
      apiEndpoint: p.apiEndpoint,
      apiKey: p.apiKey,
      models: p.models.map((m) => ({
        sid: `${p.id}:${m.id}`,
        name: m.name,
        id: m.id,
        family: m.family,
        version: m.version,
        maxInputTokens: m.maxInputTokens,
        maxOutputTokens: m.maxOutputTokens,
        capabilities: {},
      })),
    }));
  }

  private inferProviderType(endpoint: string): string {
    const lower = endpoint.toLowerCase();
    if (lower.includes('openai.com')) return 'openai';
    if (lower.includes('anthropic.com')) return 'anthropic';
    if (lower.includes('googleapis.com')) return 'google';
    return 'generic';
  }

  // ... 其他方法（saveProviders, dispose 等）
}
```

### 阶段 4：LLMService 适配 (Week 4)

**目标**：适配配置获取方式变化

**改造代码** (`src/core/llm/llmService.ts`)：

```typescript
import * as vscode from 'vscode';
import { streamText, generateText, ModelMessage, Tool } from 'ai';
import { Provider, Model } from '../../common/types';
import { IToolManager, IMcpService } from '../../common/interfaces';
import { AIProviderRegistry } from './aiRegistry';
import { MessageConverter } from './messageConverter';
import { ToolOrchestrator } from './toolOrchestrator';
import { logger } from '../../common/logger';

export class LLMService {
  private readonly toolOrchestrator: ToolOrchestrator;

  constructor(toolManager?: IToolManager, mcpService?: IMcpService) {
    this.toolOrchestrator = new ToolOrchestrator(toolManager, mcpService);
  }

  /**
   * VS Code API 兼容的聊天入口点
   *
   * 新 API 模式下，configuration 可能来自多个源：
   * 1. lmConfiguration API 的 configuration 参数
   * 2. storageService 中的缓存配置
   */
  async chat(
    provider: Provider,
    model: Model,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    onStats?: (stats: { firstTokenTime: number; endTime: number; tokenCount: number }) => void
  ): Promise<void> {
    logger.debug('LLMService.chat called', {
      provider: provider.name,
      model: model.name,
      messageCount: messages.length,
    });

    // 转换消息格式
    const coreMessages = await MessageConverter.toAiCoreMessages(messages);
    const systemMessage = MessageConverter.extractSystemMessage(messages);
    const tools = await this.toolOrchestrator.prepareTools(options);

    // 执行聊天请求
    await this.executeDirect(provider, model, coreMessages, systemMessage, tools, progress, token, {
      onStats,
    });
  }

  /**
   * 执行实际的聊天请求
   */
  private async executeDirect(
    provider: Provider,
    model: Model,
    messages: ModelMessage[],
    systemMessage: string | undefined,
    tools: Record<string, Tool>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    options: ExecutionOptions
  ): Promise<void> {
    try {
      const aiOptions = this.buildAiOptions(provider, model, messages, systemMessage, tools);

      const additionalParams = this.parseAdditionalParams(model);
      const useStreaming = additionalParams['stream'] !== false;

      if (useStreaming) {
        await this.executeStreaming(aiOptions, progress, token, options);
      } else {
        await this.executeNonStreaming(aiOptions, progress, options);
      }
    } catch (error) {
      this.handleError(error, progress);
    }
  }

  /**
   * 构建 AI SDK 选项
   */
  private buildAiOptions(
    provider: Provider,
    model: Model,
    messages: ModelMessage[],
    system: string | undefined,
    tools: Record<string, Tool>
  ): any {
    const aiModel = AIProviderRegistry.createModel(provider, model.id);
    const additionalParams = this.parseAdditionalParams(model);

    const baseOptions: any = {
      model: aiModel,
      system,
      messages,
      abortSignal: new AbortController().signal,
      maxOutputTokens: model.maxOutputTokens,
    };

    // 如果有工具，添加到选项
    if (Object.keys(tools).length > 0) {
      baseOptions.tools = tools;
    }

    // 合并额外参数
    return { ...baseOptions, ...additionalParams };
  }

  /**
   * 流式执行
   */
  private async executeStreaming(
    aiOptions: any,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    options: ExecutionOptions
  ): Promise<void> {
    const result = streamText({
      ...aiOptions,
      onFinish: ({ text, usage, finishReason }) => {
        logger.debug('Streaming finished', {
          textLength: text.length,
          usage,
          finishReason,
        });
        options.onStats?.({
          firstTokenTime: 0, // 需要从 stream result 获取
          endTime: Date.now(),
          tokenCount: usage?.totalTokens ?? 0,
        });
      },
    });

    for await (const chunk of result.textStream) {
      if (token.isCancellationRequested) {
        result.cancel();
        break;
      }
      progress.report(new vscode.LanguageModelTextPart(chunk));
    }
  }

  /**
   * 非流式执行
   */
  private async executeNonStreaming(
    aiOptions: any,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    options: ExecutionOptions
  ): Promise<void> {
    const result = await generateText(aiOptions);

    progress.report(new vscode.LanguageModelTextPart(result.text));

    options.onStats?.({
      firstTokenTime: 0,
      endTime: Date.now(),
      tokenCount: result.usage?.totalTokens ?? 0,
    });
  }

  private parseAdditionalParams(model: Model): Record<string, any> {
    if (!model.requestAdditional) {
      return {};
    }
    try {
      return JSON.parse(model.requestAdditional);
    } catch {
      return {};
    }
  }

  private handleError(
    error: any,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('LLM execution error', error);
    progress.report(new vscode.LanguageModelTextPart(`Error: ${errorMessage}`));
  }
}
```

### 阶段 5：扩展入口更新 (Week 5)

**目标**：更新扩展入口，注册新 API

**改造代码** (`src/presentation/extension.ts`)：

```typescript
import * as vscode from 'vscode';
import { AddiChatProvider } from '../core/providers/AddiChatProvider';
import { LLMService } from '../core/llm/llmService';
import { logger } from '../common/logger';
import { McpServerService } from '../infrastructure/mcp/mcpServerService';
import { CustomToolManager } from '../infrastructure/mcp/customToolManager';
import { StorageService } from '../infrastructure/storage/storageService';
import { AddiLmConfiguration } from '../common/types';

export async function activate(context: vscode.ExtensionContext) {
  logger.initialize(context);
  const extension = vscode.extensions.getExtension('deepwn.addi');
  const version = extension?.packageJSON?.version ?? 'unknown';
  logger.info(`Extension activated (v${version})`, undefined, 'Extension');

  // 初始化服务
  const storageService = new StorageService(context);
  const mcpService = McpServerService.getInstance(context);
  const toolManager = new CustomToolManager();

  // 初始化 LLM 服务
  const llmService = new LLMService(toolManager, mcpService);

  // 注册语言模型提供商（新 API）
  const addiProvider = new AddiChatProvider(llmService);

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider(
      'addi', // 对应 package.json 中的 vendor
      addiProvider
    )
  );

  // 监听配置变化
  context.subscriptions.push(
    vscode.lm.onDidChangeProviders(() => {
      logger.info('Language model providers changed');
      addiProvider.refresh();
    })
  );

  // 旧版 MCP 服务初始化（保持兼容）
  context.subscriptions.push(new vscode.Disposable(() => mcpService.dispose()));
  await mcpService.initialize().catch((err) => {
    logger.error('Failed to initialize MCP Server', err, 'MCP');
  });

  // ... 其他初始化代码保持不变
}

export function deactivate() {
  logger.info('Extension deactivated');
}
```

---

## 5. 核心代码改造

### 5.1 package.json 更新

**完整配置示例**：

```json
{
  "name": "addi",
  "displayName": "Addi",
  "version": "0.0.26",
  "engines": {
    "vscode": "^1.109.0"
  },
  "enabledApiProposals": [
    "contribLanguageModelToolSets",
    "languageModelCapabilities",
    "languageModelThinkingPart",
    "lmConfiguration"
  ],
  "contributes": {
    "languageModelChatProviders": [
      {
        "vendor": "addi",
        "displayName": "Addi",
        "configuration": {
          "type": "object",
          "properties": {
            "providers": {
              "type": "array",
              "description": "AI 模型提供商列表",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "提供商唯一标识符"
                  },
                  "name": {
                    "type": "string",
                    "description": "提供商显示名称"
                  },
                  "apiEndpoint": {
                    "type": "string",
                    "description": "API 端点 URL"
                  },
                  "apiKey": {
                    "type": "string",
                    "secret": true,
                    "description": "API 密钥",
                    "title": "API Key"
                  },
                  "models": {
                    "type": "array",
                    "description": "可用模型列表",
                    "items": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "description": "模型远程 ID"
                        },
                        "name": {
                          "type": "string",
                          "description": "模型显示名称"
                        },
                        "family": {
                          "type": "string",
                          "description": "模型系列"
                        },
                        "version": {
                          "type": "string",
                          "description": "模型版本"
                        },
                        "maxInputTokens": {
                          "type": "number",
                          "description": "最大输入 token 数",
                          "default": 128000
                        },
                        "maxOutputTokens": {
                          "type": "number",
                          "description": "最大输出 token 数",
                          "default": 4096
                        }
                      },
                      "required": ["id", "name"]
                    }
                  }
                },
                "required": ["id", "name", "apiEndpoint", "apiKey"]
              }
            }
          }
        }
      }
    ]
  }
}
```

### 5.2 类型定义统一

**src/common/types.ts 新增**：

```typescript
/**
 * VS Code lmConfiguration API 类型
 *
 * 注意：这些类型应与 vscode.proposed.lmConfiguration.d.ts 保持一致
 * 在官方类型发布前，使用声明延期或自定义类型
 */

// ============================================================================
// 新版配置类型（lmConfiguration API）
// ============================================================================

export interface LmConfiguration {
  providers?: LmProvider[];
}

export interface LmProvider {
  id: string;
  name: string;
  apiEndpoint: string;
  apiKey: string;
  models?: LmModel[];
}

export interface LmModel {
  id: string;
  name: string;
  family?: string;
  version?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

// ============================================================================
// 内部类型适配层
// ============================================================================

export interface Provider {
  sid: string;
  name: string;
  providerType: string;
  apiEndpoint: string;
  apiKey?: string;
  models: Model[];
  // 兼容字段
  apiKeySha256?: string;
}

export interface Model {
  sid: string;
  name: string;
  id: string;
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  capabilities?: {
    imageInput?: boolean;
    toolCalling?: boolean;
  };
  // 兼容字段
  requestAdditional?: string;
  averageSpeed?: number;
}

// ============================================================================
// 转换函数
// ============================================================================

export function lmProviderToInternal(lmProvider: LmProvider): Provider {
  return {
    sid: lmProvider.id,
    name: lmProvider.name,
    providerType: inferProviderType(lmProvider.apiEndpoint),
    apiEndpoint: lmProvider.apiEndpoint,
    apiKey: lmProvider.apiKey,
    models: (lmProvider.models ?? []).map((m) => ({
      sid: `${lmProvider.id}:${m.id}`,
      name: m.name,
      id: m.id,
      family: m.family ?? 'unknown',
      version: m.version ?? 'latest',
      maxInputTokens: m.maxInputTokens ?? 128000,
      maxOutputTokens: m.maxOutputTokens ?? 4096,
      capabilities: {},
    })),
  };
}

export function internalProviderToLm(provider: Provider): LmProvider {
  return {
    id: provider.sid,
    name: provider.name,
    apiEndpoint: provider.apiEndpoint,
    apiKey: provider.apiKey ?? '',
    models: provider.models.map((m) => ({
      id: m.id,
      name: m.name,
      family: m.family,
      version: m.version,
      maxInputTokens: m.maxInputTokens,
      maxOutputTokens: m.maxOutputTokens,
    })),
  };
}

export function inferProviderType(endpoint: string): string {
  const normalized = endpoint.toLowerCase();
  if (normalized.includes('openai.com')) return 'openai';
  if (normalized.includes('anthropic.com')) return 'anthropic';
  if (normalized.includes('googleapis.com')) return 'google';
  return 'generic';
}
```

### 5.3 配置迁移工具

**src/infrastructure/storage/migrationHelper.ts**：

```typescript
import * as vscode from 'vscode';
import { Provider, Model } from '../../common/types';
import { logger } from '../../common/logger';

/**
 * 配置迁移助手
 *
 * 负责从旧版存储迁移到新版 lmConfiguration API
 */
export class ConfigurationMigrationHelper {
  private readonly legacyKey = 'addi.providers';
  private readonly migrationFlagKey = 'addi.migrationCompleted';

  constructor(private readonly secrets: vscode.SecretStorage) {}

  /**
   * 检查是否需要迁移
   */
  async needsMigration(): Promise<boolean> {
    try {
      const flag = await this.secrets.get(this.migrationFlagKey);
      if (flag === 'true') {
        return false; // 已完成迁移
      }

      const legacyData = await this.secrets.get(this.legacyKey);
      return !!legacyData && legacyData.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 执行迁移
   */
  async migrate(): Promise<boolean> {
    try {
      logger.info('Starting configuration migration');

      // 1. 加载旧配置
      const legacyProviders = await this.loadLegacyConfiguration();
      if (!legacyProviders || legacyProviders.length === 0) {
        logger.info('No legacy configuration to migrate');
        await this.setMigrationComplete();
        return true;
      }

      // 2. 转换格式
      const lmConfig = this.convertToLmConfiguration(legacyProviders);

      // 3. 存储新配置（由 VS Code lmConfiguration API 管理）
      // 这里主要标记迁移完成，实际配置由 VS Code UI 收集
      logger.info('Configuration migration completed', {
        providerCount: lmConfig.providers?.length ?? 0,
      });

      await this.setMigrationComplete();

      // 4. 清理旧配置（可选，保留一段时间用于回滚）
      // await this.secrets.delete(this.legacyKey);

      return true;
    } catch (error) {
      logger.error('Migration failed', error);
      return false;
    }
  }

  /**
   * 加载旧配置
   */
  private async loadLegacyConfiguration(): Promise<Provider[]> {
    try {
      const data = await this.secrets.get(this.legacyKey);
      if (!data) {
        return [];
      }

      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed as Provider[];
    } catch (error) {
      logger.warn('Failed to load legacy configuration', error);
      return [];
    }
  }

  /**
   * 转换为 lmConfiguration 格式
   */
  private convertToLmConfiguration(providers: Provider[]): any {
    return {
      providers: providers.map((p) => ({
        id: p.sid,
        name: p.name,
        apiEndpoint: p.apiEndpoint,
        apiKey: p.apiKey ?? '',
        models: p.models.map((m) => ({
          id: m.id,
          name: m.name,
          family: m.family,
          version: m.version,
          maxInputTokens: m.maxInputTokens,
          maxOutputTokens: m.maxOutputTokens,
        })),
      })),
    };
  }

  /**
   * 标记迁移完成
   */
  private async setMigrationComplete(): Promise<void> {
    await this.secrets.store(this.migrationFlagKey, 'true');
  }

  /**
   * 回滚迁移（如果需要）
   */
  async rollback(): Promise<boolean> {
    try {
      await this.secrets.delete(this.migrationFlagKey);
      logger.info('Migration rollback completed');
      return true;
    } catch (error) {
      logger.error('Rollback failed', error);
      return false;
    }
  }
}
```

---

## 6. 配置迁移策略

### 6.1 迁移时机

**启动时迁移**：

```typescript
// src/presentation/extension.ts
export async function activate(context: vscode.ExtensionContext) {
  // ... 其他初始化

  // 检查并执行迁移
  const migrationHelper = new ConfigurationMigrationHelper(context.secrets);

  if (await migrationHelper.needsMigration()) {
    const confirmed = await vscode.window.showInformationMessage(
      'Addi 需要迁移配置到新版 API。是否继续？',
      { modal: true },
      '迁移',
      '稍后'
    );

    if (confirmed === '迁移') {
      const success = await migrationHelper.migrate();
      if (success) {
        vscode.window.showInformationMessage('配置迁移成功！');
      } else {
        vscode.window.showErrorMessage('配置迁移失败，请查看日志。');
      }
    }
  }
}
```

### 6.2 配置格式对比

| 方面     | 旧版格式          | 新版格式                  |
| -------- | ----------------- | ------------------------- |
| 存储位置 | extension.secrets | lmConfiguration API       |
| 配置结构 | Provider[]        | { providers: Provider[] } |
| 密钥处理 | 自行加密          | secret: true 自动处理     |
| 多提供商 | 扁平数组          | 嵌套结构                  |
| 验证     | 自行实现          | JSON Schema 自动验证      |

### 6.3 数据完整性保障

**迁移检查清单**：

```typescript
async function validateMigration(
  oldConfig: Provider[],
  newConfig: any
): Promise<MigrationValidationResult> {
  const result: MigrationValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  // 1. 检查提供商数量
  if (oldConfig.length !== newConfig.providers.length) {
    result.warnings.push('提供商数量不匹配');
  }

  // 2. 检查每个提供商
  for (const oldProvider of oldConfig) {
    const newProvider = newConfig.providers.find((p) => p.id === oldProvider.sid);

    if (!newProvider) {
      result.errors.push(`提供商 ${oldProvider.name} 迁移失败`);
      result.valid = false;
      continue;
    }

    // 3. 检查模型数量
    if (oldProvider.models.length !== newProvider.models.length) {
      result.warnings.push(`提供商 ${oldProvider.name} 的模型数量不匹配`);
    }

    // 4. 检查关键字段
    if (oldProvider.apiKey && !newProvider.apiKey) {
      result.errors.push(`提供商 ${oldProvider.name} 的 API Key 丢失`);
      result.valid = false;
    }
  }

  return result;
}
```

---

## 7. 向后兼容性保障

### 7.1 双轨运行模式

```typescript
/**
 * 配置源优先级
 *
 * 1. lmConfiguration API（新版）
 * 2. legacy secrets（旧版，迁移中）
 * 3. workspace settings（用户配置）
 */
export class ConfigurationResolver {
  async resolveProviders(): Promise<Provider[]> {
    // 优先使用新 API 配置
    const lmConfig = await this.loadFromLmApi();
    if (lmConfig && lmConfig.providers?.length > 0) {
      return this.adaptLmConfig(lmConfig);
    }

    // 回退到旧版
    const legacyConfig = await this.loadLegacyConfig();
    if (legacyConfig.length > 0) {
      return legacyConfig;
    }

    return [];
  }

  private async loadFromLmApi(): Promise<any | null> {
    try {
      // 通过 VS Code lmConfiguration API 获取
      // 需要实际 API 支持
      return null;
    } catch {
      return null;
    }
  }
}
```

### 7.2 渐进式降级

```typescript
/**
 * API 可用性检查
 */
async function checkLmConfigurationAvailability(): Promise<boolean> {
  try {
    // 尝试访问新 API
    const testProvider = vscode.lm.registerLanguageModelChatProvider('test', {
      provideLanguageModelResponse: async () => {},
    });
    testProvider.dispose();
    return true;
  } catch {
    return false;
  }
}

/**
 * 根据 API 可用性选择注册方式
 */
async function registerChatProvider(
  context: vscode.ExtensionContext,
  llmService: LLMService
): Promise<vscode.Disposable | null> {
  const isNewApiAvailable = await checkLmConfigurationAvailability();

  if (isNewApiAvailable) {
    // 使用新 API
    const provider = new AddiChatProvider(llmService);
    return vscode.lm.registerLanguageModelChatProvider('addi', provider);
  } else {
    // 使用旧 API（如果仍然支持）
    // 这是一个临时兼容措施
    logger.warn('lmConfiguration API not available, using legacy API');

    // 尝试旧注册方式（如果存在）
    if (typeof (vscode as any).registerLanguageModelChatProvider === 'function') {
      const provider = new LegacyAddiChatProvider(llmService);
      return (vscode as any).registerLanguageModelChatProvider('addi', provider);
    }

    return null;
  }
}
```

### 7.3 版本检测

```typescript
/**
 * VS Code 版本检测工具
 */
export class VersionChecker {
  private static readonly MIN_VERSION = '1.109.0';

  /**
   * 检查当前 VS Code 版本是否支持 lmConfiguration API
   */
  static isSupported(): boolean {
    const version = vscode.env.appVersion;
    if (!version) {
      return false;
    }

    return this.compareVersions(version, this.MIN_VERSION) >= 0;
  }

  /**
   * 比较版本号
   * 返回值: < 0 (v1 < v2), = 0 (相等), > 0 (v1 > v2)
   */
  static compareVersions(v1: string, v2: string): number {
    const parseVersion = (v: string) => {
      const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
      if (!match) {
        return [0, 0, 0];
      }
      return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
    };

    const [major1, minor1, patch1] = parseVersion(v1);
    const [major2, minor2, patch2] = parseVersion(v2);

    if (major1 !== major2) return major1 - major2;
    if (minor1 !== minor2) return minor1 - minor2;
    return patch1 - patch2;
  }
}
```

---

## 8. 测试策略

### 8.1 单元测试

**src/test/core/providers/addiChatProvider.test.ts**：

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';
import { AddiChatProvider } from '../../../core/providers/AddiChatProvider';
import { LLMService } from '../../../core/llm/llmService';
import { AddiLmConfiguration, adaptLmConfigToLegacy } from '../../../common/types';

suite('AddiChatProvider Tests', () => {
  suite('Configuration Adaptation', () => {
    test('should adapt lmConfiguration to legacy format', () => {
      const config: AddiLmConfiguration = {
        providers: [
          {
            id: 'test-provider',
            name: 'Test Provider',
            apiEndpoint: 'https://api.test.com',
            apiKey: 'test-key',
            models: [
              {
                id: 'gpt-4',
                name: 'GPT-4',
                family: 'GPT',
                version: '4',
                maxInputTokens: 128000,
                maxOutputTokens: 4096,
              },
            ],
          },
        ],
      };

      const providers = adaptLmConfigToLegacy(config);

      assert.strictEqual(providers.length, 1);
      assert.strictEqual(providers[0].sid, 'test-provider');
      assert.strictEqual(providers[0].name, 'Test Provider');
      assert.strictEqual(providers[0].models.length, 1);
      assert.strictEqual(providers[0].models[0].id, 'gpt-4');
    });

    test('should handle empty configuration', () => {
      const config: AddiLmConfiguration = { providers: [] };
      const providers = adaptLmConfigToLegacy(config);
      assert.strictEqual(providers.length, 0);
    });

    test('should handle undefined providers', () => {
      const config: AddiLmConfiguration = {};
      const providers = adaptLmConfigToLegacy(config);
      assert.strictEqual(providers.length, 0);
    });
  });
});
```

### 8.2 集成测试

**src/test/infrastructure/storage/migration.test.ts**：

```typescript
import * as assert from 'assert';
import { ConfigurationMigrationHelper } from '../../../infrastructure/storage/migrationHelper';

suite('Configuration Migration Tests', () => {
  test('should detect legacy configuration', async () => {
    // Mock secret storage with legacy data
    const mockSecrets = {
      get: async (key: string) => {
        if (key === 'addi.providers') {
          return JSON.stringify([
            {
              sid: 'test',
              name: 'Test Provider',
              apiEndpoint: 'https://api.test.com',
              models: [],
            },
          ]);
        }
        return undefined;
      },
      store: async () => {},
      delete: async () => {},
    };

    const helper = new ConfigurationMigrationHelper(mockSecrets as any);

    const needsMigration = await helper.needsMigration();
    assert.strictEqual(needsMigration, true);
  });
});
```

### 8.3 手动测试清单

- [ ] **基础功能测试**
  - [ ] 添加新提供商
  - [ ] 编辑现有提供商
  - [ ] 删除提供商
  - [ ] 模型列表显示正确

- [ ] **API 调用测试**
  - [ ] 使用配置调用远程 API
  - [ ] 错误处理（无效 API Key）
  - [ ] 流式响应正常

- [ ] **迁移测试**
  - [ ] 从旧版配置迁移
  - [ ] 迁移后数据完整性
  - [ ] 迁移回滚功能

- [ ] **兼容性测试**
  - [ ] 不同 VS Code 版本
  - [ ] 不同操作系统
  - [ ] 多种模型提供商

---

## 9. 风险评估与应对

### 9.1 技术风险

| 风险           | 可能性 | 影响 | 应对措施           |
| -------------- | ------ | ---- | ------------------ |
| 新 API 变更    | 中     | 高   | 双轨运行、降级策略 |
| 存储格式不兼容 | 低     | 高   | 迁移验证、回滚机制 |
| 性能下降       | 低     | 中   | 性能测试、优化缓存 |

### 9.2 用户体验风险

| 风险         | 影响 | 应对措施               |
| ------------ | ---- | ---------------------- |
| 配置 UI 变化 | 中   | 提供迁移向导、帮助文档 |
| 旧配置丢失   | 高   | 多重备份、强制迁移验证 |
| API Key 暴露 | 高   | secret: true 自动保护  |

### 9.3 回滚计划

如果迁移出现问题，按以下步骤回滚：

1. **立即回滚**：使用 `ConfigurationMigrationHelper.rollback()`
2. **版本回退**：发布补丁版本回退到旧 API
3. **数据恢复**：从备份恢复配置

```typescript
// 紧急回滚命令
export async function rollbackMigration(context: vscode.ExtensionContext) {
  const migrationHelper = new ConfigurationMigrationHelper(context.secrets);

  const confirmed = await vscode.window.showWarningMessage(
    '确定要回滚配置迁移吗？这将恢复使用旧版配置格式。',
    { modal: true },
    '回滚',
    '取消'
  );

  if (confirmed === '回滚') {
    await migrationHelper.rollback();
    vscode.window.showInformationMessage('配置已回滚，请重启扩展');
  }
}
```

---

## 10. 迁移阶段规划

### 10.1 阶段划分

本迁移方案分为五个核心阶段，每个阶段聚焦于特定的技术改造任务。这种分阶段方式有助于降低风险、确保每阶段的产出质量可控。

**第一阶段：基础架构准备**

此阶段聚焦于完成 package.json 修改和类型定义工作。需要更新扩展的声明文件，添加 languageModelChatProviders 贡献点定义，建立新版配置类型与现有类型的映射关系。这一阶段是整个迁移的基础，确保后续代码有正确的类型支撑。

主要任务包括：更新 package.json 的 contributes 配置、定义 AddiLmConfiguration 相关类型、实现配置格式转换函数。

**第二阶段：Provider 核心迁移**

此阶段重点重构 AddiChatProvider，使其适配新 API 的注册方式和回调签名。核心任务包括实现 provideLanguageModelResponse 方法、适配 configuration 参数传递、处理进度报告等。需要充分测试以确保基本聊天功能正常。

**第三阶段：存储层适配**

此阶段改造 storageService 以支持新配置存储方式。需要实现配置迁移工具、适配新旧配置格式、建立向后兼容的回退机制。确保用户现有配置能够平滑迁移，同时保留降级能力。

**第四阶段：集成与兼容性**

此阶段完成 LLMService 的配置获取适配、扩展入口更新、以及向后兼容性保障措施。需要实现双轨运行模式、渐进式降级策略、版本检测机制等。确保在不同 VS Code 版本上都能正常运行。

**第五阶段：测试与完善**

此阶段进行全面测试和问题修复，包括单元测试、集成测试、手动测试清单验证。完成文档更新和发布准备工作，确保迁移方案的质量和完整性。

### 10.2 里程碑定义

| 里程碑       | 目标                         | 验收标准                   |
| ------------ | ---------------------------- | -------------------------- |
| M1: 基础架构 | 完成 package.json 和类型定义 | 编译通过、类型正确         |
| M2: 核心迁移 | AddiChatProvider 新 API 适配 | 基本聊天功能正常           |
| M3: 存储适配 | storageService 支持新配置    | 配置读写正常、迁移功能正常 |
| M4: 完整迁移 | 所有组件迁移完成             | 全功能测试通过             |
| M5: 发布就绪 | 文档和测试完成               | 无阻塞 Bug、文档完整       |

---

## 附录

### A. 相关链接

- [VS Code 1.109 发布说明](https://code.visualstudio.com/updates/v1_109)
- [Chat Model Provider Configuration 提案](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.lmConfiguration.d.ts)
- [AI SDK 文档](https://sdk.vercel.ai/docs)
- [VS Code 扩展开发指南](https://code.visualstudio.com/api)

### B. 参考实现

- [VS Code Chat Output Renderer Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-output-renderer-sample)
- [VS Code Chat Prompt Files API Sample](https://github.com/microsoft/vscode-extension-samples)

### C. 变更日志

| 日期       | 版本 | 描述     |
| ---------- | ---- | -------- |
| 2026-02-11 | 1.0  | 初始版本 |
