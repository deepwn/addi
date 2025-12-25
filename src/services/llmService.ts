import * as vscode from "vscode";
import { streamText, jsonSchema, tool, Tool } from "ai";
import { Provider, Model } from "../types";
import { AIProviderRegistry } from "./aiRegistry";
import { MessageConverter } from "./messageConverter";
import { logger } from "../logger";
import { CustomToolManager } from "./customToolManager";
import * as cp from "child_process";
import * as util from "util";

const exec = util.promisify(cp.exec);

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
        for (const ct of customTools) {
          try {
            tools[ct.name] = tool({
              description: ct.description,
              inputSchema: jsonSchema(ct.parameters),
              execute: async (args: any) => {
                logger.info(`Executing custom tool ${ct.name}`, args);
                let lastResult = "";

                // Helper for interpolation
                const interpolate = (text: string, data: Record<string, any>) => {
                  let result = text;
                  for (const [key, value] of Object.entries(data)) {
                    // Replace ${key} with value
                    result = result.replace(new RegExp(`\\$\{${key}\}`, "g"), String(value));
                  }
                  return result;
                };

                for (const step of ct.steps) {
                  if (step.run) {
                    let cmd = interpolate(step.run, args);
                    try {
                      const { stdout, stderr } = await exec(cmd);
                      lastResult = stdout.trim() || stderr.trim();
                    } catch (e: any) {
                      throw new Error(`Step ${step.name || "unknown"} failed: ${e.message}`);
                    }
                  } else if (step.http) {
                    let url = interpolate(step.http.url, args);
                    const method = step.http.method || "POST";
                    const headers = step.http.headers || { "Content-Type": "application/json" };

                    // Interpolate headers
                    for (const key in headers) {
                      const val = headers[key];
                      if (val) {
                        headers[key] = interpolate(val, args);
                      }
                    }

                    let body = null;
                    if (step.http.body) {
                      const bodyStr = typeof step.http.body === "string" ? step.http.body : JSON.stringify(step.http.body);
                      body = interpolate(bodyStr, args);
                    } else if (method !== "GET") {
                      // Default: send all args as JSON if no body specified
                      body = JSON.stringify(args);
                    }

                    try {
                      const response = await fetch(url, {
                        method,
                        headers,
                        body,
                      });
                      lastResult = await response.text();
                    } catch (e: any) {
                      throw new Error(`Step ${step.name || "unknown"} failed: ${e.message}`);
                    }
                  }
                }
                return lastResult;
              },
            } as any);
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
            schema = tool.inputSchema ? JSON.parse(JSON.stringify(tool.inputSchema)) : { type: "object", properties: {} };
          } catch (e) {
            logger.warn(`Failed to clone schema for tool ${tool.name}, using default object schema`, e);
            schema = { type: "object", properties: {} };
          }

          // Ensure schema is of type object, as required by ai-sdk and DeepSeek
          sanitizeSchema(schema);

          // Double check top-level is object
          if (schema.type !== "object") {
            logger.warn(`Tool ${tool.name} has non-object schema type: ${schema.type}. Forcing to object.`);
            schema.type = "object";
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
                prop.description = prop.description.substring(0, 50) + "...";
              }
            }
          }

          logger.info(`Registering tool: ${tool.name}`);

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
        temperature: additionalParams["temperature"],
        topP: additionalParams["topP"],
        presencePenalty: additionalParams["presencePenalty"],
        frequencyPenalty: additionalParams["frequencyPenalty"],
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

      if (Object.keys(tools).length > 0) {
        streamOptions.tools = tools;
        streamOptions.maxSteps = 10;
      }

      const result = streamText(streamOptions);

      // 6. 处理流式响应
      let hasOutput = false;
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          if (!firstTokenTime) {
            firstTokenTime = Date.now();
          }
          hasOutput = true;
          progress.report(new vscode.LanguageModelTextPart(part.text));
        } else if (part.type === "tool-call") {
          logger.info("Tool Call", part);
          // Check if this tool is one of the providedTools (VS Code tools)
          const isProvidedTool = providedTools?.some((t) => t.name === part.toolName);
          if (isProvidedTool) {
            // Report to VS Code so it can execute the tool
            // Note: ai-sdk part might use 'args' or 'input' depending on version/type
            const args = (part as any).args ?? (part as any).input;
            progress.report(new vscode.LanguageModelToolCallPart(part.toolCallId, part.toolName, args));
            hasOutput = true; // Tool call counts as output
          }
        } else if (part.type === "tool-result") {
          logger.info("Tool Result", part);
        } else if (part.type === "error") {
          logger.error("Stream Error", part.error);
          throw part.error;
        }
      }

      if (!hasOutput) {
        logger.warn("Stream finished with no text output");
      }
    } catch (error) {
      logger.error("LLMService chat error", error);
      // 重新抛出以便上层处理
      throw error;
    }
  }
}

function sanitizeSchema(schema: any) {
  if (!schema || typeof schema !== "object") {
    return;
  }

  // Handle type property
  if (Array.isArray(schema.type)) {
    // If type is array (e.g. ["string", "null"]), pick the first non-null type
    const nonNull = schema.type.find((t: any) => t !== "null");
    if (nonNull) {
      schema.type = nonNull;
    } else {
      // If all are null (weird), default to string
      schema.type = "string";
    }
  } else if (schema.type === "null") {
    // DeepSeek doesn't like type: null
    schema.type = "string";
  } else if (!schema.type) {
    // Missing type
    if (schema.properties) {
      schema.type = "object";
    } else if (schema.items) {
      schema.type = "array";
    }
    // If no properties/items, leave it undefined?
    // Some schemas rely on inference, but explicit is better.
  }

  // Enforce additionalProperties: false for objects (OpenAI/DeepSeek requirement)
  if (schema.type === "object") {
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
  ["anyOf", "oneOf", "allOf"].forEach((combinator) => {
    if (Array.isArray(schema[combinator])) {
      // Filter out {type: 'null'} options which are common in nullable schemas
      const originalLength = schema[combinator].length;
      schema[combinator] = schema[combinator].filter((subSchema: any) => {
        return subSchema.type !== "null";
      });

      // If we filtered everything out (e.g. it was just null), fallback to string
      if (schema[combinator].length === 0 && originalLength > 0) {
        delete schema[combinator];
        if (!schema.type) {
          schema.type = "string";
        }
      } else {
        // Recursively sanitize remaining options
        schema[combinator].forEach((subSchema: any) => sanitizeSchema(subSchema));
      }
    }
  });
}
