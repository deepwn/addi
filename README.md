<center style="text-align: center; background-color: lightblue; padding: 40px 40px; border-radius: 10px; margin-bottom: 20px;">
  <img src="resources/icon-bg.min.png" width="128" height="128" alt="Addi Logo" />

  <h1>Addi — Extend Your VS Code Copilot</h1>
  <p><b>为 GitHub Copilot 添加自定义 AI 供应商与模型、快捷构造MCP工具的 VS Code 扩展</b></p>
    <a href="https://github.com/deepwn/addi/releases"><img alt="Release" src="https://img.shields.io/github/v/release/deepwn/addi?logo=github" /></a>
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-green.svg" /></a>
    <a href="https://github.com/deepwn/addi/issues"><img alt="Issues" src="https://img.shields.io/github/issues/deepwn/addi" /></a>
    <a href="https://github.com/deepwn/addi/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/deepwn/addi" /></a>
  </p>
</center>

---

## 目录 Table of Contents

- [目录 Table of Contents](#目录-table-of-contents)
- [简介 Introduction](#简介-introduction)
- [特性 Features](#特性-features)
- [快速开始 Quick Start](#快速开始-quick-start)
- [安装 Installation](#安装-installation)
  - [插件市场 Marketplace](#插件市场-marketplace)
  - [本地 VSIX](#本地-vsix)
- [使用概览 Usage Overview](#使用概览-usage-overview)
- [供应商与模型管理 Provider \& Model Management](#供应商与模型管理-provider--model-management)
  - [添加供应商 Add Provider](#添加供应商-add-provider)
  - [添加模型 Add Model](#添加模型-add-model)
  - [模型验证 Model Verification](#模型验证-model-verification)
  - [快速编辑 Edit API Key](#快速编辑-edit-api-key)
- [自定义工具 Custom Tools (MCP)](#自定义工具-custom-tools-mcp)
  - [核心特性 Core Features](#核心特性-core-features)
  - [快速概览 Quick Overview](#快速概览-quick-overview)
  - [非预期行为处置 Unexpected Behavior Handling (Preview)](#非预期行为处置-unexpected-behavior-handling-preview)
    - [功能说明 Description](#功能说明-description)
    - [使用场景 Use Cases](#使用场景-use-cases)
    - [安全警告 Warning](#安全警告-warning)
    - [配置示例 Configuration Example](#配置示例-configuration-example)
- [中间件与存储架构 Middleware \& Storage Architecture](#中间件与存储架构-middleware--storage-architecture)
  - [中间件系统 Middleware System](#中间件系统-middleware-system)
    - [核心组件 Core Components](#核心组件-core-components)
    - [ToolCallCompatibilityMiddleware](#toolcallcompatibilitymiddleware)
    - [流式响应处理](#流式响应处理)
  - [三层存储架构 Three-Tier Storage Architecture](#三层存储架构-three-tier-storage-architecture)
    - [配置层 Config Layer](#配置层-config-layer)
    - [统计层 Stats Layer](#统计层-stats-layer)
    - [密钥层 Secrets Layer](#密钥层-secrets-layer)
  - [API 密钥脱敏 API Key Masking](#api-密钥脱敏-api-key-masking)
- [命令 Commands](#命令-commands)
- [配置项 Settings Items](#配置项-settings-items)
- [配置文件格式 Config Format](#配置文件格式-config-format)
- [常见问题 FAQ](#常见问题-faq)
  - [Q: 为什么我添加的模型在 Copilot 中不可见？](#q-为什么我添加的模型在-copilot-中不可见)
  - [Q: 如何知道我的模型是否正在使用中？](#q-如何知道我的模型是否正在使用中)
  - [Q: 我可以添加多少个供应商和模型？](#q-我可以添加多少个供应商和模型)
  - [Q: 我的自定义工具没有显示在 Copilot 的工具列表中？](#q-我的自定义工具没有显示在-copilot-的工具列表中)
- [故障排除 Troubleshooting](#故障排除-troubleshooting)
- [许可证 License](#许可证-license)
- [免责声明 Disclaimer](#免责声明-disclaimer)
- [致谢 Thanks](#致谢-thanks)

---

## 简介 Introduction

Addi 让你在 VS Code 中为 GitHub Copilot 添加自定义 / 第三方 / 自建 **AI Provider 与模型**，并在 Copilot 原生模型选择器中一键切换。它既是一个**模型管理器**，同时还是一个**快捷构造 MCP 工具**微服务。

> [!Tip]
> 虽然 vscode 官方有支持自定义模型的计划，但目前仍未开放给大众用户，Addi 作为一个临时解决方案，可以帮助你快速上手并测试各种模型。详见 [Bring Your Own Language Model](https://code.visualstudio.com/docs/copilot/customization/language-models#_bring-your-own-language-model-key) 以及 [Use an OpenAI-Compatible Model](https://code.visualstudio.com/docs/copilot/customization/language-models#_use-an-openaicompatible-model)。

## 特性 Features

| 类别             | 说明                                                          |
| ---------------- | ------------------------------------------------------------- |
| Provider 管理    | 添加 / 编辑 / 复制 / 删除 / 快速编辑 API Key                  |
| 模型管理         | 绑定于 Provider 的模型定义与特性标记（视觉 / 工具调用支持等） |
| 智能模型验证     | 自动检测连通性、视觉能力、工具调用支持和 Token 限制           |
| 模型切换         | 在 Copilot 模型选择器中勾选后即可切换自定义模型               |
| 配置导入导出     | JSON 结构备份 / 迁移到其他机器                                |
| 可配置默认参数   | 默认 family / version / token 限制                            |
| 排序选项         | 支持按字母、输入/输出 Token 数排序供应商和模型                |
| UI / 树视图      | 直观的 ActivityBar 侧边栏管理界面                             |
| 非预期行为处理   | 检测并清洗幻觉工具调用标签，或自动重试以强制工具调用          |
| 中间件系统       | ToolCallCompatibilityMiddleware 处理模型异常输出              |
| 三层存储架构     | 配置层 / 统计层 / 密钥层分离，提升安全性                      |
| API 密钥自动脱敏 | 日志和 UI 中自动隐藏敏感信息                                  |
| 右键上下文操作   | 针对 Provider / Model 的快捷操作                              |
| SSE 流式输出     | 支持 OpenAI 及兼容端点增量输出                                |
| 测试覆盖         | 单元测试与集成测试覆盖核心逻辑                                |
| 日志输出         | 专用 output channel 与可调 Log Level                          |

## 快速开始 Quick Start

```text
1. 安装扩展（市场或本地 VSIX）
2. 打开侧边栏 “Addi”
3. 添加 Provider（填写端点与 API Key）
4. 为该 Provider 添加模型（id / token 限制等）
5. 在 Copilot → 模型下拉 → 管理模型 → 勾选你的模型
6. 返回聊天界面，选择并使用它！
```

## 安装 Installation

### 插件市场 Marketplace

搜索 “Addi” 并安装；或命令面板输入：`ext install addi`。

### 本地 VSIX

```powershell
npm install; npm run package
code --install-extension addi.vsix
# 或在 VS Code 文件列表中右键安装
```

## 使用概览 Usage Overview

Activity Bar 中的 Addi 图标 → 展开树：

- Provider：可快速添加模型 / 编辑密钥 / 管理模型
- Custom Tools：添加 / 管理 MCP 自定义工具

> [!Warning]
> 完整利用自定义模型的 Edit / Agent 模式可能需要 GitHub Copilot Pro 级别订阅；Free 版本目前测试仅支持用于 Ask 模式使用自定义模型。请确保账户权限满足需求。

## 供应商与模型管理 Provider & Model Management

### 添加供应商 Add Provider

1. 点击 “Add Provider”
2. 填写：名称 / 描述 / 网站 / API Endpoint / API Key / 接口类型(OpenAI 兼容等)
3. 保存后出现在列表

### 添加模型 Add Model

1. 选中 Provider → Add Model
2. 填写：id / 名称(可选) / maxInputTokens / maxOutputTokens / 视觉支持 / 工具支持
3. 保存后挂载在对应 Provider 下

### 模型验证 Model Verification

在添加或编辑模型时，点击底部的 **"Verify & Detect"** 按钮可以自动测试：

- **连通性**：检查 API Key 和 Endpoint 是否有效
- **视觉能力**：自动检测模型是否支持图片输入
- **工具调用**：自动检测模型是否支持 Function Calling
- **Token 限制**：自动探测并填充 Max Input / Output Tokens (使用二分查找与参数估算，不消耗真实 Token)

> [!Tip]
> 如果不确定模型的 Token 限制，可以将 `Max Input Tokens` 和 `Max Output Tokens` 留空（或设为`?`），点击 Verify & Detect 后 Addi 会自动探测并填入建议值。如果检测不准确，请参照官方模型文档手动设置。
> 所有附属能力（视觉 / 工具调用）也会在验证过程中自动测试并更新勾选（不适配则会自动去除勾选）。

### 快速编辑 Edit API Key

Provider 节点右侧钥匙图标 → 输入密钥 → 保存。

## 自定义工具 Custom Tools (MCP)

Addi 内置了一个 **Model Context Protocol (MCP)** Server，支持通过 YAML 文件定义自定义工具。这意味着你的本地脚本可以被 AI 像原生函数一样调用。

并且为了方便用户理解与编辑，Addi 的自定义工具语法完全兼容 GitHub Actions 的 `composite` 语法规范，使用优秀的开源本地化 actions 运行项目 `nektos/act` 作为模板解析引擎。

详细文档与示例：[自定义工具指南 (CUSTOM_TOOLS.md)](CUSTOM_TOOLS.md)

### 核心特性 Core Features

- **多语言支持**: 支持 PowerShell, Bash, Python, Node.js 等多种运行时。
- **热重载**: 修改 YAML 文件后自动生效，无需重启 VS Code。
- **无缝集成**: 兼容 GitHub Actions `composite` 语法。

> [!Tip]
> 自定义工具的 YAML 文件支持热重载，修改后会自动生效，无需重启 VS Code 或手动处置 Addi MCP Server 进程。
> 但因 VS Code 资源按需运行的基本原则，修改 yaml 模板文件后的 Copilot 工具列表将只会在 Chat 触发服务启动时发出 `list_tool` 并更新 UI 中显示的工具。或您可尝试通过命令面板执行 `MCP: List Server` 选中并手动启动服务来同步刚增加修改或删除的工具列表。

### 快速概览 Quick Overview

1. **创建工具文件**：在 `.addi/public/` (共享) 或 `.addi/private/` (私有) 目录下创建 `.yaml` 文件。
2. **定义工具**：
   ```yaml
   name: 'get-ip'
   description: 'Get public IP'
   runs:
     using: 'composite'
     steps:
       - run: curl -s http://ip-api.com/json/
         shell: bash
   ```
3. **使用工具**：在对话中直接询问 "Check my IP"。

### 非预期行为处置 Unexpected Behavior Handling (Preview)

Addi 提供了一个强大的正则表达式过滤系统，用于处理模型输出中的非预期行为。此功能在模型设置界面中配置，支持实时测试和验证。

#### 功能说明 Description

- **自定义正则表达式**: 配置正则表达式来匹配需要过滤或修改的内容（如非预期的工具调用格式）
- **实时验证**: 界面提供实时测试功能，可以立即验证正则表达式的有效性
- **多种处置方式**:
  - **重试**: 当匹配到设定的内容时，自动去除非法内容并重新发送请求以获取新的输出
  - **停止**: 当匹配到设定的内容时，停止当前请求等待用户进行后续操作
- **实时测试**: 在编辑器界面中可以输入测试内容并预览过滤效果
- **工具名匹配**: 支持针对特定工具名称进行 `RegExp Group` 匹配，以便更精确地控制过滤行为（无工具名则使用 `tool_choice: required` 重试）

> [!Tip]
>
> - 在配置正则表达式时，可以使用界面提供的测试区域输入示例文本，实时查看匹配结果和处置效果。
> - 尽量使用简短且高效的正则表达式，以减少对模型输出的影响。
> - 该功能适用于需要严格控制模型输出的场景，如过滤幻觉工具调用或危害信息。
> - 如出现不一致工具调用行为，可尝试同时减小 `Max Input Tokens` 以提升模型响应的稳定性。

#### 使用场景 Use Cases

1. **过滤幻觉工具调用**: 如果模型输出中经常包含错误的工具调用标签，可以使用正则表达式匹配这些标签并选择“重试”处置方式，以确保输出的准确性。
2. **危害信息处理**: 如果模型输出中可能包含危害信息，可以使用正则表达式匹配这些信息并选择“停止”处置方式，以防止不当内容的传播。

#### 安全警告 Warning

> [!Warning]
> 此功能处于 **预览阶段**，请谨慎使用并充分测试。
>
> - 正则表达式配置不当可能导致意外行为，建议先使用界面提供的测试功能验证
> - 过度使用可能影响模型输出的自然性和准确性
> - 请确保正则表达式不会误删或误改重要信息
> - 建议在生产环境使用前进行充分的测试

#### 配置示例 Configuration Example

在编辑器界面中：

1. 填写正则表达式（如 `<\s*tool_call\s*>.*?<\s*/\s*tool_call\s*>` 用于匹配错误的类似functionCall调用标签）
2. 选择处置方式（"重试"或"停止"）
3. 使用测试区域输入示例文本确认正则准确性
4. 保存配置后，Addi 会在模型输出时自动根据规则检查内容是否匹配并执行相应处置

## 中间件与存储架构 Middleware & Storage Architecture

### 中间件系统 Middleware System

Addi 实现了强大的中间件系统，用于处理 AI 模型消息和响应，特别擅长处理模型异常行为。

#### 核心组件 Core Components

```typescript
// 中间件核心接口
interface LLMCallContext {
  provider: Provider;
  modelId: string;
  model: Model;
}

interface MiddlewareResult {
  messages: ModelMessage[];
}
```

#### ToolCallCompatibilityMiddleware

提供全面的工具来处理模型异常行为：

**基于模式的内容过滤**

```typescript
interface ScrubSettings {
  enabled: boolean; // 是否启用
  patterns: string[]; // 正则表达式模式列表
  strategy: 'stop' | 'retry'; // 处置策略
  flags?: string; // 正则标志
  toolNameGroup?: number; // 工具名匹配组
}
```

**核心功能**：

- 可配置的正则表达式模式匹配
- 支持多个检测模式
- 按模型配置能力独立设置
- 检测到模式时自动重试

**配置示例**：

```typescript
const model = {
  id: 'gpt-4',
  capabilities: {
    scrubSettings: {
      enabled: true,
      patterns: ['<tool_call>.*?</tool_call>', 'DEBUG: .*'],
      strategy: 'retry',
      flags: 's',
    },
  },
};
```

#### 流式响应处理

中间件支持实时流式响应处理：

1. **文本增量处理**：过滤或修改文本内容
2. **工具调用检测**：识别和处理意外的工具调用
3. **工具结果处理**：验证和转换结果
4. **错误恢复**：检测到模式时自动重试

### 三层存储架构 Three-Tier Storage Architecture

Addi 采用三层存储架构分离关注点并提升安全性：

```text
┌──────────────────────────────────────────────────────────────┐
│                    Storage Architecture                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Config Layer (addi.providers)                         │  │
│  │  • Provider configurations                             │  │
│  │  • Model definitions                                   │  │
│  │  • Capability settings                                 │  │
│  │  • Sync: VS Code Settings Sync                         │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Stats Layer (addi.providers.stats)                    │  │
│  │  • Usage statistics                                    │  │
│  │  • Token counts                                        │  │
│  │  • Error rates                                         │  │
│  │  • Sync: Local only                                    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Secrets Layer (VS Code SecretStorage)                 │  │
│  │  • API keys                                            │  │
│  │  • Tokens                                              │  │
│  │  • Credentials                                         │  │
│  │  • Sync: Encrypted, platform-specific                  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### 配置层 Config Layer

**存储位置**：`vscode.workspace.globalState`

**数据类型**：

```typescript
interface ProviderConfig {
  id: string;
  name: string;
  providerType: 'openai' | 'anthropic' | 'google' | 'deepseek' | 'zhipu-ai' | 'minimax' | 'generic';
  apiEndpoint?: string;
  defaultModel?: string;
  models: ModelConfig[];
}

interface ModelConfig {
  id: string;
  name: string;
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  capabilities?: ModelCapabilities;
}
```

**特点**：

- 通过 VS Code Settings Sync 同步
- 可在多台机器间共享
- 包含供应商和模型配置
- 支持能力定义

#### 统计层 Stats Layer

**存储位置**：`vscode.workspace.globalState`

**数据类型**：

```typescript
interface ProviderStats {
  providerId: string;
  totalRequests: number;
  totalTokens: number;
  successCount: number;
  errorCount: number;
  lastUsed: Date;
}

interface ModelStats {
  modelId: string;
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  averageLatency: number;
}
```

**特点**：

- 本地存储
- 不跨机器同步
- 用于统计和分析
- 可独立清除

#### 密钥层 Secrets Layer

**存储位置**：`vscode.secretStorage`

**安全特性**：

- 平台特定加密（macOS Keychain, Windows 凭证管理器等）
- 绝不存储明文
- 扩展卸载时自动清除
- API 密钥在日志和 UI 中自动脱敏

**示例用法**：

```typescript
// 存储 API 密钥
await context.secrets.store(`addi.provider.${providerId}.apiKey`, apiKey);

// 检索 API 密钥
const apiKey = await context.secrets.get(`addi.provider.${providerId}.apiKey`);

// 删除 API 密钥
await context.secrets.delete(`addi.provider.${providerId}.apiKey`);
```

### API 密钥脱敏 API Key Masking

Addi 实现自动 API 密钥脱敏保护安全：

```typescript
function maskSecret(secret: string): string {
  if (secret.length >= 16) {
    // 显示前4位和后4位
    return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
  } else if (secret.length >= 8) {
    // 仅显示后4位
    return `****${secret.slice(-4)}`;
  } else {
    // 短密钥完全脱敏
    return '****';
  }
}
```

**示例**：

- `sk-proj-abc123def456...` → `sk-p***9012`
- `sk-abc12345` → `****2345`
- `sk-ab` → `****`

## 命令 Commands

| Command ID          | 标题                 | 用途                |
| ------------------- | -------------------- | ------------------- |
| `addi.manage`       | Management           | 打开管理视图        |
| `addi.exportConfig` | Export Configuration | 导出配置 (支持加密) |
| `addi.importConfig` | Import Configuration | 导入配置 (支持解密) |
| `addi.showLogs`     | Show Logs            | 打开 Addi 日志输出  |

> **注意**: 导出配置时，如果**不设置密码**，导出的 JSON 文件将**不包含**任何 API Key（为了安全）。如果需要备份或迁移 API Key，请务必设置导出密码，此时文件将以加密格式保存。

`Show Logs` 将在 VS Code 的 **输出 (Output)** 面板中定位 "Addi" 通道，可随时查看调试信息。日志内容会自动脱敏，并额外记录模型解析、请求选项等关键上下文，便于排查问题。

> 这些命令大多通过树视图右键或标题按钮触发，命令面板默认隐藏。

## 配置项 Settings Items

| Setting                         | 默认    | 说明                                                |
| ------------------------------- | ------- | --------------------------------------------------- |
| `addi.defaultMaxInputTokens`    | 4028    | 默认最大输入 tokens                                 |
| `addi.defaultMaxOutputTokens`   | 1024    | 默认最大输出 tokens                                 |
| `addi.defaultModelFamily`       | "Addi"  | 默认模型 family                                     |
| `addi.defaultModelVersion`      | "1.0.0" | 默认模型 version                                    |
| `addi.saveConfigToSettingsSync` | true    | 是否保存到 VSCode Settings Sync 云端                |
| `addi.sortRule`                 | "none"  | 排序规则 (none/alphabet/input tokens/output tokens) |
| `addi.sortTarget`               | "both"  | 排序目标 (providers/models/both)                    |

更改方法：VS Code 设置搜索 “addi” 或在视图标题中点击 Settings。

## 配置文件格式 Config Format

配置文件以 JSON 多维数组存储，每个供应商包含其模型列表：

```json
[
  {
    "id": "provider-id",
    "name": "OpenAI",
    "providerType": "openai",
    "description": "提供 GPT 系列模型",
    "website": "https://openai.com",
    "apiEndpoint": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "models": [
      {
        "id": "gpt-4",
        "name": "GPT-4",
        "family": "Addi",
        "version": "1.0.0",
        "maxInputTokens": 8192,
        "maxOutputTokens": 2048,
        "capabilities": {
          "imageInput": false,
          "toolCalling": false
        }
      }
    ]
  }
]
```

## 常见问题 FAQ

### Q: 为什么我添加的模型在 Copilot 中不可见？

A: 请确保：

1. 您已为供应商配置了 API 密钥
2. 您使用的是 GitHub Copilot 个人计划
3. 模型已正确添加并保存

### Q: 如何知道我的模型是否正在使用中？

A: 您可以在 Copilot 聊天界面的模型选择器中查看当前选中的模型。

### Q: 我可以添加多少个供应商和模型？

A: 扩展对供应商和模型数量没有硬性限制，但建议根据您的实际需求合理添加。

### Q: 我的自定义工具没有显示在 Copilot 的工具列表中？

A: 请确保：

1. 自定义工具的 YAML 文件位于正确的目录（`.addi/public/` 或 `.addi/private/`）。
2. 文件格式符合规范且无语法错误。
3. MCP 服务器已启动（修改 YAML 文件后，发起一次对话，或可通过执行 `MCP: Start Server` 命令手动启动）。

## 故障排除 Troubleshooting

| 问题                  | 排查步骤                                                           |
| --------------------- | ------------------------------------------------------------------ |
| 无法切换模型          | 重启 VS Code / 确认 Provider Key / 在模型管理面板勾选显示模型      |
| 无法在 Agent 模式使用 | 确认 Copilot 订阅等级 / 检查模型支持情况（官方要求需支持工具调用） |
| 新增的工具不显示      | 确认 YAML 语法正确 / 检查文件路径 / 确认 MCP 服务器已在运行        |
| 工具列表重复显示      | 重启 VS Code / 确认没有自编译版本的 Addi 插件及 MCP 服务正在运行   |
| 请求失败              | 查看 Addi 输出日志 & 控制台 / 校验 API Endpoint & Key              |
| 流式不工作            | Provider 是否支持 SSE；禁用流后重试                                |
| 配置未同步            | 检查 `addi.saveConfigToSettingsSync` 设置                          |
| 接口兼容性问题        | 检查 Provider 类型设置 / 查看日志了解请求细节 / 切换其他类型测试   |

## 许可证 License

MIT © 2026-present [deepwn](https://github.com/deepwn) — 详见 [LICENSE](LICENSE)。

## 免责声明 Disclaimer

本扩展仅提供客户端功能，使用第三方 / 自建 API 带来的数据与安全风险由使用者自行承担。我们不对直接或间接损失负责。

## 致谢 Thanks

- GitHub Copilot 团队与 VS Code 扩展生态
- OpenAI / Anthropic / Google 等公共 API 生态
- 所有提交 Issue / PR 的贡献者 🙌

---

欢迎 Star 支持项目，如果它对你有帮助！
