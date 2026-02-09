import * as vscode from 'vscode';
import { streamText, generateText, ModelMessage, Tool } from 'ai';
import { Provider, Model } from '../../common/types';
import { IToolManager, IMcpService } from '../../common/interfaces';
import { AIProviderRegistry } from './aiRegistry';
import { MessageConverter } from './messageConverter';
import { ToolOrchestrator } from './toolOrchestrator';
import { LLMMiddleware } from './middleware';
import { ToolCallCompatibilityMiddleware } from './middleware/toolCallCompatibility/toolCallCompatibility';
import { logger } from '../../common/logger';

export class LLMService {
  private toolOrchestrator: ToolOrchestrator;
  private middlewares: LLMMiddleware[] = [];

  constructor(toolManager?: IToolManager, mcpService?: IMcpService) {
    this.toolOrchestrator = new ToolOrchestrator(toolManager, mcpService);
    this.middlewares.push(new ToolCallCompatibilityMiddleware());
  }

  /**
   * VS Code API compatible chat entry point.
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
    const coreMessages = await MessageConverter.toAiCoreMessages(messages);
    const systemMessage = MessageConverter.extractSystemMessage(messages);
    const tools = await this.toolOrchestrator.prepareTools(options);

    return this.executeDirect(
      provider,
      model,
      coreMessages,
      systemMessage,
      tools,
      progress,
      token,
      {
        onStats,
        onReasoning: (delta: string) => {
          progress.report(new vscode.LanguageModelTextPart(delta));
        },
      } as any
    );
  }

  private async executeDirect(
    provider: Provider,
    model: Model,
    messages: ModelMessage[],
    systemMessage: string | undefined,
    tools: Record<string, Tool>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    options?: {
      onStats?: (stats: any) => void;
      onReasoning?: (delta: string) => void;
    },
    retryCount = 0,
    forcedToolName?: string
  ): Promise<void> {
    const onStats = options?.onStats;
    const onReasoning = options?.onReasoning;
    const requestId = Math.random().toString(36).substring(7);

    try {
      // 1. Apply Middlewares
      let processedMessages = [...messages];
      let processedSystem = systemMessage;

      const context = { provider, modelId: model.id, model, requestId };
      for (const mw of this.middlewares) {
        if (mw.processMessages) {
          const result = await mw.processMessages(processedMessages, context);
          processedMessages = result.messages;
          if (result.system) {
            processedSystem = (processedSystem ? processedSystem + '\n' : '') + result.system;
          }
        }
      }

      const aiModel = AIProviderRegistry.createModel(provider, model.id);
      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());

      let additionalParams: Record<string, any> = {};
      if (model.requestAdditional) {
        try {
          additionalParams = JSON.parse(model.requestAdditional);
        } catch (e) {
          /* ignore */
        }
      }

      let firstTokenTime: number | undefined;

      const baseOptions: any = {
        model: aiModel,
        system: processedSystem,
        messages: processedMessages,
        abortSignal: abortController.signal,
        maxOutputTokens: model.maxOutputTokens,
        temperature: additionalParams['temperature'],
        topP: additionalParams['topP'],
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

      // Force tool choice if this is a retry
      if (forcedToolName && tools[forcedToolName]) {
        // https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling#tool-choice
        // { type: 'tool', toolName: string (typed) } if forcing a specific tool
        baseOptions.toolChoice = { type: 'tool', toolName: forcedToolName };
        logger.info(`[LLMService] Forcing tool call to "${forcedToolName}" for retry.`);
      } else if (retryCount > 0 && Object.keys(tools).length > 0) {
        baseOptions.toolChoice = 'required';
      }

      if (Object.keys(tools).length > 0) {
        baseOptions.tools = tools;
        baseOptions.maxSteps = additionalParams['maxSteps'] ?? 100;
      }

      const useStreaming = additionalParams['stream'] !== false;

      if (!useStreaming) {
        const result = await generateText(baseOptions);
        const steps = (result.steps as any[]) || [];

        let shouldRetry = false;
        let shouldStop = false;

        for (const step of steps) {
          if (step.reasoning) {
            let reasoning =
              typeof step.reasoning === 'string'
                ? step.reasoning
                : step.reasoning.map((r: any) => r.text || '').join('');

            // Apply middlewares to reasoning
            for (const mw of this.middlewares) {
              if (mw.processResponsePart) {
                const mock = mw.processResponsePart(
                  { type: 'text-delta', text: reasoning },
                  context
                );
                reasoning = mock.text;
                if (mock._addiAction === 'retry') {
                  shouldRetry = true;
                }
                if (mock._addiAction === 'stop') {
                  shouldStop = true;
                }
              }
            }

            if (!shouldRetry && !shouldStop && reasoning) {
              if (onReasoning) {
                onReasoning(reasoning);
              }
              progress.report(new vscode.LanguageModelTextPart(reasoning));
            }
          }

          if (shouldRetry || shouldStop) {
            break;
          }

          for (const tc of step.toolCalls || []) {
            progress.report(
              new vscode.LanguageModelToolCallPart(tc.toolCallId, tc.toolName, tc.args || tc.input)
            );
            const tr = step.toolResults?.find((r: any) => r.toolCallId === tc.toolCallId);
            if (tr) {
              const res = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
              progress.report(
                new vscode.LanguageModelToolResultPart(tc.toolCallId, [
                  new vscode.LanguageModelTextPart(res),
                ])
              );
            }
          }
        }

        if (!shouldRetry && !shouldStop && result.text) {
          let text = result.text;
          for (const mw of this.middlewares) {
            if (mw.processResponsePart) {
              const mock = mw.processResponsePart({ type: 'text-delta', text: text }, context);
              text = mock.text;
              if (mock._addiAction === 'retry') {
                shouldRetry = true;
              }
              if (mock._addiAction === 'stop') {
                shouldStop = true;
              }
            }
          }
          if (!firstTokenTime) {
            firstTokenTime = Date.now();
          }
          if (!shouldRetry && !shouldStop) {
            progress.report(new vscode.LanguageModelTextPart(text));
          }
        }

        if (shouldRetry && retryCount < 3) {
          logger.warn(`Middleware requested retry for ${model.id} (non-streaming).`);

          const toolCallId = `retry-${requestId}-${retryCount}`;
          progress.report(
            new vscode.LanguageModelToolCallPart(
              toolCallId,
              `Addi Compatibility (Retry ${retryCount + 1}/3)`,
              { action: 'recovery' }
            )
          );
          progress.report(
            new vscode.LanguageModelToolResultPart(toolCallId, [
              new vscode.LanguageModelTextPart(`Detected unexpected output. Retrying...`),
            ])
          );

          return this.executeDirect(
            provider,
            model,
            messages,
            systemMessage,
            tools,
            progress,
            token,
            options,
            retryCount + 1
          );
        }

        if (shouldRetry && retryCount >= 3) {
          vscode.window.showErrorMessage(
            `Model "${model.name}" is repeatedly outputting unexpected tool calls. Execution stopped after 3 retries.`
          );
          return;
        }

        if (shouldStop) {
          return;
        }
        return;
      }

      const result = await streamText(baseOptions);
      for await (let part of result.fullStream) {
        if (!firstTokenTime) {
          firstTokenTime = Date.now();
        }
        if (token.isCancellationRequested) {
          break;
        }

        // Apply Middlewares to response parts
        for (const mw of this.middlewares) {
          if (mw.processResponsePart) {
            part = mw.processResponsePart(part, context);
          }
        }

        if ((part as any)._addiAction === 'stop') {
          abortController.abort();
          return;
        }

        if ((part as any)._addiAction === 'retry') {
          if (retryCount < 3) {
            abortController.abort();
            const toolName = (part as any)._addiTool;
            const matchedContent = (part as any)._addiMatched || 'unexpected tool call';

            logger.warn(
              `Middleware requested retry for ${model.id} (Attempt ${retryCount + 1}). Content: ${matchedContent}`
            );

            // Inform user via Copilot UI using tool-like status block
            const toolCallId = `retry-${requestId}-${retryCount}`;
            progress.report(
              new vscode.LanguageModelToolCallPart(
                toolCallId,
                `Addi Compatibility (Retry ${retryCount + 1}/3)`,
                { matched: matchedContent }
              )
            );
            progress.report(
              new vscode.LanguageModelToolResultPart(toolCallId, [
                new vscode.LanguageModelTextPart(`Detected unexpected output. Retrying...`),
              ])
            );

            return this.executeDirect(
              provider,
              model,
              messages,
              systemMessage,
              tools,
              progress,
              token,
              options,
              retryCount + 1,
              toolName
            );
          } else {
            abortController.abort();
            vscode.window.showErrorMessage(
              `Model "${model.name}" is repeatedly outputting unexpected tool calls. Execution stopped after 3 retries.`
            );
            return;
          }
        }

        switch (part.type) {
          case 'text-delta':
            progress.report(new vscode.LanguageModelTextPart(part.text));
            break;
          case 'reasoning-delta':
            if (onReasoning) {
              onReasoning(part.text);
            }
            // Still report to VS Code progress for compatibility
            progress.report(new vscode.LanguageModelTextPart(part.text));
            break;
          case 'tool-call':
            progress.report(
              new vscode.LanguageModelToolCallPart(
                part.toolCallId,
                part.toolName,
                (part as any).args || (part as any).input
              )
            );
            break;
          case 'tool-result':
            const toolRes = (part as any).result || (part as any).output;
            const res = typeof toolRes === 'string' ? toolRes : JSON.stringify(toolRes);
            progress.report(
              new vscode.LanguageModelToolResultPart(part.toolCallId, [
                new vscode.LanguageModelTextPart(res),
              ])
            );
            break;
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return;
      }
      logger.error('LLMService executeDirect error', error);
      throw error;
    }
  }
}
