import { ModelDraft, Provider } from "./types";

export class ModelTester {
  private static readonly TOKEN_LIMIT = 1024 * 1024 * 4;

  static async testModelApi(provider: Provider, modelDraft: ModelDraft, token: AbortSignal): Promise<void> {
    const apiEndpoint = provider.apiEndpoint?.trim();
    const apiKey = provider.apiKey?.trim();

    if (!apiEndpoint) {
      throw new Error("unconfigured API endpoint for the provider");
    }

    if (!apiKey) {
      throw new Error("unconfigured API key for the provider");
    }

    switch (provider.providerType) {
      case "openai":
        await this.testOpenAiApi(apiEndpoint, apiKey, modelDraft, token);
        return;
      case "anthropic":
        await this.testAnthropicApi(apiEndpoint, apiKey, modelDraft, token);
        return;
      case "google":
        await this.testGoogleApi(apiEndpoint, apiKey, modelDraft, token);
        return;
      default:
        await this.testGenericOpenAiCompatibleApi(apiEndpoint, apiKey, modelDraft, token);
        return;
    }
  }

  private static async testOpenAiApi(apiEndpoint: string, apiKey: string, modelDraft: ModelDraft, signal: AbortSignal): Promise<void> {
    const url = this.resolveChatCompletionsUrl(apiEndpoint, "https://api.openai.com/v1");
    const modelIdentifier = this.resolveModelIdentifierFromDraft(modelDraft);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelIdentifier,
        messages: [{ role: "user", content: this.getTestPrompt() }],
        max_tokens: this.ensureMaxTokens(modelDraft.maxOutputTokens),
        stream: false,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(await this.readResponseError(response));
    }

    const data: unknown = await response.json();
    if (!data || typeof data !== "object") {
      throw new Error("OpenAI API response format error");
    }
    const record = data as Record<string, unknown>;
    const choices = record["choices"] as unknown;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error("OpenAI API response format error");
    }
  }

  private static async testAnthropicApi(apiEndpoint: string, apiKey: string, modelDraft: ModelDraft, signal: AbortSignal): Promise<void> {
    const baseUrl = this.normalizeBaseUrl(apiEndpoint, "https://api.anthropic.com");
    const url = this.buildUrl(baseUrl, "/v1/messages");
    const modelIdentifier = this.resolveModelIdentifierFromDraft(modelDraft);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelIdentifier,
        max_tokens: this.ensureMaxTokens(modelDraft.maxOutputTokens),
        messages: [{ role: "user", content: this.getTestPrompt() }],
        stream: false,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(await this.readResponseError(response));
    }

    const data: unknown = await response.json();
    if (!data || typeof data !== "object") {
      throw new Error("Anthropic API response format error");
    }
    const record = data as Record<string, unknown>;
    if (!("content" in record)) {
      throw new Error("Anthropic API response format error");
    }
  }

  private static async testGoogleApi(apiEndpoint: string, apiKey: string, modelDraft: ModelDraft, signal: AbortSignal): Promise<void> {
    const baseUrl = this.normalizeBaseUrl(apiEndpoint, "https://generativelanguage.googleapis.com/v1beta");
    const modelIdentifier = this.resolveModelIdentifierFromDraft(modelDraft);
    const url = `${baseUrl}/models/${encodeURIComponent(modelIdentifier)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: this.getTestPrompt() }],
          },
        ],
        generationConfig: {
          maxOutputTokens: this.ensureMaxTokens(modelDraft.maxOutputTokens),
        },
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(await this.readResponseError(response));
    }

    const data: unknown = await response.json();
    if (!data || typeof data !== "object") {
      throw new Error("Google API response format error");
    }
    const record = data as Record<string, unknown>;
    const candidates = record["candidates"] as unknown;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error("Google API response format error");
    }
  }

  private static async testGenericOpenAiCompatibleApi(apiEndpoint: string, apiKey: string, modelDraft: ModelDraft, signal: AbortSignal): Promise<void> {
    const url = this.resolveChatCompletionsUrl(apiEndpoint, "https://api.openai.com/v1");
    const modelIdentifier = this.resolveModelIdentifierFromDraft(modelDraft);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelIdentifier,
        messages: [{ role: "user", content: this.getTestPrompt() }],
        max_tokens: this.ensureMaxTokens(modelDraft.maxOutputTokens),
        stream: false,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(await this.readResponseError(response));
    }

    const data: unknown = await response.json();
    if (!data || typeof data !== "object") {
      throw new Error("OpenAI compatible API response format error");
    }
    const record = data as Record<string, unknown>;
    const choices = record["choices"] as unknown;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error("OpenAI compatible API response format error");
    }
  }

  private static resolveModelIdentifierFromDraft(modelDraft: ModelDraft): string {
    const trimmedId = modelDraft.id?.trim();
    if (trimmedId) {
      return trimmedId;
    }
    const trimmedFamily = (modelDraft.family ?? "addi").trim();
    if (trimmedFamily) {
      return trimmedFamily;
    }
    const draftSid = modelDraft.sid?.trim();
    if (draftSid) {
      return draftSid;
    }
    return "addi";
  }

  private static ensureMaxTokens(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return 128;
    }
    return Math.min(Math.max(Math.floor(value), 1), this.TOKEN_LIMIT);
  }

  private static getTestPrompt(): string {
    return "Hello from Addi connectivity test.";
  }

  private static async readResponseError(response: Response): Promise<string> {
    const statusInfo = `${response.status} ${response.statusText}`;
    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      return statusInfo;
    }

    if (!body) {
      return statusInfo;
    }

    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.error === "string") {
        return `${statusInfo} - ${parsed.error}`;
      }
      if (parsed?.error?.message) {
        return `${statusInfo} - ${parsed.error.message}`;
      }
      return `${statusInfo} - ${body}`;
    } catch {
      return `${statusInfo} - ${body}`;
    }
  }

  private static resolveChatCompletionsUrl(endpoint: string, fallback: string): string {
    const base = this.normalizeBaseUrl(endpoint, fallback);
    const lower = base.toLowerCase();
    if (lower.endsWith("/chat/completions")) {
      return base;
    }
    return this.buildUrl(base, "/chat/completions");
  }

  private static normalizeBaseUrl(endpoint: string | undefined, fallback: string): string {
    const base = (endpoint && endpoint.trim()) || fallback;
    return base.replace(/\/+$/, "");
  }

  private static buildUrl(base: string, path: string): string {
    const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }
}
