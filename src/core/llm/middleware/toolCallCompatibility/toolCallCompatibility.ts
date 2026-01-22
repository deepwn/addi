import { ModelMessage } from 'ai';
import { LLMMiddleware, LLMCallContext } from '../index';
import { logger } from '../../../../common/logger';

/**
 * Middleware to ensure tool call compatibility.
 * Some providers (like DeepSeek or older OAI-compatible endpoints) 
 * might have specific requirements for tool call IDs or message ordering.
 */
export class ToolCallCompatibilityMiddleware implements LLMMiddleware {
  private readonly DEFAULT_PATTERNS = [
    /<\/?tool_call[^>]*>/gi,
    /<\/?function_call[^>]*>/gi
  ];

  private getScrubbingConfig(context: LLMCallContext) {
    const settings = context.model?.capabilities?.scrubSettings;
    if (!settings || !settings.enabled) {
      return { enabled: false, patterns: [], strategy: 'retry' as const };
    }
    const patterns = (settings.patterns || []).map((p) => new RegExp(p, 'gi'));
    return {
      enabled: true,
      patterns: patterns.length > 0 ? patterns : this.DEFAULT_PATTERNS,
      strategy: settings.strategy || 'retry',
    };
  }

  async processMessages(
    messages: ModelMessage[],
    context: LLMCallContext
  ): Promise<{ messages: ModelMessage[] }> {
    logger.debug(`[Middleware] Applying tool call compatibility for ${context.modelId}`);

    const config = this.getScrubbingConfig(context);

    const processed = messages.map((msg) => {
      // 1. Scrub hallucinated tags from assistant/user text content
      if (config.enabled && (msg.role === 'assistant' || msg.role === 'user')) {
        if (typeof msg.content === 'string') {
          let scrubbed = msg.content;
          for (const pattern of config.patterns) {
            scrubbed = scrubbed.replace(pattern, '');
          }
          if (scrubbed !== msg.content) {
            return { ...msg, content: scrubbed.trim() } as ModelMessage;
          }
        } else if (Array.isArray(msg.content)) {
          const scrubbedContent = msg.content.map((part: any) => {
            if (part.type === 'text') {
              let text = part.text;
              for (const pattern of config.patterns) {
                text = text.replace(pattern, '');
              }
              return { ...part, text };
            }
            return part;
          });
          return { ...msg, content: scrubbedContent } as ModelMessage;
        }
      }

      return msg;
    });

    return { messages: processed };
  }

  processResponsePart(part: any, context: LLMCallContext): any {
    const config = this.getScrubbingConfig(context);
    if (!config.enabled) {
      return part;
    }

    // Scrub hallucinated tags from streaming text deltas
    if (part.type === 'text-delta' && typeof part.text === 'string') {
      let text = part.text;
      let matched = false;
      for (const pattern of config.patterns) {
        if (pattern.test(text)) {
          matched = true;
          text = text.replace(pattern, '');
        }
      }

      if (matched) {
        if (config.strategy === 'stop') {
          return { ...part, text, _addiAction: 'stop' };
        } else if (config.strategy === 'retry') {
          return { ...part, text, _addiAction: 'retry' };
        }
      }

      return { ...part, text };
    }
    return part;
  }
}
