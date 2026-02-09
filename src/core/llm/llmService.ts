import * as vscode from 'vscode';
import { streamText, generateText, ModelMessage, Tool } from 'ai';
import { Provider, Model } from '../../common/types';
import { IToolManager, IMcpService } from '../../common/interfaces';
import { AIProviderRegistry } from './aiRegistry';
import { MessageConverter } from './messageConverter';
import { ToolOrchestrator } from './toolOrchestrator';
import { logger } from '../../common/logger';

// ============================================================================
// Types & Interfaces
// ============================================================================

interface ExecutionOptions {
  onStats?:
    | ((stats: { firstTokenTime: number; endTime: number; tokenCount: number }) => void)
    | undefined;
  onReasoning?: ((delta: string) => void) | undefined;
}

// ============================================================================
// LLM Service - Main Entry Point
// ============================================================================

export class LLMService {
  private readonly toolOrchestrator: ToolOrchestrator;

  constructor(toolManager?: IToolManager, mcpService?: IMcpService) {
    this.toolOrchestrator = new ToolOrchestrator(toolManager, mcpService);
  }

  // ========================================================================
  // Public API - VS Code Language Model Chat Entry Point
  // ========================================================================

  /**
   * VS Code API compatible chat entry point.
   *
   * @param provider - The AI provider configuration
   * @param model - The model configuration
   * @param messages - VS Code chat request messages
   * @param options - Language model response options
   * @param progress - Progress reporter for streaming response parts
   * @param token - Cancellation token
   * @param onStats - Optional callback for statistics
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
    // Convert VS Code messages to AI SDK format
    const coreMessages = await MessageConverter.toAiCoreMessages(messages);
    const systemMessage = MessageConverter.extractSystemMessage(messages);
    const tools = await this.toolOrchestrator.prepareTools(options);

    // Execute the chat request
    return this.executeDirect(
      provider,
      model,
      coreMessages,
      systemMessage,
      tools,
      progress,
      token,
      { onStats }
    );
  }

  // ========================================================================
  // Core Execution Logic
  // ========================================================================

  /**
   * Main execution method that handles both streaming and non-streaming requests.
   */
  private async executeDirect(
    provider: Provider,
    model: Model,
    messages: ModelMessage[],
    systemMessage: string | undefined,
    tools: Record<string, Tool>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    options: ExecutionOptions
  ): Promise<void> {
    try {
      // Build AI SDK options
      const aiOptions = this.buildAiOptions(
        provider,
        model,
        messages,
        systemMessage,
        tools,
        options
      );

      // Execute based on streaming preference
      const additionalParams = this.parseAdditionalParams(model);
      const useStreaming = additionalParams['stream'] !== false;

      if (useStreaming) {
        await this.executeStreaming(aiOptions, progress, token, options);
      } else {
        await this.executeNonStreaming(aiOptions, progress, options);
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Parse additional parameters from model configuration.
   */
  private parseAdditionalParams(model: Model): Record<string, any> {
    if (!model.requestAdditional) {
      return {};
    }

    try {
      return JSON.parse(model.requestAdditional);
    } catch {
      return {};
    }
  }

  /**
   * Build AI SDK options object.
   */
  private buildAiOptions(
    provider: Provider,
    model: Model,
    messages: ModelMessage[],
    system: string | undefined,
    tools: Record<string, Tool>,
    options: ExecutionOptions
  ): any {
    const aiModel = AIProviderRegistry.createModel(provider, model.id);
    const additionalParams = this.parseAdditionalParams(model);

    const baseOptions: any = {
      model: aiModel,
      system,
      messages,
      abortSignal: new AbortController().signal,
      maxOutputTokens: model.maxOutputTokens,
      temperature: additionalParams['temperature'],
      topP: additionalParams['topP'],
      onFinish: ({ usage }: any) => {
        if (options.onStats && usage) {
          options.onStats({
            firstTokenTime: Date.now(),
            endTime: Date.now(),
            tokenCount: usage.outputTokens || 0,
          });
        }
      },
    };

    // Add tools if present
    if (Object.keys(tools).length > 0) {
      baseOptions.tools = tools;
      baseOptions.maxSteps = additionalParams['maxSteps'] ?? 100;
    }

    // Merge remaining additional params (excluding those already explicitly handled)
    const handledParams = ['temperature', 'topP', 'maxSteps'];
    for (const [key, value] of Object.entries(additionalParams)) {
      if (!handledParams.includes(key) && value !== undefined) {
        baseOptions[key] = value;
      }
    }

    return baseOptions;
  }

  // ========================================================================
  // Streaming Execution
  // ========================================================================

  /**
   * Handle streaming response from AI SDK.
   */
  private async executeStreaming(
    options: any,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    executionOptions: ExecutionOptions
  ): Promise<void> {
    const abortController = new AbortController();
    token.onCancellationRequested(() => abortController.abort());

    let firstTokenTime: number | undefined;
    const result = await streamText({ ...options, abortSignal: abortController.signal });

    for await (const part of result.fullStream) {
      if (!firstTokenTime) {
        firstTokenTime = Date.now();
      }
      if (token.isCancellationRequested) {
        break;
      }

      // Process the response part
      this.processResponsePart(part, progress, executionOptions);
    }
  }

  // ========================================================================
  // Non-Streaming Execution
  // ========================================================================

  /**
   * Handle non-streaming response from AI SDK.
   */
  private async executeNonStreaming(
    options: any,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    executionOptions: ExecutionOptions
  ): Promise<void> {
    const result = await generateText(options);
    const steps = (result.steps as any[]) || [];

    // Process each step
    for (const step of steps) {
      // Handle reasoning/thinking content
      this.processReasoning(step, progress, executionOptions);

      // Handle tool calls
      this.processToolCalls(step, progress);
    }

    // Handle final text response
    if (result.text) {
      progress.report(new vscode.LanguageModelTextPart(result.text));
    }
  }

  // ========================================================================
  // Response Processing Helpers
  // ========================================================================

  /**
   * Process and report a response part to VS Code UI.
   */
  private processResponsePart(
    part: any,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    options: ExecutionOptions
  ): void {
    switch (part.type) {
      case 'text-delta':
        progress.report(new vscode.LanguageModelTextPart(part.text));
        break;

      case 'reasoning-delta':
        // Use LanguageModelThinkingPart for reasoning content
        if (options.onReasoning) {
          options.onReasoning(part.text);
        } else {
          progress.report(
            new vscode.LanguageModelThinkingPart(
              part.text
            ) as unknown as vscode.LanguageModelResponsePart
          );
        }
        break;

      case 'tool-call':
        progress.report(
          new vscode.LanguageModelToolCallPart(
            part.toolCallId,
            part.toolName,
            part.args || part.input
          )
        );
        break;

      case 'tool-result':
        const toolRes = part.result || part.output;
        const res = typeof toolRes === 'string' ? toolRes : JSON.stringify(toolRes);
        progress.report(
          new vscode.LanguageModelToolResultPart(part.toolCallId, [
            new vscode.LanguageModelTextPart(res),
          ])
        );
        break;
    }
  }

  /**
   * Extract reasoning/thinking content from various possible locations in the response.
   */
  private extractReasoningContent(step: any): string {
    // Priority order for reasoning content fields
    const reasoningFields = [
      'reasoning_details', // MiniMax and some OpenAI-compatible providers
      'reasoning', // Standard AI SDK format
      'thinking', // Some providers
    ];

    for (const field of reasoningFields) {
      const content = step[field];
      if (!content) {
        continue;
      }

      // Handle string format
      if (typeof content === 'string') {
        return content;
      }

      // Handle array format (common in AI SDK responses)
      if (Array.isArray(content)) {
        const texts = content
          .map((item) => {
            if (typeof item === 'string') {
              return item;
            }
            if (typeof item === 'object') {
              // Handle various possible object structures
              return item.text || item.content || item.value || JSON.stringify(item);
            }
            return String(item);
          })
          .filter(Boolean);

        if (texts.length > 0) {
          return texts.join('\n');
        }
      }

      // Handle object format
      if (typeof content === 'object') {
        // Try common object structures
        return content.text || content.content || content.value || JSON.stringify(content);
      }
    }

    return '';
  }

  /**
   * Process reasoning/thinking content from a step.
   */
  private processReasoning(
    step: any,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    options: ExecutionOptions
  ): void {
    const reasoning = this.extractReasoningContent(step);

    if (!reasoning) {
      return;
    }

    // Report reasoning using LanguageModelThinkingPart
    if (options.onReasoning) {
      options.onReasoning(reasoning);
    } else {
      progress.report(
        new vscode.LanguageModelThinkingPart(
          reasoning
        ) as unknown as vscode.LanguageModelResponsePart
      );
    }
  }

  /**
   * Process tool calls from a step.
   */
  private processToolCalls(
    step: any,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): void {
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

  /**
   * Handle errors during execution.
   */
  private handleError(error: any): void {
    if (error.name === 'AbortError') {
      return;
    }
    logger.error('LLMService executeDirect error', error);
    throw error;
  }
}
