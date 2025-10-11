import * as vscode from "vscode";
import { Model, Provider, ProviderRepository } from "./types";
import { TokenFormatter } from "./utils";
import { logger } from "./logger";
import { ToolRegistry } from "./toolRegistry";

const TOKEN_LIMIT = 1024 * 1024 * 4;

export class ModelTreeItem extends vscode.TreeItem {
  constructor(public model: Model) {
    super(model.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "model";
    const capabilityHints: string[] = [];
    if (model.capabilities?.imageInput) {
      capabilityHints.push("vision");
    }
    if (model.capabilities?.toolCalling !== undefined) {
      const toolValue = model.capabilities.toolCalling;
      capabilityHints.push(`tool:${typeof toolValue === "number" ? toolValue : toolValue ? "yes" : "no"}`);
    }
    const inputTokensDetail = TokenFormatter.formatDetailed(model.maxInputTokens);
    const outputTokensDetail = TokenFormatter.formatDetailed(model.maxOutputTokens);
    let tooltip = `name: ${model.name}\nfamily: ${model.family}\nversion: ${model.version}\nmaxInputTokens: ${inputTokensDetail}\nmaxOutputTokens: ${outputTokensDetail}`;
    if (model.tooltip) {
      tooltip += `\ntooltip: ${model.tooltip}`;
    }
    if (model.detail) {
      tooltip += `\ndetail: ${model.detail}`;
    }
    if (capabilityHints.length > 0) {
      tooltip += `\ncapabilities: ${capabilityHints.join(", ")}`;
    }
    this.tooltip = tooltip;
    const inputSummary = TokenFormatter.format(model.maxInputTokens);
    const outputSummary = TokenFormatter.format(model.maxOutputTokens);
    const tokenSuffix = inputSummary && outputSummary ? ` · ${inputSummary}↑/${outputSummary}↓` : "";
    this.description = `${model.family} v${model.version}${tokenSuffix}`;
  }
}

export class AddiChatProvider implements vscode.LanguageModelChatProvider {
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
          id: `addi-provider:${m.id}`,
          name: `${m.name} (${p.name})`,
          family: m.family,
          version: m.version,
          maxInputTokens: m.maxInputTokens,
          maxOutputTokens: m.maxOutputTokens,
          tooltip: m.tooltip ?? `${p.name} - ${summary}`,
          detail: m.detail ?? summary,
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
    const modelId = typeof model.id === "string" && model.id.startsWith("addi-provider:") ? model.id.replace("addi-provider:", "") : model.id;
    logger.info("Chat response requested", {
      requestedModelId: modelId,
      messageCount: messages.length,
      hasOptions: Boolean(options),
    });
    const messageSummary = this.summarizeMessages(messages);
    const optionSummary = this.sanitizeChatOptions(options);
    const toolDefinitions = this.resolveToolDefinitions(options);
    logger.debug("Chat request summary", {
      requestedModelId: modelId,
      messages: messageSummary,
      options: optionSummary,
      toolCount: toolDefinitions?.length ?? 0,
      toolSource: toolDefinitions && toolDefinitions.length > 0 ? (Array.isArray((options as any)?.tools) ? "host" : "fallback") : "none",
    });
    const result = this.repository.findModel(modelId);
    if (!result) {
      logger.warn("Chat response requested for unknown model", { requestedModelId: modelId });
      progress.report(new vscode.LanguageModelTextPart("cannot find the specified model."));
      return;
    }

    const { provider, model: storedModel } = result;
    logger.debug("Resolved model for chat response", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(storedModel),
      options: optionSummary,
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

    try {
      if (this.isOpenAiEndpoint(provider.apiEndpoint)) {
        logger.debug("Dispatching request to OpenAI endpoint", logger.sanitizeProvider(provider));
        await this.callOpenAiApi(provider, storedModel, messages, options, toolDefinitions, progress, token);
        return;
      }

      if (this.isAnthropicEndpoint(provider.apiEndpoint)) {
        logger.debug("Dispatching request to Anthropic endpoint", logger.sanitizeProvider(provider));
        await this.callAnthropicApi(provider, storedModel, messages, options, toolDefinitions, progress, token, (options as any)?.toolInvocationToken);
        return;
      }

      if (this.isGoogleEndpoint(provider.apiEndpoint)) {
        logger.debug("Dispatching request to Google endpoint", logger.sanitizeProvider(provider));
        await this.callGoogleApi(provider, storedModel, messages, options, toolDefinitions, progress, token, (options as any)?.toolInvocationToken);
        return;
      }

      logger.debug("Dispatching request to generic OpenAI-compatible endpoint", logger.sanitizeProvider(provider));
      await this.callGenericOpenAiCompatibleApi(provider, storedModel, messages, options, toolDefinitions, progress, token);
    } catch (error) {
      logger.error("Model query error", {
        error: error instanceof Error ? error.message : String(error),
        provider: logger.sanitizeProvider(provider),
        model: logger.sanitizeModel(storedModel),
      });
      progress.report(new vscode.LanguageModelTextPart(`model query error: ${error instanceof Error ? error.message : "unknown"}`));
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

  private normalizeBaseUrl(endpoint: string, fallback: string): string {
    const base = endpoint.trim() || fallback;
    return base.replace(/\/+$/, "");
  }

  private buildUrl(base: string, path: string): string {
    const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  private resolveChatCompletionsUrl(endpoint: string, fallback: string): string {
    const base = this.normalizeBaseUrl(endpoint, fallback);
    const lower = base.toLowerCase();
    if (lower.endsWith("/chat/completions")) {
      return base;
    }
    return this.buildUrl(base, "/chat/completions");
  }

  private resolveModelIdentifier(model: Model): string {
    const trimmedId = model.id?.trim();
    if (trimmedId && !/^[0-9]+$/.test(trimmedId)) {
      return trimmedId;
    }
    const trimmedFamily = model.family?.trim();
    if (trimmedFamily) {
      return trimmedFamily;
    }
    return trimmedId || model.family;
  }

  private getNumberOption(options: vscode.ProvideLanguageModelChatResponseOptions | undefined, key: string): number | undefined {
    if (!options) {
      return undefined;
    }
    const bag = options as unknown as Record<string, unknown>;
    const value = bag[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    return undefined;
  }

  private ensureMaxTokens(value: number | undefined, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.min(Math.max(Math.floor(value), 1), TOKEN_LIMIT);
    }
    return fallback;
  }

  private extractGenerationParameters(
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    model: Model
  ): {
    maxTokens: number;
    temperature?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
  } {
    const requestedMax = this.getNumberOption(options, "maxOutputTokens") ?? this.getNumberOption(options, "responseMaxTokens");
    const maxTokens = this.ensureMaxTokens(requestedMax, model.maxOutputTokens);
    const temperature = this.getNumberOption(options, "temperature");
    const topP = this.getNumberOption(options, "topP");
    const presencePenalty = this.getNumberOption(options, "presencePenalty");
    const frequencyPenalty = this.getNumberOption(options, "frequencyPenalty");
    const params: {
      maxTokens: number;
      temperature?: number;
      topP?: number;
      presencePenalty?: number;
      frequencyPenalty?: number;
    } = { maxTokens };
    if (temperature !== undefined) {
      params.temperature = temperature;
    }
    if (topP !== undefined) {
      params.topP = topP;
    }
    if (presencePenalty !== undefined) {
      params.presencePenalty = presencePenalty;
    }
    if (frequencyPenalty !== undefined) {
      params.frequencyPenalty = frequencyPenalty;
    }
    return params;
  }

  private extractTextFromMessageParts(parts: readonly unknown[]): string {
    const textParts: string[] = [];
    for (const part of parts) {
      if (typeof part === "string") {
        textParts.push(part);
        continue;
      }
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part.value ?? "");
        continue;
      }
      if (part && typeof part === "object") {
        const value = (part as Record<string, unknown>)["value"];
        if (typeof value === "string") {
          textParts.push(value);
        }
      }
    }
    return textParts.join("");
  }

  private extractToolCallFromParts(parts: readonly unknown[]): { name: string; arguments: string; id?: string } | undefined {
    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const candidate = part as Record<string, unknown>;
      const name = typeof candidate["name"] === "string" ? candidate["name"] : undefined;
      const argsRaw = candidate["arguments"] ?? candidate["input"];
      if (!name) {
        continue;
      }
      if (argsRaw === undefined) {
        continue;
      }
      const id = typeof candidate["callId"] === "string" ? candidate["callId"] : typeof candidate["id"] === "string" ? candidate["id"] : undefined;
      const args = typeof argsRaw === "string" ? argsRaw : JSON.stringify(argsRaw ?? {});
      const result: { name: string; arguments: string; id?: string } = { name, arguments: args };
      if (id) {
        result.id = id;
      }
      return result;
    }
    return undefined;
  }

  private extractToolResultFromParts(parts: readonly unknown[]): { id?: string; content: string } | undefined {
    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const candidate = part as Record<string, unknown>;
      const id =
        typeof candidate["callId"] === "string"
          ? candidate["callId"]
          : typeof candidate["toolCallId"] === "string"
          ? candidate["toolCallId"]
          : typeof candidate["id"] === "string"
          ? candidate["id"]
          : undefined;
      if (!id) {
        continue;
      }
      const payload = candidate["result"] ?? candidate["output"] ?? candidate["content"];
      const content = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
      return { id, content };
    }
    return undefined;
  }

  private resolveToolDefinitions(options: vscode.ProvideLanguageModelChatResponseOptions | undefined): ReadonlyArray<Record<string, unknown>> | undefined {
    const bag = options as unknown as Record<string, unknown> | undefined;
    const provided = Array.isArray(bag?.["tools"]) ? (bag!["tools"] as ReadonlyArray<Record<string, unknown>>) : undefined;
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

  private convertToFunctionTools(toolDefinitions: ReadonlyArray<Record<string, unknown>> | undefined):
    | Array<{
        type: "function";
        function: { name: string; description?: string; parameters: Record<string, unknown> };
      }>
    | undefined {
    if (!toolDefinitions || toolDefinitions.length === 0) {
      return undefined;
    }
    const seen = new Set<string>();
    const converted: Array<{ type: "function"; function: { name: string; description?: string; parameters: Record<string, unknown> } }> = [];
    for (const definition of toolDefinitions) {
      if (!definition || typeof definition !== "object") {
        continue;
      }
      const record = definition as Record<string, unknown>;
      const identifier = this.getToolIdentifierFromDefinition(record);
      if (!identifier || seen.has(identifier)) {
        continue;
      }
      seen.add(identifier);
      const metadata = ToolRegistry.findTool(identifier);
      const descriptionCandidate =
        metadata?.description ??
        (typeof record["description"] === "string" ? (record["description"] as string) : typeof record["detail"] === "string" ? (record["detail"] as string) : undefined);
      const parametersCandidate = metadata?.parameters ?? this.normalizeToolParameters(record["parameters"] ?? record["inputSchema"] ?? record["schema"]);
      converted.push({
        type: "function",
        function: {
          name: identifier,
          description: descriptionCandidate ?? "",
          parameters: parametersCandidate,
        },
      });
    }
    return converted.length > 0 ? converted : undefined;
  }

  private getToolIdentifierFromDefinition(record: Record<string, unknown>): string | undefined {
    const keys = ["id", "identifier", "name"];
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  }

  private normalizeToolParameters(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object") {
      return { type: "object", properties: {} };
    }
    const record = value as Record<string, unknown>;
    if (typeof record["type"] === "string" && record["type"].trim().length > 0) {
      return record;
    }
    return {
      type: "object",
      properties: record,
    };
  }

  private summarizeMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): {
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
      const parts = Array.isArray(message.content) ? (message.content as readonly unknown[]) : [message.content];

      if (this.extractToolCallFromParts(parts)) {
        summary.toolCallMessages += 1;
      }
      if (this.extractToolResultFromParts(parts)) {
        summary.toolResultMessages += 1;
      }

      for (const part of parts) {
        if (typeof part === "string") {
          summary.textCharacters += part.length;
          continue;
        }
        if (part instanceof vscode.LanguageModelTextPart) {
          summary.textCharacters += part.value?.length ?? 0;
          continue;
        }
        if (part && typeof part === "object") {
          const candidate = part as Record<string, unknown>;
          const text = candidate["text"] ?? candidate["value"] ?? candidate["content"];
          if (typeof text === "string") {
            summary.textCharacters += text.length;
          }
          if (typeof candidate["mimeType"] === "string" || typeof candidate["type"] === "string") {
            summary.attachmentParts += 1;
          }
        }
      }
    }

    return summary;
  }

  private sanitizeChatOptions(options: vscode.ProvideLanguageModelChatResponseOptions | undefined): Record<string, unknown> | undefined {
    if (!options) {
      return undefined;
    }

    const sanitized: Record<string, unknown> = {};
    const numericKeys = ["maxOutputTokens", "responseMaxTokens", "temperature", "topP", "presencePenalty", "frequencyPenalty", "maxInputTokens", "maxPromptTokens"];
    for (const key of numericKeys) {
      const value = this.getNumberOption(options, key);
      if (value !== undefined) {
        sanitized[key] = value;
      }
    }

    const bag = options as unknown as Record<string, unknown>;
    if (Array.isArray(bag["stopSequences"])) {
      sanitized["stopSequenceCount"] = (bag["stopSequences"] as readonly unknown[]).length;
    }

    const responseFormat = bag["responseFormat"];
    if (typeof responseFormat === "string") {
      sanitized["responseFormat"] = responseFormat;
    } else if (responseFormat && typeof responseFormat === "object") {
      sanitized["responseFormatKeys"] = Object.keys(responseFormat as Record<string, unknown>);
    }

    if (Array.isArray(bag["tools"])) {
      const toolEntries = (bag["tools"] as ReadonlyArray<Record<string, unknown>>).map((tool) => ({
        id: typeof tool["id"] === "string" ? tool["id"] : undefined,
        name: typeof tool["name"] === "string" ? tool["name"] : undefined,
        hasParameters: tool["parameters"] !== undefined,
      }));
      sanitized["tools"] = { count: toolEntries.length, definitions: toolEntries };
    }

    if (bag["toolInvocationToken"] !== undefined) {
      sanitized["hasToolInvocationToken"] = true;
    }

    const booleanKeys = ["stream", "jsonMode", "toolChoiceRequired", "silent"];
    for (const key of booleanKeys) {
      const value = bag[key];
      if (typeof value === "boolean") {
        sanitized[key] = value;
      }
    }

    const excludedKeys = new Set<string>([...numericKeys, "stopSequences", "responseFormat", "tools", "toolInvocationToken", ...booleanKeys]);
    const otherKeys = Object.keys(bag).filter((key) => !excludedKeys.has(key));
    if (otherKeys.length > 0) {
      sanitized["otherOptionKeys"] = otherKeys.sort();
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  private mapChatRole(role: unknown): string {
    const value = typeof role === "string" ? role.toLowerCase() : undefined;
    switch (value) {
      case "assistant":
        return "assistant";
      case "tool":
        return "tool";
      case "system":
        return "system";
      default:
        return "user";
    }
  }

  private async callOpenAiApi(
    provider: Provider,
    model: Model,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    toolDefinitions: ReadonlyArray<Record<string, unknown>> | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const url = this.resolveChatCompletionsUrl(provider.apiEndpoint ?? "", "https://api.openai.com/v1");
    const modelIdentifier = this.resolveModelIdentifier(model);
    const generation = this.extractGenerationParameters(options, model);
    const optionsSanitized = this.sanitizeChatOptions(options);
    logger.debug("callOpenAiApi", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
      generation,
      options: optionsSanitized,
    });
    const tools = this.convertToFunctionTools(toolDefinitions);
    const body: Record<string, unknown> = {
      model: modelIdentifier,
      messages: this.toOpenAiMessages(messages),
      max_tokens: generation.maxTokens,
      stream: true,
    };
    if (generation.temperature !== undefined) {
      body["temperature"] = generation.temperature;
    }
    if (generation.topP !== undefined) {
      body["top_p"] = generation.topP;
    }
    if (generation.presencePenalty !== undefined) {
      body["presence_penalty"] = generation.presencePenalty;
    }
    if (generation.frequencyPenalty !== undefined) {
      body["frequency_penalty"] = generation.frequencyPenalty;
    }
    if (tools && tools.length > 0) {
      body["tools"] = tools;
    }

    await this.streamOpenAiCompatibleResponse(
      {
        url,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body,
      },
      progress,
      token,
      true,
      (options as any)?.toolInvocationToken
    );
    logger.debug("callOpenAiApi completed", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
    });
  }

  private async callAnthropicApi(
    provider: Provider,
    model: Model,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    toolDefinitions: ReadonlyArray<Record<string, unknown>> | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    toolInvocationToken?: unknown
  ): Promise<void> {
    void toolDefinitions;
    const baseUrl = this.normalizeBaseUrl(provider.apiEndpoint ?? "", "https://api.anthropic.com");
    const systemMessage = this.extractSystemMessage(messages);
    const userMessages = this.toAnthropicMessages(messages);
    const modelIdentifier = this.resolveModelIdentifier(model);
    const generation = this.extractGenerationParameters(options, model);
    const optionsSanitized = this.sanitizeChatOptions(options);
    logger.debug("callAnthropicApi", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
      generation,
      hasSystemMessage: Boolean(systemMessage),
      messageCount: userMessages.length,
      options: optionsSanitized,
    });

    const response = await fetch(this.buildUrl(baseUrl, "/v1/messages"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelIdentifier,
        max_tokens: generation.maxTokens,
        system: systemMessage || undefined,
        messages: userMessages,
        stream: true,
        temperature: generation.temperature,
        top_p: generation.topP,
      }),
    });

    if (!response.ok) {
      // Report friendly errors for common HTTP statuses
      if (response.status === 401 || response.status === 403) {
        logger.warn("Anthropic auth or consent error", {
          status: response.status,
          provider: logger.sanitizeProvider(provider),
        });
        progress.report(new vscode.LanguageModelTextPart("Authentication or consent issue: please check API key or user consent for this model."));
        return;
      }
      if (response.status === 429) {
        logger.warn("Anthropic rate limit", {
          provider: logger.sanitizeProvider(provider),
        });
        progress.report(new vscode.LanguageModelTextPart("Rate limit or quota exceeded. Please try again later."));
        return;
      }
      if (response.status >= 500) {
        logger.warn("Anthropic server error", {
          status: response.status,
          provider: logger.sanitizeProvider(provider),
        });
        progress.report(new vscode.LanguageModelTextPart("Server error from model provider. Please try again later."));
        return;
      }
      throw new Error(`Anthropic API Error: ${response.status} ${response.statusText}`);
    }

    await this.streamSseResponse(response, token, (data) => {
      void toolInvocationToken;
      const obj = data as Record<string, unknown> | undefined;
      if (!obj) {
        return;
      }
      if (obj["type"] === "content_block_delta") {
        const delta = obj["delta"] as Record<string, unknown> | undefined;
        if (delta && typeof delta["text"] === "string") {
          progress.report(new vscode.LanguageModelTextPart(delta["text"] as string));
        }
      }
    });
    logger.debug("callAnthropicApi completed", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
    });
  }

  private async callGoogleApi(
    provider: Provider,
    model: Model,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    toolDefinitions: ReadonlyArray<Record<string, unknown>> | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    toolInvocationToken?: unknown
  ): Promise<void> {
    void toolDefinitions;
    const baseUrl = this.normalizeBaseUrl(provider.apiEndpoint ?? "", "https://generativelanguage.googleapis.com/v1beta");
    const contents = this.toGoogleMessages(messages);
    const modelIdentifier = this.resolveModelIdentifier(model);
    const generation = this.extractGenerationParameters(options, model);
    const optionsSanitized = this.sanitizeChatOptions(options);
    logger.debug("callGoogleApi", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
      generation,
      messageCount: contents.length,
      options: optionsSanitized,
    });

    const response = await fetch(`${baseUrl}/models/${modelIdentifier}:streamGenerateContent?key=${provider.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: generation.maxTokens,
          temperature: generation.temperature,
          topP: generation.topP,
          presencePenalty: generation.presencePenalty,
          frequencyPenalty: generation.frequencyPenalty,
        },
      }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        logger.warn("Google auth or consent error", {
          status: response.status,
          provider: logger.sanitizeProvider(provider),
        });
        progress.report(new vscode.LanguageModelTextPart("Authentication or consent issue: please check API key or user consent for this model."));
        return;
      }
      if (response.status === 429) {
        logger.warn("Google rate limit", { provider: logger.sanitizeProvider(provider) });
        progress.report(new vscode.LanguageModelTextPart("Rate limit or quota exceeded. Please try again later."));
        return;
      }
      if (response.status >= 500) {
        logger.warn("Google server error", {
          status: response.status,
          provider: logger.sanitizeProvider(provider),
        });
        progress.report(new vscode.LanguageModelTextPart("Server error from model provider. Please try again later."));
        return;
      }
      throw new Error(`Google API Error: ${response.status} ${response.statusText}`);
    }

    await this.streamLineDelimitedJson(response, token, (data) => {
      void toolInvocationToken;
      const obj = data as Record<string, unknown> | undefined;
      if (!obj) {
        return;
      }
      const candidates = obj["candidates"];
      if (!Array.isArray(candidates)) {
        return;
      }
      for (const candidate of candidates) {
        const cand = candidate as Record<string, unknown> | undefined;
        const content = cand?.["content"] as Record<string, unknown> | undefined;
        const parts = content?.["parts"] as unknown;
        if (!Array.isArray(parts)) {
          continue;
        }
        for (const part of parts as unknown[]) {
          const p = part as Record<string, unknown> | undefined;
          if (p && typeof p["text"] === "string") {
            progress.report(new vscode.LanguageModelTextPart(p["text"] as string));
          }
        }
      }
    });
    logger.debug("callGoogleApi completed", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
    });
  }

  private async callGenericOpenAiCompatibleApi(
    provider: Provider,
    model: Model,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    toolDefinitions: ReadonlyArray<Record<string, unknown>> | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const url = this.resolveChatCompletionsUrl(provider.apiEndpoint ?? "", "https://api.openai.com/v1");
    const modelIdentifier = this.resolveModelIdentifier(model);
    const generation = this.extractGenerationParameters(options, model);
    const optionsSanitized = this.sanitizeChatOptions(options);
    logger.debug("callGenericOpenAiCompatibleApi", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
      generation,
      options: optionsSanitized,
    });
    const tools = this.convertToFunctionTools(toolDefinitions);
    const bodyGeneric: Record<string, unknown> = {
      model: modelIdentifier,
      messages: this.toOpenAiMessages(messages),
      max_tokens: generation.maxTokens,
      stream: true,
    };
    if (generation.temperature !== undefined) {
      bodyGeneric["temperature"] = generation.temperature;
    }
    if (generation.topP !== undefined) {
      bodyGeneric["top_p"] = generation.topP;
    }
    if (generation.presencePenalty !== undefined) {
      bodyGeneric["presence_penalty"] = generation.presencePenalty;
    }
    if (generation.frequencyPenalty !== undefined) {
      bodyGeneric["frequency_penalty"] = generation.frequencyPenalty;
    }
    if (tools && tools.length > 0) {
      bodyGeneric["tools"] = tools;
    }

    await this.streamOpenAiCompatibleResponse(
      {
        url,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: bodyGeneric,
      },
      progress,
      token,
      false,
      (options as any)?.toolInvocationToken
    );
    logger.debug("callGenericOpenAiCompatibleApi completed", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
    });
  }
  private toOpenAiMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): Array<Record<string, unknown>> {
    return messages.map((msg) => {
      const role = this.mapChatRole(msg.role);
      const parts = Array.isArray(msg.content) ? (msg.content as readonly unknown[]) : [msg.content];
      const toolCall = this.extractToolCallFromParts(parts);
      const toolResult = this.extractToolResultFromParts(parts);
      const contentText = this.extractTextFromMessageParts(parts);

      const entry: Record<string, unknown> = {
        role,
      };

      if (toolCall) {
        const callId = toolCall.id ?? `tool_call_${Math.random().toString(36).slice(2)}`;
        entry["tool_calls"] = [
          {
            type: "function",
            id: callId,
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          },
        ];
        entry["content"] = contentText;
      } else if (toolResult && role === "tool") {
        entry["content"] = toolResult.content;
        if (toolResult.id) {
          entry["tool_call_id"] = toolResult.id;
        }
      } else {
        entry["content"] = contentText;
      }

      return entry;
    });
  }

  private extractSystemMessage(messages: readonly vscode.LanguageModelChatRequestMessage[]): string {
    for (const msg of messages) {
      if (msg.name === "system") {
        if (typeof msg.content === "string") {
          return msg.content;
        }
        if (Array.isArray(msg.content)) {
          return (msg.content as Array<unknown>)
            .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
            .map((p) => p.value)
            .join("");
        }
        return String(msg.content);
      }
    }
    return "";
  }

  private toAnthropicMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];
    for (const msg of messages) {
      if (msg.name === "system") {
        continue;
      }
      const role = msg.role === vscode.LanguageModelChatMessageRole.User ? "user" : "assistant";
      const content =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
          ? msg.content
              .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
              .map((p: vscode.LanguageModelTextPart) => p.value)
              .join("")
          : String(msg.content);
      result.push({ role, content });
    }
    return result;
  }

  private toGoogleMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    let currentRole = "";
    let currentParts: Array<{ text: string }> = [];

    messages.forEach((msg) => {
      const role = msg.role === vscode.LanguageModelChatMessageRole.User ? "user" : "model";
      const content =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
          ? (msg.content as Array<unknown>)
              .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
              .map((p) => p.value)
              .join("")
          : String(msg.content);

      if (role !== currentRole && currentParts.length > 0) {
        contents.push({
          role: currentRole,
          parts: currentParts,
        });
        currentParts = [];
      }

      currentRole = role;
      currentParts.push({ text: content });
    });

    if (currentParts.length > 0) {
      contents.push({
        role: currentRole,
        parts: currentParts,
      });
    }

    return contents;
  }

  private async streamOpenAiCompatibleResponse(
    request: { url: string; headers: Record<string, string>; body: Record<string, unknown> },
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    strict: boolean,
    toolInvocationToken?: unknown
  ): Promise<void> {
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        progress.report(new vscode.LanguageModelTextPart("Authentication or consent issue: please check API key or user consent for this model."));
        return;
      }
      if (response.status === 429) {
        progress.report(new vscode.LanguageModelTextPart("Rate limit or quota exceeded. Please try again later."));
        return;
      }
      if (response.status >= 500) {
        progress.report(new vscode.LanguageModelTextPart("Server error from model provider. Please try again later."));
        return;
      }
      throw new Error(`OpenAI Compatible API Error: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      progress.report(new vscode.LanguageModelTextPart("Model returned an empty response."));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    // For OpenAI-style function_call detection we may receive parts indicating a function call
    let pendingFunctionCall: { name?: string; arguments?: string } | null = null;
    // For newer OpenAI-style tool_calls streaming we may receive incremental tool_calls entries
    const pendingToolCalls: Record<number, { id?: string | undefined; name?: string | undefined; arguments?: string | undefined }> = {};

    while (true) {
      if (token.isCancellationRequested) {
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        if (trimmed === "data: [DONE]") {
          return;
        }
        if (trimmed.startsWith("data: ")) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const choice = data?.choices?.[0];
            // delta may contain content chunks, legacy function_call, or new tool_calls
            const delta = choice?.delta ?? {};

            // Handle streaming tool_calls (newer protocol). delta.tool_calls may be an array of partials
            const toolCallsDelta = delta?.tool_calls ?? delta?.tool_call ?? data?.choices?.[0]?.message?.tool_calls ?? data?.choices?.[0]?.message?.tool_call;
            if (Array.isArray(toolCallsDelta)) {
              for (let i = 0; i < toolCallsDelta.length; i++) {
                const part = toolCallsDelta[i] as unknown;
                if (!part || typeof part !== "object") {
                  continue;
                }
                const entry = part as Record<string, unknown>;
                // entry may have nested `function` or direct fields
                const fn = (entry["function"] as Record<string, unknown>) ?? entry;
                const id = typeof fn["id"] === "string" ? (fn["id"] as string) : typeof entry["id"] === "string" ? (entry["id"] as string) : undefined;
                const name = typeof fn["name"] === "string" ? (fn["name"] as string) : typeof entry["name"] === "string" ? (entry["name"] as string) : undefined;
                const args =
                  typeof fn["arguments"] === "string" ? (fn["arguments"] as string) : typeof entry["arguments"] === "string" ? (entry["arguments"] as string) : undefined;
                const idx = i;
                if (!pendingToolCalls[idx]) {
                  pendingToolCalls[idx] = { id: id ?? undefined, name: name ?? undefined, arguments: args ?? "" };
                } else {
                  if (id) {
                    pendingToolCalls[idx].id = id;
                  }
                  if (name) {
                    pendingToolCalls[idx].name = name;
                  }
                  if (args) {
                    pendingToolCalls[idx].arguments = (pendingToolCalls[idx].arguments ?? "") + args;
                  }
                }
              }
            }

            // Legacy function_call streaming (some providers/models still use this)
            if (delta?.function_call) {
              const fn = delta.function_call as { name?: string; arguments?: string };
              if (!pendingFunctionCall) {
                pendingFunctionCall = { name: fn.name ?? "", arguments: fn.arguments ?? "" };
              } else {
                if (fn.name) {
                  pendingFunctionCall.name = fn.name;
                }
                if (fn.arguments) {
                  pendingFunctionCall.arguments = (pendingFunctionCall.arguments ?? "") + fn.arguments;
                }
              }
            }

            const content = delta?.content ?? data?.choices?.[0]?.message?.content;
            if (typeof content === "string") {
              progress.report(new vscode.LanguageModelTextPart(content));
            }
            // If the event signals finish and we have pending tool_calls aggregated, emit them
            const finishReason = data?.choices?.[0]?.finish_reason;
            if (data?.id && finishReason === "tool_calls") {
              try {
                // If the final message contains an explicit tool_calls array, prefer it
                const finalToolCalls = data?.choices?.[0]?.message?.tool_calls ?? data?.choices?.[0]?.message?.tool_call;
                if (Array.isArray(finalToolCalls) && finalToolCalls.length > 0) {
                  for (let i = 0; i < finalToolCalls.length; i++) {
                    const call = finalToolCalls[i] as Record<string, unknown>;
                    const fn = (call["function"] as Record<string, unknown>) ?? call;
                    const callId = typeof fn["id"] === "string" ? (fn["id"] as string) : typeof call["id"] === "string" ? (call["id"] as string) : undefined;
                    const name = typeof fn["name"] === "string" ? (fn["name"] as string) : typeof call["name"] === "string" ? (call["name"] as string) : "tool";
                    const rawArgs = fn["arguments"] ?? call["arguments"] ?? call["input"] ?? call["input_args"] ?? {};
                    let inputObj: unknown = rawArgs;
                    if (typeof rawArgs === "string") {
                      try {
                        inputObj = JSON.parse(rawArgs);
                      } catch {
                        inputObj = rawArgs;
                      }
                    }
                    // Ensure the tool input is an object as expected by LanguageModelToolCallPart
                    const normalizedInput: object = typeof inputObj === "object" && inputObj !== null ? (inputObj as object) : { value: inputObj };
                    const idToUse = callId ?? `tool_call_${i}_${Date.now().toString()}`;
                    progress.report(new vscode.LanguageModelToolCallPart(idToUse, name, normalizedInput));
                    // Attempt to actually invoke the tool if registered so side-effects (like file creation) occur.
                    try {
                      // invokeTool will validate input against declared schema and run the tool implementation
                      const tokenForInvoke = toolInvocationToken as unknown | undefined;
                      const invokeOptions = { input: normalizedInput, toolInvocationToken: tokenForInvoke } as unknown as vscode.LanguageModelToolInvocationOptions<object>;
                      const toolResult = await this.invokeToolWithLogging(name, invokeOptions, token, progress);
                      // Report a short textual summary of the tool result to the chat stream
                      try {
                        const summary =
                          toolResult && Array.isArray((toolResult as any).content)
                            ? (toolResult as any).content.map((p: any) => (p instanceof vscode.LanguageModelTextPart ? p.value : String(p))).join("")
                            : String(toolResult);
                        progress.report(new vscode.LanguageModelTextPart(summary || `Tool ${name} invoked successfully.`));
                      } catch (err) {
                        progress.report(new vscode.LanguageModelTextPart(`Tool ${name} invoked.`));
                      }
                    } catch (err) {
                      progress.report(new vscode.LanguageModelTextPart(`Tool invocation failed for ${name}: ${err instanceof Error ? err.message : String(err)}`));
                    }
                  }
                  // reset pending tool calls and return to hand off to VS Code
                  for (const k of Object.keys(pendingToolCalls)) {
                    delete pendingToolCalls[Number(k)];
                  }
                  return;
                }

                // Otherwise, fallback to aggregated partials collected earlier
                const indexes = Object.keys(pendingToolCalls)
                  .map((s) => Number(s))
                  .sort((a, b) => a - b);
                for (const idx of indexes) {
                  const pending = pendingToolCalls[idx];
                  if (!pending) {
                    continue;
                  }
                  let inputObj: unknown = pending.arguments ?? {};
                  if (typeof pending.arguments === "string") {
                    try {
                      inputObj = JSON.parse(pending.arguments);
                    } catch {
                      inputObj = pending.arguments;
                    }
                  }
                  const normalizedInput: object = typeof inputObj === "object" && inputObj !== null ? (inputObj as object) : { value: inputObj };
                  const idToUse = pending.id ?? `tool_call_${idx}_${Date.now().toString()}`;
                  const name = pending.name ?? "tool";
                  progress.report(new vscode.LanguageModelToolCallPart(idToUse, name, normalizedInput));
                  try {
                    const tokenForInvoke = toolInvocationToken as unknown | undefined;
                    const invokeOptions = { input: normalizedInput, toolInvocationToken: tokenForInvoke } as unknown as vscode.LanguageModelToolInvocationOptions<object>;
                    const toolResult = await this.invokeToolWithLogging(name, invokeOptions, token, progress);
                    try {
                      const summary =
                        toolResult && Array.isArray((toolResult as any).content)
                          ? (toolResult as any).content.map((p: any) => (p instanceof vscode.LanguageModelTextPart ? p.value : String(p))).join("")
                          : String(toolResult);
                      progress.report(new vscode.LanguageModelTextPart(summary || `Tool ${name} invoked successfully.`));
                    } catch (_err) {
                      progress.report(new vscode.LanguageModelTextPart(`Tool ${name} invoked.`));
                    }
                  } catch (err) {
                    progress.report(new vscode.LanguageModelTextPart(`Tool invocation failed for ${name}: ${err instanceof Error ? err.message : String(err)}`));
                  }
                }
                // clear pending tool calls
                for (const k of Object.keys(pendingToolCalls)) {
                  delete pendingToolCalls[Number(k)];
                }
                return;
              } catch (err) {
                // If parsing/reporting fails, continue streaming and surface text
                logger.warn("Failed to emit tool_calls as LanguageModelToolCallPart", {
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }

            // If the event signals finish and we have a pending function call (legacy), emit a tool call part
            if (data?.id && pendingFunctionCall && finishReason === "function_call") {
              try {
                const callId = `fn_${Date.now().toString()}`;
                const inputObj = pendingFunctionCall.arguments ? JSON.parse(pendingFunctionCall.arguments) : {};
                progress.report(new vscode.LanguageModelToolCallPart(callId, pendingFunctionCall.name ?? "", inputObj));
                pendingFunctionCall = null;
                return;
              } catch (err) {
                progress.report(new vscode.LanguageModelTextPart(pendingFunctionCall?.arguments ?? ""));
                pendingFunctionCall = null;
              }
            }
          } catch (error) {
            // If strict parsing is required we warn, but also report a textual hint so user sees progress
            if (strict) {
              logger.warn("Failed to parse OpenAI compatible stream data", {
                error: error instanceof Error ? error.message : String(error),
              });
            }
            // Optionally surface a non-fatal parse hint
            // Do not spam progress with every parse error; skip reporting here.
          }
        }
      }
    }
  }

  private async streamSseResponse(response: Response, token: vscode.CancellationToken, onData: (data: unknown) => void): Promise<void> {
    if (!response.body) {
      throw new Error("Response body is empty");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      if (token.isCancellationRequested) {
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const data = JSON.parse(line.slice(6));
            onData(data);
          } catch (error) {
            logger.warn("Failed to parse SSE data", { error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
    }
  }

  private async streamLineDelimitedJson(response: Response, token: vscode.CancellationToken, onData: (data: unknown) => void): Promise<void> {
    if (!response.body) {
      throw new Error("Response body is empty");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      if (token.isCancellationRequested) {
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const data = JSON.parse(trimmed);
          onData(data);
        } catch (error) {
          logger.warn("Failed to parse line-delimited JSON", { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }

  private async invokeToolWithLogging(
    name: string,
    invokeOptions: vscode.LanguageModelToolInvocationOptions<object>,
    token: vscode.CancellationToken,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): Promise<unknown> {
    if (!vscode?.lm || typeof (vscode as any).lm.invokeTool !== "function") {
      progress.report(new vscode.LanguageModelTextPart(`Tool invocation not available in this host for ${name}.`));
      return undefined;
    }

    if (!invokeOptions.toolInvocationToken) {
      logger.warn("Tool invocation skipped - no token", { toolName: name });
      progress.report(new vscode.LanguageModelTextPart(`Tool ${name} cannot run because the host did not provide tool access for this request.`));
      return undefined;
    }

    try {
      const toolResult = await (vscode as any).lm.invokeTool(name, invokeOptions, token);
      return toolResult;
    } catch (err) {
      logger.warn("Tool invocation failed", {
        toolName: name,
        error: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof Error) {
        throw err;
      }
      throw new Error(String(err));
    }
  }
}
