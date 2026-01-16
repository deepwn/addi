import * as vscode from 'vscode';
import { streamText, generateText, jsonSchema, Tool } from 'ai';
import { Provider, Model } from '../../common/types';
import { IToolManager, IMcpService } from '../../common/interfaces';
import { AIProviderRegistry } from './aiRegistry';
import { MessageConverter } from './messageConverter';
import { logger } from '../../common/logger';

export class LLMService {
  constructor(
    private toolManager?: IToolManager,
    private mcpService?: IMcpService
  ) {}

  /**
   * Orchestrates the chat interaction using Vercel AI SDK.
   *
   * Flow:
   * 1. Factory Creation: Creates specific AI model instance (OpenAI/Anthropic/DeepSeek etc).
   * 2. Message Conversion: Transforms VS Code chat messages to AI SDK CoreMessage format.
   * 3. Tool Registration:
   *    - Custom Tools (from yaml/json): Registered with execution handlers via MCP.
   *    - Host Tools (from VS Code): Registered as pass-through tools.
   * 4. Streaming: Initiates `streamText` with multi-step support (`stopWhen`).
   * 5. Response Handling: Converts AI SDK stream parts (text/tool-calls) back to VS Code format.
   */
  async chat(
    provider: Provider,
    model: Model,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    onStats?: (stats: { firstTokenTime: number; endTime: number; tokenCount: number }) => void
  ): Promise<void> {
    try {
      // 1. Create AI SDK Model Instance
      const aiModel = AIProviderRegistry.createModel(provider, model.id);

      // 2. 转换消息
      const coreMessages = await MessageConverter.toAiCoreMessages(messages);

      // 3. 准备工具
      const tools: Record<string, Tool> = {};

      // Add Custom Tools
      if (this.toolManager) {
        const customTools = this.toolManager.getTools();
        logger.debug('LLMService: customTools from manager', {
          tools:
            customTools && customTools.length ? customTools.map((t: any) => t.name) : customTools,
        });
        for (const ct of customTools) {
          try {
            // Clone and sanitize the schema to ensure compatibility (e.g. DeepSeek requires specific types)
            const schema = JSON.parse(JSON.stringify(ct.parameters));
            sanitizeSchema(schema);

            // Ensure top-level is object as required by many LLM providers
            if (schema.type !== 'object') {
              schema.type = 'object';
              if (!schema.properties) {
                schema.properties = {};
              }
            }

            tools[ct.name] = {
              description: ct.description,
              inputSchema: jsonSchema(schema),
              execute: async (args: any) => {
                // Log tool execution without sensitive args
                logger.debug(`Executing custom tool ${ct.name}`, {
                  paramCount: Object.keys(args || {}).length,
                });

                if (!this.mcpService) {
                  return 'Error: MCP Service not available for tool execution.';
                }

                try {
                  const result = await this.mcpService.callTool(ct.name, args);

                  // MCP result structure: { content: [{ type: 'text', text: '...' }], isError: boolean }
                  if (result.content && Array.isArray(result.content)) {
                    const parts = result.content.map((p: any) => {
                      if (p.type === 'text') {
                        return p.text;
                      }
                      return '';
                    });
                    return parts.join('\n');
                  }
                  return 'Tool executed successfully with no output.';
                } catch (e: any) {
                  logger.error(`Error executing ${ct.name} via MCP`, e);
                  return `Error executing tool '${ct.name}': ${e.message}`;
                }
              },
            };
          } catch (e) {
            logger.error(`Failed to register custom tool ${ct.name} for AI SDK`, e);
          }
        }
      }

      // @ts-ignore: options.tools might exist in runtime even if not in d.ts
      const providedTools = (options as any)?.tools as vscode.LanguageModelChatTool[] | undefined;

      if (providedTools && providedTools.length > 0) {
        for (const tool of providedTools) {
          let schema: any;
          try {
            schema = tool.inputSchema
              ? JSON.parse(JSON.stringify(tool.inputSchema))
              : { type: 'object', properties: {} };
          } catch (e) {
            logger.error(
              `Failed to clone schema for tool ${tool.name}, using default object schema`,
              e
            );
            schema = { type: 'object', properties: {} };
          }

          // Ensure it's an object schema, which is required for AI SDK tools
          sanitizeSchema(schema);
          if (schema.type !== 'object') {
            schema.type = 'object';
            if (!schema.properties) {
              schema.properties = {};
            }
          }

          // Create a simplified schema for logging to avoid clutter
          const logSchema = JSON.parse(JSON.stringify(schema));
          if (tool.description && tool.description.length > 50) {
            // We are logging the tool registration, not the tool object itself here,
            // but the schema might contain descriptions in properties.
            // Let's just log the tool name and a truncated description.
          }
          // Truncate property descriptions in the log schema
          if (logSchema.properties) {
            for (const key in logSchema.properties) {
              const prop = logSchema.properties[key];
              if (prop.description && prop.description.length > 50) {
                prop.description = prop.description.substring(0, 50) + '...';
              }
            }
          }

          // Log tool registration without sensitive schema details
          logger.info(`Registering tool: ${tool.name}`, {
            description:
              tool.description && tool.description.length > 50
                ? tool.description.substring(0, 50) + '...'
                : tool.description,
            propertyCount: logSchema.properties ? Object.keys(logSchema.properties).length : 0,
          });

          try {
            tools[tool.name] = {
              description: tool.description,
              inputSchema: jsonSchema(schema),
            } as any;
          } catch (e) {
            logger.error(`Failed to register provided tool ${tool.name} due to schema error`, e);
            // Skip this tool instead of crashing the whole chat
            continue;
          }
        }
      }

      // 4. 提取生成参数
      // 尝试从 model.requestAdditional 解析参数
      let additionalParams: Record<string, any> = {};
      if (model.requestAdditional) {
        try {
          additionalParams = JSON.parse(model.requestAdditional);
        } catch (e) {
          logger.warn('Failed to parse requestAdditional', e);
        }
      }

      let firstTokenTime: number | undefined;
      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());

      // 5. 调用 streamText
      const streamOptions: any = {
        model: aiModel,
        messages: coreMessages,
        abortSignal: abortController.signal,
        maxOutputTokens: model.maxOutputTokens,
        temperature: additionalParams['temperature'],
        topP: additionalParams['topP'],
        presencePenalty: additionalParams['presencePenalty'],
        frequencyPenalty: additionalParams['frequencyPenalty'],
        onFinish: ({ usage }: any) => {
          if (onStats && usage) {
            onStats({
              firstTokenTime: firstTokenTime || Date.now(),
              endTime: Date.now(),
              tokenCount: usage.outputTokens || 0,
            });
          }
        },
      };

      logger.debug('LLMService: tools registered at call time', { tools: Object.keys(tools) });
      if (Object.keys(tools).length > 0) {
        streamOptions.tools = tools;
        // Enable multi-step tool calls
        // Precedence: 1. Model-specific JSON setting, 2. Global setting, 3. Hardcoded safe default 100
        const globalMaxSteps = vscode.workspace.getConfiguration('addi').get<number | null>('maxToolChainSteps');
        streamOptions.maxSteps = additionalParams['maxSteps'] ?? globalMaxSteps ?? 100;
      }

      // Check if non-streaming is explicitly requested
      const useStreaming = additionalParams['stream'] !== false;

      if (!useStreaming) {
        logger.info('Using non-streaming request (generateText)', { modelId: model.id });
        const result = await generateText(streamOptions);

        // 1. Report reasoning and tool calls from each step
        for (const step of result.steps as any[]) {
          // reasoning
          if (step.reasoning) {
            if (typeof step.reasoning === 'string') {
              progress.report(new vscode.LanguageModelTextPart(step.reasoning));
            } else if (Array.isArray(step.reasoning)) {
              const reasoningText = step.reasoning.map((r: any) => r.text || '').join('');
              if (reasoningText) {
                progress.report(new vscode.LanguageModelTextPart(reasoningText));
              }
            }
          }

          // tool calls and results
          if (step.toolCalls) {
            for (const toolCall of step.toolCalls) {
              progress.report(
                new vscode.LanguageModelToolCallPart(
                  toolCall.toolCallId,
                  toolCall.toolName,
                  toolCall.args || toolCall.input
                )
              );

              // find corresponding result in this step
              const toolResult = step.toolResults?.find(
                (r: any) => r.toolCallId === toolCall.toolCallId
              );
              if (toolResult) {
                const res = toolResult.result;
                const contentParts: vscode.LanguageModelResponsePart[] = [];
                if (typeof res === 'string') {
                  contentParts.push(new vscode.LanguageModelTextPart(res));
                } else {
                  contentParts.push(new vscode.LanguageModelTextPart(JSON.stringify(res)));
                }
                progress.report(new vscode.LanguageModelToolResultPart(toolCall.toolCallId, contentParts));
              }
            }
          }
        }

        // 2. Report final text
        if (result.text) {
          if (!firstTokenTime) {
            firstTokenTime = Date.now();
          }
          progress.report(new vscode.LanguageModelTextPart(result.text));
        }

        if (onStats && result.usage) {
          onStats({
            firstTokenTime: firstTokenTime || Date.now(),
            endTime: Date.now(),
            tokenCount: result.usage.outputTokens || 0,
          });
        }
        return;
      }

      const result = streamText(streamOptions);

      // 6. 处理流式响应
      const streamStartTime = Date.now();
      logger.info(
        'Stream processing started',
        {
          modelId: model.id,
          messageCount: coreMessages.length,
          toolCount: Object.keys(tools).length,
        },
        'LLM'
      );

      let hasOutput = false;
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          if (!firstTokenTime) {
            firstTokenTime = Date.now();
          }
          hasOutput = true;
          progress.report(new vscode.LanguageModelTextPart(part.text));
        } else if (part.type === 'reasoning-delta') {
          if (!firstTokenTime) {
            firstTokenTime = Date.now();
          }
          hasOutput = true;
          // Output reasoning as text, maybe italicized or quoted if markdown supported,
          // but LanguageModelTextPart is plain text usually interpreted as markdown in chat.
          // We'll just stream it. Users can distinguish contextually.
          progress.report(new vscode.LanguageModelTextPart(part.text));
        } else if (part.type === 'tool-call') {
          const args = (part as any).args ?? (part as any).input;
          logger.trace(
            'Tool Call received',
            { toolCallId: part.toolCallId, toolName: part.toolName, args },
            'LLM'
          );
          // Report the tool call to VS Code (UI)
          // Whether it's a client-side tool (providedTools) or server-side tool (customTools),
          // we notify VS Code that a tool is being called.
          progress.report(
            new vscode.LanguageModelToolCallPart(part.toolCallId, part.toolName, args)
          );
          hasOutput = true;

          // Note: We do NOT execute the tool manually here anymore.
          // Since we enabled `stopWhen` (multi-step) and provided `execute` functions for custom tools,
          // the AI SDK will automatically execute the tool and emit a `tool-result` part later in the stream.
        } else if (part.type === 'tool-result') {
          const result = (part as any).result;
          logger.trace(
            'Tool Result received',
            { toolCallId: part.toolCallId, toolName: part.toolName, result },
            'LLM'
          );

          // 1. Report the result to VS Code so it appears in the chat history
          if (result !== undefined) {
            const contentParts: vscode.LanguageModelResponsePart[] = [];
            if (typeof result === 'string') {
              contentParts.push(new vscode.LanguageModelTextPart(result));
            } else if (result && typeof result === 'object') {
              contentParts.push(new vscode.LanguageModelTextPart(JSON.stringify(result)));
            } else {
              contentParts.push(new vscode.LanguageModelTextPart(String(result)));
            }

            try {
              progress.report(
                new vscode.LanguageModelToolResultPart(part.toolCallId, contentParts)
              );
              hasOutput = true;
            } catch (e) {
              // Fallback if ToolResultPart fails
              logger.warn('Failed to report ToolResultPart', e);
            }
          }

          // 2. Handle errors (if any)
          const toolErr = (part as any).error ?? (part as any).result?.error ?? null;
          if (toolErr) {
            // Log full error server-side for debugging
            logger.error(`Tool ${part.toolName} returned error`, toolErr);

            // Build a safe, truncated message for the model (no stacktraces, no secrets)
            let rawMessage: string;
            if (typeof toolErr === 'string') {
              rawMessage = toolErr;
            } else if (toolErr && typeof toolErr.message === 'string') {
              rawMessage = toolErr.message;
            } else {
              rawMessage = String(toolErr);
            }

            const safeMessage = rawMessage.replace(/\s+/g, ' ').trim().slice(0, 1024);
            const errorCode = (toolErr && (toolErr.code ?? toolErr.status)) || null;

            // Create a clear, human-readable error message with retry suggestion
            const retryMessage = `Tool "${part.toolName}" failed${
              errorCode ? ` (${errorCode})` : ''
            }: ${safeMessage}. Please try calling this tool again with corrected parameters or use an alternative approach.`;

            // Report the error back to the model as a text part so the model can decide next steps
            // Use plain text instead of JSON for better model understanding
            progress.report(new vscode.LanguageModelTextPart(retryMessage));
            hasOutput = true;

            // Also log the JSON payload for debugging
            logger.info('Tool error reported to model', {
              toolName: part.toolName,
              toolCallId: part.toolCallId,
              message: retryMessage,
            });
          }
        } else if (part.type === 'error') {
          logger.error('Stream Error', part.error);
          throw part.error;
        }
      }

      const streamDuration = Date.now() - streamStartTime;
      logger.info('Stream processing completed', {
        duration: streamDuration,
        hasOutput,
        outputCount: hasOutput ? 1 : 0,
      });

      if (!hasOutput) {
        logger.error('Stream finished with no text output');
      }
    } catch (error) {
      logger.error('LLMService chat error', error);
      // 重新抛出以便上层处理
      throw error;
    }
  }
}

function sanitizeSchema(schema: any) {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  // Handle type property
  if (Array.isArray(schema.type)) {
    // If type is array (e.g. ["string", "null"]), pick the first non-null type
    const nonNull = schema.type.find((t: any) => t !== 'null');
    if (nonNull) {
      schema.type = nonNull;
    } else {
      // If all are null (weird), default to string
      schema.type = 'string';
    }
  } else if (schema.type === 'null') {
    // DeepSeek doesn't like type: null
    schema.type = 'string';
  } else if (!schema.type) {
    // Missing type or completely empty schema
    if (schema.properties) {
      schema.type = 'object';
    } else if (schema.items) {
      schema.type = 'array';
    } else {
      // Default to object for tool inputs
      schema.type = 'object';
    }
  }

  // Enforce additionalProperties: false and ensure properties exists for objects
  if (schema.type === 'object') {
    if (!schema.properties) {
      schema.properties = {};
    }
    if (schema.additionalProperties !== false) {
      schema.additionalProperties = false;
    }

    // Ensure required fields exist in properties
    if (Array.isArray(schema.required)) {
      schema.required = schema.required.filter((req: string) => {
        return schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, req);
      });
    }
  }

  // Recursively sanitize properties
  if (schema.properties) {
    for (const key in schema.properties) {
      sanitizeSchema(schema.properties[key]);
    }
  }

  // Recursively sanitize array items
  if (schema.items) {
    sanitizeSchema(schema.items);
  }

  // Handle combinators (anyOf, oneOf, allOf)
  ['anyOf', 'oneOf', 'allOf'].forEach((combinator) => {
    if (Array.isArray(schema[combinator])) {
      // Filter out {type: 'null'} options which are common in nullable schemas
      const originalLength = schema[combinator].length;
      schema[combinator] = schema[combinator].filter((subSchema: any) => {
        return subSchema.type !== 'null';
      });

      // If we filtered everything out (e.g. it was just null), fallback to string
      if (schema[combinator].length === 0 && originalLength > 0) {
        delete schema[combinator];
        if (!schema.type) {
          schema.type = 'string';
        }
      } else {
        // Recursively sanitize remaining options
        schema[combinator].forEach((subSchema: any) => sanitizeSchema(subSchema));
      }
    }
  });
}
