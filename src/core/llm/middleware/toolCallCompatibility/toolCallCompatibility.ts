import { ModelMessage } from 'ai';
import { LLMMiddleware, LLMCallContext } from '../index';
import { logger } from '../../../../common/logger';

/**
 * Middleware to ensure tool call compatibility.
 * Some providers (like DeepSeek or older OAI-compatible endpoints)
 * might have specific requirements for tool call IDs or message ordering.
 */
export class ToolCallCompatibilityMiddleware implements LLMMiddleware {
  private readonly DEFAULT_PATTERNS = ['</?tool_call[^>]*>', '</?function_call[^>]*>'];

  private _regexCache: Map<string, RegExp[]> = new Map();
  private _streamBuffers: Map<string, string> = new Map();
  private _emittedLengths: Map<string, number> = new Map();

  private getScrubbingConfig(context: LLMCallContext) {
    const settings = context.model?.capabilities?.scrubSettings;

    const isEnabled = settings !== undefined && (settings as any).enabled === true;
    const strategy = settings?.strategy || 'retry';
    const rawPatterns =
      settings?.patterns && Array.isArray(settings.patterns) && settings.patterns.length > 0
        ? settings.patterns
        : this.DEFAULT_PATTERNS;
    const flags = settings?.flags || 'g';

    // Use cache to avoid recompiling regexes every time (especially during streaming)
    const cacheKey = `${flags}:${rawPatterns.join('|')}`;
    let patterns = this._regexCache.get(cacheKey);

    if (!patterns) {
      patterns = rawPatterns
        .map((p) => {
          try {
            return new RegExp(p, flags);
          } catch (e) {
            return null;
          }
        })
        .filter((p): p is RegExp => p !== null);
      this._regexCache.set(cacheKey, patterns);
      if (isEnabled) {
        logger.debug(
          `[Middleware] Initialized with ${patterns.length} patterns and flags "${flags}": ${rawPatterns.join(', ')}`
        );
      }
    }

    return {
      enabled: isEnabled,
      patterns,
      strategy,
      toolNameGroup: settings?.toolNameGroup,
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
            logger.debug(`[Middleware] Scrubbed message content for request ${context.requestId}`);
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
          if (changed) {
            logger.debug(
              `[Middleware] Scrubbed multi-part message for request ${context.requestId}`
            );
          }
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
      this._emittedLengths.delete(requestId);
      return part;
    }

    // Scrub hallucinated tags from streaming text/reasoning deltas
    if (
      (part.type === 'text-delta' || part.type === 'reasoning-delta') &&
      typeof part.text === 'string'
    ) {
      const text = part.text;

      // Update buffer for this request
      const previousBuffer = this._streamBuffers.get(requestId) || '';
      const currentBuffer = previousBuffer + text;
      this._streamBuffers.set(requestId, currentBuffer);

      const emittedStep = this._emittedLengths.get(requestId) || 0;

      for (const pattern of config.patterns) {
        pattern.lastIndex = 0;

        // Check for match in the current total buffer
        const match = pattern.exec(currentBuffer);
        if (match) {
          const action =
            config.strategy === 'stop' ? 'stop' : config.strategy === 'retry' ? 'retry' : undefined;

          if (action) {
            // Found a match!
            const matchIndex = match.index;
            let matchedContent = match[0];
            let toolName: string | undefined;
            if (config.toolNameGroup !== undefined && match[config.toolNameGroup]) {
              toolName = match[config.toolNameGroup];
            }

            logger.warn(
              `[Middleware] Detected unexpected output matching "${pattern.source}" (Content: "${matchedContent}")`
            );

            // Smart truncation: emit content BEFORE the match, then stop
            const safeEmitLength = matchIndex;
            const toEmit = currentBuffer.substring(emittedStep, safeEmitLength);

            if (action === 'retry') {
              this._streamBuffers.delete(requestId);
              this._emittedLengths.delete(requestId);
            }

            // Return the safe content and the action signal
            return {
              ...part,
              text: toEmit,
              _addiAction: action,
              _addiTool: toolName,
              _addiMatched: matchedContent,
            };
          }
        }
      }

      // NO MATCH FOUND YET.
      // Only hold back if the buffer ends with a possible tag start (e.g. <tool, <funct, etc.)
      // Otherwise, emit all new content.
      // 没有任何正则匹配时，全部输出原始内容
      const toEmit = currentBuffer.substring(emittedStep, currentBuffer.length);
      if (toEmit.length > 0) {
        this._emittedLengths.set(requestId, emittedStep + toEmit.length);
        return { ...part, text: toEmit };
      }
      return { ...part, text: '' };
    }
    return part;
  }
}
