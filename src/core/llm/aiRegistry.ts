import { LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createZhipu } from 'zhipu-ai-provider';
import { createMinimax } from 'vercel-minimax-ai-provider';
import { Provider } from '../../common/types';
import { logger } from '../../common/logger';

// AI SDK 的 Provider 实例通常是一个函数，接受 modelId 返回 LanguageModelV1
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
    this.factories[factory.id] = factory;
  }

  static getFactory(id: string): ProviderFactory | undefined {
    this.ensureInitialized();
    return this.factories[id];
  }

  static getAvailableTypes() {
    this.ensureInitialized();
    return Object.values(this.factories).map((f) => ({ label: f.label, value: f.id }));
  }

  static ensureInitialized() {
    if (this.initialized) {
      return;
    }

    // Helper to create a debug fetch wrapper
    const createDebugFetch = (baseFetch?: typeof fetch) => {
      return async (url: string | Request | URL, options?: any) => {
        const urlStr = url.toString();
        logger.info(`[AI-SDK Fetch] Requesting: ${urlStr}`);
        if (options && options.body) {
          try {
            const bodyStr = options.body.toString();
            logger.debug(`[AI-SDK Fetch] Request Body (snippet): ${bodyStr.substring(0, 2000)}`);
          } catch (e) {
            /* ignore */
          }
        }
        try {
          const fetchFn = baseFetch || fetch;
          // Add default User-Agent if not present (helps with some strict firewalls/providers like Minimax)
          const finalOptions = { ...options };
          if (!finalOptions.headers) {
            finalOptions.headers = {};
          }
          // Handle headers as Headers object or plain object
          if (finalOptions.headers instanceof Headers) {
            if (!finalOptions.headers.has('User-Agent')) {
              finalOptions.headers.set('User-Agent', 'VSCode-Addi-Extension');
            }
          } else if (!finalOptions.headers['User-Agent'] && !finalOptions.headers['user-agent']) {
            finalOptions.headers['User-Agent'] = 'VSCode-Addi-Extension';
          }

          const response = await fetchFn(url, finalOptions);
          if (!response.ok) {
            logger.error(`[AI-SDK Fetch] Error ${response.status} from ${urlStr}`);
            try {
              const clone = response.clone();
              const text = await clone.text();
              logger.error(`[AI-SDK Fetch] Error Body: ${text}`);
            } catch (e) {
              logger.error(`[AI-SDK Fetch] Could not read error body: ${e}`);
            }
          }
          return response;
        } catch (e) {
          logger.error(`[AI-SDK Fetch] Network Error: ${e}`);
          throw e;
        }
      };
    };

    // OpenAI
    const openAIFactory: ProviderFactory = {
      id: 'openai',
      label: 'OpenAI',
      create: (p) => {
        const settings: any = {};
        // Detect if using a custom endpoint (Proxy / Enterprise / Compatible Service)
        const isCustomEndpoint = p.apiEndpoint && !p.apiEndpoint.includes('api.openai.com');

        if (p.apiEndpoint) {
          settings.baseURL = p.apiEndpoint.replace(/\/chat\/completions\/?$/, '');
        }
        if (p.apiKey) {
          settings.apiKey = p.apiKey;
        }
        settings.fetch = createDebugFetch();

        // 智能优化：Smart Fallback for Custom Endpoints
        // 如果用户选择了 "OpenAI" 类型但使用的是自定义 Endpoint（如 OneAPI、LocalAI、DeepSeek 等），
        // 自动降级使用 createOpenAICompatible。它对非标准 Header 和响应格式的兼容性更好，
        // 避免了官方 SDK 严格的 Header 检查（如 OpenAI-Organization）导致的错误。
        if (isCustomEndpoint) {
          settings.name = 'openai-proxy';
          return createOpenAICompatible(settings);
        }

        return createOpenAI(settings);
      },
    };
    this.register(openAIFactory);

    // DeepSeek
    this.register({
      id: 'deepseek',
      label: 'DeepSeek',
      create: (p) => {
        const settings: any = {
          name: 'deepseek',
        };
        if (p.apiKey) {
          settings.apiKey = p.apiKey;
        }

        // Use createOpenAICompatible for DeepSeek to ensure reasoning_content support
        // and better compatibility with latest features.
        if (p.apiEndpoint) {
          settings.baseURL = p.apiEndpoint.replace(/\/chat\/completions\/?$/, '');
        } else {
          settings.baseURL = 'https://api.deepseek.com';
        }
        settings.fetch = createDebugFetch();
        return createDeepSeek(settings);
      },
    });

    // Zhipu AI
    this.register({
      id: 'zhipu-ai',
      label: 'Zhipu AI',
      create: (p) => {
        const settings: any = {};
        if (p.apiKey) {
          settings.apiKey = p.apiKey;
        }
        if (p.apiEndpoint) {
          settings.baseURL = p.apiEndpoint.replace(/\/chat\/completions\/?$/, '');
        }
        settings.fetch = createDebugFetch();
        return createZhipu(settings);
      },
    });
    //Minimax
    this.register({
      id: 'minimax',
      label: 'Minimax',
      create: (p) => {
        const settings: any = {};
        if (p.apiKey) {
          settings.apiKey = p.apiKey;
        }
        if (p.apiEndpoint) {
          // Minimax provider might expect specific base URL handling
          settings.baseURL = p.apiEndpoint.replace(/\/chat\/completions\/?$/, '');
        }
        settings.fetch = createDebugFetch();
        return createMinimax(settings);
      },
    });

    //
    // Generic (OpenAI Compatible)
    // Use createOpenAICompatible for better compatibility with non-OpenAI providers
    this.register({
      id: 'generic',
      label: 'Generic (OpenAI Compatible)',
      create: (p) => {
        const settings: any = {
          name: 'generic',
        };
        if (p.apiEndpoint) {
          settings.baseURL = p.apiEndpoint.replace(/\/chat\/completions\/?$/, '');
        }
        if (p.apiKey) {
          settings.apiKey = p.apiKey;
        }

        // Add debug fetch to log actual URLs
        settings.fetch = createDebugFetch();

        return createOpenAICompatible(settings);
      },
    });

    // Anthropic
    this.register({
      id: 'anthropic',
      label: 'Anthropic',
      create: (p) => {
        const settings: any = {};
        if (p.apiEndpoint) {
          // Manual mode: User must provide the correct baseURL.
          // e.g. https://api.minimaxi.com/anthropic/v1
          // We only strip /messages because the SDK adds it.
          settings.baseURL = p.apiEndpoint.replace(/\/messages\/?$/, '');
        }
        if (p.apiKey) {
          settings.apiKey = p.apiKey;
        }
        settings.fetch = createDebugFetch();
        return createAnthropic(settings);
      },
    });

    // Google
    this.register({
      id: 'google',
      label: 'Google Gemini',
      create: (p) => {
        const settings: any = {};
        if (p.apiEndpoint) {
          settings.baseURL = p.apiEndpoint;
        }
        if (p.apiKey) {
          settings.apiKey = p.apiKey;
        }
        settings.fetch = createDebugFetch();
        return createGoogleGenerativeAI(settings);
      },
    });

    this.initialized = true;
  }

  /**
   * 根据 Provider 配置和 Model ID 创建 AI SDK 的 LanguageModel 实例
   */
  static createModel(provider: Provider, modelId: string): LanguageModel {
    this.ensureInitialized();

    // 尝试获取对应的工厂，如果找不到则默认使用 openai (兼容模式)
    let factory = this.factories[provider.providerType];
    if (!factory) {
      // 如果 providerType 是未知的（例如用户手动修改了配置文件），尝试回退到 openai
      factory = this.factories['openai'];
    }

    if (!factory) {
      throw new Error(`Provider factory not found for type: ${provider.providerType}`);
    }

    const aiProviderInstance = factory.create(provider);
    return aiProviderInstance(modelId);
  }
}
