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
- [命令 Commands](#命令-commands)
- [配置项 Settings Items](#配置项-settings-items)
- [配置文件格式 Config Format](#配置文件格式-config-format)
- [调试游乐场 Debug Playground](#调试游乐场-debug-playground)
- [常见问题 FAQ](#常见问题-faq)
  - [Q: 为什么我添加的模型在 Copilot 中不可见？](#q-为什么我添加的模型在-copilot-中不可见)
  - [Q: 如何知道我的模型是否正在使用中？](#q-如何知道我的模型是否正在使用中)
  - [Q: 我可以添加多少个供应商和模型？](#q-我可以添加多少个供应商和模型)
- [故障排除 Troubleshooting](#故障排除-troubleshooting)
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

### 插件市场 Marketplace

搜索 “Addi” 并安装；或命令面板输入：`ext install addi`。

### 本地 VSIX

```powershell
yarn install; yarn vsix
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

### 快速编辑 Edit API Key

Provider 节点右侧钥匙图标 → 输入密钥 → 保存。

### 切换模型 Switch Model

Copilot 侧边栏 → 模型下拉 → 管理模型 → 选择 Addi → 勾选自定义模型 → 返回选择该模型。

## 命令 Commands

| Command ID          | 标题                 | 用途         |
| ------------------- | -------------------- | ------------ |
| `addi.manage`       | Management           | 打开管理视图 |
| `addi.exportConfig` | Export Configuration | 导出配置     |
| `addi.importConfig` | Import Configuration | 导入配置     |

> 这些命令大多通过树视图右键或标题按钮触发，命令面板默认隐藏。

## 配置项 Settings Items

| Setting                         | 默认    | 说明                                 |
| ------------------------------- | ------- | ------------------------------------ |
| `addi.defaultMaxInputTokens`    | 4096    | 默认最大输入 tokens                  |
| `addi.defaultMaxOutputTokens`   | 1024    | 默认最大输出 tokens                  |
| `addi.defaultModelFamily`       | "Addi"  | 默认模型 family                      |
| `addi.defaultModelVersion`      | "1.0.0" | 默认模型 version                     |
| `addi.saveConfigToSettingsSync` | true    | 是否保存到 VSCode Settings Sync 云端 |

更改方法：VS Code 设置搜索 “addi” 或在视图标题中点击 Settings。

## 配置文件格式 Config Format

配置文件以 JSON 多维数组存储，每个供应商包含其模型列表：

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

| 问题         | 排查步骤                                        |
| ------------ | ----------------------------------------------- |
| 无法切换模型 | 重启 VS Code / 确认 Provider Key / 重新勾选模型 |
| 请求失败     | 查看输出 & 控制台日志 / 校验 API Endpoint & Key |
| 流式不工作   | Provider 是否支持 SSE；禁用流后重试             |
| 配置未同步   | 检查 `addi.saveConfigToSettingsSync` 设置       |

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
