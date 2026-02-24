<center style="text-align: center; background-color: lightblue; padding: 40px 40px; border-radius: 10px; margin-bottom: 20px;">
  <img src="resources/icon-bg.min.png" width="128" height="128" alt="Addi Logo" />

  <h1>Addi — Extend Your VS Code Copilot</h1>
  <p><b>为 GitHub Copilot 添加自定义 AI 供应商与模型、快捷构造 MCP 工具的 VS Code 扩展</b></p>
    <a href="https://github.com/deepwn/addi/releases"><img alt="Release" src="https://img.shields.io/github/v/release/deepwn/addi?logo=github" /></a>
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-green.svg" /></a>
    <a href="https://github.com/deepwn/addi/issues"><img alt="Issues" src="https://img.shields.io/github/issues/deepwn/addi" /></a>
    <a href="https://github.com/deepwn/addi/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/deepwn/addi" /></a>
  </p>
</center>

---

## 简介

Addi 是一个 VS Code 扩展，让你在 GitHub Copilot 中使用自定义 AI 供应商与模型，并支持快捷构建 MCP 工具。

**核心功能：**

- 🏢 **Provider 管理** — 添加/编辑/删除 AI 供应商，API Key 安全存储
- 🤖 **模型管理** — 为供应商绑定模型，配置 Token 限制与特性标记
- 🔧 **自定义工具 (MCP)** — 使用 YAML 快速创建工具，支持复合操作
- 🔒 **安全存储** — 配置/统计/密钥三层分离，API Key 加密存储

## 快速开始

1. 安装扩展
2. 打开侧边栏 "Addi"
3. 添加 Provider（端点与 API Key）
4. 为 Provider 添加模型
5. 在 Copilot 模型选择器中勾选你的模型

## 安装

**插件市场：** 搜索 "Addi" 或命令面板执行 `ext install addi`

**本地 VSIX：**

```powershell
# PowerShell
.\scripts\dev-install.ps1

# 或手动安装
code --install-extension addi-*.vsix
```

## 功能详情

### Provider 与模型管理

| 功能                | 说明                                   |
| ------------------- | -------------------------------------- |
| 添加/编辑/复制/删除 | 完整的 CRUD 操作                       |
| API Key 快速编辑    | 右键菜单快速修改密钥                   |
| 模型验证            | 自动检测连通性、视觉能力、工具调用支持 |
| 模型切换            | 在 Copilot 模型选择器中一键切换        |
| 导入导出            | JSON 格式配置备份与迁移                |
| 拉取模型列表        | 从 API 端点自动获取可用模型列表        |

#### 添加/编辑 Provider

Provider 是 AI 服务的访问端点，每个 Provider 包含以下配置项：

| 字段         | 必填 | 说明                                   |
| ------------ | ---- | -------------------------------------- |
| **名称**     | 是   | 显示名称，用于标识供应商               |
| **端点 URL** | 是   | API 请求的基础地址                     |
| **API Key**  | 是   | 访问令牌，支持明文或 `key://` 协议引用 |
| **组织 ID**  | 否   | 部分服务需要的组织标识                 |
| **默认模型** | 否   | 该供应商的默认模型 ID                  |
| **验证类型** | 否   | 认证方式 (Bearer/Header/API Key)       |

**操作步骤：**

1. 在侧边栏点击 "添加 Provider" 或选择现有 Provider 点击编辑
2. 填写基本信息（名称、端点、API Key）
3. 保存后即可为该 Provider 添加模型

#### 添加/编辑 Model

Model 是具体的 AI 模型实例，每个 Model 绑定到特定的 Provider：

| 字段                | 必填 | 说明                     |
| ------------------- | ---- | ------------------------ |
| **模型 ID**         | 是   | API 调用的模型标识符     |
| **显示名称**        | 否   | 在界面中显示的名称       |
| **Provider**        | 是   | 所属的供应商             |
| **最大输入 Tokens** | 否   | 上下文窗口大小           |
| **最大输出 Tokens** | 否   | 单次响应最大长度         |
| **Family**          | 否   | 模型系列分类             |
| **Version**         | 否   | 模型版本号               |
| **特性标记**        | 否   | 视觉、工具调用等能力标识 |

**操作步骤：**

1. 选择一个 Provider，点击 "添加模型"
2. 填写模型 ID（从 API 拉取可自动填充）
3. 配置 Token 限制和特性
4. 保存后在 Copilot 模型选择器中勾选使用

#### 导入导出配置

配置导入导出功能支持完整的配置备份与迁移：

**导出配置 (`addi.exportConfig`)**

- 导出所有 Provider、模型、自定义工具的完整配置
- 导出格式为 JSON，包含结构化数据
- **不会**导出 API Key（敏感信息需要手动填写或使用 `key://` 引用）
- 适合用于配置备份或团队共享

**导入配置 (`addi.importConfig`)**

- 导入 JSON 格式的配置文件
- 自动合并现有配置（同名项会被覆盖）
- 导入后需要手动补充 API Key
- 支持版本兼容检查

**配置内容：**

```json
{
  "version": "1.0.0",
  "providers": [...],
  "models": [...],
  "tools": [...]
}
```

### 自定义工具 (MCP)

使用 YAML 定义工具，支持：

- **简单工具** — HTTP 请求、文件操作等内置动作
- **复合操作** — 类 GitHub Actions 语法，支持条件判断与上下文
- **资源暴露** — 自动扫描 `resources` 目录暴露为 MCP 资源
- **递归调用** — 工具可引用其他本地工具

查看 [CUSTOM_TOOLS.md](CUSTOM_TOOLS.md) 了解完整语法。

### 命令

**管理命令：**

| 命令                | 说明           |
| ------------------- | -------------- |
| `addi.manage`       | 打开管理视图   |
| `addi.refresh`      | 刷新供应商列表 |
| `addi.openSettings` | 打开扩展设置   |
| `addi.showLogs`     | 显示日志输出   |

**Provider 命令：**

| 命令                      | 说明                |
| ------------------------- | ------------------- |
| `addi.addProvider`        | 添加供应商          |
| `addi.editProvider`       | 编辑供应商          |
| `addi.deleteProvider`     | 删除供应商          |
| `addi.copyProvider`       | 复制供应商          |
| `addi.editApiKey`         | 编辑 API Key        |
| `addi.pullProviderModels` | 从 API 拉取模型列表 |

**模型命令：**

| 命令               | 说明     |
| ------------------ | -------- |
| `addi.addModel`    | 添加模型 |
| `addi.editModel`   | 编辑模型 |
| `addi.deleteModel` | 删除模型 |
| `addi.copyModel`   | 复制模型 |

**工具命令：**

| 命令              | 说明         |
| ----------------- | ------------ |
| `addi.addTool`    | 添加工具     |
| `addi.editTool`   | 编辑工具     |
| `addi.deleteTool` | 删除工具     |
| `addi.copyTool`   | 复制工具     |
| `addi.runTool`    | 调试运行工具 |

**配置命令：**

| 命令                | 说明     |
| ------------------- | -------- |
| `addi.exportConfig` | 导出配置 |
| `addi.importConfig` | 导入配置 |

**详情编辑命令：**

| 命令                 | 说明             |
| -------------------- | ---------------- |
| `addi.verifyDetails` | 自动检测模型参数 |
| `addi.saveDetails`   | 保存详情         |
| `addi.cancelDetails` | 取消编辑         |

**调试命令：**

| 命令                   | 说明                |
| ---------------------- | ------------------- |
| `addi.debug.mcpStatus` | 检查 MCP 服务器状态 |

## 配置项

**基础配置：**

| Setting                         | 默认     | 说明                      |
| ------------------------------- | -------- | ------------------------- |
| `addi.defaultMaxInputTokens`    | 60000    | 默认最大输入 tokens (60k) |
| `addi.defaultMaxOutputTokens`   | 128000   | 默认最大输出 tokens (128k) |
| `addi.defaultModelFamily`       | "Addi"  | 默认模型 family           |
| `addi.defaultModelVersion`      | "1.0.0" | 默认模型 version          |
| `addi.confirmDelete`            | true    | 删除前确认                |
| `addi.saveConfigToSettingsSync` | true    | 同步到 Settings Sync 云端 |

**排序配置：**

| Setting           | 默认   | 说明                                  |
| ----------------- | ------ | ------------------------------------- |
| `addi.sortRule`   | "none" | 排序规则 (none/alphabet/input/output) |
| `addi.sortTarget` | "both" | 排序目标 (providers/models/both)      |

**MCP 服务器配置：**

| Setting                        | 默认          | 说明                           |
| ------------------------------ | ------------- | ------------------------------ |
| `addi.mcpServer.executionMode` | "local"       | 执行模式 (local/docker/both)   |
| `addi.mcpServer.path`          | ""            | MCP 服务器二进制路径           |
| `addi.mcp.registryBaseRepo`    | "deepwn/addi" | MCP 模板仓库 (owner/repo 格式) |
| `addi.maxToolChainSteps`       | 100           | 工具链最大步数                 |

## 常见问题

**Q: 添加的模型在 Copilot 中不可见？**
确保已在 Copilot 模型选择器的"管理模型"中勾选该模型。

**Q: 自定义工具没有显示？**
检查 YAML 语法是否正确，文件是否存放在 `.addi/public/` 或 `.addi/private/` 目录。

## 许可证

MIT License

## 致谢

感谢所有贡献者和测试用户！
