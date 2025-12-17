import * as vscode from "vscode";
import { ModelDraft, Provider } from "./types";
import { MessageConverter } from "./services/messageConverter";

export interface TestResult {
  success: boolean;
  error?: string;
  detectedMaxInputTokens?: number;
  detectedMaxOutputTokens?: number;
  visionSupported?: boolean;
  toolCallingSupported?: boolean;
}

export interface TestOptions {
  detectInput: boolean;
  detectOutput: boolean;
  checkVision: boolean;
  checkTools: boolean;
}

export type ProgressCallback = (message: string) => void;

export class ModelTester {
  private static readonly COARSE_STEP = 64 * 1024;
  private static readonly VERIFICATION_TOKEN = "ADDI_VERIFY_123456";
  private static readonly VERIFICATION_REGEX = /ADDI_VERIFY_123456/;
  private static readonly VISION_TEST_IMAGE =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAZEAEAAgMAAAAAAAAAAAAAAAAAAQIxcbH/xAAVAQEBAAAAAAAAAAAAAAAAAAAGB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ALH64jUcAF1Qf//Z";

  static async testModelApi(provider: Provider, modelDraft: ModelDraft, options: TestOptions, token: AbortSignal, onProgress?: ProgressCallback): Promise<TestResult> {
    const result: TestResult = { success: false };

    try {
      // 1. Basic Connectivity
      onProgress?.("Checking connectivity...");
      await this.performRequest(provider, modelDraft, { type: "text", prompt: "Reply 'OK'." }, token);
      result.success = true;

      // 2. Vision Check
      if (options.checkVision) {
        onProgress?.("Verifying vision capabilities...");
        try {
          await this.performRequest(provider, modelDraft, { type: "vision" }, token);
          result.visionSupported = true;
        } catch (e) {
          result.visionSupported = false;
        }
      }

      // 3. Tools Check
      if (options.checkTools) {
        onProgress?.("Verifying tool calling capabilities...");
        try {
          await this.performRequest(provider, modelDraft, { type: "tools" }, token);
          result.toolCallingSupported = true;
        } catch (e) {
          result.toolCallingSupported = false;
        }
      }

      // 4. Detect Token Limits
      if (options.detectOutput) {
        onProgress?.("Detecting output token limits...");
        result.detectedMaxOutputTokens = await this.detectLimit(provider, modelDraft, "output", token, onProgress);
      }

      if (options.detectInput) {
        onProgress?.("Detecting input token limits...");
        result.detectedMaxInputTokens = await this.detectLimit(provider, modelDraft, "input", token, onProgress);
      }
    } catch (e) {
      result.success = false;
      result.error = e instanceof Error ? e.message : String(e);
    }

    return result;
  }

  private static async detectLimit(provider: Provider, modelDraft: ModelDraft, mode: "input" | "output", token: AbortSignal, onProgress?: ProgressCallback): Promise<number> {
    // Coarse search (Reverse)
    const coarsePoints = [262144, 196608, 131072, 65536, 1024]; // 256k, 192k, 128k, 64k, 1k
    let high = 0;
    let low = 0;

    for (const point of coarsePoints) {
      if (token.aborted) {
        return 0;
      }
      onProgress?.(`Probing ${mode} limit: ${point} tokens...`);
      const success = await this.verifyLimit(provider, modelDraft, point, token);
      if (success) {
        high = point;
        // If we passed at 256k, we can stop or try higher? For now, cap at 256k.
        if (point === coarsePoints[0]) {
          return point;
        }
        // Found the upper bound of the working range.
        // The previous point failed, this one passed.
        // So the limit is between [point, previous_point_that_failed]
        // But wait, we are iterating downwards.
        // 256k (Fail) -> 192k (Fail) -> 128k (Pass).
        // Limit is between 128k and 192k.
        low = point;
        high = point + this.COARSE_STEP;
        break;
      }
    }

    if (low === 0) {
      return 0; // Even 1k failed
    }

    // Binary search between low and high
    onProgress?.(`Refining ${mode} limit between ${low} and ${high}...`);
    let best = low;
    let l = low;
    let r = high;

    while (r - l > 1024) {
      // Precision 1k
      if (token.aborted) {
        return best;
      }
      const mid = Math.floor((l + r) / 2);
      onProgress?.(`Probing ${mode} limit: ${mid} tokens...`);
      const success = await this.verifyLimit(provider, modelDraft, mid, token);
      if (success) {
        best = mid;
        l = mid;
      } else {
        r = mid;
      }
    }

    return best;
  }

  private static async verifyLimit(provider: Provider, modelDraft: ModelDraft, value: number, token: AbortSignal): Promise<boolean> {
    try {
      const intValue = Math.floor(value);
      let payload: any = { type: "text" };
      // Use parameter estimation for both input and output to avoid consuming user tokens
      payload.maxTokens = intValue;
      payload.prompt = `Reply exactly with the following verification token: "${this.VERIFICATION_TOKEN}"`;

      const responseText = await this.performRequest(provider, modelDraft, payload, token);
      return this.VERIFICATION_REGEX.test(responseText || "");
    } catch (e) {
      return false;
    }
  }

  private static async performRequest(
    provider: Provider,
    modelDraft: ModelDraft,
    payload: { type: "text" | "vision" | "tools"; prompt?: string; maxTokens?: number },
    signal: AbortSignal
  ): Promise<string | undefined> {
    const apiEndpoint = provider.apiEndpoint?.trim();
    const apiKey = provider.apiKey?.trim();

    if (!apiEndpoint) {
      throw new Error("Unconfigured API endpoint");
    }
    if (!apiKey) {
      throw new Error("Unconfigured API key");
    }

    const maxTokens = payload.maxTokens ?? 10; // Default small for speed
    const prompt = payload.prompt ?? "Reply 'OK'.";

    switch (provider.providerType) {
      case "openai":
      case "generic":
        return await this.requestOpenAI(apiEndpoint, apiKey, modelDraft, payload, signal, maxTokens, prompt);
      case "anthropic":
        return await this.requestAnthropic(apiEndpoint, apiKey, modelDraft, payload, signal, maxTokens, prompt);
      case "google":
        return await this.requestGoogle(apiEndpoint, apiKey, modelDraft, payload, signal, maxTokens, prompt);
    }
  }

  private static async requestOpenAI(endpoint: string, key: string, draft: ModelDraft, payload: any, signal: AbortSignal, maxTokens: number, prompt: string): Promise<string> {
    const url = this.resolveChatCompletionsUrl(endpoint, "https://api.openai.com/v1");

    let messages: any[];
    if (payload.type === "vision") {
      const imagePart = new vscode.LanguageModelDataPart(Buffer.from(this.VISION_TEST_IMAGE, "base64"), "image/png");
      const mockMsg = {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [new vscode.LanguageModelTextPart("Describe this image"), imagePart],
        name: undefined,
      } as unknown as vscode.LanguageModelChatRequestMessage;
      messages = MessageConverter.toOpenAiMessages([mockMsg]);
    } else {
      messages = [{ role: "user", content: prompt }];
    }

    const body: any = {
      model: this.resolveModelIdentifierFromDraft(draft),
      messages,
      max_tokens: maxTokens,
      stream: false,
    };

    if (payload.type === "tools") {
      body.tools = [
        {
          type: "function",
          function: {
            name: "test_tool",
            description: "A test tool",
            parameters: { type: "object", properties: {} },
          },
        },
      ];
      body.tool_choice = "none";
    }

    const data = await this.doFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal,
      },
      "OpenAI"
    );

    return data.choices?.[0]?.message?.content ?? "";
  }

  private static async requestAnthropic(endpoint: string, key: string, draft: ModelDraft, payload: any, signal: AbortSignal, maxTokens: number, prompt: string): Promise<string> {
    const baseUrl = this.normalizeBaseUrl(endpoint, "https://api.anthropic.com");
    const url = this.buildUrl(baseUrl, "/v1/messages");

    let messages: any[];
    if (payload.type === "vision") {
      const imagePart = new vscode.LanguageModelDataPart(Buffer.from(this.VISION_TEST_IMAGE, "base64"), "image/png");
      const mockMsg = {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [new vscode.LanguageModelTextPart("Describe this image"), imagePart],
        name: undefined,
      } as unknown as vscode.LanguageModelChatRequestMessage;
      messages = MessageConverter.toAnthropicMessages([mockMsg]);
    } else {
      messages = [{ role: "user", content: prompt }];
    }

    const body: any = {
      model: this.resolveModelIdentifierFromDraft(draft),
      max_tokens: maxTokens,
      messages,
      stream: false,
    };

    if (payload.type === "tools") {
      body.tools = [
        {
          name: "test_tool",
          description: "A test tool",
          input_schema: { type: "object", properties: {} },
        },
      ];
    }

    const data = await this.doFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal,
      },
      "Anthropic"
    );

    return data.content?.[0]?.text ?? "";
  }

  private static async requestGoogle(endpoint: string, key: string, draft: ModelDraft, payload: any, signal: AbortSignal, maxTokens: number, prompt: string): Promise<string> {
    const baseUrl = this.normalizeBaseUrl(endpoint, "https://generativelanguage.googleapis.com/v1beta");
    const modelId = this.resolveModelIdentifierFromDraft(draft);
    const url = `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`;

    let contents: any[];
    if (payload.type === "vision") {
      const imagePart = new vscode.LanguageModelDataPart(Buffer.from(this.VISION_TEST_IMAGE, "base64"), "image/png");
      const mockMsg = {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [new vscode.LanguageModelTextPart("Describe this image"), imagePart],
        name: undefined,
      } as unknown as vscode.LanguageModelChatRequestMessage;
      contents = MessageConverter.toGoogleMessages([mockMsg]);
    } else {
      contents = [{ role: "user", parts: [{ text: prompt }] }];
    }

    const body: any = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    };

    if (payload.type === "tools") {
      body.tools = [{ function_declarations: [{ name: "test_tool", description: "A test tool" }] }];
    }

    const data = await this.doFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      },
      "Google"
    );

    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  private static async doFetch(url: string, init: RequestInit, providerName: string): Promise<any> {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(await this.readResponseError(response));
    }
    const data: any = await response.json();
    if (!data || typeof data !== "object") {
      throw new Error(`${providerName} API response format error`);
    }
    return data;
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
