import * as vscode from 'vscode';
import { ModelMessage, UserContent, ToolContent, AssistantContent } from 'ai';
import { logger } from '../../common/logger';
import { UIMessage } from '../../common/types';

export class MessageConverter {
  /**
   * Converts UIMessages to AI SDK Core ModelMessages.
   */
  static uiMessagesToCoreMessages(uiMessages: UIMessage[]): ModelMessage[] {
    return uiMessages.map((msg) => {
      if (msg.role === 'user') {
        return {
          role: 'user',
          content: msg.parts.map((part) => {
            if (part.type === 'text') {
              return { type: 'text', text: part.text };
            }
            if (part.type === 'image') {
              return { 
                type: 'image', 
                image: part.image, 
                mediaType: part.mediaType 
              };
            }
            return { type: 'text', text: '' };
          }) as UserContent,
        };
      } else if (msg.role === 'assistant') {
        const content: AssistantContent = [];
        for (const part of msg.parts) {
          if (part.type === 'text') {
            content.push({ type: 'text', text: part.text });
          } else if (part.type === 'reasoning') {
            content.push({ type: 'reasoning' as any, reasoning: part.reasoning } as any);
          } else if (part.type === 'tool-call') {
            content.push({
              type: 'tool-call',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: part.args,
            } as any);
          }
        }
        return { role: 'assistant', content };
      } else if (msg.role === 'system') {
        const text = msg.parts
          .filter((p) => p.type === 'text')
          .map((p: any) => p.text)
          .join('\n');
        return { role: 'system', content: text };
      }
      // Handle tool role if UIMessage supports it in the future
      return { role: 'user', content: [] };
    });
  }

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

  static extractTextFromMessageParts(parts: readonly unknown[]): string {
    const textParts: string[] = [];
    for (const part of parts) {
      if (this.isImagePart(part)) {
        continue;
      }
      if (typeof part === 'string') {
        textParts.push(part);
        continue;
      }
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part.value ?? '');
        continue;
      }
      if (part && typeof part === 'object') {
        const value = (part as Record<string, unknown>)['value'];
        if (typeof value === 'string') {
          textParts.push(value);
        }
      }
    }
    return textParts.join('');
  }

  static isImagePart(part: unknown): part is vscode.LanguageModelDataPart {
    return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
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

  static toOpenAiMessages(
    messages: readonly vscode.LanguageModelChatRequestMessage[]
  ): Array<Record<string, unknown>> {
    return messages.map((msg) => {
      let role = this.mapChatRole(msg.role);
      if (msg.name === 'system') {
        role = 'system';
      }
      const parts = Array.isArray(msg.content)
        ? (msg.content as readonly unknown[])
        : [msg.content];
      const toolCall = this.extractToolCallFromParts(parts);
      const toolResult = this.extractToolResultFromParts(parts);

      // Handle content parts (text and images)
      const contentParts: any[] = [];
      for (const part of parts) {
        if (this.isImagePart(part)) {
          contentParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${part.mimeType};base64,${this.uint8ArrayToBase64(part.data)}`,
            },
          });
        } else {
          const text = this.extractTextFromMessageParts([part]);
          if (text) {
            contentParts.push({ type: 'text', text });
          }
        }
      }

      if (toolCall) {
        role = 'assistant';
      } else if (toolResult) {
        role = 'tool';
      }

      const entry: Record<string, unknown> = {
        role,
      };

      if (toolCall) {
        const callId = toolCall.id ?? `tool_call_${Math.random().toString(36).slice(2)}`;
        entry['tool_calls'] = [
          {
            type: 'function',
            id: callId,
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          },
        ];
        // OpenAI expects null content for tool calls usually, or it can be present.
        // If we have text content alongside tool call, we should include it?
        // For now, let's keep existing behavior but use contentParts if available and not tool call.
        const contentText = this.extractTextFromMessageParts(parts);
        entry['content'] = contentText || null;
      } else if (toolResult) {
        entry['content'] = toolResult.content;
        if (toolResult.id) {
          entry['tool_call_id'] = toolResult.id;
        }
      } else {
        // If we have mixed content (images), use array. If only text, use string (for better compatibility).
        const hasImage = contentParts.some((p) => p.type === 'image_url');
        if (hasImage) {
          entry['content'] = contentParts;
        } else {
          entry['content'] = this.extractTextFromMessageParts(parts);
        }
      }

      return entry;
    });
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

  static toAnthropicMessages(
    messages: readonly vscode.LanguageModelChatRequestMessage[]
  ): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    for (const msg of messages) {
      if (msg.name === 'system') {
        continue;
      }
      const role = this.mapChatRole(msg.role);

      const parts = Array.isArray(msg.content)
        ? (msg.content as readonly unknown[])
        : [msg.content];
      const contentParts: any[] = [];

      for (const part of parts) {
        if (this.isImagePart(part)) {
          contentParts.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: part.mimeType,
              data: this.uint8ArrayToBase64(part.data),
            },
          });
        } else {
          const text = this.extractTextFromMessageParts([part]);
          if (text) {
            contentParts.push({ type: 'text', text });
          }
        }
      }

      const hasImage = contentParts.some((p) => p.type === 'image');

      if (hasImage) {
        result.push({ role, content: contentParts });
      } else {
        const textContent = contentParts.map((p) => p.text).join('');
        result.push({ role, content: textContent });
      }
    }
    return result;
  }

  static toGoogleMessages(
    messages: readonly vscode.LanguageModelChatRequestMessage[]
  ): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
    let currentRole = '';
    let currentParts: Array<Record<string, unknown>> = [];

    messages.forEach((msg) => {
      if (msg.name === 'system') {
        return;
      }
      const role = msg.role === vscode.LanguageModelChatMessageRole.User ? 'user' : 'model';

      const parts = Array.isArray(msg.content)
        ? (msg.content as readonly unknown[])
        : [msg.content];
      const msgParts: Array<Record<string, unknown>> = [];

      for (const part of parts) {
        if (this.isImagePart(part)) {
          msgParts.push({
            inline_data: {
              mime_type: part.mimeType,
              data: this.uint8ArrayToBase64(part.data),
            },
          });
        } else {
          const text = this.extractTextFromMessageParts([part]);
          if (text) {
            msgParts.push({ text });
          }
        }
      }

      if (role !== currentRole && currentParts.length > 0) {
        contents.push({
          role: currentRole,
          parts: currentParts,
        });
        currentParts = [];
      }

      currentRole = role;
      currentParts.push(...msgParts);
    });

    if (currentParts.length > 0) {
      contents.push({
        role: currentRole,
        parts: currentParts,
      });
    }

    return contents;
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
