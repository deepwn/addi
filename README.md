<center style="text-align: center; background-color: lightblue; padding: 40px 40px; border-radius: 10px; margin-bottom: 20px;">
  <img src="resources/icon-bg.min.png" width="128" height="128" alt="Addi Logo" />

  <h1>Addi — Extend Your VS Code Copilot</h1>
  <p><b>为 GitHub Copilot 添加自定义 AI 供应商与模型的 VS Code 扩展</b></p>
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
  - [快速编辑 Edit API Key](#快速编辑-edit-api-key)
  - [切换模型 Switch Model](#切换模型-switch-model)
- [自定义工具 Custom Tools](#自定义工具-custom-tools)
- [命令 Commands](#命令-commands)
- [配置项 Settings Items](#配置项-settings-items)
- [配置文件格式 Config Format](#配置文件格式-config-format)
- [调试游乐场 Debug Playground](#调试游乐场-debug-playground)
- [常见问题 FAQ](#常见问题-faq)
  - [Q: 为什么我添加的模型在 Copilot 中不可见？](#q-为什么我添加的模型在-copilot-中不可见)
  - [Q: 如何知道我的模型是否正在使用中？](#q-如何知道我的模型是否正在使用中)
  - [Q: 我可以添加多少个供应商和模型？](#q-我可以添加多少个供应商和模型)
- [故障排除 Troubleshooting](#故障排除-troubleshooting)
- [开发 Development](#开发-development)
  - [环境准备](#环境准备)
  - [开发命令](#开发命令)
  - [清理缓存](#清理缓存)
- [许可证 License](#许可证-license)
- [免责声明 Disclaimer](#免责声明-disclaimer)
- [致谢 Thanks](#致谢-thanks)

---

## 简介 Introduction

Addi 让你在 VS Code 中为 GitHub Copilot 添加自定义 / 第三方 / 自建 **AI Provider 与模型**，并在 Copilot 原生模型选择器中一键切换。它既是一个**模型管理器**，也是一个**交互式调试 Playground**。

> [!Tip]
> 虽然 vscode 官方有支持自定义模型的计划，但目前仍未开放给大众用户，Addi 作为一个临时解决方案，可以帮助你快速上手并测试各种模型。详见 [Bring Your Own Language Model](https://code.visualstudio.com/docs/copilot/customization/language-models#_bring-your-own-language-model-key) 以及 [Use an OpenAI-Compatible Model](https://code.visualstudio.com/docs/copilot/customization/language-models#_use-an-openaicompatible-model)。

## 特性 Features

| 类别            | 说明                                                          |
| --------------- | ------------------------------------------------------------- |
| Provider 管理   | 添加 / 编辑 / 复制 / 删除 / 快速编辑 API Key                  |
| 模型管理        | 绑定于 Provider 的模型定义与特性标记（视觉 / 工具调用支持等） |
| 智能模型验证    | 自动检测连通性、视觉能力、工具调用支持和 Token 限制           |
| 模型切换        | 在 Copilot 模型选择器中勾选后即可切换自定义模型               |
| 配置导入导出    | JSON 结构备份 / 迁移到其他机器                                |
| 可配置默认参数  | 默认 family / version / token 限制                            |
| 排序选项        | 支持按字母、输入/输出 Token 数排序供应商和模型                |
| UI / 树视图     | 直观的 ActivityBar 侧边栏管理界面                             |
| 右键上下文操作  | 针对 Provider / Model 的快捷操作                              |
| Playground 调试 | 发送消息、调节参数、实时查看日志                              |
| SSE 流式输出    | 支持 OpenAI 及兼容端点增量输出                                |
| 参数持久化      | 最近一次 Playground 参数自动恢复                              |
| 测试覆盖        | Streaming / 参数裁剪与持久化测试                              |
| 日志输出        | 专用 output channel 与可调 Log Level                          |

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

- Provider 节点：右侧 ＋ 图标可快速添加模型 / 编辑密钥
- Model 节点：右键 “Use Model” 在 Copilot 中启用
- 顶部视图标题按钮：Add Provider / Export / Import / Settings

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
> 如果不确定模型的 Token 限制，可以将 `Max Input Tokens` 和 `Max Output Tokens` 留空（或设为`?`），点击 Verify & Detect 后 Addi 会自动探测并填入建议值。
> 所有附属能力（视觉 / 工具调用）也会在验证过程中自动测试并更新勾选（不适配则会自动去除勾选）。

### 快速编辑 Edit API Key

Provider 节点右侧钥匙图标 → 输入密钥 → 保存。

### 复制 Copy

在 Provider 或 Model 节点上右键点击 **"Copy"**，可以快速复制一份配置（名称会自动添加 "Copy" 后缀），便于快速创建相似配置。

### 切换模型 Switch Model

Copilot 侧边栏 → 模型下拉 → 管理模型 → 选择 Addi → 勾选自定义模型 → 返回选择该模型。

## 自定义工具 Custom Tools

Addi 允许你通过文件方式定义自定义工具，让 AI 模型能够执行本地命令或发送 HTTP 请求。为了便于管理与保密，工具放置在工作区的 `.addi` 目录下，分为两个子目录：

- `.addi/public`：公开工具（推荐放置可共享或无敏感信息的工具定义）。
- `.addi/private`：私有工具（推荐放置包含密钥或敏感参数的工具定义；Addi 会在检测到 Git 仓库时提示将 `.addi/private` 加入 `.gitignore`）。

支持文件后缀：`.yml` 与 `.yaml`。

使用方法：

1. 在工作区中创建文件 `./.addi/public/my-tool.yml` 或 `./.addi/private/my-secret-tool.yml`。
2. 文件内容为 YAML 格式的工具定义，示例：

```yaml
name: echoTool
description: "Echo a message back"
inputs:
  message:
    description: "The message to echo"
    required: true
steps:
  - name: default
    command: echo
    args: ["${message}"]
```

字段说明：

- `name`：工具标识符，会发送给模型作为可调用工具名。
- `description`：简短描述，帮助模型判断何时调用该工具（会发送给模型）。
- `inputs` / `parameters`：工具参数定义（简化格式会转换为 JSON Schema）。
- `steps`：执行步骤数组，推荐使用结构化 `command` + `args` 形式：

  ```yaml
  steps:
    - name: default
      command: echo
      args: ["${message}"]
  ```

  系统仍向后兼容旧的 `run: "echo ${message}"` 字符串形式，但推荐使用结构化格式以避免 shell 注入与解析歧义。

> [!Warning] 不应该随意使用未经过验证的其他人提供的工具定义，以免引入安全风险。请在使用前仔细审查工具内容。

在与 Copilot 对话时，如果模型发起 `tool-call`，Addi 会尝试：

- 首先将调用转发给 VS Code 提供的工具（如果存在）；
- 否则在工作区已注册的自定义工具中查找并执行相应步骤，并将命令输出或错误作为 `tool-result` 返回给模型（同时也会附带一条人类可读的错误提示，提升模型自动重试或改用替代策略的概率）。

## 自定义工具 Custom Tools

Addi 支持通过 YAML 文件定义自定义工具，这些工具可以被模型调用以执行本地命令或 HTTP 请求。

### 目录结构

工具文件存放在工作区的 `.addi` 目录下：

- `.addi/public/`: 公共工具，可以提交到版本控制。
- `.addi/private/`: 私有工具，包含敏感信息，建议在 `.gitignore` 中忽略。

### 工具定义格式

支持简单的单行命令和复杂的脚本执行。

#### 示例 1: 简单命令 (Legacy)

```yaml
name: my_tool
description: A simple tool
steps:
  - run: echo "Hello World"
```

#### 示例 2: 多步骤脚本 (New)

支持指定 `shell` (如 `node`, `python`, `bash`, `powershell`) 和环境变量 `env`。

```yaml
name: get_netinfo
description: Get network information
steps:
  - name: Start
    run: echo "Starting analysis..."

  - name: Run Script
    shell: node
    env:
      MY_VAR: "some value"
    run: |
      const os = require('os');
      console.log('Platform: ' + os.platform());
      console.log('Env Var: ' + process.env.MY_VAR);
```

#### 示例 3: HTTP 请求

```yaml
name: get_ip
description: Get public IP
inputs:
  ip:
    description: IP address (optional)
    default: ""
steps:
  - http:
      url: http://ip-api.com/json/${{ inputs.ip }}
      method: GET
```

### 变量替换

支持使用 `${{ inputs.variable }}` 语法引用输入参数（类似 GitHub Actions）。

安全提示：

- 把包含敏感信息的工具放入 `.addi/private`，并接受 Addi 的 `.gitignore` 提示以避免将私密内容提交到代码仓库；
- 工具定义中尽量避免将长期有效凭据以明文形式写入文件，建议使用环境变量或外部秘密管理器结合运行时注入。

## 命令 Commands

| Command ID          | 标题                 | 用途                |
| ------------------- | -------------------- | ------------------- |
| `addi.manage`       | Management           | 打开管理视图        |
| `addi.exportConfig` | Export Configuration | 导出配置 (支持加密) |
| `addi.importConfig` | Import Configuration | 导入配置 (支持解密) |
| `addi.showLogs`     | Show Logs            | 打开 Addi 日志输出  |

> **注意**: 导出配置时，如果**不设置密码**，导出的 JSON 文件将**不包含**任何 API Key（为了安全）。如果需要备份或迁移 API Key，请务必设置导出密码，此时文件将以加密格式保存。

`Show Logs` 将在 VS Code 的 **输出 (Output)** 面板中定位 “Addi” 通道，可随时查看调试信息。通过 `Set Log Level` 或在设置中修改 `addi.logLevel`，即可在 `off / error / warn / info / debug` 之间切换输出详细程度。
日志内容会自动脱敏，并额外记录模型解析、请求选项等关键上下文，便于排查问题。

> 这些命令大多通过树视图右键或标题按钮触发，命令面板默认隐藏。

## 配置项 Settings Items

| Setting                         | 默认    | 说明                                                |
| ------------------------------- | ------- | --------------------------------------------------- |
| `addi.defaultMaxInputTokens`    | 65535   | 默认最大输入 tokens                                 |
| `addi.defaultMaxOutputTokens`   | 65535   | 默认最大输出 tokens                                 |
| `addi.defaultModelFamily`       | "Addi"  | 默认模型 family                                     |
| `addi.defaultModelVersion`      | "1.0.0" | 默认模型 version                                    |
| `addi.saveConfigToSettingsSync` | true    | 是否保存到 VSCode Settings Sync 云端                |
| `addi.logLevel`                 | warn    | 控制 Addi 输出通道的最低日志级别                    |
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

## 调试游乐场 Debug Playground

提供交互式调试界面，发送消息、调节参数、查看日志。现阶段主要用于测试与调试自定义模型，未来可能集成更多功能。

支持设定参数：Temperature / Top P / Max Output Tokens / Presence Penalty / Frequency Penalty / System Prompt。参数在 workspaceState 中持久化。OpenAI 兼容端点支持 SSE 流式增量输出，可中途取消（AbortController）。不支持流的 Provider 自动回退普通请求。

后续扩展方向：

- 更多 Provider 流式适配（Anthropic / Google 等）
- Markdown 渲染 + 代码高亮
- Token 消耗统计与速率提示
- 多参数 Profile 切换

## 常见问题 FAQ

### Q: 为什么我添加的模型在 Copilot 中不可见？

A: 请确保：

1. 您已为供应商配置了 API 密钥
2. 您使用的是 GitHub Copilot 个人计划
3. 模型已正确添加并保存

### Q: 如何知道我的模型是否正在使用中？

A: 当您成功切换模型后，会收到确认消息。此外，您可以在 Copilot 聊天界面的模型选择器中查看当前选中的模型。

### Q: 我可以添加多少个供应商和模型？

A: 扩展对供应商和模型数量没有硬性限制，但建议根据您的实际需求合理添加。

## 故障排除 Troubleshooting

| 问题         | 排查步骤                                              |
| ------------ | ----------------------------------------------------- |
| 无法切换模型 | 重启 VS Code / 确认 Provider Key / 重新勾选模型       |
| 请求失败     | 查看 Addi 输出日志 & 控制台 / 校验 API Endpoint & Key |
| 流式不工作   | Provider 是否支持 SSE；禁用流后重试                   |
| 配置未同步   | 检查 `addi.saveConfigToSettingsSync` 设置             |

## 许可证 License

MIT © 2025-present [deepwn](https://github.com/deepwn) — 详见 [LICENSE](LICENSE)。

## 免责声明 Disclaimer

本扩展仅提供客户端功能，使用第三方 / 自建 API 带来的数据与安全风险由使用者自行承担。我们不对直接或间接损失负责。

## 开发 Development

### 环境准备

```powershell
git clone https://github.com/deepwn/addi.git
cd addi
npm install
```

### 开发命令

```bash
# 编译
npm run compile

# 开发模式监听
npm run watch

# 运行测试
npm test

# 打包扩展
npm run package

# 清理缓存和构建文件
npm run clean

# 快速清理（无详细信息）
npm run clean:fast
```

### 清理缓存

项目包含清理命令来节省磁盘空间：

```bash
npm run clean  # 完整清理，显示详细信息
npm run clean:fast  # 快速清理
```

详细说明请参考 [CLEANING.md](CLEANING.md)。

## 致谢 Thanks

- GitHub Copilot 团队与 VS Code 扩展生态
- OpenAI / Anthropic / Google 等公共 API 生态
- 所有提交 Issue / PR 的贡献者 🙌

---

欢迎 Star 支持项目，如果它对你有帮助！
