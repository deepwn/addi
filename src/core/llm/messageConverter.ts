import * as vscode from 'vscode';
import { ModelMessage, UserContent, ToolContent, AssistantContent } from 'ai';
import { logger } from '../../common/logger';

export class MessageConverter {
  static async toAiCoreMessages(
    messages: readonly vscode.LanguageModelChatRequestMessage[]
  ): Promise<ModelMessage[]> {
    const coreMessages: ModelMessage[] = [];

    // Optimization: Build a map of toolCallId -> toolName once to avoid O(N*M) lookups
    const toolCallMap = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role === vscode.LanguageModelChatMessageRole.Assistant) {
        for (const part of msg.content) {
          if (part instanceof vscode.LanguageModelToolCallPart) {
            toolCallMap.set(part.callId, part.name);
          }
        }
      }
    }

    for (const msg of messages) {
      if (msg.role === vscode.LanguageModelChatMessageRole.User) {
        const userContent: UserContent = [];
        const toolResults: vscode.LanguageModelToolResultPart[] = [];

        for (const part of msg.content) {
          if (part instanceof vscode.LanguageModelTextPart) {
            userContent.push({ type: 'text', text: part.value });
          } else if (part instanceof vscode.LanguageModelDataPart) {
            if (part.mimeType.startsWith('image/')) {
              // @ts-ignore: vscode.LanguageModelDataPart.value might be missing in types
              const data = part.value || (part as any).data;
              // Ensure data is in a format ai-sdk accepts (base64 string or Uint8Array)
              userContent.push({ type: 'image', image: data });
            }
          } else if (part instanceof vscode.LanguageModelToolResultPart) {
            toolResults.push(part);
          }
        }

        // 1. 先处理 Tool Results (作为单独的 Tool Message)
        if (toolResults.length > 0) {
          const toolContent: ToolContent = [];

          for (const tr of toolResults) {
            const toolName = toolCallMap.get(tr.callId) || 'unknown';

            // If we can't find the tool name, it means the tool call message is missing from history.
            // We should skip this result to avoid confusing the AI model or causing errors (like "text part not found" from ai-sdk).
            if (toolName === 'unknown') {
              logger.warn(
                `Dropping orphan tool result for callId: ${tr.callId} (No matching tool call found in history)`,
                undefined,
                'MessageConverter'
              );
              continue;
            }

            // Check for images or mixed content
            const hasImage = tr.content.some((c) => c instanceof vscode.LanguageModelDataPart);

            let output: any;

            if (hasImage) {
              const contentParts = tr.content
                .map((c) => {
                  if (c instanceof vscode.LanguageModelTextPart) {
                    return { type: 'text', text: c.value };
                  } else if (c instanceof vscode.LanguageModelDataPart) {
                    // @ts-ignore
                    const data = c.value || (c as any).data;
                    const base64 =
                      data instanceof Uint8Array
                        ? MessageConverter.uint8ArrayToBase64(data)
                        : Buffer.from(data).toString('base64');
                    return {
                      type: 'file-data',
                      data: base64,
                      mediaType: c.mimeType,
                    };
                  }
                  return null;
                })
                .filter((p) => p !== null);
              output = { type: 'content', value: contentParts };
            } else {
              // 提取结果文本
              const resultText = tr.content
                .map((c) => {
                  if (c instanceof vscode.LanguageModelTextPart) {
                    return c.value;
                  }
                  return '';
                })
                .join('');

              // Log result length
              logger.trace(
                `Tool Result: ${toolName} (${tr.callId}) -> ${resultText.length} chars`,
                undefined,
                'MessageConverter'
              );

              output = { type: 'text', value: resultText || 'Success' };
              // Try to parse as JSON if it looks like JSON (starts with { or [)
              const trimmed = resultText.trim();
              if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 100000) {
                try {
                  const json = JSON.parse(resultText);
                  if (typeof json === 'object' && json !== null) {
                    output = { type: 'json', value: json };
                  }
                } catch (e) {
                  // Not valid JSON, keep as text
                }
              }
            }

            toolContent.push({
              type: 'tool-result',
              toolCallId: tr.callId,
              toolName: toolName,
              output: output,
            } as any);
          }

          if (toolContent.length > 0) {
            coreMessages.push({ role: 'tool', content: toolContent });
          }
        }

        // 2. 再处理 User Content (Text/Image)
        if (userContent.length > 0) {
          coreMessages.push({ role: 'user', content: userContent });
        }
      } else if (msg.role === vscode.LanguageModelChatMessageRole.Assistant) {
        const content: AssistantContent = [];
        for (const part of msg.content) {
          if (part instanceof vscode.LanguageModelTextPart) {
            content.push({ type: 'text', text: part.value });
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            content.push({
              type: 'tool-call',
              toolCallId: part.callId,
              toolName: part.name,
              input: part.input,
            } as any);
          }
        }
        // Ensure assistant message has content
        if (content.length > 0) {
          coreMessages.push({ role: 'assistant', content });
        } else {
          // If empty, maybe skip or add placeholder?
          // VS Code might send empty assistant message if it's just a placeholder?
          // Let's log warning
          logger.warn(
            'Encountered empty assistant message, skipping.',
            undefined,
            'MessageConverter'
          );
        }
      }
    }

    // Log the converted messages for debugging at trace level
    logger.trace(
      'Converted Messages count: ' + coreMessages.length,
      coreMessages,
      'MessageConverter'
    );

    return coreMessages;
  }

  static mapChatRole(role: vscode.LanguageModelChatMessageRole): string {
    return role === vscode.LanguageModelChatMessageRole.User ? 'user' : 'assistant';
  }

  static uint8ArrayToBase64(array: Uint8Array): string {
    return Buffer.from(array).toString('base64');
  }

  static extractToolCallFromParts(
    parts: readonly unknown[]
  ): { name: string; arguments: string; id?: string } | undefined {
    for (const part of parts) {
      if (part instanceof vscode.LanguageModelToolCallPart) {
        return { name: part.name, arguments: JSON.stringify(part.input), id: part.callId };
      }
      if (!part || typeof part !== 'object') {
        continue;
      }
      const candidate = part as Record<string, unknown>;
      const name = typeof candidate['name'] === 'string' ? candidate['name'] : undefined;
      const argsRaw = candidate['arguments'] ?? candidate['input'];
      if (!name) {
        continue;
      }
      if (argsRaw === undefined) {
        continue;
      }
      const id =
        typeof candidate['callId'] === 'string'
          ? candidate['callId']
          : typeof candidate['id'] === 'string'
            ? candidate['id']
            : undefined;
      const args = typeof argsRaw === 'string' ? argsRaw : JSON.stringify(argsRaw ?? {});
      const result: { name: string; arguments: string; id?: string } = { name, arguments: args };
      if (id) {
        result.id = id;
      }
      return result;
    }
    return undefined;
  }

  static extractToolResultFromParts(
    parts: readonly unknown[]
  ): { id?: string; content: string } | undefined {
    for (const part of parts) {
      if (part instanceof vscode.LanguageModelToolResultPart) {
        const content = part.content
          .map((p) => {
            if (p instanceof vscode.LanguageModelTextPart) {
              return p.value;
            }
            return '';
          })
          .join('');
        return { id: part.callId, content };
      }
      if (!part || typeof part !== 'object') {
        continue;
      }
      const candidate = part as Record<string, unknown>;
      const id =
        typeof candidate['callId'] === 'string'
          ? candidate['callId']
          : typeof candidate['toolCallId'] === 'string'
            ? candidate['toolCallId']
            : typeof candidate['id'] === 'string'
              ? candidate['id']
              : undefined;
      if (!id) {
        continue;
      }
      const payload = candidate['result'] ?? candidate['output'] ?? candidate['content'];
      const content = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
      return { id, content };
    }
    return undefined;
  }

  static extractSystemMessage(messages: readonly vscode.LanguageModelChatRequestMessage[]): string {
    for (const msg of messages) {
      if (msg.name === 'system') {
        if (typeof msg.content === 'string') {
          return msg.content;
        }
        if (Array.isArray(msg.content)) {
          return (msg.content as Array<unknown>)
            .filter(
              (p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart
            )
            .map((p) => p.value)
            .join('');
        }
        return String(msg.content);
      }
    }
    return '';
  }

  static summarizeMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): {
    total: number;
    byRole: Record<string, number>;
    toolCallMessages: number;
    toolResultMessages: number;
    textCharacters: number;
    attachmentParts: number;
  } {
    const summary = {
      total: messages.length,
      byRole: {} as Record<string, number>,
      toolCallMessages: 0,
      toolResultMessages: 0,
      textCharacters: 0,
      attachmentParts: 0,
    };

    for (const message of messages) {
      const role = this.mapChatRole(message.role);
      summary.byRole[role] = (summary.byRole[role] ?? 0) + 1;
      const parts = Array.isArray(message.content)
        ? (message.content as readonly unknown[])
        : [message.content];

      if (this.extractToolCallFromParts(parts)) {
        summary.toolCallMessages += 1;
      }
      if (this.extractToolResultFromParts(parts)) {
        summary.toolResultMessages += 1;
      }

      for (const part of parts) {
        if (typeof part === 'string') {
          summary.textCharacters += part.length;
          continue;
        }
        if (part instanceof vscode.LanguageModelTextPart) {
          summary.textCharacters += part.value?.length ?? 0;
          continue;
        }
        if (part && typeof part === 'object') {
          const candidate = part as Record<string, unknown>;
          const text = candidate['text'] ?? candidate['value'] ?? candidate['content'];
          if (typeof text === 'string') {
            summary.textCharacters += text.length;
          }
          if (typeof candidate['mimeType'] === 'string' || typeof candidate['type'] === 'string') {
            summary.attachmentParts += 1;
          }
        }
      }
    }

    return summary;
  }
}
