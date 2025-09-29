import * as vscode from "vscode";
import { Model, Provider, ProviderRepository } from "./types";

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
    let tooltip = `name: ${model.name}\nfamily: ${model.family}\nversion: ${model.version}\nmaxInputTokens: ${model.maxInputTokens}\nmaxOutputTokens: ${model.maxOutputTokens}`;
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
    this.description = `${model.family} v${model.version}`;
  }
}

export class AddiChatProvider implements vscode.LanguageModelChatProvider {
  constructor(private repository: ProviderRepository) {}

  async provideLanguageModelChatInformation(options: { silent: boolean }, _token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
    const providers = this.repository.getProviders();
    const filterProviders = options.silent ? providers.filter((p) => p.apiKey && p.apiKey.trim() !== "") : providers;
    return filterProviders.flatMap((p) =>
      p.models.map((m) => ({
        id: `addi-provider:${m.id}`,
        name: `${m.name} (${p.name})`,
        family: m.family,
        version: m.version,
        maxInputTokens: m.maxInputTokens,
        maxOutputTokens: m.maxOutputTokens,
        tooltip: m.tooltip ?? `${p.name} - ${m.maxInputTokens}↑/${m.maxOutputTokens}↓`,
        detail: m.detail ?? `${m.maxInputTokens}↑/${m.maxOutputTokens}↓`,
        capabilities: {
          imageInput: !!m.capabilities?.imageInput,
          // LanguageModelChatInformation.capabilities.toolCalling expects number | boolean
          toolCalling: (m.capabilities?.toolCalling ?? false) as number | boolean,
        },
      }))
    );
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    _options: vscode.ProvideLanguageModelChatResponseOptions | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const modelId = typeof model.id === "string" && model.id.startsWith("addi-provider:") ? model.id.replace("addi-provider:", "") : model.id;
    const result = this.repository.findModel(modelId);
    if (!result) {
      progress.report(new vscode.LanguageModelTextPart("cannot find the specified model."));
      return;
    }

    const { provider, model: storedModel } = result;
    if (!provider.apiKey || provider.apiKey.trim() === "") {
      progress.report(new vscode.LanguageModelTextPart("unconfigured API key."));
      return;
    }

    if (!provider.apiEndpoint || provider.apiEndpoint.trim() === "") {
      progress.report(new vscode.LanguageModelTextPart("unconfigured API endpoint."));
      return;
    }

    try {
      if (this.isOpenAiEndpoint(provider.apiEndpoint)) {
        await this.callOpenAiApi(provider, storedModel, messages, progress, token);
        return;
      }

      if (this.isAnthropicEndpoint(provider.apiEndpoint)) {
        await this.callAnthropicApi(provider, storedModel, messages, progress, token);
        return;
      }

      if (this.isGoogleEndpoint(provider.apiEndpoint)) {
        await this.callGoogleApi(provider, storedModel, messages, progress, token);
        return;
      }

      await this.callGenericOpenAiCompatibleApi(provider, storedModel, messages, progress, token);
    } catch (error) {
      console.error("model query error:", error);
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

  private async callOpenAiApi(provider: Provider, model: Model, messages: readonly vscode.LanguageModelChatRequestMessage[], progress: vscode.Progress<vscode.LanguageModelResponsePart>, token: vscode.CancellationToken): Promise<void> {
    const url = this.resolveChatCompletionsUrl(provider.apiEndpoint ?? "", "https://api.openai.com/v1");
    const modelIdentifier = this.resolveModelIdentifier(model);
    await this.streamOpenAiCompatibleResponse(
      {
        url,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: {
          model: modelIdentifier,
          messages: this.toOpenAiMessages(messages),
          max_tokens: model.maxOutputTokens,
          stream: true,
        },
      },
      progress,
      token,
      true
    );
  }

  private async callAnthropicApi(provider: Provider, model: Model, messages: readonly vscode.LanguageModelChatRequestMessage[], progress: vscode.Progress<vscode.LanguageModelResponsePart>, token: vscode.CancellationToken): Promise<void> {
    const baseUrl = this.normalizeBaseUrl(provider.apiEndpoint ?? "", "https://api.anthropic.com");
    const systemMessage = this.extractSystemMessage(messages);
    const userMessages = this.toAnthropicMessages(messages);
    const modelIdentifier = this.resolveModelIdentifier(model);

    const response = await fetch(this.buildUrl(baseUrl, "/v1/messages"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelIdentifier,
        max_tokens: model.maxOutputTokens,
        system: systemMessage || undefined,
        messages: userMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      // Report friendly errors for common HTTP statuses
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
      throw new Error(`Anthropic API Error: ${response.status} ${response.statusText}`);
    }

    await this.streamSseResponse(response, token, (data) => {
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
  }

  private async callGoogleApi(provider: Provider, model: Model, messages: readonly vscode.LanguageModelChatRequestMessage[], progress: vscode.Progress<vscode.LanguageModelResponsePart>, token: vscode.CancellationToken): Promise<void> {
    const baseUrl = this.normalizeBaseUrl(provider.apiEndpoint ?? "", "https://generativelanguage.googleapis.com/v1beta");
    const contents = this.toGoogleMessages(messages);
    const modelIdentifier = this.resolveModelIdentifier(model);

    const response = await fetch(`${baseUrl}/models/${modelIdentifier}:streamGenerateContent?key=${provider.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: model.maxOutputTokens,
        },
      }),
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
      throw new Error(`Google API Error: ${response.status} ${response.statusText}`);
    }

    await this.streamLineDelimitedJson(response, token, (data) => {
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
  }

  private async callGenericOpenAiCompatibleApi(
    provider: Provider,
    model: Model,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const url = this.resolveChatCompletionsUrl(provider.apiEndpoint ?? "", "https://api.openai.com/v1");
    const modelIdentifier = this.resolveModelIdentifier(model);
    await this.streamOpenAiCompatibleResponse(
      {
        url,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: {
          model: modelIdentifier,
          messages: this.toOpenAiMessages(messages),
          max_tokens: model.maxOutputTokens,
          stream: true,
        },
      },
      progress,
      token,
      false
    );
  }

  private toOpenAiMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): Array<{ role: string; content: string }> {
    return messages.map((msg) => ({
      role: msg.role === vscode.LanguageModelChatMessageRole.User ? "user" : "assistant",
      content:
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
          ? (msg.content as Array<unknown>)
              .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
              .map((p) => p.value)
              .join("")
          : String(msg.content),
    }));
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
      const content = typeof msg.content === "string"
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
      const content = typeof msg.content === "string"
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
    strict: boolean
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
            const content = data?.choices?.[0]?.delta?.content ?? data?.choices?.[0]?.message?.content;
            if (typeof content === "string") {
              progress.report(new vscode.LanguageModelTextPart(content));
            }
          } catch (error) {
            // If strict parsing is required we warn, but also report a textual hint so user sees progress
            if (strict) {
              console.warn("Failed to parse OpenAI compatible stream data:", error);
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
            console.warn("Failed to parse SSE data:", error);
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
          console.warn("Failed to parse line-delimited JSON:", error);
        }
      }
    }
  }
}
