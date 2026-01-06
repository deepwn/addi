# Addi 插件优化计划 (Optimization Plan)

本文档详细记录了在日志分析和代码审查中发现的问题、优化策略、实施步骤以及验证方法。

## 1. 已完成的优化 (Completed)

- [x] **修复重复注册问题**: 统一了 MCP Server 在 `package.json` 和代码中的注册名称。
- [x] **重构 MCP 服务架构**: 实现了双实例模式（VS Code 公共进程 + Addi 私有进程），解耦了生命周期管理。
- [x] **消除文件监听冲突**: 确认了 Go 后端 `--watch` 与 JS 前端 `CustomToolManager` 的职责边界。
- [x] **冗余代码清理**: 移除了 `McpServerService` 中未使用的手动进程管理代码。
- [x] **语法错误修复**: 修正了 `McpServerService` 中的 Lint 错误。

## 2. 架构重构计划 (Refactoring Plan)

目标：将物理代码结构与 `PROJECT_DESIGN.md` 中定义的四层架构对齐。

### 阶段 1: 目录结构调整 (Re-structuring)

- [x] **创建新目录**:
    - `src/presentation/` (包含 views, commands)
    - `src/core/` (包含 llm, providers 逻辑)
    - `src/infrastructure/` (包含 mcp, storage)
    - `src/common/` (包含 logger, utils, types)

- [x] **迁移文件 (Migration)**:
    - 移动 `src/views/*` -> `src/presentation/views/`
    - 移动 `src/commands.ts` -> `src/presentation/commands.ts`
    - 移动 `src/services/llmService.ts`, `src/services/aiRegistry.ts`, `src/services/messageConverter.ts` -> `src/core/llm/`
    - 移动 `src/provider.ts` -> `src/core/providers/ProviderModelManager.ts`
    - 移动 `src/model.ts` -> `src/core/providers/AddiChatProvider.ts`
    - 移动 `src/services/mcpServerService.ts`, `src/services/customToolManager.ts` -> `src/infrastructure/mcp/`
    - 移动 `src/services/storageService.ts` -> `src/infrastructure/storage/`
    - 移动 `src/logger.ts`, `src/types.ts` -> `src/common/`
    - 移动 `src/utils/*` -> `src/common/utils/`

- [x] **修复引用 (Fix Imports)**: 更新所有文件的 import 路径以适应新结构。
- [x] **环境配置 (Configuration)**: 更新 `package.json` 的 `main` 入口和 `scripts` 构建命令。

### 阶段 2: 代码解耦与清理 (Decoupling)

- [x] **Extension Entry 精简**: `extension.ts` 已重构。
    - 移除了 MCP 注册逻辑到 `src/presentation/mcpIntegration.ts`。
    - 移除了 MCP 命令注册逻辑。
    - 通过 `McpExtensionIntegration` 类封装了 MCP 相关功能的初始化。
- [x] **依赖检查**: 确认了各层之间的依赖关系基本符合分层架构 (Presentation -> Core -> Infrastructure -> Common)。

### 阶段 3: 深度架构优化 (Sustainable Architecture)

- [x] **定义接口层 (Interfaces)**: 在 `src/common/interfaces.ts` 中定义了 Core 所需的服务接口 (`IToolManager`, `IMcpService`, `IStorageService`)。
- [x] **依赖倒置 (DIP)**:
    - 核心业务类 `LLMService` 和 `ProviderModelManager` 不再依赖具体的 Infrastructure 类，而是依赖接口。
    - Infrastructure 类实现这些接口。
- [x] **依赖注入 (DI)**:
    - `src/presentation/extension.ts` 作为 Composition Root，负责实例化 Infrastructure 服务并注入到 Core 组件中。
    - 实现了完全的控制反转，极大提高了可测试性和模块独立性。

## 3. 验证步骤 (Verification)

1.  **编译检查**: 运行 `bun run watch`，已确认编译成功 (Bundled 177 modules)。
2.  **静态类型检查**: 运行 `bunx tsc`，已确认无类型错误 (All Tests Passed Cleanly after fix)。
3.  **启动日志**: (需在 Debug 模式下验证)
    *   只看到一次 `Extension activation start`。
    *   只看到一次 `provideMcpServerDefinitions called`。
    *   可能看到 "Spawning Private MCP Server" 日志（这是 Addi 内部使用的，正常）。
    *   任务管理器可能看到两个 `mcp-server` 进程（一个 VS Code 用，一个 Addi 用），这是预期的架构设计。
3.  **功能检查**:
    *   UI 列表应该清晰，没有重复的 `_2` 后缀工具。
    *   Chat 中能正常调用工具。
    *   修改 YAML 文件后 UI 自动刷新。

