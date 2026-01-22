import { ModelMessage } from 'ai';
import { LLMMiddleware, LLMCallContext } from '../index';

/**
 * Middleware to ensure tool call compatibility.
 * Some providers (like DeepSeek or older OAI-compatible endpoints) 
 * might have specific requirements for tool call IDs or message ordering.
 */
export class ToolCallCompatibilityMiddleware implements LLMMiddleware {
  private readonly DEFAULT_PATTERNS = [
    '<\\\\/?tool_call[^>]*>',
    '<\\\\/?function_call[^>]*>'
  ];

  private getScrubbingConfig(context: LLMCallContext) {
    const settings = context.model?.capabilities?.scrubSettings;
    
    // Explicitly check for enabled property and patterns
    const isEnabled = settings !== undefined && (settings as any).enabled === true;
    const strategy = settings?.strategy || 'retry';
    const rawPatterns = (settings?.patterns && Array.isArray(settings.patterns) && settings.patterns.length > 0) 
      ? settings.patterns 
      : this.DEFAULT_PATTERNS;

    const patterns = rawPatterns.map((p) => {
      try {
        // Double escape backslashes for the RegExp constructor if they come from JSON strings
        const normalized = p.replace(/\\\\/g, '\\');
        return new RegExp(normalized, 'gi');
      } catch (e) {
        return null;
      }
    }).filter((p): p is RegExp => p !== null);

    return {
      enabled: isEnabled,
      patterns,
      strategy
    };
  }

  async processMessages(
    messages: ModelMessage[],
    context: LLMCallContext
  ): Promise<{ messages: ModelMessage[] }> {
    const config = this.getScrubbingConfig(context);

    const processed = messages.map((msg) => {
      // 1. Scrub hallucinated tags from assistant/user text content
      if (config.enabled && (msg.role === 'assistant' || msg.role === 'user')) {
        if (typeof msg.content === 'string') {
          let scrubbed = msg.content;
          for (const pattern of config.patterns) {
            pattern.lastIndex = 0;
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
                pattern.lastIndex = 0;
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
        // Reset lastIndex for reuse of global regex
        pattern.lastIndex = 0;
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
