---
description: Apply when working on the Addi VS Code extension codebase
applyTo: "src/**/*.ts"
---

# Addi 开发规范

> 适用于所有 AI Agent 在 Addi 项目中生成、审查或修改代码时遵循。

---

## 项目概述

Addi 是一个 VS Code 扩展，作为 VS Code 原生 BYOK（Bring Your Own Key）系统的可视化编辑器。它管理 `chatLanguageModels.json` 文件，提供树视图和 Webview 面板来创建/编辑 AI Provider 和 Model。**零运行时依赖**——所有 AI 通信均由 VS Code Copilot 原生处理。

**核心能力**：Provider/Model CRUD、远程模型列表获取、预设快速添加、树视图展示、Webview 可视化编辑、i18n 中英双语。

---

## 开发环境

| 要求    | 版本       | 说明           |
| ------- | ---------- | -------------- |
| VS Code | `^1.125.0` | BYOK API 支持  |
| Bun     | 最新版     | 运行时和包管理 |
| Windows | PowerShell | 终端环境       |

> **注意**：本项目使用 **Bun** 作为包管理器和运行时，不使用 npm/yarn/pnpm。

---

## 常用命令

```powershell
bun install            # 安装依赖
bun run watch          # 开发模式（监听编译）
bun run build          # 构建（编译 + 打包 VSIX）
bun run clean          # 清理构建产物
bun run lint           # oxlint 检查
bun run lint:fix       # oxlint 自动修复
bun run format         # oxfmt 格式化
bun run format:check   # oxfmt 检查（CI 用）
bun run release:github # 发布到 GitHub Release
```

按 `F5` 启动 Extension Development Host 调试。

---

## 代码规范

### 命名

| 类型      | 规范             | 示例                               |
| --------- | ---------------- | ---------------------------------- |
| 类/接口   | PascalCase       | `ProviderModelManager`, `ByokFileManager` |
| 方法/变量 | camelCase        | `getProviders()`, `modelList`      |
| 常量      | UPPER_SNAKE_CASE | `DEFAULT_MAX_TOKENS`               |
| 文件      | kebab-case       | `byok-file-manager.ts`             |

### 日志

```typescript
import { logger, LogScope } from "./common/logger";

logger.debug("Debug info", { data: "value" }, LogScope.VIEW);
logger.info("Info message");
logger.warn("Warning message");
logger.error("Error message", error, "ComponentName");
```

日志查看：`Ctrl+Shift+U` → Output 面板 → 选择 "Addi"。

### 类型

- 优先 `interface` 用于可扩展类型
- 使用 `type` 用于联合类型、交叉类型
- 避免 `any`，使用 `unknown` 替代

### 错误处理

```typescript
try {
  const result = await someAsyncOperation();
  return result;
} catch (error) {
  logger.error("Operation failed", error, "ComponentName");
  throw error;
}
```

---

## 项目架构

```
VS Code 启动
  └─ extension.ts:activate()
       ├─ ByokFileManager         (读写 %APPDATA%/Code/User/chatLanguageModels.json)
       ├─ ProviderModelManager    (CRUD 适配器)
       ├─ AddiTreeDataProvider    (侧边栏树视图)
       ├─ CommandHandler          (命令路由 → Provider/Model/Config 处理器)
       ├─ EditorViewManager       (Webview 面板: React ProviderForm/ModelForm)
       └─ 12 个已注册命令
```

| 层级         | 目录                 | 职责                       |
| ------------ | -------------------- | -------------------------- |
| Presentation | `src/presentation/`  | UI、命令、视图、Webview    |
| Core         | `src/core/`          | ProviderModelManager 数据层 |
| Services     | `src/services/`      | BYOK 文件管理、远程获取    |
| Common       | `src/common/`        | 日志、通用工具             |

### 核心组件

| 组件                 | 文件                                         | 职责                    |
| -------------------- | -------------------------------------------- | ----------------------- |
| ByokFileManager      | `src/services/byokFileManager.ts`            | chatLanguageModels.json 读写 |
| ProviderModelManager | `src/core/providers/ProviderModelManager.ts` | Provider/Model CRUD     |
| EditorViewManager    | `src/presentation/views/editorView.ts`       | Webview 面板管理        |
| AddiTreeDataProvider | `src/presentation/views/providerView.ts`     | 侧边栏树视图            |
| CommandHandler       | `src/presentation/commands/index.ts`         | 命令路由门面            |

### 数据流

```
用户操作 → CommandHandler/EditorViewManager
              ↓
         ProviderModelManager
              ↓
         ByokFileManager → chatLanguageModels.json
              ↓
         VS Code Copilot BYOK 引擎 (自动加载模型)
```

---

## VS Code Proposed API

项目使用以下 Proposed API，类型定义位于 `typings/proposedApi/`：

- `chatParticipantPrivate` — Chat 子代理、权限
- `languageModelThinkingPart` — Thinking/Reasoning 支持
- `toolInvocationApproveCombination` — 工具调用审批

> Proposed API 可能随 VS Code 版本变化，需关注更新。

---

## 工具链

| 工具           | 用途                        | 配置文件                      |
| -------------- | --------------------------- | ----------------------------- |
| **Bun**        | 包管理 + 运行时             | `bun.lock`                    |
| **oxlint**     | 代码检查（替代 ESLint）     | `.oxlintrc.json`              |
| **oxfmt**      | 代码格式化（替代 Prettier） | `.oxfmtrc.json`               |
| **TypeScript** | 类型检查                    | `tsconfig.json`               |
| **bun build**  | 构建打包                    | 内置于 `package.json` scripts |

---

## 开发注意事项

### 核心规则

1. 新增存储键必须使用 `addi.` 前缀
2. 敏感数据（API Key）只存 SecretStorage，不存 Memento
3. 使用 `model.rid` 调用 AI SDK，`model.id` 用于内部管理
4. 日志中使用 `maskSecret()` 脱敏 API Key
5. 错误消息需对用户友好
6. 不要硬编码 API Key 或密码

### 添加新命令

1. 在 `src/presentation/commands/` 对应文件中添加命令处理函数
2. 在 `src/presentation/extension.ts` 中注册命令

### 添加新类型

1. 在 `src/common/types/` 对应文件中添加类型定义
2. 通过 `src/common/types/index.ts` barrel export

---

## 参考文档

| 文档        | 路径                                     | 说明                           |
| ----------- | ---------------------------------------- | ------------------------------ |
| 用户指南    | `docs/DOCUMENTATION.md`                  | 安装、配置、使用               |
| 架构规范    | `docs/architecture-spec.md`              | 分层、数据流、核心设计约束     |
| 编码规范    | `docs/coding-standards.md`               | 类型安全、日志、错误处理等约束 |
| AI SDK      | `docs/ai-sdk-reference.md`               | AI SDK v6 API                  |
| VS Code API | `docs/vscode-reference.md`               | VS Code Copilot API            |
| 加密导出    | `docs/encrypted-config-export-import.md` | 加密功能说明                   |
