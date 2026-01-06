import { LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createDeepSeek } from '@ai-sdk/deepseek';
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
    return Object.values(this.factories).map(f => ({ label: f.label, value: f.id }));
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
                } catch (e) { /* ignore */ }
            }
            try {
                const fetchFn = baseFetch || fetch;
                const response = await fetchFn(url, options);
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
        if (p.apiEndpoint) { 
            // Clean up baseURL: remove /chat/completions if present
            let baseURL = p.apiEndpoint.replace(/\/chat\/completions\/?$/, '');
            settings.baseURL = baseURL; 
        }
        if (p.apiKey) { settings.apiKey = p.apiKey; }
        settings.fetch = createDebugFetch();
        
        return createOpenAI(settings);
      }
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
        if (p.apiKey) { settings.apiKey = p.apiKey; }
        
        // Use createOpenAICompatible for DeepSeek to ensure reasoning_content support
        // and better compatibility with latest features.
        if (p.apiEndpoint) {
             let baseURL = p.apiEndpoint.replace(/\/chat\/completions\/?$/, '');
             settings.baseURL = baseURL;
        } else {
            settings.baseURL = 'https://api.deepseek.com';
        }
        settings.fetch = createDebugFetch();
        return createDeepSeek(settings);
      }
    });

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
                // Clean up baseURL: remove /chat/completions if present
                let baseURL = p.apiEndpoint.replace(/\/chat\/completions\/?$/, '');
                settings.baseURL = baseURL;
            }
            if (p.apiKey) { settings.apiKey = p.apiKey; }

            // Add debug fetch to log actual URLs
            settings.fetch = createDebugFetch();

            return createOpenAICompatible(settings);
        }
    });

    // Anthropic
    this.register({
      id: 'anthropic',
      label: 'Anthropic',
      create: (p) => {
        const settings: any = {};
        if (p.apiEndpoint) { settings.baseURL = p.apiEndpoint; }
        if (p.apiKey) { settings.apiKey = p.apiKey; }
        settings.fetch = createDebugFetch();
        return createAnthropic(settings);
      }
    });

    // Google
    this.register({
      id: 'google',
      label: 'Google Gemini',
      create: (p) => {
        const settings: any = {};
        if (p.apiEndpoint) { settings.baseURL = p.apiEndpoint; }
        if (p.apiKey) { settings.apiKey = p.apiKey; }
        settings.fetch = createDebugFetch();
        return createGoogleGenerativeAI(settings);
      }
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
