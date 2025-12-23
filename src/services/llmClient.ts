import * as vscode from "vscode";
import { Model, Provider } from "../types";
import { logger } from "../logger";
import { MessageConverter } from "./messageConverter";

const TOKEN_LIMIT = 1024 * 1024 * 4;

export class LLMClient {
  private _extractorCache: Map<string, (data: any) => any> = new Map();
  async callOpenAiApi(
    provider: Provider,
    model: Model,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    toolDefinitions: ReadonlyArray<vscode.LanguageModelChatTool> | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    onStats?: (stats: { firstTokenTime: number; endTime: number; tokenCount: number }) => void
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
      messages: MessageConverter.toOpenAiMessages(messages),
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

    if (model.requestAdditional) {
      try {
        const additional = JSON.parse(model.requestAdditional);
        Object.assign(body, additional);
      } catch (e) {
        logger.warn("Failed to parse requestAdditional", { error: e instanceof Error ? e.message : String(e) });
      }
    }

    const sanitizedBody = { ...body };
    if (Array.isArray(sanitizedBody["messages"])) {
      sanitizedBody["messages"] = (sanitizedBody["messages"] as any[]).map((msg) => {
        if (Array.isArray(msg.content)) {
          return {
            ...msg,
            content: msg.content.map((part: any) => {
              if (part.type === "image_url" && part.image_url?.url?.startsWith("data:")) {
                return { ...part, image_url: { ...part.image_url, url: "<base64_image_data>" } };
              }
              return part;
            }),
          };
        }
        return msg;
      });
    }
    logger.debug("callOpenAiApi request body", { body: sanitizedBody });

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
      onStats,
      model.responseOverwrite
    );
    logger.debug("callOpenAiApi completed", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
    });
  }

  async callAnthropicApi(
    provider: Provider,
    model: Model,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    toolDefinitions: ReadonlyArray<vscode.LanguageModelChatTool> | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    toolInvocationToken?: unknown,
    onStats?: (stats: { firstTokenTime: number; endTime: number; tokenCount: number }) => void
  ): Promise<void> {
    void toolDefinitions;
    const baseUrl = this.normalizeBaseUrl(provider.apiEndpoint ?? "", "https://api.anthropic.com");
    const systemMessage = MessageConverter.extractSystemMessage(messages);
    const userMessages = MessageConverter.toAnthropicMessages(messages);
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

    const body = {
      model: modelIdentifier,
      max_tokens: generation.maxTokens,
      system: systemMessage || undefined,
      messages: userMessages,
      stream: true,
      temperature: generation.temperature,
      top_p: generation.topP,
    };

    if (model.requestAdditional) {
      try {
        const additional = JSON.parse(model.requestAdditional);
        Object.assign(body, additional);
      } catch (e) {
        logger.warn("Failed to parse requestAdditional", { error: e instanceof Error ? e.message : String(e) });
      }
    }

    const sanitizedBody = { ...body };
    if (Array.isArray(sanitizedBody["messages"])) {
      sanitizedBody["messages"] = (sanitizedBody["messages"] as any[]).map((msg) => {
        if (Array.isArray(msg.content)) {
          return {
            ...msg,
            content: msg.content.map((part: any) => {
              if (part.type === "image" && part.source?.data) {
                 return { ...part, source: { ...part.source, data: "<base64_image_data>" } };
              }
              return part;
            }),
          };
        }
        return msg;
      });
    }
    logger.debug("callAnthropicApi request body", { body: sanitizedBody });

    const headers = {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey!,
      "anthropic-version": "2023-06-01",
    };

    logger.debug("Sending Anthropic API request", {
      url: this.buildUrl(baseUrl, "/v1/messages"),
      headers: this.sanitizeHeaders(headers),
      body: body
    });

    const response = await fetch(this.buildUrl(baseUrl, "/v1/messages"), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    logger.debug("Received Anthropic API response", {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
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

    await this.streamSseResponse(
      response,
      token,
      (data) => {
        void toolInvocationToken;
        const obj = data as Record<string, unknown> | undefined;
        if (!obj) {
          return 0;
        }
        if (obj["type"] === "content_block_delta") {
          const delta = obj["delta"] as Record<string, unknown> | undefined;
          if (delta && typeof delta["text"] === "string") {
            const text = delta["text"] as string;
            progress.report(new vscode.LanguageModelTextPart(text));
            return Math.max(1, Math.ceil(text.length / 4));
          }
        }
        return 0;
      },
      onStats
    );
    logger.debug("callAnthropicApi completed", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
    });
  }

  async callGoogleApi(
    provider: Provider,
    model: Model,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    toolDefinitions: ReadonlyArray<vscode.LanguageModelChatTool> | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    toolInvocationToken?: unknown,
    onStats?: (stats: { firstTokenTime: number; endTime: number; tokenCount: number }) => void
  ): Promise<void> {
    void toolDefinitions;
    const baseUrl = this.normalizeBaseUrl(provider.apiEndpoint ?? "", "https://generativelanguage.googleapis.com/v1beta");
    const contents = MessageConverter.toGoogleMessages(messages);
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

    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: generation.maxTokens,
        temperature: generation.temperature,
        topP: generation.topP,
        presencePenalty: generation.presencePenalty,
        frequencyPenalty: generation.frequencyPenalty,
      },
    };

    if (model.requestAdditional) {
      try {
        const additional = JSON.parse(model.requestAdditional);
        Object.assign(body, additional);
      } catch (e) {
        logger.warn("Failed to parse requestAdditional", { error: e instanceof Error ? e.message : String(e) });
      }
    }

    const sanitizedBody = { ...body };
    if (Array.isArray(sanitizedBody["contents"])) {
      sanitizedBody["contents"] = (sanitizedBody["contents"] as any[]).map((msg) => {
        if (Array.isArray(msg.parts)) {
          return {
            ...msg,
            parts: msg.parts.map((part: any) => {
              if (part.inline_data?.data) {
                 return { ...part, inline_data: { ...part.inline_data, data: "<base64_image_data>" } };
              }
              return part;
            }),
          };
        }
        return msg;
      });
    }
    logger.debug("callGoogleApi request body", { body: sanitizedBody });

    const url = `${baseUrl}/models/${modelIdentifier}:streamGenerateContent?key=${provider.apiKey}`;
    const maskedUrl = url.replace(/key=([^&]+)/, "key=***");

    logger.debug("Sending Google API request", {
      url: maskedUrl,
      headers: { "Content-Type": "application/json" },
      body: body
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    logger.debug("Received Google API response", {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
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

    await this.streamLineDelimitedJson(
      response,
      token,
      (data) => {
        void toolInvocationToken;
        const obj = data as Record<string, unknown> | undefined;
        if (!obj) {
          return 0;
        }
        const candidates = obj["candidates"];
        if (!Array.isArray(candidates)) {
          return 0;
        }
        let count = 0;
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
              const text = p["text"] as string;
              progress.report(new vscode.LanguageModelTextPart(text));
              count += Math.max(1, Math.ceil(text.length / 4));
            }
          }
        }
        return count;
      },
      onStats
    );
    logger.debug("callGoogleApi completed", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
    });
  }

  async callGenericOpenAiCompatibleApi(
    provider: Provider,
    model: Model,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    toolDefinitions: ReadonlyArray<vscode.LanguageModelChatTool> | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    onStats?: (stats: { firstTokenTime: number; endTime: number; tokenCount: number }) => void
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
      messages: MessageConverter.toOpenAiMessages(messages),
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

    if (model.requestAdditional) {
      try {
        const additional = JSON.parse(model.requestAdditional);
        Object.assign(bodyGeneric, additional);
      } catch (e) {
        logger.warn("Failed to parse requestAdditional", { error: e instanceof Error ? e.message : String(e) });
      }
    }

    const sanitizedBody = { ...bodyGeneric };
    if (Array.isArray(sanitizedBody["messages"])) {
      sanitizedBody["messages"] = (sanitizedBody["messages"] as any[]).map((msg) => {
        if (Array.isArray(msg.content)) {
          return {
            ...msg,
            content: msg.content.map((part: any) => {
              if (part.type === "image_url" && part.image_url?.url?.startsWith("data:")) {
                return { ...part, image_url: { ...part.image_url, url: "<base64_image_data>" } };
              }
              return part;
            }),
          };
        }
        return msg;
      });
    }
    logger.debug("callGenericOpenAiCompatibleApi request body", { body: sanitizedBody });

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
      onStats
    );
    logger.debug("callGenericOpenAiCompatibleApi completed", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
    });
  }

  private resolveChatCompletionsUrl(endpoint: string, fallback: string): string {
    const base = this.normalizeBaseUrl(endpoint, fallback);
    const lower = base.toLowerCase();
    if (lower.endsWith("/chat/completions")) {
      return base;
    }
    return this.buildUrl(base, "/chat/completions");
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

  private resolveModelIdentifier(model: Model): string {
    const trimmedId = model.id?.trim();
    if (trimmedId) {
      return trimmedId;
    }
    const trimmedFamily = model.family?.trim();
    if (trimmedFamily) {
      return trimmedFamily;
    }
    return model.sid;
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

  private getNumberOption(options: vscode.ProvideLanguageModelChatResponseOptions | undefined, key: string): number | undefined {
    if (!options || !options.modelOptions) {
      return undefined;
    }
    const value = options.modelOptions[key];
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

  private sanitizeChatOptions(options: vscode.ProvideLanguageModelChatResponseOptions | undefined): Record<string, unknown> | undefined {
    if (!options) {
      return undefined;
    }

    const sanitized: Record<string, unknown> = {};
    const modelOptions = options.modelOptions || {};

    const numericKeys = ["maxOutputTokens", "responseMaxTokens", "temperature", "topP", "presencePenalty", "frequencyPenalty", "maxInputTokens", "maxPromptTokens"];
    for (const key of numericKeys) {
      const value = this.getNumberOption(options, key);
      if (value !== undefined) {
        sanitized[key] = value;
      }
    }

    if (Array.isArray(modelOptions["stopSequences"])) {
      sanitized["stopSequenceCount"] = (modelOptions["stopSequences"] as readonly unknown[]).length;
    }

    const responseFormat = modelOptions["responseFormat"];
    if (typeof responseFormat === "string") {
      sanitized["responseFormat"] = responseFormat;
    } else if (responseFormat && typeof responseFormat === "object") {
      sanitized["responseFormatKeys"] = Object.keys(responseFormat as Record<string, unknown>);
    }

    if (options.tools && options.tools.length > 0) {
      const toolEntries = options.tools.map((tool) => ({
        name: tool.name,
        hasParameters: true, // LanguageModelChatTool always has parameters/inputSchema
      }));
      sanitized["tools"] = { count: toolEntries.length, definitions: toolEntries };
    }

    if (modelOptions["toolInvocationToken"] !== undefined) {
      sanitized["hasToolInvocationToken"] = true;
    }

    const booleanKeys = ["stream", "jsonMode", "toolChoiceRequired", "silent"];
    for (const key of booleanKeys) {
      const value = modelOptions[key];
      if (typeof value === "boolean") {
        sanitized[key] = value;
      }
    }

    const excludedKeys = new Set<string>([...numericKeys, "stopSequences", "responseFormat", "tools", "toolInvocationToken", ...booleanKeys]);
    const otherKeys = Object.keys(modelOptions).filter((key) => !excludedKeys.has(key));
    if (otherKeys.length > 0) {
      sanitized["otherOptionKeys"] = otherKeys.sort();
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  private convertToFunctionTools(toolDefinitions: ReadonlyArray<vscode.LanguageModelChatTool> | undefined):
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
    for (const tool of toolDefinitions) {
      const identifier = tool.name;
      if (!identifier || seen.has(identifier)) {
        continue;
      }
      seen.add(identifier);
      
      converted.push({
        type: "function",
        function: {
          name: identifier,
          description: tool.description,
          parameters: this.normalizeToolParameters(tool.inputSchema),
        },
      });
    }
    return converted.length > 0 ? converted : undefined;
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

  private extractValue(data: any, path: string): any {
    // Use a compiled accessor cached per-path to avoid repeated regex/parsing overhead
    const cacheKey = path;
    let fn = this._extractorCache.get(cacheKey);
    if (!fn) {
      fn = this.compileExtractor(path);
      this._extractorCache.set(cacheKey, fn);
    }
    try {
      return fn(data);
    } catch {
      return undefined;
    }
  }

  private compileExtractor(path: string): (data: any) => any {
    // Allow users to use "response" as the root object variable
    if (path.startsWith("response.")) {
      path = path.substring(9);
    }
    const parts = path.split('.');
    const steps: Array<any> = parts.map((part) => {
      const selectorMatch = part.match(/^(\w+)\[(.*?)\]$/);
      if (selectorMatch && selectorMatch[1] && selectorMatch[2]) {
        const field = selectorMatch[1];
        const selector = selectorMatch[2];
        if (/^\d+$/.test(selector)) {
          return { type: 'index', field, index: parseInt(selector, 10) };
        }
        const kvMatch = selector.match(/^(\w+)=['"]?(.*?)['"]?$/);
        if (kvMatch && kvMatch[1]) {
          return { type: 'filter', field, key: kvMatch[1], value: kvMatch[2] };
        }
        return { type: 'unknown', raw: part };
      }
      return { type: 'prop', name: part };
    });

    return (data: any) => {
      let current = data;
      for (const s of steps) {
        if (current === undefined || current === null) {
          return undefined;
        }
        if (s.type === 'prop') {
          current = current[s.name];
        } else if (s.type === 'index') {
          current = current[s.field];
          if (!Array.isArray(current)) {
            return undefined;
          }
          current = current[s.index];
        } else if (s.type === 'filter') {
          current = current[s.field];
          if (!Array.isArray(current)) {
            return undefined;
          }
          current = current.find((item: any) => item && item[s.key] === s.value);
        } else {
          // Unknown selector, fall back to direct property
          current = current[s.raw];
        }
      }
      return current;
    };
  }

  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === "authorization" || key.toLowerCase() === "x-api-key" || key.toLowerCase().includes("key") || key.toLowerCase().includes("token")) {
        sanitized[key] = "***";
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private async streamOpenAiCompatibleResponse(
    request: { url: string; headers: Record<string, string>; body: Record<string, unknown> },
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    _strict: boolean,
    onStats?: (stats: { firstTokenTime: number; endTime: number; tokenCount: number }) => void,
    responseOverwrite?: string
  ): Promise<void> {
    logger.debug("Sending API request", {
      url: request.url,
      headers: this.sanitizeHeaders(request.headers),
      body: request.body
    });

    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
    });

    logger.debug("Received API response", {
      url: request.url,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch {
        errorBody = "<failed to read response body>";
      }
      
      logger.error("API request failed", {
        url: request.url,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: errorBody,
      });

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
      throw new Error(`OpenAI Compatible API Error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    if (!response.body) {
      progress.report(new vscode.LanguageModelTextPart("Model returned an empty response."));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let mapping: Record<string, string> | undefined;
    if (responseOverwrite) {
      try {
        mapping = JSON.parse(responseOverwrite);
      } catch (e) {
        logger.warn("Failed to parse responseOverwrite", { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // For OpenAI-style function_call detection we may receive parts indicating a function call
    let pendingFunctionCall: { name?: string; arguments?: string } | null = null;
    // For newer OpenAI-style tool_calls streaming we may receive incremental tool_calls entries
    const pendingToolCalls: Record<number, { id?: string | undefined; name?: string | undefined; arguments?: string | undefined }> = {};

    let firstTokenTime = 0;
    let tokenCount = 0;

    outerLoop: while (true) {
      if (token.isCancellationRequested) {
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (!done) {
        buffer += decoder.decode(value, { stream: true });
      }

      const lines = buffer.split("\n");
      if (!done) {
        buffer = lines.pop() ?? "";
      } else {
        buffer = "";
      }

      // Attempt to process the buffer if it looks like a complete message
      // To avoid CPU overhead and false-positives, only attempt parsing in limited cases:
      // - exact `data: [DONE]`
      // - `data: ` prefixed JSON (common SSE case)
      // - small bare JSON that likely represents a single response chunk (heuristic)
      // Also limit the buffer size we try parsing to avoid expensive operations on large buffers.
      if (buffer && !done) {
        const trimmedBuffer = buffer.trim();
        const maxProbeSize = 64 * 1024; // only attempt parse for buffers <= 64KB
        if (trimmedBuffer === "data: [DONE]") {
          lines.push(buffer);
          buffer = "";
        } else if (trimmedBuffer.startsWith("data: ") && buffer.length <= maxProbeSize) {
          try {
            JSON.parse(trimmedBuffer.slice(6));
            lines.push(buffer);
            buffer = "";
          } catch {
            // Incomplete or invalid JSON, wait for more data
          }
        } else if (trimmedBuffer.startsWith("{") && buffer.length <= 8 * 1024 && trimmedBuffer.includes('"choices"')) {
          // Heuristic: small bare JSON most likely a single response object from some providers
          try {
            JSON.parse(trimmedBuffer);
            lines.push(buffer);
            buffer = "";
          } catch {
            // Incomplete JSON, wait for more data
          }
        }
      }

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        if (trimmed === "data: [DONE]") {
          break outerLoop;
        }
        let data: any;
        if (trimmed.startsWith("data: ")) {
          try {
            data = JSON.parse(trimmed.slice(6));
          } catch {
            continue;
          }
        } else if (trimmed.startsWith("{")) {
          try {
            data = JSON.parse(trimmed);
          } catch {
            continue;
          }
        } else {
          continue;
        }

        if (data) {
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

            let reasoning: string | undefined;
            if (mapping && mapping["thinking"]) {
                reasoning = this.extractValue(data, mapping["thinking"]);
            }
            if (!reasoning) {
                reasoning = delta?.reasoning_content ?? data?.choices?.[0]?.message?.reasoning_content;
            }

            if (typeof reasoning === "string" && reasoning.length > 0) {
              if (firstTokenTime === 0) {
                firstTokenTime = Date.now();
              }
              tokenCount += Math.max(1, Math.ceil(reasoning.length / 4));
              progress.report(new vscode.LanguageModelTextPart(reasoning));
            }

            let content: string | undefined;
            if (mapping && mapping["text"]) {
                content = this.extractValue(data, mapping["text"]);
            }
            if (!content) {
                content = delta?.content ?? data?.choices?.[0]?.message?.content;
            }

            if (typeof content === "string" && content.length > 0) {
              if (firstTokenTime === 0) {
                firstTokenTime = Date.now();
              }
              tokenCount += Math.max(1, Math.ceil(content.length / 4));
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
                  }
                  // reset pending tool calls and return to hand off to VS Code
                  for (const k of Object.keys(pendingToolCalls)) {
                    delete pendingToolCalls[Number(k)];
                  }
                  if (onStats && firstTokenTime > 0) {
                    onStats({ firstTokenTime, endTime: Date.now(), tokenCount });
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
                }
                // clear pending tool calls
                for (const k of Object.keys(pendingToolCalls)) {
                  delete pendingToolCalls[Number(k)];
                }
                if (onStats && firstTokenTime > 0) {
                  onStats({ firstTokenTime, endTime: Date.now(), tokenCount });
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
                if (onStats && firstTokenTime > 0) {
                  onStats({ firstTokenTime, endTime: Date.now(), tokenCount });
                }
                return;
              } catch (err) {
                progress.report(new vscode.LanguageModelTextPart(pendingFunctionCall?.arguments ?? ""));
                pendingFunctionCall = null;
              }
            }

            if (finishReason) {
              // If we have pending tool calls, we must not break yet, we need to let the tool_calls logic below handle it
              // But wait, the tool_calls logic is ABOVE this check.
              // If finishReason is "tool_calls", we already returned.
              // If finishReason is "stop" or "length", we break.
              break outerLoop;
            }
        }
      }
      if (done) {
        break;
      }
    }

    if (onStats && firstTokenTime > 0) {
      onStats({ firstTokenTime, endTime: Date.now(), tokenCount });
    }

    // Emit any pending tool calls that weren't flushed by a finish_reason event

    // Emit any pending tool calls that weren't flushed by a finish_reason event
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
    }

    if (pendingFunctionCall) {
      try {
        const callId = `fn_${Date.now().toString()}`;
        const inputObj = pendingFunctionCall.arguments ? JSON.parse(pendingFunctionCall.arguments) : {};
        progress.report(new vscode.LanguageModelToolCallPart(callId, pendingFunctionCall.name ?? "", inputObj));
      } catch (err) {
        progress.report(new vscode.LanguageModelTextPart(pendingFunctionCall.arguments ?? ""));
      }
    }
  }

  private async streamSseResponse(
    response: Response,
    token: vscode.CancellationToken,
    onData: (data: unknown) => number, // Return token count increment
    onStats?: (stats: { firstTokenTime: number; endTime: number; tokenCount: number }) => void
  ): Promise<void> {
    if (!response.body) {
      throw new Error("Response body is empty");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let firstTokenTime = 0;
    let tokenCount = 0;

    while (true) {
      if (token.isCancellationRequested) {
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (!done) {
        buffer += decoder.decode(value, { stream: true });
      }

      const lines = buffer.split("\n");
      if (!done) {
        buffer = lines.pop() ?? "";
      } else {
        buffer = "";
      }

      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const data = JSON.parse(line.slice(6));
            const increment = onData(data);
            if (increment > 0) {
              if (firstTokenTime === 0) {
                firstTokenTime = Date.now();
              }
              tokenCount += increment;
            }
          } catch (error) {
            logger.warn("Failed to parse SSE data", { error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
      if (done) {
        break;
      }
    }
    if (onStats && firstTokenTime > 0) {
      onStats({ firstTokenTime, endTime: Date.now(), tokenCount });
    }
  }

  private async streamLineDelimitedJson(
    response: Response,
    token: vscode.CancellationToken,
    onData: (data: unknown) => number, // Return token count increment
    onStats?: (stats: { firstTokenTime: number; endTime: number; tokenCount: number }) => void
  ): Promise<void> {
    if (!response.body) {
      throw new Error("Response body is empty");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let firstTokenTime = 0;
    let tokenCount = 0;

    while (true) {
      if (token.isCancellationRequested) {
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (!done) {
        buffer += decoder.decode(value, { stream: true });
      }

      const lines = buffer.split("\n");
      if (!done) {
        buffer = lines.pop() ?? "";
      } else {
        buffer = "";
      }

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const data = JSON.parse(trimmed);
          const increment = onData(data);
          if (increment > 0) {
            if (firstTokenTime === 0) {
              firstTokenTime = Date.now();
            }
            tokenCount += increment;
          }
        } catch (error) {
          logger.warn("Failed to parse line-delimited JSON", { error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (done) {
        break;
      }
    }
    if (onStats && firstTokenTime > 0) {
      onStats({ firstTokenTime, endTime: Date.now(), tokenCount });
    }
  }
}
