# Addi 重构可行性报告：转型为 `chatLanguageModels.json` 可视化编辑器插件

> 版本：v2.0  
> 日期：2026-06-29  
> 作者：AI Coding Agent  
> 存档分支：`archive/ai-sdk-version`（当前 AI SDK 版本已封存）

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [现状分析](#2-现状分析)
3. [VS Code BYOK 定制端点机制调研](#3-vs-code-byok-定制端点机制调研)
4. [新架构设计：可视化 JSON 编辑器](#4-新架构设计可视化-json-编辑器)
5. [技术实现方案](#5-技术实现方案)
6. [UI/UX 设计概念](#6-uiux-设计概念)
7. [改造方案与工作量评估](#7-改造方案与工作量评估)
8. [风险与挑战](#8-风险与挑战)
9. [结论与建议](#9-结论与建议)

---

## 1. 背景与目标

### 1.1 当前现状

Addi 当前是一个完整的 VS Code Chat Provider 扩展，核心架构如下：

```
用户 → AddiChatProvider → LLMService → AI SDK → 远程 API
                                          ↓
                              aiRegistry (Provider 工厂)
                              ├─ @ai-sdk/openai
                              ├─ @ai-sdk/anthropic
                              ├─ @ai-sdk/google
                              └─ @ai-sdk/openai-compatible
```

- **源码规模**：约 40 个 TypeScript 源文件，总计约 7,000 行代码
- **运行时依赖**：`ai` (v6.x), `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`
- **架构层级**：Presentation → Core (LLM/AI SDK) → Infrastructure → Domain → Common

### 1.2 改造目标

将 Addi 彻底转型为 **`chatLanguageModels.json` 的可视化编辑器插件**——类似于 Markdown 的渲染预览模式，但对 `chatLanguageModels.json` 文件进行友好渲染和交互编辑。

**核心理念**：

```
VS Code 内置命令: "Chat: Open Language Models (JSON)"
         ↓
  chatLanguageModels.json (BYOK 配置文件)
         ↓
    Addi 扩展 (可视化编辑器)
    ┌─────────────────────────┐
    │ 像渲染 Markdown 一样，    │
    │  将 JSON 渲染为可视化表单  │
    │  并提供交互编辑能力        │
    └─────────────────────────┘
         ↓
  VS Code BYOK 引擎自动加载
  (无需 Addi 介入模型通信)
```

### 1.3 关键转变

| 维度           | 旧模式                                         | 新模式                                 |
| -------------- | ---------------------------------------------- | -------------------------------------- |
| **角色**       | Chat Provider + Provider 管理                  | `chatLanguageModels.json` 可视化编辑器 |
| **通信**       | 通过 AI SDK 直接调用远程 API                   | **完全交由 VS Code BYOK 处理**         |
| **配置存储**   | `StorageService` (globalState + SecretStorage) | `chatLanguageModels.json` (文本文件)   |
| **UI 形态**    | 侧边栏树视图 + Webview 编辑弹窗                | **编辑器标签页** (类似 Markdown 预览)  |
| **入口方式**   | 点击活动栏图标 → 侧边栏                        | 点击活动栏图标 → **直接打开编辑器**    |
| **模型数据源** | 内部 CRUD 管理                                 | **直接读写 JSON 文件**                 |
| **依赖管理**   | AI SDK 5 件套 (5 个运行时依赖)                 | **零运行时依赖**                       |

将 Addi 彻底转型为 **`chatLanguageModels.json` 的可视化编辑器插件**——类似于 Markdown 的渲染预览模式，但对 `chatLanguageModels.json` 文件进行友好渲染和交互编辑。

---

## 2. 现状分析

### 2.1 可保留的部分

| 组件                 | 文件                                                          | 保留方式                       |
| -------------------- | ------------------------------------------------------------- | ------------------------------ |
| Webview React 组件库 | `webview-ui/src/components/ProviderForm.tsx`, `ModelForm.tsx` | 重构为编辑器的渲染组件         |
| i18n (中英文)        | `webview-ui/src/i18n/`                                        | 保留                           |
| Logger               | `src/common/logger.ts`                                        | 保留（精简）                   |
| 类型定义             | `src/common/types/`                                           | 大部分删除，仅保留最小必要类型 |
| 图标资源             | `resources/`                                                  | 保留                           |

### 2.2 可删除的部分（全部）

| 层级                                   | 组件                            | 文件                                          | 行数 |
| -------------------------------------- | ------------------------------- | --------------------------------------------- | ---- |
| **Core/LLM** ✅ 全部删除                | LLMService                      | `core/llm/llmService.ts`                      | ~900 |
|                                        | AIProviderRegistry              | `core/llm/aiRegistry.ts`                      | ~150 |
|                                        | MessageConverter                | `core/llm/messageConverter.ts`                | ~500 |
|                                        | ToolOrchestrator                | `core/llm/toolOrchestrator.ts`                | ~80  |
|                                        | ToolRegistry                    | `core/llm/toolRegistry.ts`                    | ~220 |
|                                        | ReasoningUtils                  | `core/llm/reasoningUtils.ts`                  | ~100 |
|                                        | ReasoningContentAdaptMiddleware | `core/llm/reasoningContentAdaptMiddleware.ts` | ~220 |
|                                        | ModelTester                     | `core/llm/modelTester.ts`                     | ~260 |
| **Core/Providers** ✅ 全部删除          | AddiChatProvider                | `core/providers/AddiChatProvider.ts`          | ~200 |
|                                        | ProviderModelManager            | `core/providers/ProviderModelManager.ts`      | ~820 |
|                                        | DataNormalizer                  | `core/providers/dataNormalizer.ts`            | ~200 |
|                                        | RemoteModelFetcher              | `core/providers/remoteModelFetcher.ts`        | ~200 |
| **Infrastructure** ✅ 大部分删除        | StorageService                  | `infrastructure/storage/storageService.ts`    | ~400 |
|                                        | ApiKeyService                   | `infrastructure/storage/ApiKeyService.ts`     | ~120 |
|                                        | CryptoService                   | `infrastructure/crypto/cryptoService.ts`      | ~120 |
| **Presentation/Views** ✅ 删除          | ProviderView (树视图)           | `presentation/views/providerView.ts`          | ~320 |
|                                        | TreeItems                       | `presentation/views/treeItems.ts`             | ~100 |
| **Presentation/Commands** ✅ 大部分删除 | Config.ts (导出/导入/备份)      | `presentation/commands/config.ts`             | ~820 |
|                                        | Provider.ts (CRUD)              | `presentation/commands/provider.ts`           | ~300 |
|                                        | Model.ts (CRUD)                 | `presentation/commands/model.ts`              | ~260 |
|                                        | Base.ts                         | `presentation/commands/base.ts`               | ~70  |
|                                        | SortStrategy                    | `presentation/utils/sortStrategy.ts`          | ~120 |

**总计可删除约 5,800+ 行代码**（占总源码的 ~83%）。

### 2.3 `package.json` 精简

**删除的 contribution points**：
```json
{
  // ❌ 删除
  "viewsContainers": { "activitybar": [...] },
  "views": { "addi-sidebar": [...] },
  "viewsWelcome": [...],
  "menus": { "view/title": [...], "view/item/context": [...] },
  "languageModelChatProviders": [{ "vendor": "addi-provider", ... }]
}
```

**新增的 contribution points**：
```json
{
  // ✅ 新增 - 自定义编辑器
  "customEditors": [
    {
      "viewType": "addi.chatLanguageModelsEditor",
      "displayName": "Addi Language Models Editor",
      "selector": [
        {
          "filenamePattern": "chatLanguageModels.json"
        }
      ],
      "priority": "default"
    }
  ]
}
```

**删除的运行时依赖**（全部）：
```
ai, @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google, @ai-sdk/openai-compatible
```

---

## 3. VS Code BYOK 定制端点机制调研

### 3.1 Custom Endpoint 核心能力

VS Code 从 1.12x 起内置 **Custom Endpoint** 机制，支持三种 API 类型：

| API 类型             | 适用场景               | 配置值               |
| -------------------- | ---------------------- | -------------------- |
| **Chat Completions** | OpenAI 兼容            | `"chat-completions"` |
| **Responses**        | OpenAI Responses API   | `"responses"`        |
| **Messages**         | Anthropic Messages API | `"messages"`         |

### 3.2 配置格式完整参考

```jsonc
// %APPDATA%/Code/User/chatLanguageModels.json
[
  {
    "name": "我的 Provider",
    "vendor": "customendpoint",     // 固定值
    "apiKey": "${input:chat.lm.secret.xxx}",  // 可选，用 SecretStorage
    "apiType": "chat-completions",
    "models": [
      {
        "id": "deepseek-chat",      // 发送给 API 的模型 ID
        "name": "DeepSeek V4",      // 显示名称
        "url": "https://api.deepseek.com/v1/chat/completions",
        "toolCalling": true,        // 必须 true 才能在模型选择器显示
        "vision": false,
        "thinking": true,
        "streaming": true,
        "maxInputTokens": 128000,
        "maxOutputTokens": 64000,
        "supportsReasoningEffort": ["low", "medium", "high"],
        "editTools": ["find-replace", "multi-find-replace", "apply-patch", "code-rewrite"],
        "requestHeaders": { "X-Custom": "value" }
      }
    ]
  }
]
```

### 3.3 VS Code 负责的能力 ✓

| 能力                   | 说明                                         |
| ---------------------- | -------------------------------------------- |
| HTTP 请求              | 完全由 VS Code 处理                          |
| 流式响应               | 原生支持                                     |
| 工具调用               | 原生支持                                     |
| 思考/推理渲染          | `thinking: true` + `supportsReasoningEffort` |
| Vision                 | `vision: true`                               |
| Token 统计             | 自动计算                                     |
| 模型选择器             | 自动注册到模型下拉框                         |
| Thinking Effort 选择器 | 自动添加 UI                                  |
| 密钥安全管理           | `${input:...}` 语法                          |
| 零数据保留             | `zeroDataRetentionEnabled`                   |

> **结论**：VS Code BYOK 完全覆盖了 Addi 当前 Chat Provider 的所有通信需求。Addi 不需要编写任何 HTTP 请求逻辑。

### 3.4 原生字段兼容性验证 ✅

> **数据来源**：[VS Code 官方文档 — Model configuration reference](https://code.visualstudio.com/docs/agent-customization/language-models#_model-configuration-reference)（2026-06-24 更新）

以下逐字段验证了 VS Code 原生支持的 `chatLanguageModels.json` 字段，并与 Addi 旧版自定义字段对比：

**Provider 级别字段：**

| 字段                        | VS Code 原生 |    Addi 旧版自定义    | 说明                                             |
| --------------------------- | :----------: | :-------------------: | ------------------------------------------------ |
| `vendor`                    |    ✅ 必需    |   ❌ `providerType`    | 旧版用 4 种自定义类型，原生用 `"customendpoint"` |
| `name`                      |    ✅ 必需    |        ✅ 保留         | 显示名称                                         |
| `apiKey`                    |    ✅ 可选    |   ❌ `ApiKeyService`   | 原生支持 `${input:...}` 密钥语法                 |
| `apiType`                   |    ✅ 可选    | ❌ 嵌入 `providerType` | `chat-completions` / `responses` / `messages`    |
| `models`                    |    ✅ 可选    |        ✅ 保留         | 模型数组                                         |
| `id` (UUID)                 |   ❌ 不需要   |        ❌ 移除         | 原生按名称索引                                   |
| `description` / `website`   |   ❌ 不需要   |        ❌ 移除         | 无意义                                           |
| `order`                     |   ❌ 不需要   |        ❌ 移除         | 排序由 VS Code 管理                              |
| `extraBody` / `extraHeader` |   ❌ 不支持   |        ❌ 移除         | 替代：`requestHeaders`（模型级）                 |
| `options` (temperature 等)  |   ❌ 不支持   |        ❌ 移除         | VS Code 不暴露生成参数                           |

**Model 级别字段：**

| 字段                            |      VS Code 原生      |       Addi 旧版自定义        | 说明                                        |
| ------------------------------- | :--------------------: | :--------------------------: | ------------------------------------------- |
| `id`                            |         ✅ 必需         |           ❌ `rid`            | 发送给 API 的模型标识符                     |
| `name`                          |         ✅ 可选         |            ✅ 保留            | 模型选择器中的显示名                        |
| `url`                           |         ✅ 必需         |   ❌ 从 `apiEndpoint` 拼接    | 完整端点 URL                                |
| `toolCalling`                   |         ✅ 可选         | ❌ `capabilities.toolCalling` | 控制模型是否显示在 Agent 模式               |
| `vision`                        |         ✅ 可选         |   ❌ `capabilities.vision`    | 图片输入支持                                |
| `maxInputTokens`                |         ✅ 可选         |            ✅ 保留            | 输入上限（部分模型需要）                    |
| `maxOutputTokens`               |         ✅ 可选         |            ✅ 保留            | 输出上限（部分模型需要）                    |
| `editTools`                     |         ✅ 可选         |           ❌ 不支持           | 原生新增：find-replace / apply-patch 等     |
| **`thinking`**                  | ✅ **可选, 默认 false** |  ❌ `capabilities.reasoning`  | **已验证 ✅ — VS Code 原生支持思考能力声明** |
| **`streaming`**                 | ✅ **可选, 默认 true**  |          ✅ 隐式启用          | **已验证 ✅ — VS Code 原生支持流式响应声明** |
| `supportsReasoningEffort`       |         ✅ 可选         | ❌ `options.reasoningEffort`  | 控制 Thinking Effort 选择器 UI              |
| `reasoningEffortFormat`         |         ✅ 可选         |           ❌ 不支持           | body 格式指定                               |
| `requestHeaders`                |         ✅ 可选         |       ❌ `extraHeader`        | 自定义 HTTP 头                              |
| `zeroDataRetentionEnabled`      |         ✅ 可选         |           ❌ 不支持           | 零数据保留模式                              |
| `apiType`                       |   ✅ 可选 (per-model)   |           ❌ 不支持           | 模型级覆盖 provider 的 apiType              |
| `family` / `version`            |        ❌ 不需要        |            ❌ 移除            | VS Code 不关心                              |
| `isUserSelectable`              |        ❌ 不需要        |            ❌ 移除            | VS Code 管理模型可见性                      |
| `extraBody`                     |        ❌ 不支持        |            ❌ 移除            | VS Code 限制                                |
| `speedHistory` / `averageSpeed` |        ❌ 不需要        |            ❌ 移除            | 速度统计移除                                |

> **关键结论**：
> - **`thinking`** ✅ 已验证为 VS Code 1.12x+ 原生支持字段
> - **`streaming`** ✅ 已验证为 VS Code 原生支持字段（默认 `true`）
> - Addi **不引入任何自定义扩展字段**——编辑器仅渲染上述 ✅ 原生字段
> - 所有 Addi 旧版自定义字段（`family`, `version`, `extraBody`, `options.temperature` 等）在新架构中**全部删除**

---

## 4. 新架构设计：可视化 JSON 编辑器

### 4.1 核心概念

> **像 VS Code 渲染 Markdown 一样渲染 `chatLanguageModels.json`**

- Markdown 文件 → VS Code 渲染为带格式的预览 → 可读性提升
- `chatLanguageModels.json` → **Addi 渲染为可视化表单** → 可读性 + 可编辑性提升

### 4.2 新架构总览

```
┌─── 用户点击活动栏 Addi 图标 ─────────────────────────────┐
│                                                           │
│  vscode.commands.executeCommand('vscode.open', chatLM_uri) │
│                                                           │
│  ↓ VS Code 检测到 filenamePattern 匹配 → 激活 Addi         │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  CustomTextEditorProvider.resolveCustomTextEditor()   │  │
│  │  = AddiChatLanguageModelsEditor                       │  │
│  │                                                       │  │
│  │  1. 读取 TextDocument (chatLanguageModels.json)       │  │
│  │  2. 解析 JSON                                         │  │
│  │  3. 渲染 Webview UI (可视化编辑器)                     │  │
│  │  4. 用户编辑 → 同步回 TextDocument                     │  │
│  │  5. 保存 → VS Code BYOK 自动重新加载                   │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ↓ VS Code BYOK 引擎自动读取 chatLanguageModels.json       │
│  ↓ 模型出现在 Copilot Chat 模型选择器中                    │
│  ↓ 用户选择模型 → Copilot 通过 BYOK 直接调用远程 API       │
│  ↓ Addi 完全不介入通信过程                                 │
└───────────────────────────────────────────────────────────┘
```

### 4.3 文件结构

```
addi/
├── package.json                    # 精简后 ~50 行
├── src/
│   ├── extension.ts                # 入口：注册 CustomEditorProvider
│   ├── addiEditor.ts               # CustomTextEditorProvider 实现
│   ├── webview/                    # Webview UI (React)
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ProviderCard.tsx     # Provider 可视化卡片
│   │   │   ├── ModelCard.tsx        # Model 可视化卡片
│   │   │   ├── ProviderForm.tsx     # Provider 编辑表单
│   │   │   └── ModelForm.tsx        # Model 编辑表单
│   │   ├── hooks/
│   │   │   └── useVscode.ts
│   │   └── i18n/
│   │       ├── en.ts
│   │       ├── zh.ts
│   │       └── index.tsx
│   └── common/
│       └── logger.ts               # 精简版日志
├── resources/
│   └── icon.svg                    # 活动栏图标
└── docs/
    └── refactoring-byok-feasibility-report.md
```

### 4.4 VS Code CustomEditorProvider 最佳选择

我们选择 **`CustomTextEditorProvider`** 而非 Webview Panel，因为：

| 能力         | `CustomTextEditorProvider`           | Webview Panel  |
| ------------ | ------------------------------------ | -------------- |
| 文件关联     | ✅ 自动关联 `chatLanguageModels.json` | ❌ 手动管理     |
| 撤销/重做    | ✅ 基于 TextDocument 自动支持         | ❌ 需自行实现   |
| 保存逻辑     | ✅ 自动同步                           | ❌ 需手动监听   |
| 多 Tab       | ✅ 支持同时打开多个                   | ❌ 单实例       |
| 文件修改检测 | ✅ 外部修改自动通知                   | ❌ 需自己 watch |

---

## 5. 技术实现方案

### 5.1 `package.json` 贡献点

```jsonc
{
  "name": "addi",
  "displayName": "Addi",
  "description": "Visual editor for chatLanguageModels.json - Beautiful BYOK model management",
  "categories": ["AI", "Visualization", "language models"],
  "activationEvents": [
    "onCustomEditor:addi.chatLanguageModelsEditor"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "customEditors": [
      {
        "viewType": "addi.chatLanguageModelsEditor",
        "displayName": "Addi Language Models Editor",
        "selector": [
          {
            "filenamePattern": "chatLanguageModels.json"
          }
        ],
        "priority": "default"
      }
    ],
    "commands": [
      {
        "command": "addi.openEditor",
        "title": "Addi: Open Language Models Editor",
        "icon": "$(edit)"
      }
    ],
    "menus": {
      "commandPalette": [
        {
          "command": "addi.openEditor"
        }
      ]
    }
  }
}
```

### 5.2 `extension.ts` — 新入口

```typescript
import * as vscode from 'vscode';
import { AddiChatLanguageModelsEditor } from './addiEditor';

export function activate(context: vscode.ExtensionContext) {
  // 注册自定义编辑器
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'addi.chatLanguageModelsEditor',
      new AddiChatLanguageModelsEditor(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: true,
      }
    )
  );

  // 注册"打开编辑器"命令
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.openEditor', async () => {
      const chatLMUri = getChatLanguageModelsUri();
      
      // 如果文件不存在，创建默认模板
      try {
        await vscode.workspace.fs.stat(chatLMUri);
      } catch {
        await vscode.workspace.fs.writeFile(
          chatLMUri,
          new TextEncoder().encode('[\n  {\n    "name": "My Provider",\n    "vendor": "customendpoint",\n    "apiType": "chat-completions",\n    "models": []\n  }\n]')
        );
      }
      
      // 用自定义编辑器打开
      await vscode.commands.executeCommand('vscode.open', chatLMUri);
    })
  );
}

function getChatLanguageModelsUri(): vscode.Uri {
  const basePath = process.env.APPDATA 
    || `${process.env.HOME}/Library/Application Support`
    || `${process.env.HOME}/.config`;
  return vscode.Uri.file(`${basePath}/Code/User/chatLanguageModels.json`);
}
```

### 5.3 `addiEditor.ts` — 自定义编辑器核心

```typescript
import * as vscode from 'vscode';

export class AddiChatLanguageModelsEditor implements vscode.CustomTextEditorProvider {
  constructor(private context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // 配置 Webview
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.context.extensionUri, 'webview-ui', 'dist'),
      ],
    };

    // 设置 HTML
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    // 监听来自 Webview 的消息（用户编辑）
    const changeDisposable = webviewPanel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'update':
            await this.updateDocument(document, message.data);
            break;
          case 'openJson':
            await vscode.commands.executeCommand('workbench.action.chat.openLanguageModelsJson');
            break;
          case 'addProvider':
          case 'deleteProvider':
          case 'addModel':
          case 'deleteModel':
            await this.updateDocument(document, message.data);
            break;
          case 'error':
            vscode.window.showErrorMessage(message.text);
            break;
        }
      }
    );

    // 监听文件外部修改 → 刷新 Webview
    const changeListener = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          webviewPanel.webview.postMessage({
            type: 'refresh',
            data: JSON.parse(document.getText()),
          });
        }
      }
    );

    webviewPanel.onDidDispose(() => {
      changeDisposable.dispose();
      changeListener.dispose();
    });

    // 初始加载：发送 JSON 数据到 Webview
    const initialData = this.parseJsonSafe(document.getText());
    webviewPanel.webview.postMessage({
      type: 'init',
      data: initialData,
    });
  }

  private async updateDocument(document: vscode.TextDocument, data: any) {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.lineAt(0).range.start,
      document.lineAt(document.lineCount - 1).range.end
    );
    edit.replace(document.uri, fullRange, JSON.stringify(data, null, 2));
    await vscode.workspace.applyEdit(edit);
    await document.save();
  }

  private parseJsonSafe(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      return [];
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview-ui', 'dist', 'assets', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview-ui', 'dist', 'assets', 'index.css')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Addi - Language Models Editor</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 64; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
```

### 5.4 数据同步流程

```
用户编辑 Webview UI
    ↓
Webview → postMessage({ type: 'update', data: newJson })
    ↓
addiEditor.ts → WorkspaceEdit → document.save()
    ↓
chatLanguageModels.json 写入磁盘
    ↓ (自动触发)
VS Code BYOK 检测到文件变更 → 重新加载模型列表
    ↓
Copilot Chat 模型选择器立即更新
```

---

## 6. UI/UX 设计概念

### 6.1 核心设计原则

| 原则                    | 说明                                                       |
| ----------------------- | ---------------------------------------------------------- |
| **一致感**              | 使用 VS Code Design Language，与 VS Code 原生 UI 融为一体  |
| **透明感**              | 可视化表单与原始 JSON 一一对应，用户始终知道自己在编辑什么 |
| **Markdown 式渲染体验** | 打开即渲染，所见即所得，同时保留切换原始 JSON 的能力       |
| **原生遵循**            | **仅渲染 VS Code 原生支持的字段**，不添加任何自定义扩展    |

### 6.2 Provider 卡片渲染概念

> **所有字段均直接映射到 VS Code 原生 `chatLanguageModels.json` 配置**，不添加任何 Addi 自定义扩展字段。

```
┌────────────────────────────────────────────────────────────┐
│  Provider 1: My Custom API                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 🏷️ 名称     My Custom API          ← name             │ │
│  │ 🏢 Vendor   customendpoint          ← vendor           │ │
│  │ 🔑 API Key  ●●●●●●●●●●  [重新输入]  ← apiKey          │ │
│  │ 📡 API Type chat-completions  ▼     ← apiType          │ │
│  │                                                        │ │
│  │  Models (2):                                           │ │
│  │  ┌────────────────────────────────────────────────┐    │ │
│  │  │ 🤖 deepseek-chat        DeepSeek V4           │    │ │
│  │  │    🌐 https://api.deepseek.com/...  ← url       │    │ │
│  │  │    🧠 thinking: ✓   | ← thinking (原生)         │    │ │
│  │  │    🔧 tools: ✓      | ← toolCalling (原生)     │    │ │
│  │  │    👁️ vision: ✗     | ← vision (原生)         │    │ │
│  │  │    ⚡ streaming: ✓  | ← streaming (原生)       │    │ │
│  │  │    📊 max: 128K/64K  ← maxInput/OutputTokens   │    │ │
│  │  │    [编辑] [复制] [删除]                          │    │ │
│  │  └────────────────────────────────────────────────┘    │ │
│  │  [+ 添加模型]                                           │ │
│  └────────────────────────────────────────────────────────┘ │
│  [编辑 Provider] [复制] [删除]  [+ 添加 Provider]            │
└────────────────────────────────────────────────────────────┘
```

### 6.3 Webview 类型定义（原生字段唯一）

```typescript
// ---------- 仅使用 VS Code BYOK 原生支持的字段 ----------

/** Provider 级别 */
interface LMProvider {
  name: string;
  vendor: "customendpoint";
  apiKey?: string;                    // ${input:...} 语法
  apiType?: "chat-completions" | "responses" | "messages";
  models: LMModel[];
}

/** Model 级别 — 仅含 VS Code 原生字段 */
interface LMModel {
  id: string;                         // 发送给 API 的模型 ID
  name?: string;                      // 显示名称
  url: string;                        // 完整端点 URL
  apiType?: "chat-completions" | "responses" | "messages"; // per-model 覆盖
  toolCalling?: boolean;
  vision?: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  thinking?: boolean;                 // ✅ 原生
  streaming?: boolean;                // ✅ 原生
  editTools?: string[];               // 原生
  supportsReasoningEffort?: string[]; // 原生
  reasoningEffortFormat?: "chat-completions" | "responses"; // 原生
  requestHeaders?: Record<string, string>; // 原生
  zeroDataRetentionEnabled?: boolean; // 原生
}

// ❌ 不包含任何 Addi 自定义字段：
//    family, version, extraBody, extraHeader,
//    options.temperature, options.topP,
//    capabilities.reasoning, isUserSelectable,
//    speedHistory, averageSpeed
```

> **类型文件路径约定**：`webview-ui/src/types/chatLanguageModels.ts`，取代旧版 `types/index.ts`

### 6.4 交互流程

1. **打开方式**：点击活动栏图标 / 命令面板 "Open Language Models Editor" / 直接打开 `chatLanguageModels.json`
2. **文件不存在**：自动创建含空 Provider 示例的模板文件
3. **加载错误**：显示友好错误提示 + 提供打开原始 JSON 的按钮
4. **编辑中**：实时同步到 TextDocument（撤销/重做自动支持）
5. **外部修改**：自动检测并刷新 UI（`onDidChangeTextDocument`）
6. **原始 JSON**：侧边按钮切换查看原始 JSON（只读参考）

---

## 7. 风险与挑战

### 7.1 技术风险

| 风险                      | 等级 | 说明                                        | 缓解措施                                      |
| ------------------------- | ---- | ------------------------------------------- | --------------------------------------------- |
| `extraBody` 功能缺失      | 🟢 低 | Addi 不再需要此能力（不做通信）             | N/A — 插件定位已变                            |
| Vite + React Webview 打包 | 🟡 中 | Webview 资源路径需在 VS Code 环境中正确处理 | 使用 `vscode.Webview.asWebviewUri()` 转换路径 |
| CSP 限制                  | 🟢 低 | VS Code Webview 有严格的 CSP 策略           | 在 HTML 中配置合适的 CSP nonce                |
| 文件并发写入冲突          | 🟢 低 | 用户同时在 JSON 编辑器和可视化编辑器中修改  | `onDidChangeTextDocument` 自动刷新 UI         |
| 用户首次使用              | 🟢 低 | 新用户可能没有 `chatLanguageModels.json`    | 自动创建模板文件                              |

### 7.2 功能降级（相较当前 AI SDK 版本）

| 功能            | 当前              | 新版本                  | 说明                         |
| --------------- | ----------------- | ----------------------- | ---------------------------- |
| 模型通信        | ✅ AI SDK 直接调用 | ❌ 由 VS Code BYOK 接管  | 核心变化，用户无感知         |
| 树视图管理      | ✅ Sidebar 树视图  | ❌ 移除                  | 点击活动栏图标直接打开编辑器 |
| 速度统计        | ✅ 支持            | ❌ 移除                  | BYOK 不提供此能力            |
| 导出/导入       | ✅ 加密导出        | ❌ 移除                  | 用户可直接复制文件           |
| 备份管理        | ✅ 支持            | ❌ 移除                  | —                            |
| 从 API 拉取模型 | ✅ 支持            | ❌ 移除                  | BYOK 需手动配置              |
| 模型连通性测试  | ✅ 支持            | ❌ 移除                  | 用户直接在 Chat 中测试       |
| 可视化编辑      | ✅ 表格编辑        | ✅✅ 卡片式渲染编辑       | **大幅提升**                 |
| 中英文 i18n     | ✅                 | ✅                       | 保留                         |
| 撤销/重做       | ❌ 不支持          | ✅ TextDocument 原生支持 | **新增**                     |
| 多 Tab 同时编辑 | ❌ 不支持          | ✅ CustomEditor 原生支持 | **新增**                     |

---

## 8. 结论与建议

### 8.1 可行性评估：✅ 可行且强烈建议

| 维度       | 评估    | 说明                                                                 |
| ---------- | ------- | -------------------------------------------------------------------- |
| 技术可行性 | ⭐⭐⭐⭐⭐   | `CustomTextEditorProvider` + `customEditors` 是 VS Code 一等公民 API |
| 代码精简   | ⭐⭐⭐⭐⭐   | 从 ~7,000 行 → ~1,200 行，减少 ~83%                                  |
| 功能覆盖   | ⭐⭐⭐⭐    | 编辑能力大幅提升，通信由 BYOK 完全接管                               |
| 工作量     | ⭐⭐ (低) | 约 1000 行新代码，VS Code 原生加持                                   |
| 维护成本   | ✅ 极低  | 无运行时依赖，无通信层维护，只需关注 UI 渲染                         |
| 风险       | 🟢 极低  | 所有 API 均为稳定的 VS Code 1.89+ API                                |

### 8.2 核心优势总结

1. **真正的零通信**：Addi 完全不介入模型通信，VS Code BYOK 全权负责
2. **Markdown 式体验**：像预览 Markdown 一样预览 `chatLanguageModels.json`，直观且强大
3. **VS Code 原生能力**：撤销/重做、多 Tab、文件同步全部免费获得
4. **零运行时依赖**：从 5 个 AI SDK 运行时依赖归零
5. **代码量暴跌 83%**：从 ~7,000 行精简至 ~1,200 行

### 8.3 建议实施路线图

```
Day 1 — 骨架搭建（4h）
├── 创建 customEditors 分支（从 main）
├── 精简 package.json（删 views/menus/chatProviders → 加 customEditors）
├── 新建 src/addiEditor.ts（CustomTextEditorProvider 核心）
└── 精简 src/extension.ts（仅注册 EditorProvider + 命令）

Day 2 — Webview UI（6h）
├── 改造 webview-ui/（删旧 ProviderForm/ModelForm，建 ProviderCard/ModelCard）
├── 实现 postMessage 数据同步
├── 实现撤销/保存/外部修改刷新
└── i18n 适配

Day 3 — 清理 + 测试（4h）
├── 删除所有废弃的 src/ 文件（core/, infrastructure/, 旧 views/commands）
├── 清理 webview-ui/ 旧组件
├── 更新 package.json scripts
└── 手动测试完整流程
```

**总计约 1.5-2 天工作量**。

### 8.4 最终架构一览

```
┌─── 用户 ─────────────────────────────────────────────┐
│                                                       │
│  点击图标 → Addi 可视化编辑器 (CustomEditorProvider)    │
│  ↓                                                     │
│  编辑 chatLanguageModels.json                           │
│  ↓ 保存                                                │
│  VS Code BYOK 自动加载新模型                            │
│  ↓                                                     │
│  用户在 Copilot Chat 中选择模型 → 直接调用远程 API       │
│  ↑────────── Addi 完全不介入 ──────────↑               │
└───────────────────────────────────────────────────────┘
```

> **一句话总结**：Addi 转型为 **`chatLanguageModels.json` 的 Markdown 式可视化渲染编辑器**，让配置 VS Code BYOK 模型变得像在 Markdown 中写文档一样简单直观。

---

## 附录

### A. 现有分支状态

| 分支                                    | 说明                                                 | 位置        |
| --------------------------------------- | ---------------------------------------------------- | ----------- |
| `main`                                  | 当前开发分支（AI SDK 版本）                          | 本地 + 远程 |
| `archive/ai-sdk-version`                | ✅ 已封存的 AI SDK 版本                               | 本地 + 远程 |
| `archive/ai-sdk-provider-communication` | 已有的存档分支（与 `archive/ai-sdk-version` 同节点） | 本地        |

### B. 参考文档

- [VS Code 官方文档: AI Language Models](https://code.visualstudio.com/docs/agent-customization/language-models)
- [VS Code 1.125 Release Notes — Language Models Updates](https://code.visualstudio.com/updates/v1_125)
- [GitHub Copilot: Change the Chat Model](https://docs.github.com/en/copilot/how-tos/use-ai-models/change-the-chat-model)
- [Addi 架构规范](/docs/architecture-spec.md)
- [加密配置导出/导入](/docs/encrypted-config-export-import.md)
- [Reasoning 架构参考](/docs/reasoning-architecture.md)
