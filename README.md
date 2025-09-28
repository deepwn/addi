<div align="center">
  <img src="resources/icon-bg.min.png" width="96" alt="Addi Logo" />
  
  <h1>Addi — Extend GitHub Copilot with Your Own AI Providers</h1>
  <p><b>为 GitHub Copilot 添加自定义 AI 供应商与模型的 VS Code 扩展。</b><br/>Manage, switch and experiment with multiple AI providers & models seamlessly inside Copilot.</p>
  
  <p>
    <a href="https://github.com/deepwn/addi/releases"><img alt="Release" src="https://img.shields.io/github/v/release/deepwn/addi?logo=github" /></a>
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-green.svg" /></a>
    <a href="https://github.com/deepwn/addi/issues"><img alt="Issues" src="https://img.shields.io/github/issues/deepwn/addi" /></a>
    <a href="https://github.com/deepwn/addi/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/deepwn/addi" /></a>
  </p>
</div>

---

## 目录 Table of Contents

- [目录 Table of Contents](#目录-table-of-contents)
- [简介 Introduction](#简介-introduction)
- [特性 Features](#特性-features)
- [快速开始 Quick Start](#快速开始-quick-start)
- [安装 Installation](#安装-installation)
  - [Marketplace](#marketplace)
  - [本地 VSIX](#本地-vsix)
  - [从源码调试](#从源码调试)
- [使用概览 Usage Overview](#使用概览-usage-overview)
- [供应商与模型管理 Provider \& Model Management](#供应商与模型管理-provider--model-management)
  - [添加 Provider](#添加-provider)
  - [添加模型](#添加模型)
  - [快速编辑 API Key](#快速编辑-api-key)
  - [切换模型 (Copilot)](#切换模型-copilot)
  - [调试 Playground](#调试-playground)
- [配置项 Settings Configuration](#配置项-settings-configuration)
- [配置文件格式 Config File Format](#配置文件格式-config-file-format)
- [命令 Commands](#命令-commands)
- [Playground / 调试与流式输出](#playground--调试与流式输出)
- [常见问题 FAQ](#常见问题-faq)
- [Roadmap](#roadmap)
- [贡献 Contributing](#贡献-contributing)
- [发布与版本 Versioning](#发布与版本-versioning)
- [故障排除 Troubleshooting](#故障排除-troubleshooting)
- [许可证 License](#许可证-license)
- [免责声明 Disclaimer](#免责声明-disclaimer)
- [致谢 Thanks](#致谢-thanks)
- [要求](#要求)
- [安装](#安装)
- [使用方法](#使用方法)
  - [基本操作](#基本操作)
  - [添加供应商](#添加供应商)
  - [编辑供应商](#编辑供应商)
  - [快速编辑 API 密钥](#快速编辑-api-密钥)
  - [添加模型](#添加模型-1)
  - [编辑模型](#编辑模型)
  - [查看模型详情](#查看模型详情)
  - [使用模型（切换 Copilot 当前模型）](#使用模型切换-copilot-当前模型)
  - [模型调试面板](#模型调试面板)
  - [删除供应商或模型](#删除供应商或模型)
  - [导出配置](#导出配置)
  - [导入配置](#导入配置)
- [扩展设置](#扩展设置)
- [配置文件格式](#配置文件格式)
- [参数说明](#参数说明)
  - [供应商参数](#供应商参数)
  - [模型参数](#模型参数)
- [常见问题](#常见问题)
  - [Q: 为什么我添加的模型在 Copilot 中不可见？](#q-为什么我添加的模型在-copilot-中不可见)
  - [Q: 如何知道我的模型是否正在使用中？](#q-如何知道我的模型是否正在使用中)
  - [Q: 我可以添加多少个供应商和模型？](#q-我可以添加多少个供应商和模型)
- [发布说明](#发布说明)
  - [0.0.1](#001)
  - [最新版本](#最新版本)
- [故障排除](#故障排除)
- [支持和反馈](#支持和反馈)
- [开发](#开发)
- [打包 VSIX（vsce）](#打包-vsixvsce)
- [许可证](#许可证)
- [免责声明](#免责声明)
- [Playground 参数支持（最新扩展）](#playground-参数支持最新扩展)
  - [流式响应 (Streaming)](#流式响应-streaming)
  - [取消流式请求](#取消流式请求)
  - [参数持久化](#参数持久化)
  - [错误处理](#错误处理)
  - [测试覆盖](#测试覆盖)
  - [后续可扩展方向](#后续可扩展方向)

---

## 简介 Introduction

Addi 让你在 VS Code 中为 GitHub Copilot 添加自定义 / 第三方 / 自建 **AI Provider 与模型**，并在 Copilot 原生模型选择器中一键切换。它既是一个**模型管理器**，也是一个**交互式调试 Playground**。

> [!Tip]
> 完整利用自定义 Edit / Agent 模式可能需要 GitHub Copilot Pro 级别订阅；Free 版本主要用于 Ask / Chat。请确保账户权限满足需求。

## 特性 Features

| 类别            | 说明                                                          |
| --------------- | ------------------------------------------------------------- |
| Provider 管理   | 添加 / 编辑 / 删除 / 快速编辑 API Key                         |
| 模型管理        | 绑定于 Provider 的模型定义与特性标记（视觉 / 工具调用支持等） |
| 模型切换        | 在 Copilot 模型选择器中勾选后即可切换自定义模型               |
| 配置导入导出    | JSON 结构备份 / 迁移到其他机器                                |
| 可配置默认参数  | 默认 family / version / token 限制                            |
| UI / 树视图     | 直观的 ActivityBar 侧边栏管理界面                             |
| 右键上下文操作  | 针对 Provider / Model 的快捷操作                              |
| Playground 调试 | 发送消息、调节参数、实时查看日志                              |
| SSE 流式输出    | 支持 OpenAI 及兼容端点增量输出                                |
| 参数持久化      | 最近一次 Playground 参数自动恢复                              |
| 测试覆盖        | Streaming / 参数裁剪与持久化测试                              |

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

### Marketplace

搜索 “Addi” 并安装；或命令面板输入：`ext install addi`。

### 本地 VSIX

```powershell
npm install ; npm run vsix
code --install-extension addi.vsix  # 或用 VS Code 图形界面手动安装
```

### 从源码调试

```powershell
npm install
npm run watch
# 使用 F5 启动 Extension Development Host
```

## 使用概览 Usage Overview

Activity Bar 中的 Addi 图标 → 展开树：

- Provider 节点：右侧 inline 图标可快速添加模型 / 编辑密钥
- Model 节点：右键 “Use Model” 在 Copilot 中启用
- 顶部视图标题按钮：Add Provider / Export / Import / Settings

## 供应商与模型管理 Provider & Model Management

### 添加 Provider

1. 点击 “Add Provider”
2. 填写：名称 / 描述 / 网站 / API Endpoint / API Key / 接口类型(OpenAI 兼容等)
3. 保存后出现在列表

### 添加模型

1. 选中 Provider → Add Model
2. 填写：id / 名称(可选) / maxInputTokens / maxOutputTokens / 视觉支持 / 工具支持
3. 保存后挂载在对应 Provider 下

### 快速编辑 API Key

Provider 节点右侧钥匙图标 → 输入密钥 → 保存。

### 切换模型 (Copilot)

Copilot 侧边栏 → 模型下拉 → 管理模型 → 选择 Addi → 勾选自定义模型 → 返回选择该模型。

### 调试 Playground

模型右键 “Use Model” 打开面板：实时发送消息、试参数、看日志 & 流输出。

## 配置项 Settings Configuration

| Setting                         | 默认    | 说明                                 |
| ------------------------------- | ------- | ------------------------------------ |
| `addi.defaultMaxInputTokens`    | 4096    | 默认最大输入 tokens                  |
| `addi.defaultMaxOutputTokens`   | 1024    | 默认最大输出 tokens                  |
| `addi.defaultModelFamily`       | "Addi"  | 默认模型 family                      |
| `addi.defaultModelVersion`      | "1.0.0" | 默认模型 version                     |
| `addi.saveConfigToSettingsSync` | true    | 是否保存到 VSCode Settings Sync 云端 |

更改方法：VS Code 设置搜索 “addi” 或在视图标题中点击 Settings。

## 配置文件格式 Config File Format

导出得到 JSON 数组，每个 Provider 包含其模型列表：

```json
[
  {
    "id": "provider-id",
    "name": "OpenAI",
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
        "imageInput": false,
        "toolCalling": true
      }
    ]
  }
]
```

## 命令 Commands

| Command ID            | 标题                 | 用途                    |
| --------------------- | -------------------- | ----------------------- |
| `addi.manage`         | Manage Sidebar       | 打开管理视图            |
| `addi.addProvider`    | Add Provider         | 添加供应商              |
| `addi.editProvider`   | Edit Provider        | 编辑供应商              |
| `addi.deleteProvider` | Delete Provider      | 删除供应商              |
| `addi.addModel`       | Add Model            | 添加模型                |
| `addi.editModel`      | Edit Model           | 编辑模型                |
| `addi.deleteModel`    | Delete Model         | 删除模型                |
| `addi.useModel`       | Use Model            | 在 Copilot 里启用该模型 |
| `addi.editApiKey`     | Edit API Key         | 快速修改密钥            |
| `addi.exportConfig`   | Export Configuration | 导出所有配置            |
| `addi.importConfig`   | Import Configuration | 导入配置                |

> 这些命令大多通过树视图右键或标题按钮触发，命令面板默认隐藏。

## Playground / 调试与流式输出

支持参数：Temperature / Top P / Max Output Tokens / Presence Penalty / Frequency Penalty / System Prompt。参数在 workspaceState 中持久化。OpenAI 兼容端点支持 SSE 流式增量输出，可中途取消（AbortController）。不支持流的 Provider 自动回退普通请求。取消时追加 `[已取消]` 标记。

错误处理：网络 & API 错误以 `错误: <message>` 形式显示。参数超界会被裁剪到合法范围。

后续扩展方向：

- 更多 Provider 流式适配（Anthropic / Google 等）
- Markdown 渲染 + 代码高亮
- Token 消耗统计与速率提示
- 多参数 Profile 切换

## 常见问题 FAQ

**Q: 添加的模型在 Copilot 中不可见？**  
请检查：1) Provider 已配置 API Key；2) Copilot 订阅级别满足；3) 模型已勾选允许切换。

**Q: 如何确认当前使用的模型？**  
Copilot 模型下拉显示已选择的模型；切换时会出现确认消息。

**Q: 模型 / Provider 数量限制？**  
无硬性限制，建议按需精简，避免界面冗余。

## Roadmap

- [ ] 发布 VS Marketplace
- [ ] 添加更多 Provider 预设模板 (Anthropic / Google / Azure OpenAI)
- [ ] Provider 能力自动探测 (支持的最大 tokens / 工具调用 / 视觉)
- [ ] Token/Cost 估算与速率限制提示
- [ ] 多配置 Profile 与一键切换
- [ ] Markdown + 代码高亮渲染
- [ ] 更完善的单元测试矩阵 & 端到端测试

## 贡献 Contributing

欢迎 PR！

```bash
git clone https://github.com/deepwn/addi.git
cd addi
npm install
npm run watch   # 或直接 F5 调试
```

创建分支：`git checkout -b feat/awesome` → 提交 → PR。请保持提交信息清晰，并在需要时补充测试。

## 发布与版本 Versioning

遵循 [SemVer](https://semver.org/)。变更摘要见 [CHANGELOG.md](CHANGELOG.md)。首个可用版本为 0.0.1。

## 故障排除 Troubleshooting

| 问题         | 排查步骤                                        |
| ------------ | ----------------------------------------------- |
| 无法切换模型 | 重启 VS Code / 确认 Provider Key / 重新勾选模型 |
| 请求失败     | 查看输出 & 控制台日志 / 校验 API Endpoint & Key |
| 流式不工作   | Provider 是否支持 SSE；禁用流后重试             |
| 配置未同步   | 检查 `addi.saveConfigToSettingsSync` 设置       |

若仍失败：提交 Issue（附日志与复现步骤）。

## 许可证 License

MIT © 2024-present [deepwn](https://github.com/deepwn) — 详见 [LICENSE](LICENSE)。

## 免责声明 Disclaimer

本扩展仅提供客户端功能，使用第三方 / 自建 API 带来的数据与安全风险由使用者自行承担。我们不对直接或间接损失负责。

## 致谢 Thanks

- GitHub Copilot 团队与 VS Code 扩展生态
- OpenAI / Anthropic / Google 等公共 API 生态
- 所有提交 Issue / PR 的贡献者 🙌

---

欢迎 Star 支持项目，如果它对你有帮助！

## 要求

- Visual Studio Code 1.104.0 或更高版本
- GitHub Copilot 个人计划

> [!TIP]
> Edit/Agent 模式使用自定义 AI 模型需要 GitHub Copilot Pro 及以上计划，Free 版本仅支持内置模型和 Ask 模式。
> 请确保您已订阅相关内容，以使用此扩展自定义功能。

## 安装

1. 打开 Visual Studio Code
2. 按 `Ctrl+P` (Windows/Linux) 或 `Cmd+P` (macOS) 打开命令面板
3. 输入 `ext install addi`
4. 点击 "安装" 按钮
5. 安装完成后，重新启动 VS Code

## 使用方法

### 基本操作

1. 点击活动栏中的 "Addi" 图标打开侧边栏（或通过 Copilot 选择模型列表 → 管理模型 → Addi Settings 按钮）
2. 在侧边栏中，您可以查看所有已添加的供应商和模型并进行管理
3. 使用视图标题栏中的按钮添加供应商、导出配置、导入配置或打开设置

### 添加供应商

1. 点击侧边栏标题栏中的 "添加供应商" 按钮（+ 图标）
2. 依次填写以下参数：
   - **名称**（必填）：供应商的名称，例如 "OpenAI"
   - **描述**（可选）：供应商的描述信息，例如 "提供 GPT 系列模型"
   - **网站**（可选）：供应商的官方网站 URL，例如 "https://openai.com"
   - **接口类型**（可选）：选择供应商的接口类型，默认为 "OpenAI 兼容"
   - **API 端点**（可选）：供应商的 API 端点 URL，例如 "https://api.openai.com/v1"
   - **API 密钥**（可选）：访问供应商 API 所需的密钥，输入时以密码形式显示
3. 完成所有输入后，新供应商将出现在列表中

### 编辑供应商

1. 右键点击要编辑的供应商
2. 选择 "编辑" 选项
3. 修改所需信息并保存

### 快速编辑 API 密钥

1. 在供应商列表中，找到要编辑 API 密钥的供应商
2. 点击供应商右侧的密钥图标
3. 在弹出的对话框中输入新的 API 密钥
4. 点击确认保存

### 添加模型

1. 在供应商列表中，选中需要添加模型的供应商
2. 选择 "添加模型" 选项（或符号+）
3. 依次填写以下参数：
   - **id**（必填）：模型的唯一标识符，例如 "gpt-4"
   - **名称**（可选）：模型的名称，默认与 ID 相同，例如 "GPT-4"
   - **最大输入 Token 数**（可选）：模型可接受的最大输入 Token 数，例如 "4096"
   - **最大输出 Token 数**（可选）：模型可生成的最大输出 Token 数，例如 "1024"
   - **是否支持视觉处理**（可选）：如果模型支持视觉处理，请选择 "是"
   - **是否支持工具调用**（可选）：如果模型支持工具调用，请选择 "是"
   - **家族**（内建）：模型家族，默认为 "Addi"
   - **版本**（内建）：模型版本号，默认为 "1.0.0"
4. 完成所有输入后，新模型将添加到指定供应商下

### 编辑模型

1. 右键点击要编辑的模型
2. 选择 "编辑" 选项
3. 修改所需信息并保存

### 查看模型详情

1. 将鼠标悬停在模型上
2. 工具提示将显示模型的详细信息，包括名称、家族、版本、最大输入/输出 Token 数等

### 使用模型（切换 Copilot 当前模型）

1. 在官方 `Github Copilot` 侧边栏中，点击模型选择下拉菜单
2. 点击列表最下方 "管理模型" 选项
3. 在弹出供应商列表中选择 "Addi"
4. 在 Addi 模型列表中勾选允许切换的模型
5. 返回 Copilot 聊天界面，点击模型选择下拉菜单，选择刚才勾选的模型
6. 您将看见聊天框中出现您选择的自定义模型

> [!WARNING]
>
> 要调用模型，必须确保其供应商已配置正确的端点与密钥（如需），您可以在添加模型的最后一步发起测试，或点击模型列表右侧的测试按钮。

### 模型调试面板

调试面板提供一个交互式 Playground：

- 在模型上下文菜单中点击 "使用模型" 即可打开调试 Playground
- 在 Playground 中，您可以输入消息并发送给所选模型
- 模型的回复将显示在消息区，您可以测试请求和响应流程
- 右上角设置按钮（⚙️）允许调整参数，如 Temperature、Top P、Max Output Tokens 等
- 您对模型的参数设置将会持续保留，但对话日志将会在 playground 关闭后清空

### 删除供应商或模型

1. 右键点击要删除的供应商或模型
2. 选择 "删除" 选项
3. 确认删除操作

### 导出配置

1. 点击侧边栏标题栏中的 "导出配置" 按钮
2. 选择保存位置和文件名
3. 配置将以 JSON 格式保存

### 导入配置

1. 点击侧边栏标题栏中的 "导入配置" 按钮
2. 选择之前导出的配置文件
3. 确认是否覆盖现有配置

## 扩展设置

此扩展提供以下设置，您可以在 VS Code 设置中修改：

- `addi.defaultMaxInputTokens`: 默认最大输入 Token 数 (默认: 4096)
- `addi.defaultMaxOutputTokens`: 默认最大输出 Token 数 (默认: 1024)
- `addi.defaultModelFamily`: 默认模型家族 (默认: "Addi")
- `addi.defaultModelVersion`: 默认模型版本 (默认: "1.0.0")
- `addi.saveConfigToSettingsSync`: 是否将配置保存到 vscode 云端设置文件中 (默认: true)

要修改这些设置：

1. 打开 VS Code 设置 (`Ctrl+,` 或 `Cmd+,`)
2. 搜索 "addi"
3. 修改所需设置
4. 或者，点击侧边栏标题栏中的 "打开设置" 按钮

## 配置文件格式

导出的配置文件使用 JSON 格式，结构如下：

```json
[
  {
    "id": "供应商唯一ID",
    "name": "供应商名称",
    "description": "供应商描述",
    "website": "供应商网站",
    "apiEndpoint": "API端点URL",
    "apiKey": "API密钥",
    "models": [
      {
        "id": "模型唯一ID",
        "name": "模型名称",
        "family": "模型家族",
        "version": "模型版本",
        "maxInputTokens": "最大输入Token数",
        "maxOutputTokens": "最大输出Token数"
      }
    ]
  }
]
```

## 参数说明

### 供应商参数

| 参数     | 必填 | 说明                                   | 示例                      |
| -------- | ---- | -------------------------------------- | ------------------------- |
| 名称     | 是   | 供应商的名称，用于显示和识别           | OpenAI                    |
| 描述     | 否   | 供应商的描述信息，显示在供应商名称旁边 | 提供 GPT 系列模型         |
| 网站     | 否   | 供应商的官方网站 URL                   | https://openai.com        |
| API 端点 | 否   | 供应商的 API 端点 URL                  | https://api.openai.com/v1 |
| API 密钥 | 否   | 访问供应商 API 所需的密钥              | sk-...                    |

### 模型参数

| 参数              | 必填 | 说明                          | 示例       |
| ----------------- | ---- | ----------------------------- | ---------- |
| 名称              | 是   | 模型的名称，用于显示和识别    | GPT-4      |
| 家族              | 是   | 模型家族，用于分组相关模型    | GPT/openai |
| 版本              | 是   | 模型版本号                    | 4.0        |
| 最大输入 Token 数 | 是   | 模型可接受的最大输入 Token 数 | 8192       |
| 最大输出 Token 数 | 是   | 模型可生成的最大输出 Token 数 | 4096       |

## 常见问题

### Q: 为什么我添加的模型在 Copilot 中不可见？

A: 请确保：

1. 您已为供应商配置了 API 密钥
2. 您使用的是 GitHub Copilot 个人计划
3. 模型已正确添加并保存

### Q: 如何知道我的模型是否正在使用中？

A: 当您成功切换模型后，会收到确认消息。此外，您可以在 Copilot 聊天界面的模型选择器中查看当前选中的模型。

### Q: 我可以添加多少个供应商和模型？

A: 扩展对供应商和模型数量没有硬性限制，但建议根据您的实际需求合理添加。

## 发布说明

### 0.0.1

- 初始版本发布
- 支持添加、编辑和删除 AI 供应商和模型
- 支持配置导入/导出功能
- 添加自定义设置选项
- 实现直观的用户界面和上下文菜单

### 最新版本

- 添加供应商详细参数配置（名称、描述、网站、API 端点、API 密钥）
- 实现 API 密钥快速编辑功能
- 添加模型详情查看功能
- 实现模型快速切换功能
- 改进用户界面和交互体验
- 修复与 VS Code Copilot 的兼容性问题

## 故障排除

如果您遇到任何问题，请尝试以下步骤：

1. 重新启动 VS Code
2. 禁用然后重新启用扩展
3. 检查 VS Code 控制台是否有错误消息
4. 确保您使用的是支持的 VS Code 版本
5. 确保您已为供应商配置了有效的 API 密钥

## 支持和反馈

如果您有任何问题、建议或功能请求，请通过以下方式联系我们：

- 在 GitHub 上创建问题: [Addi AI Issues](https://github.com/your-username/addi/issues)

## 开发

如果您想为这个项目做贡献，请按照以下步骤操作：

1. Fork 此仓库
2. 创建您的功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交您的更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 打包 VSIX（vsce）

您可以使用 vsce 将此扩展打包为 .vsix 文件，方便离线安装或发布。

前置准备：

- 在 `package.json` 中设置 `publisher` 字段（本项目已设置为 `addi`）。
- 已安装 Node.js 和 npm。

两种方式使用 vsce：

1. 使用项目内依赖（推荐）

- 我们在 devDependencies 中加入了 `vsce`。执行打包脚本：

```powershell
npm install ; npm run vsix
```

2. 使用 npx 临时执行（可选）

```powershell
npm run package ; npx vsce package
```

脚本会先运行 `webpack` 生成 `dist/extension.js`，随后使用 `vsce package` 生成 VSIX 包（如 `addi-0.0.1.vsix`）。

常见问题：

- 缺少 `publisher`：请在 `package.json` 顶层添加 `"publisher": "your-publisher"`。
- 包体过大：请检查根目录 `.vscodeignore` 是否正确排除了 `src/`、`test/`、`.vscode/`、`node_modules/` 等不需要的内容。
- 需要签名/发布到 Marketplace：请参考 vsce 文档执行 `vsce login <publisher>` 后再 `vsce publish`。

## 许可证

本项目采用 MIT 许可证 - 有关详细信息，请查看 [LICENSE](LICENSE) 文件。

## 免责声明

使用本项目时，您需自行承担风险。我们不对因使用本项目而导致的任何直接或间接损失负责。

## Playground 参数支持（最新扩展）

Playground 目前支持以下可调节参数（通过折叠的“参数设置”面板）：

- Temperature (0 ~ 2)
- Top P (0 ~ 1)
- Max Output Tokens (1 ~ 8192，按 Provider 能力有效)
- Presence Penalty (-2 ~ 2)
- Frequency Penalty (-2 ~ 2)
- System Prompt（可选，作为对话第一条 system 消息）

参数变更通过前端向扩展发送 `playgroundSetParams` 消息；发送消息时使用最新参数集合调用后端 `invokeChatCompletion`。不被某些 Provider 支持的字段将被安全忽略。OpenAI 及兼容端点会收到 `top_p / presence_penalty / frequency_penalty`，Google 端点映射为 `topP`，Anthropic 目前仅使用 temperature / top_p（若其版本支持）与 max_tokens。

### 流式响应 (Streaming)

Playground 现在支持对 OpenAI / OpenAI 兼容端点进行 **SSE 流式输出**：

1. 在“参数设置”面板勾选 `Streaming`（默认已勾选）。
2. 发送消息后，模型回复将逐字增量出现在最新的 assistant 消息块中。
3. 最终完成后该消息被标记为 `data-stream-final`（内部属性）。

不支持流的 Provider（如当前的 Anthropic / Google 非兼容接口）会回退到普通非流式调用或返回错误提示。

### 取消流式请求

流式生成过程中可点击“取消”按钮：

- 前端发送 `playgroundAbort` 消息，后端使用 `AbortController` 终止 Fetch。
- 被取消的响应会在消息区显示 `[已取消]`。
- 取消后可立即再次发送新请求。

### 参数持久化

Playground 使用 `workspaceState` 保存最近一次使用的参数集合（temperature / topP / maxOutputTokens / presencePenalty / frequencyPenalty / systemPrompt）。关闭并重新打开 VS Code 或新开 Playground 面板时会自动加载。

### 错误处理

- 网络 / API 错误会追加一条 `错误: <message>`。
- 取消操作返回 `aborted` 并被格式化为 `[已取消]`。

### 测试覆盖

新增测试：

- `streaming.test.ts`：验证 `parseSseLine` 与 `streamChatCompletion` 的增量拼接逻辑。
- `persistence.test.ts`：验证参数裁剪与持久化规则（范围、上下限与空白处理）。

执行命令（开发环境）：

```powershell
npm install
npm test
```

### 后续可扩展方向

- Anthropic / Google 流式接入
- 前端 markdown 渲染（代码高亮）
- Token 计数与速率限制提示
- 参数预设多配置集（保存/切换多个 profile）
