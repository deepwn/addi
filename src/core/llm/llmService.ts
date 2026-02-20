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
   *
   * AI SDK已经处理了thinking/reasoning的提取工作。
   * 我们只需要正确转换到VSCode API格式。
   */
  private processResponsePart(
    part: any,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    options: ExecutionOptions
  ): void {
    // Handler map for different stream part types
    const handlers: Record<string, (part: any) => void> = {
      // 文本内容
      'text-delta': (p) => {
        progress.report(new vscode.LanguageModelTextPart(p.textDelta));
      },

      // Thinking/Reasoning内容 - AI SDK已提取
      'reasoning-delta': (p) => {
        this.handleThinkingDelta(p, progress, options);
      },

      // Thinking签名 - 加密内容，通常不需要直接显示
      'reasoning-signature': (p) => {
        this.handleThinkingSignature(p);
      },

      // Thinking流结束标记
      'reasoning-complete': (p) => {
        this.handleThinkingComplete(p);
      },

      // 工具调用
      'tool-call': (p) => {
        progress.report(
          new vscode.LanguageModelToolCallPart(p.toolCallId, p.toolName, p.args || p.input)
        );
      },

      // 工具结果
      'tool-result': (p) => {
        const toolRes = p.result || p.output;
        const res = typeof toolRes === 'string' ? toolRes : JSON.stringify(toolRes);
        progress.report(
          new vscode.LanguageModelToolResultPart(p.toolCallId, [
            new vscode.LanguageModelTextPart(res),
          ])
        );
      },

      // 错误处理
      error: (p) => {
        this.handleError(p.error);
      },
    };

    const handler = handlers[part.type];
    if (handler) {
      handler(part);
    } else {
      // 未知类型，记录日志但不影响处理
      logger.debug('Unknown stream part type:', part.type);
    }
  }

  /**
   * 处理thinking delta内容
   * AI SDK已提取reasoning内容，我们只需要正确转换
   */
  private handleThinkingDelta(
    part: any,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    options: ExecutionOptions
  ): void {
    const reasoningDelta = part.reasoningDelta;

    if (!reasoningDelta) {
      return;
    }

    // 创建VSCode格式的thinking part
    const thinkingPart = new vscode.LanguageModelThinkingPart(
      reasoningDelta,
      part.id,
      part.metadata
    );

    // 通知回调（如果有）
    if (options.onReasoning) {
      options.onReasoning(reasoningDelta);
    }

    // 报告给UI
    progress.report(thinkingPart as any);
  }

  /**
   * 处理thinking签名
   * 通常用于验证，不需要直接显示给用户
   */
  private handleThinkingSignature(part: any): void {
    if (part.signature) {
      logger.debug('Thinking signature received:', part.signature.substring(0, 20) + '...');
    }
  }

  /**
   * 处理thinking流结束
   * 可以在这里做清理或最终处理
   */
  private handleThinkingComplete(_part: any): void {
    logger.info('Reasoning stream completed');
  }

  /**
   * Extract reasoning/thinking content from step response.
   *
   * 对于非流式响应，AI SDK会在steps中包含thinking内容。
   * 这个方法简化了提取逻辑，直接从标准字段获取。
   */
  private extractReasoningContent(step: any): string {
    // AI SDK的steps中，reasoning内容通常在以下字段：
    const reasoning = step.reasoning || step.thinking || step.reasoning_details;

    if (!reasoning) {
      return '';
    }

    // 处理字符串格式
    if (typeof reasoning === 'string') {
      return reasoning;
    }

    // 处理数组格式
    if (Array.isArray(reasoning)) {
      return reasoning
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }
          if (typeof item === 'object') {
            return item.text || item.content || item.value || '';
          }
          return String(item);
        })
        .filter(Boolean)
        .join('\n');
    }

    return '';
  }

  /**
   * Process reasoning/thinking content from a step.
   * 对于非流式响应，AI SDK已将thinking内容放在step中。
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

    // 简化处理，直接创建thinking part
    const thinkingPart = new vscode.LanguageModelThinkingPart(reasoning);

    if (options.onReasoning) {
      options.onReasoning(reasoning);
    } else {
      progress.report(thinkingPart as any);
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
