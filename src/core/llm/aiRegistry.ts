import { LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
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

    // OpenAI (/completions) - Most common, used by OpenAI, DeepSeek, local models, etc.
    this.register({
      id: 'openai-completions',
      label: 'OpenAI (/completions)',
      create: (p) => {
        const settings: any = {};
        const isCustomEndpoint = p.apiEndpoint && !p.apiEndpoint.includes('api.openai.com');

        if (p.apiEndpoint) {
          settings.baseURL = p.apiEndpoint.replace(/\/chat\/completions\/?$/, '');
        }
        if (p.apiKey) {
          settings.apiKey = p.apiKey;
        }
        settings.fetch = createDebugFetch();

        // Smart Fallback: use createOpenAICompatible for custom endpoints
        if (isCustomEndpoint) {
          settings.name = 'openai-proxy';
          return createOpenAICompatible(settings);
        }

        return createOpenAI(settings);
      },
    });

    // OpenAI (/responses) - Newer API with built-in tool support
    this.register({
      id: 'openai-responses',
      label: 'OpenAI (/responses)',
      create: (p) => {
        const settings: any = {};
        
        if (p.apiEndpoint) {
          settings.baseURL = p.apiEndpoint.replace(/\/responses\/?$/, '');
        }
        if (p.apiKey) {
          settings.apiKey = p.apiKey;
        }
        settings.fetch = createDebugFetch();
        
        return createOpenAI(settings);
      },
    });

    // Anthropic (/messages)
    this.register({
      id: 'anthropic-messages',
      label: 'Anthropic (/messages)',
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

    // Google (/name:generateContent)
    this.register({
      id: 'google-generateContent',
      label: 'Google (/name:generateContent)',
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
