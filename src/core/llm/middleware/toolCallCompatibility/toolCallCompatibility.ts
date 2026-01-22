import { ModelMessage } from 'ai';
import { LLMMiddleware, LLMCallContext } from '../index';

/**
 * Middleware to ensure tool call compatibility.
 * Some providers (like DeepSeek or older OAI-compatible endpoints)
 * might have specific requirements for tool call IDs or message ordering.
 */
export class ToolCallCompatibilityMiddleware implements LLMMiddleware {
  private readonly DEFAULT_PATTERNS = ['</?tool_call[^>]*>', '</?function_call[^>]*>'];

  private _regexCache: Map<string, RegExp[]> = new Map();
  private _streamBuffers: Map<string, string> = new Map();

  private getScrubbingConfig(context: LLMCallContext) {
    const settings = context.model?.capabilities?.scrubSettings;

    const isEnabled = settings !== undefined && (settings as any).enabled === true;
    const strategy = settings?.strategy || 'retry';
    const rawPatterns =
      settings?.patterns && Array.isArray(settings.patterns) && settings.patterns.length > 0
        ? settings.patterns
        : this.DEFAULT_PATTERNS;

    // Use cache to avoid recompiling regexes every time (especially during streaming)
    const cacheKey = rawPatterns.join('|');
    let patterns = this._regexCache.get(cacheKey);

    if (!patterns) {
      patterns = rawPatterns
        .map((p) => {
          try {
            return new RegExp(p, 'gi');
          } catch (e) {
            return null;
          }
        })
        .filter((p): p is RegExp => p !== null);
      this._regexCache.set(cacheKey, patterns);
    }

    return {
      enabled: isEnabled,
      patterns,
      strategy,
    };
  }

  async processMessages(
    messages: ModelMessage[],
    context: LLMCallContext
  ): Promise<{ messages: ModelMessage[] }> {
    const config = this.getScrubbingConfig(context);
    if (!config.enabled) {
      return { messages };
    }

    const processed = messages.map((msg) => {
      // 1. Scrub hallucinated tags from assistant/user text content
      if (msg.role === 'assistant' || msg.role === 'user') {
        if (typeof msg.content === 'string') {
          let scrubbed = msg.content;
          let changed = false;
          for (const pattern of config.patterns) {
            pattern.lastIndex = 0;
            const original = scrubbed;
            scrubbed = scrubbed.replace(pattern, '');
            if (scrubbed !== original) {
              changed = true;
            }
          }
          if (changed) {
            return { ...msg, content: scrubbed.trim() } as ModelMessage;
          }
        } else if (Array.isArray(msg.content)) {
          let changed = false;
          const scrubbedContent = msg.content.map((part: any) => {
            if (part.type === 'text') {
              let text = part.text;
              for (const pattern of config.patterns) {
                pattern.lastIndex = 0;
                const original = text;
                text = text.replace(pattern, '');
                if (text !== original) {
                  changed = true;
                }
              }
              return { ...part, text };
            }
            return part;
          });
          return changed ? ({ ...msg, content: scrubbedContent } as ModelMessage) : msg;
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

    const requestId = context.requestId || 'default';

    // Cleanup buffer on finish to prevent memory leaks
    if (part.type === 'finish') {
      this._streamBuffers.delete(requestId);
      return part;
    }

    // Scrub hallucinated tags from streaming text/reasoning deltas
    if (
      (part.type === 'text-delta' || part.type === 'reasoning-delta') &&
      typeof part.text === 'string'
    ) {
      let text = part.text;

      // Update buffer for this request
      const currentBuffer = (this._streamBuffers.get(requestId) || '') + text;
      this._streamBuffers.set(requestId, currentBuffer);

      let matched = false;
      for (const pattern of config.patterns) {
        pattern.lastIndex = 0;

        // Strategy 1: Check if the whole buffer matches (for retry signal)
        // This is robust against tags split across deltas
        if (pattern.test(currentBuffer)) {
          matched = true;
        }

        // Strategy 2: Clean the current delta for UI reporting
        // (This part is still delta-local, but that's okay because Strategy 1 triggers retry anyway)
        pattern.lastIndex = 0;
        text = text.replace(pattern, '');
      }

      if (matched) {
        const action =
          config.strategy === 'stop' ? 'stop' : config.strategy === 'retry' ? 'retry' : undefined;
        if (action) {
          // If we retry, we can also clear the buffer
          if (action === 'retry') {
            this._streamBuffers.delete(requestId);
          }
          return { ...part, text, _addiAction: action };
        }
      }

      return { ...part, text };
    }
    return part;
  }
}
