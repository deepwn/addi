import * as vscode from 'vscode';
import { streamText, jsonSchema, Tool } from 'ai';
import { Provider, Model } from '../types';
import { AIProviderRegistry } from './aiRegistry';
import { MessageConverter } from './messageConverter';
import { logger } from '../logger';
import { CustomToolManager } from './customToolManager';
import * as cp from 'child_process';
import * as util from 'util';

const exec = util.promisify(cp.exec);
const execFile = util.promisify(cp.execFile);

export class LLMService {
  constructor(private toolManager?: CustomToolManager) {}

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
      // 1. 获取 AI SDK Model
      // 注意：model.id 可能是 "addi-provider:xxx"，我们需要原始的 model id
      // 但在 AddiChatProvider 中已经处理了 sid。
      // 这里传入的 model 是从 repository 查出来的 Model 对象，其 id 应该是原始 id (如 gpt-4)。
      const aiModel = AIProviderRegistry.createModel(provider, model.id);
      
      // 2. 转换消息
      const coreMessages = await MessageConverter.toAiCoreMessages(messages);
      
      // 3. 准备工具
      const tools: Record<string, Tool> = {};
      
      // Add Custom Tools
      if (this.toolManager) {
          const customTools = this.toolManager.getTools();
          logger.debug('LLMService: customTools from manager', { tools: customTools && customTools.length ? customTools.map((t: any) => t.name) : customTools });
          for (const ct of customTools) {
              try {
                tools[ct.name] = {
                    description: ct.description,
                    inputSchema: jsonSchema(ct.parameters),
                    execute: async (args: any) => {
                        // Log tool execution without sensitive args
                        logger.debug(`Executing custom tool ${ct.name}`, { 
                            paramCount: Object.keys(args || {}).length 
                        });
                        let lastResult = '';
                        
                        // Helper for interpolation
                        const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const interpolate = (text: string, data: Record<string, any>) => {
                            let result = text;
                            for (const [key, value] of Object.entries(data)) {
                                // Replace ${key} with value (escape key safely)
                                const pattern = new RegExp('\\$\\{' + escapeRegExp(String(key)) + '\\}', 'g');
                                result = result.replace(pattern, String(value));
                            }
                            return result;
                        };

                        const splitArgsRespectingQuotes = (s: string) => {
                            const parts: string[] = [];
                            let current = '';
                            let inSingle = false;
                            let inDouble = false;
                            for (let i = 0; i < s.length; i++) {
                                const ch = s[i];
                                if (ch === "'" && !inDouble) {
                                    inSingle = !inSingle;
                                    continue;
                                }
                                if (ch === '"' && !inSingle) {
                                    inDouble = !inDouble;
                                    continue;
                                }
                                if (ch === ' ' && !inSingle && !inDouble) {
                                    if (current.length > 0) {
                                        parts.push(current);
                                        current = '';
                                    }
                                    continue;
                                }
                                current += ch;
                            }
                            if (current.length > 0) { parts.push(current); };
                            return parts;
                        };

                        for (const step of ct.steps) {
                             if (step.run) {
                                // New structured form: { command, args[] }
                                if (typeof step.run === 'object' && step.run.command) {
                                    const cmdRendered = interpolate(String(step.run.command), args);
                                    const cmdArgs = (step.run.args || []).map((a: any) => interpolate(String(a), args));
                                    try {
                                        const { stdout, stderr } = await execFile(cmdRendered, cmdArgs as string[]);
                                        lastResult = (stdout || '').toString().trim() || (stderr || '').toString().trim();
                                    } catch (e: any) {
                                        // fallback to shell execution of the reconstructed command for compatibility
                                        try {
                                            const shellCmd = [cmdRendered, ...cmdArgs].join(' ');
                                            const { stdout, stderr } = await exec(shellCmd);
                                            lastResult = stdout.trim() || stderr.trim();
                                        } catch (inner: any) {
                                            throw new Error(`Step ${step.name || 'unknown'} failed: ${inner && inner.message ? inner.message : String(inner)}`);
                                        }
                                    }
                                } else {
                                    // Legacy string form (kept for backward compatibility)
                                    const rendered = interpolate(String(step.run), args);
                                    const tokens = splitArgsRespectingQuotes(rendered);
                                    if (tokens.length === 0) {
                                        continue;
                                    }
                                    const cmd = tokens[0]! as string;
                                    const cmdArgs = tokens.slice(1) as string[];
                                    try {
                                        const { stdout, stderr } = await execFile(cmd, cmdArgs);
                                        lastResult = (stdout || '').toString().trim() || (stderr || '').toString().trim();
                                    } catch (e: any) {
                                        try {
                                            const { stdout, stderr } = await exec(rendered);
                                            lastResult = stdout.trim() || stderr.trim();
                                        } catch (inner: any) {
                                            throw new Error(`Step ${step.name || 'unknown'} failed: ${inner && inner.message ? inner.message : String(inner)}`);
                                        }
                                    }
                                }
                            } else if (step.http) {
                                let url = interpolate(step.http.url, args);
                                const method = step.http.method || 'POST';
                                const headers = step.http.headers || { 'Content-Type': 'application/json' };
                                
                                // Interpolate headers
                                for (const key in headers) {
                                    const val = headers[key];
                                    if (val) {
                                        headers[key] = interpolate(val, args);
                                    }
                                }

                                let body = null;
                                if (step.http.body) {
                                    const bodyStr = typeof step.http.body === 'string' 
                                        ? step.http.body 
                                        : JSON.stringify(step.http.body);
                                    body = interpolate(bodyStr, args);
                                } else if (method !== 'GET') {
                                    // Default: send all args as JSON if no body specified
                                    body = JSON.stringify(args);
                                }

                                try {
                                    const response = await fetch(url, {
                                        method,
                                        headers,
                                        body
                                    });
                                    lastResult = await response.text();
                                } catch (e: any) {
                                     throw new Error(`Step ${step.name || 'unknown'} failed: ${e.message}`);
                                }
                            }
                        }
                        return lastResult;
                    }
                } as any;
              } catch (e) {
                  logger.error(`Failed to register custom tool ${ct.name}`, e);
              }
          }
      }

      // @ts-ignore: options.tools might exist in runtime even if not in d.ts
      const providedTools = (options as any)?.tools as vscode.LanguageModelChatTool[] | undefined;
      
      if (providedTools && providedTools.length > 0) {
          for (const tool of providedTools) {
              let schema: any;
              try {
                  schema = tool.inputSchema ? JSON.parse(JSON.stringify(tool.inputSchema)) : { type: 'object', properties: {} };
              } catch (e) {
                  logger.error(`Failed to clone schema for tool ${tool.name}, using default object schema`, e);
                  schema = { type: 'object', properties: {} };
              }
              
              // Ensure schema is of type object, as required by ai-sdk and DeepSeek
              sanitizeSchema(schema);
              
              // Double check top-level is object
              if (schema.type !== 'object') {
                   logger.error(`Tool ${tool.name} has non-object schema type: ${schema.type}. Forcing to object.`);
                   schema.type = 'object';
              }

              if (!schema.properties) {
                  schema.properties = {};
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
                  description: tool.description && tool.description.length > 50 ? tool.description.substring(0, 50) + '...' : tool.description,
                  propertyCount: logSchema.properties ? Object.keys(logSchema.properties).length : 0
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
              logger.warn("Failed to parse requestAdditional", e);
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
                    tokenCount: usage.outputTokens || 0
                });
            }
        }
      };

      logger.debug('LLMService: tools registered at call time', { tools: Object.keys(tools) });
      if (Object.keys(tools).length > 0) {
          streamOptions.tools = tools;
          // maxSteps is deprecated/removed in newer ai-sdk versions (since v5)
          // Let the SDK manage tool calling limits automatically
      }

      const result = streamText(streamOptions);

      // 6. 处理流式响应
      const streamStartTime = Date.now();
      logger.info("Stream processing started", { 
          modelId: model.id, 
          messageCount: coreMessages.length,
          toolCount: Object.keys(tools).length 
      });
      
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
            logger.debug("Tool Call", { toolCallId: part.toolCallId, toolName: part.toolName });
            // If this is a VS Code provided tool, report to VS Code to execute it.
            const isProvidedTool = providedTools?.some(t => t.name === part.toolName);
            const args = (part as any).args ?? (part as any).input;

            if (isProvidedTool) {
                progress.report(new vscode.LanguageModelToolCallPart(part.toolCallId, part.toolName, args));
                hasOutput = true;
                continue;
            }

            // If we have a custom tool registered in `tools` with an execute function, run it locally
            const registeredTool = (tools as any)[part.toolName];
            // Debug: log whether we found the registered tool and if it exposes execute
            logger.debug('LLMService: tool-call', { toolName: part.toolName, registeredToolExists: !!registeredTool, hasExecute: registeredTool && typeof registeredTool.execute === 'function' });
            if (registeredTool && typeof registeredTool.execute === 'function') {
                try {
                    const execResult = await registeredTool.execute(args ?? {});
                    // Wrap the result as LanguageModelTextPart inside a LanguageModelToolResultPart
                    const contentParts: vscode.LanguageModelResponsePart[] = [];
                    if (typeof execResult === 'string') {
                        contentParts.push(new vscode.LanguageModelTextPart(execResult));
                    } else if (execResult instanceof Uint8Array) {
                        contentParts.push(new vscode.LanguageModelDataPart(execResult, 'application/octet-stream'));
                    } else if (execResult && typeof execResult === 'object' && execResult.text) {
                        contentParts.push(new vscode.LanguageModelTextPart(String(execResult.text)));
                    } else {
                        contentParts.push(new vscode.LanguageModelTextPart(String(execResult)));
                    }

                    try {
                        progress.report(new vscode.LanguageModelToolResultPart(part.toolCallId, contentParts));
                    } catch (e) {
                        // Fallback: report as text if ToolResultPart is not constructible in this environment
                        progress.report(new vscode.LanguageModelTextPart(String(execResult)));
                    }
                    hasOutput = true;
                } catch (e: any) {
                    logger.error(`Custom tool ${part.toolName} execution failed`, e);
                    const msg = `Tool \"${part.toolName}\" execution error: ${e && e.message ? e.message : String(e)}`;
                    // Report error back to model so it can retry or choose another action
                        // Also send a ToolResultPart containing structured error info so the model
                        // receives a tool-result (with error) in protocol form. This increases
                        // the chance the model will re-issue the tool-call or choose another action.
                        const errorPayload = { error: true, message: e && e.message ? e.message : String(e) };
                        const contentPartsForToolResult: vscode.LanguageModelResponsePart[] = [];
                        try {
                            contentPartsForToolResult.push(new vscode.LanguageModelTextPart(JSON.stringify(errorPayload)));
                            contentPartsForToolResult.push(new vscode.LanguageModelTextPart(msg));
                            progress.report(new vscode.LanguageModelToolResultPart(part.toolCallId, contentPartsForToolResult));
                        } catch (inner) {
                            // If ToolResultPart can't be constructed in this environment, fall back to text
                            progress.report(new vscode.LanguageModelTextPart(JSON.stringify(errorPayload)));
                            progress.report(new vscode.LanguageModelTextPart(msg));
                        }
                        hasOutput = true;
                }
            } else {
                logger.error(`Tool call for unknown tool: ${part.toolName}, ignoring. Available tools: ${Object.keys(tools).join(', ')}`);
            }
        } else if (part.type === 'tool-result') {
            logger.debug("Tool Result", { toolCallId: part.toolCallId, toolName: part.toolName });
            // If the tool result contains an error, report a sanitized error back to the model
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
                const retryMessage = `Tool "${part.toolName}" failed${errorCode ? ` (${errorCode})` : ''}: ${safeMessage}. Please try calling this tool again with corrected parameters or use an alternative approach.`;

                // Report the error back to the model as a text part so the model can decide next steps
                // Use plain text instead of JSON for better model understanding
                progress.report(new vscode.LanguageModelTextPart(retryMessage));
                hasOutput = true;

                // Also log the JSON payload for debugging
                logger.info("Tool error reported to model", { toolName: part.toolName, toolCallId: part.toolCallId, message: retryMessage });
            }
        } else if (part.type === 'error') {
             logger.error("Stream Error", part.error);
             throw part.error;
        }
      }
      
      const streamDuration = Date.now() - streamStartTime;
      logger.info("Stream processing completed", { 
          duration: streamDuration, 
          hasOutput,
          outputCount: hasOutput ? 1 : 0
      });
      
      if (!hasOutput) {
          logger.error("Stream finished with no text output");
      }

    } catch (error) {
      logger.error('LLMService chat error', error);
      // 重新抛出以便上层处理
      throw error;
    }
  }
}

function sanitizeSchema(schema: any) {
    if (!schema || typeof schema !== 'object') { return; }

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
        // Missing type
        if (schema.properties) {
            schema.type = 'object';
        } else if (schema.items) {
            schema.type = 'array';
        } 
        // If no properties/items, leave it undefined? 
        // Some schemas rely on inference, but explicit is better.
    }

    // Enforce additionalProperties: false for objects (OpenAI/DeepSeek requirement)
    if (schema.type === 'object') {
        if (schema.additionalProperties !== false) {
            schema.additionalProperties = false;
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
    ['anyOf', 'oneOf', 'allOf'].forEach(combinator => {
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
