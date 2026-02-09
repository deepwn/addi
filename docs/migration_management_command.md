# 迁移指南: 从 managementCommand 到 configuration (VS Code Chat Model Provider)

VS Code 1.109 引入了新的 Chat Model Provider 配置机制（目前为 Proposed API），旨在替代旧的 `managementCommand` 属性。本指南详细说明如何进行迁移。

**官方参考文档**: [VS Code 1.109 Release Notes - Chat Model Provider Configuration](https://code.visualstudio.com/updates/v1_109#_chat-model-provider-configuration)

## 背景

在旧版本中，Chat Model Provider 扩展通常通过 `managementCommand` 属性注册一个命令，并在用户点击设置图标时打开自定义的配置 UI（通常是 Webview 或 InputBox）。

**现状 (Old Way):**
`package.json`:

```json
"contributes": {
  "languageModelChatProviders": [
    {
      "vendor": "addi-provider",
      "displayName": "Addi",
      "managementCommand": "addi.manage"
    }
  ]
}
```

VS Code 计划弃用 `managementCommand`，转而让扩展在 `package.json` 中声明配置结构（JSON Schema），由 VS Code 统一生成原生的配置界面。

---

## 迁移步骤

> 目前为自定义编辑界面，满足 Addi 复杂配置需求的最佳方案是**保留自定义化配置界面与配置解构**，仅去除 `managementCommand` 不再从模型管理界面 `Setting` 按钮跳转。后续如考虑迁移，初步设计为以下配置对照所示：

### 1. 更新 package.json 定义

在 `languageModelChatProviders` 中，移除 `managementCommand`，改为使用 `configuration` 属性来对照定义配置的 Schema。

**新方式 (New Way - Proposed):**

```json
"contributes": {
  "languageModelChatProviders": [
    {
      "vendor": "addi-provider",
      "displayName": "Addi",
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
            "description": "Custom API Endpoint URL",
            "title": "Endpoint URL"
          },
          "models": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "name": { "type": "string" }
              }
            },
            "description": "List of configured models"
          }
        },
        "required": ["apiKey"]
      }
    }
  ]
}
```

**更复杂的配置解构（Addi 全量配置方案）：**

> 以下 Schema 完整映射了 `src/common/types.ts` 中的 `ProviderConfig` 和 `ModelConfig` 结构，确保数据无损迁移。

```json
{
  "contributes": {
    "languageModelChatProviders": [
      {
        "vendor": "addi-provider",
        "displayName": "Addi",
        "configuration": {
          "properties": {
            "providers": {
              "type": "array",
              "description": "List of configured AI providers acting as backends.",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "Unique provider identifier (UUID)"
                  },
                  "name": {
                    "type": "string",
                    "description": "Display name for the provider"
                  },
                  "providerType": {
                    "type": "string",
                    "enum": ["openai", "anthropic", "google", "deepseek", "generic"],
                    "description": "Provider backend type",
                    "default": "generic"
                  },
                  "apiEndpoint": {
                    "type": "string",
                    "description": "Base URL for the API (if applicable)"
                  },
                  "website": {
                    "type": "string",
                    "description": "Provider documentation or dashboard URL"
                  },
                  "apiKey": {
                    "type": "string",
                    "secret": true,
                    "description": "Authentication Key (stored securely)"
                  },
                  "models": {
                    "type": "array",
                    "description": "List of models available for this provider",
                    "items": {
                      "type": "object",
                      "properties": {
                        "sid": {
                          "type": "string",
                          "description": "Internal unique session ID for model config"
                        },
                        "id": {
                          "type": "string",
                          "description": "Model ID sent to the API (e.g. gpt-4)"
                        },
                        "name": {
                          "type": "string",
                          "description": "Friendly display name"
                        },
                        "family": {
                          "type": "string",
                          "description": "Model family categorization"
                        },
                        "version": {
                          "type": "string",
                          "description": "Model version info"
                        },
                        "maxInputTokens": {
                          "type": "number",
                          "default": 128000
                        },
                        "maxOutputTokens": {
                          "type": "number",
                          "default": 4096
                        },
                        "requestAdditional": {
                          "type": "string",
                          "description": "JSON string for additional request parameters (temperature, topP, etc.)"
                        },
                        "capabilities": {
                          "type": "object",
                          "description": "Model capabilities and feature flags",
                          "properties": {
                            "imageInput": {
                              "type": "boolean"
                            },
                            "toolCalling": {
                              "anyOf": [{ "type": "boolean" }, { "type": "number" }],
                              "description": "Support for tool calling (bool or max count)"
                            },
                            "scrubSettings": {
                              "type": "object",
                              "description": "Hallucination scrubbing settings",
                              "properties": {
                                "enabled": { "type": "boolean" },
                                "patterns": {
                                  "type": "array",
                                  "items": { "type": "string" }
                                },
                                "strategy": {
                                  "type": "string",
                                  "enum": ["stop", "retry"]
                                },
                                "flags": {
                                  "type": "string",
                                  "description": "RegExp flags (e.g. 'gmi')"
                                },
                                "toolNameGroup": {
                                  "type": "number",
                                  "description": "Capture group index for tool name"
                                }
                              }
                            }
                          }
                        }
                      },
                      "required": ["id", "maxInputTokens", "maxOutputTokens"]
                    }
                  }
                },
                "required": ["id", "name", "providerType", "models"]
              }
            }
          }
        }
      }
    ]
  }
}
```

### 2. 更新扩展激活逻辑 (理论预览)

> **注意**: 以下代码仅为基于 Proposed API 的理论实现。目前 Addi 仍使用自定义 `StorageService` 管理配置，暂未适配此预览功能的逻辑。

在新的 API 设计中，`provideLanguageModelResponse` 可能会直接接收配置对象，或者建议从 Workspace Configuration 中读取结构化数据。如果配置被注入到回调中，处理逻辑将从“读取本地存储”变为“解析传入配置”。

**代码变更示例 (src/presentation/extension.ts):**

```typescript
// 旧代码 (Current Implementation)
vscode.lm.registerLanguageModelChatProvider('addi-provider', {
    provideLanguageModelResponse: async (messages, options, extensionId, token) => {
        // 1. 从自定义 StorageService 获取所有配置
        const providers = storageService.getProviders();
        // 2. 根据 options.modelId 查找对应的 Provider 和 Model
        const { provider, model } = findModel(providers, options.modelId);

        await llmService.chat(provider, model, messages, options, ...);
    }
});

// 新代码 (适配 Proposed Configuration API)
// 假设 configuration 参数包含符合 package.json Schema 的完整对象
vscode.lm.registerLanguageModelChatProvider('addi-provider', {
    provideLanguageModelResponse: async (messages, options, extensionId, configuration, token) => {
        // 1. 直接使用传入的结构化配置
        // configuration 类型即为我们在 package.json 中定义的结构
        // 需要根据 JSON Schema 还原为内部使用的 ProviderConfig[]
        const configProviders = configuration.providers;

        // 2. 在配置中查找当前请求的模型
        // options.modelId 是用户在 UI 选择的模型 ID
        const targetModelId = options.modelId;
        const match = findModelInConfig(configProviders, targetModelId);

        if (!match) {
            throw new Error(`Model ${targetModelId} not found in configuration`);
        }

        // 3. 转换为内部运行时对象并执行
        await llmService.chat(match.provider, match.model, messages, options, ...);
    }
});
```

### 3. 当前状态与迁移计划

**现状声明**:
目前 Addi 项目**并未完成**此迁移，也**暂无计划**在近期版本（v0.0.x）中跟进此更新。

**原因**:

1.  **API 稳定性**: `lmConfiguration` 仍处于 Proposed 状态，随时可能变更，不适合生产环境依赖。
2.  **功能复杂性**: Addi 提供了高级的模型管理功能（如从剪贴板导入、自动检测参数、动态测试），这些功能目前无法非常恰当的映射到 VS Code 原生的 JSON 配置界面中，且可能增加处理逻辑复杂度，导致更多问题。
3.  **用户体验**: 现有的侧边栏管理界面提供了更直观的交互体验，自定义编辑页面能带来更好的自定义体验。

**未来规划**:
待该 API 正式发布且功能稳定后，将计划进一步研究，并选定方案：

- 保持原有设置方式不进行迁移，继续使用自定义界面管理配置。
- 混合模式：基础 API Key 托管给 VS Code，高级参数仍在侧边栏管理。
- 或者等待 VS Code 提供更丰富的自定义配置 UI 能力后全面迁移。

---

## 对应关系总结

| 功能         | 旧方式 (`managementCommand`)              | 新方式 (`configuration`)                   |
| :----------- | :---------------------------------------- | :----------------------------------------- |
| **触发入口** | 用户点击齿轮 -> 执行命令 -> 弹出自定义 UI | 用户点击齿轮 -> VS Code 打开原生配置编辑器 |
| **UI 实现**  | 扩展自行实现 (Webview/QuickPick)          | **VS Code 自动生成** (基于 JSON Schema)    |
| **配置存储** | 扩展自行管理 (SecretStorage/Settings)     | **VS Code 托管** (自动持久化与加密)        |
| **配置读取** | 在 `provideResponse` 中自行读取           | 通过 `provideResponse` 参数直接注入        |

## 结论

> 2026年2月9日

短期内可能更适合继续使用现有的自定义管理界面，等待 API 稳定后再评估全面迁移的可行性和最佳方案。
