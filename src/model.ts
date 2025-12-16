import * as vscode from "vscode";
import { Model, ProviderRepository } from "./types";
import { TokenFormatter } from "./utils";
import { logger } from "./logger";
import { ToolRegistry } from "./toolRegistry";
import { LLMClient } from "./services/llmClient";
import { MessageConverter } from "./services/messageConverter";



export class ModelTreeItem extends vscode.TreeItem {
  constructor(public model: Model) {
    super(model.name, vscode.TreeItemCollapsibleState.None);
    this.id = model.sid;
    this.contextValue = "model";
    const capabilityHints: string[] = [];
    if (model.capabilities?.imageInput) {
      capabilityHints.push("vision");
    }
    if (model.capabilities?.toolCalling !== undefined) {
      capabilityHints.push(`tools`);
    }
    const inputTokensDetail = TokenFormatter.formatDetailed(model.maxInputTokens);
    const outputTokensDetail = TokenFormatter.formatDetailed(model.maxOutputTokens);
    let tooltip = `name: ${model.name}\nremoteId: ${model.id}\nfamily: ${model.family}\nversion: ${model.version}\ninput: ${inputTokensDetail}\noutput: ${outputTokensDetail}`;
    if (capabilityHints.length > 0) {
      tooltip += `\ncapabilities: ${capabilityHints.join(", ")}`;
    }
    this.tooltip = tooltip;
    const inputSummary = TokenFormatter.format(model.maxInputTokens);
    const outputSummary = TokenFormatter.format(model.maxOutputTokens);
    const tokenSuffix = inputSummary && outputSummary ? ` · ${inputSummary}↑/${outputSummary}↓` : "";
    this.description = `${tokenSuffix}`;
  }
}

export class AddiChatProvider implements vscode.LanguageModelChatProvider {
  private llmClient = new LLMClient();

  constructor(private repository: ProviderRepository) {}

  async provideLanguageModelChatInformation(options: { silent: boolean }, _token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
    const providers = this.repository.getProviders();
    logger.debug("provideLanguageModelChatInformation", {
      silent: options.silent,
      providerCount: providers.length,
    });
    const filterProviders = options.silent ? providers.filter((p) => p.apiKey && p.apiKey.trim() !== "") : providers;
    logger.debug("Filtered providers for chat information", {
      original: providers.length,
      filtered: filterProviders.length,
    });
    return filterProviders.flatMap((p) =>
      p.models.map((m) => {
        const friendlyInput = TokenFormatter.format(m.maxInputTokens) || String(m.maxInputTokens);
        const friendlyOutput = TokenFormatter.format(m.maxOutputTokens) || String(m.maxOutputTokens);
        const summary = `${friendlyInput}↑/${friendlyOutput}↓`;
        return {
          id: `addi-provider:${m.sid}`,
          name: `${m.name} (${p.name})`,
          family: m.family,
          version: m.version,
          maxInputTokens: m.maxInputTokens,
          maxOutputTokens: m.maxOutputTokens,
          tooltip: `${p.name} - ${summary}`,
          capabilities: {
            imageInput: !!m.capabilities?.imageInput,
            // LanguageModelChatInformation.capabilities.toolCalling expects number | boolean
            toolCalling: (m.capabilities?.toolCalling ?? false) as number | boolean,
          },
        };
      })
    );
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const sid = typeof model.id === "string" && model.id.startsWith("addi-provider:") ? model.id.replace("addi-provider:", "") : model.id;
    logger.info("Chat response requested", {
      requestedModelSid: sid,
      messageCount: messages.length,
      hasOptions: Boolean(options),
    });
    const messageSummary = MessageConverter.summarizeMessages(messages);
    const toolDefinitions = this.resolveToolDefinitions(options);
    const toolNames = toolDefinitions?.map(t => t.name) ?? [];
    logger.debug("Chat request summary", {
      requestedModelSid: sid,
      messages: messageSummary,
      toolCount: toolDefinitions?.length ?? 0,
      toolNames,
      toolSource: toolDefinitions && toolDefinitions.length > 0 ? (Array.isArray((options as any)?.tools) ? "host" : "fallback") : "none",
    });
    const result = this.repository.findModel(sid);
    if (!result) {
      logger.warn("Chat response requested for unknown model", { requestedModelSid: sid });
      progress.report(new vscode.LanguageModelTextPart("cannot find the specified model."));
      return;
    }

    const { provider, model: storedModel } = result;
    logger.debug("Resolved model for chat response", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(storedModel),
      messages: messageSummary,
    });
    if (!provider.apiKey || provider.apiKey.trim() === "") {
      logger.warn("Provider missing API key", logger.sanitizeProvider(provider));
      progress.report(new vscode.LanguageModelTextPart("unconfigured API key."));
      return;
    }

    if (!provider.apiEndpoint || provider.apiEndpoint.trim() === "") {
      logger.warn("Provider missing API endpoint", logger.sanitizeProvider(provider));
      progress.report(new vscode.LanguageModelTextPart("unconfigured API endpoint."));
      return;
    }

    const startTime = Date.now();
    try {
      if (this.isOpenAiEndpoint(provider.apiEndpoint)) {
        logger.debug("Dispatching request to OpenAI endpoint", logger.sanitizeProvider(provider));
        await this.llmClient.callOpenAiApi(provider, storedModel, messages, options, toolDefinitions, progress, token);
      } else if (this.isAnthropicEndpoint(provider.apiEndpoint)) {
        logger.debug("Dispatching request to Anthropic endpoint", logger.sanitizeProvider(provider));
        await this.llmClient.callAnthropicApi(provider, storedModel, messages, options, toolDefinitions, progress, token, options?.modelOptions?.["toolInvocationToken"]);
      } else if (this.isGoogleEndpoint(provider.apiEndpoint)) {
        logger.debug("Dispatching request to Google endpoint", logger.sanitizeProvider(provider));
        await this.llmClient.callGoogleApi(provider, storedModel, messages, options, toolDefinitions, progress, token, options?.modelOptions?.["toolInvocationToken"]);
      } else {
        logger.debug("Dispatching request to generic OpenAI-compatible endpoint", logger.sanitizeProvider(provider));
        await this.llmClient.callGenericOpenAiCompatibleApi(provider, storedModel, messages, options, toolDefinitions, progress, token);
      }
    } catch (error) {
      logger.error("Model query error", {
        error: error instanceof Error ? error.message : String(error),
        provider: logger.sanitizeProvider(provider),
        model: logger.sanitizeModel(storedModel),
      });
      progress.report(new vscode.LanguageModelTextPart(`model query error: ${error instanceof Error ? error.message : "unknown"}`));
    } finally {
      const duration = Date.now() - startTime;
      logger.info("Chat response completed", {
        requestedModelSid: sid,
        durationMs: duration,
      });
    }
  }

  async provideTokenCount(_model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number> {
    if (typeof text === "string") {
      const words = text.split(/\s+/).length;
      return Math.ceil(words * 1.3);
    }
    // If a message is provided, stringify only text parts
    if (typeof text === "object" && text) {
      const maybe = text as { content?: unknown };
      if (Array.isArray(maybe.content)) {
        const parts = (maybe.content as readonly unknown[])
          .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
          .map((p: vscode.LanguageModelTextPart) => p.value)
          .join("");
        return Math.ceil(parts.length / 4);
      }
    }
    const textContent = JSON.stringify(text);
    return Math.ceil(textContent.length / 4);
  }

  private isOpenAiEndpoint(endpoint: string): boolean {
    return endpoint.includes("openai.com");
  }

  private isAnthropicEndpoint(endpoint: string): boolean {
    return endpoint.includes("anthropic.com");
  }

  private isGoogleEndpoint(endpoint: string): boolean {
    return endpoint.includes("googleapis.com");
  }

  private resolveToolDefinitions(options: vscode.ProvideLanguageModelChatResponseOptions | undefined): ReadonlyArray<vscode.LanguageModelChatTool> | undefined {
    const provided = options?.tools;
    if (provided && provided.length > 0) {
      ToolRegistry.captureHostTools(provided);
      return provided;
    }
    const fallback = ToolRegistry.getFallbackToolDefinitions();
    if (fallback.length > 0) {
      return fallback;
    }
    return undefined;
  }
}
