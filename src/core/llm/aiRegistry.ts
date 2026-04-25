import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Provider, Model } from "../../common/types";
import { logger } from "../../common/logger";

// AI SDK 的 Provider 实例通常是一个函数，接受 modelId 和 settings 返回 LanguageModelV1
// 我们定义一个通用的类型别名
type AIProviderInstance = (modelId: string, settings?: any) => LanguageModel;

/**
 * Factory interface for creating AI Provider instances (e.g. OpenAI, Anthropic).
 */
export interface ProviderFactory {
  id: string;
  label: string;
  create: (provider: Provider) => AIProviderInstance;
}

/**
 * Registry for all supported AI Providers.
 * Maps provider types (vendor strings) to their respective factory functions.
 */
export class AIProviderRegistry {
  private static factories: Record<string, ProviderFactory> = {};
  private static initialized = false;

  static register(factory: ProviderFactory) {
    AIProviderRegistry.factories[factory.id] = factory;
  }

  static unregister(id: string) {
    delete AIProviderRegistry.factories[id];
  }

  static getFactory(id: string): ProviderFactory | undefined {
    AIProviderRegistry.ensureInitialized();
    return AIProviderRegistry.factories[id];
  }

  static getAvailableTypes() {
    AIProviderRegistry.ensureInitialized();
    return Object.values(AIProviderRegistry.factories).map((f) => ({
      label: f.label,
      value: f.id,
    }));
  }

  static ensureInitialized() {
    if (AIProviderRegistry.initialized) {
      return;
    }

    // Helper to create a fetch wrapper for error handling
    const createFetchWithErrorHandling = (baseFetch?: typeof fetch) => {
      return async (url: string | Request | URL, options?: any) => {
        const urlStr = url.toString();
        try {
          const fetchFn = baseFetch || fetch;
          // Add default User-Agent if not present (helps with some strict firewalls/providers like Minimax)
          const finalOptions = { ...options };
          if (!finalOptions.headers) {
            finalOptions.headers = {};
          }
          // Handle headers as Headers object or plain object
          if (finalOptions.headers instanceof Headers) {
            if (!finalOptions.headers.has("User-Agent")) {
              finalOptions.headers.set("User-Agent", "VSCode-Addi-Extension");
            }
          } else if (
            !finalOptions.headers["User-Agent"] &&
            !finalOptions.headers["user-agent"]
          ) {
            finalOptions.headers["User-Agent"] = "VSCode-Addi-Extension";
          }

          const response = await fetchFn(url, finalOptions);
          if (!response.ok) {
            const errorMsg = `[AI-SDK Fetch] Error ${response.status} from ${urlStr}`;
            try {
              const clone = response.clone();
              const text = await clone.text();
              logger.error(
                errorMsg,
                { status: response.status, body: text.substring(0, 500) },
                "AIRegistry",
              );
            } catch (e) {
              logger.error(errorMsg, e, "AIRegistry");
            }
          }
          return response;
        } catch (e) {
          logger.error(
            `[AI-SDK Fetch] Network Error: ${urlStr}`,
            e,
            "AIRegistry",
          );
          throw e;
        }
      };
    };

    // OpenAI (/completions) - Most common, used by OpenAI, DeepSeek, local models, etc.
    AIProviderRegistry.register({
      id: "openai-completions",
      label: "OpenAI (/completions)",
      create: (p) => {
        const settings: any = {};
        const isCustomEndpoint =
          p.apiEndpoint && !p.apiEndpoint.includes("api.openai.com");

        if (p.apiEndpoint) {
          settings.baseURL = p.apiEndpoint.replace(
            /\/chat\/completions\/?$/,
            "",
          );
        }
        if (p.apiKey) {
          settings.apiKey = p.apiKey;
        }
        settings.fetch = createFetchWithErrorHandling();

        // Smart Fallback: use createOpenAICompatible for custom endpoints
        if (isCustomEndpoint) {
          settings.name = "openai-proxy";
          return createOpenAICompatible(settings);
        }

        return createOpenAI(settings);
      },
    });

    // OpenAI (/responses) - Newer API with built-in tool support
    AIProviderRegistry.register({
      id: "openai-responses",
      label: "OpenAI (/responses)",
      create: (p) => {
        const settings: any = {};

        if (p.apiEndpoint) {
          settings.baseURL = p.apiEndpoint.replace(/\/responses\/?$/, "");
        }
        if (p.apiKey) {
          settings.apiKey = p.apiKey;
        }
        settings.fetch = createFetchWithErrorHandling();

        return createOpenAI(settings);
      },
    });

    // Anthropic (/messages)
    AIProviderRegistry.register({
      id: "anthropic-messages",
      label: "Anthropic (/messages)",
      create: (p) => {
        const settings: any = {};
        if (p.apiEndpoint) {
          // Manual mode: User must provide the correct baseURL.
          // e.g. https://api.minimaxi.com/anthropic/v1
          // We only strip /messages because the SDK adds it.
          settings.baseURL = p.apiEndpoint.replace(/\/messages\/?$/, "");
        }
        if (p.apiKey) {
          settings.apiKey = p.apiKey;
        }
        settings.fetch = createFetchWithErrorHandling();
        return createAnthropic(settings);
      },
    });

    // Google (/name:generateContent)
    AIProviderRegistry.register({
      id: "google-generateContent",
      label: "Google (/name:generateContent)",
      create: (p) => {
        const settings: any = {};
        if (p.apiEndpoint) {
          settings.baseURL = p.apiEndpoint;
        }
        if (p.apiKey) {
          settings.apiKey = p.apiKey;
        }
        settings.fetch = createFetchWithErrorHandling();
        return createGoogleGenerativeAI(settings);
      },
    });

    AIProviderRegistry.initialized = true;
  }

  /**
   * 根据 Provider 配置和 Model ID 创建 AI SDK 的 LanguageModel 实例
   */
  static createModel(
    provider: Provider,
    modelOrId: string | Model,
  ): LanguageModel {
    AIProviderRegistry.ensureInitialized();

    const requestedModelId =
      typeof modelOrId === "string" ? modelOrId : modelOrId.id;
    let model =
      typeof modelOrId === "object" ? (modelOrId as Model) : undefined;

    // If model object is not provided but ID is, try to find it in the provider's model list
    if (
      !model &&
      typeof modelOrId === "string" &&
      Array.isArray(provider.models)
    ) {
      model = provider.models.find((m) => m.id === modelOrId);
    }

    // Prefer remote model ID for provider API calls (id is local storage UUID).
    const modelId = model?.rid?.trim() || requestedModelId;

    // 尝试获取对应的工厂，如果找不到则默认使用 openai (兼容模式)
    let factory = AIProviderRegistry.factories[provider.providerType];
    if (!factory) {
      if (
        ["openai-completions", "openai-responses"].includes(
          provider.providerType,
        )
      ) {
        factory = AIProviderRegistry.factories["openai-completions"];
      } else {
        factory = AIProviderRegistry.factories["openai-completions"]; // Default fallback
      }
    }

    if (!factory) {
      // Should not happen if fallback is correct
      // Ensure factory is strictly not undefined for TypeScript
      factory = AIProviderRegistry.factories["openai-completions"];
      if (!factory) {
        throw new Error(
          `Provider factory not found for type: ${provider.providerType}`,
        );
      }
    }

    const aiProviderInstance = factory.create(provider);

    // Configure model-specific settings
    const modelSettings: any = {};

    // Support reasoning/thinking based on capabilities
    if (model && model.capabilities?.reasoning) {
      // Specific provider handling for thinking models (e.g. Anthropic)
      if (provider.providerType === "anthropic-messages") {
        // Default budget tokens for thinking.
        const budget = model.maxOutputTokens
          ? Math.floor(model.maxOutputTokens / 2)
          : 4096;
        // ai-sdk anthropic provider accepts 'thinking' object in settings
        modelSettings.thinking = { type: "enabled", budgetTokens: budget };
      }
    }

    return aiProviderInstance(modelId, modelSettings);
  }
}
