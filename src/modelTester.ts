import * as vscode from "vscode";
import { ModelDraft, Provider, Model } from "./types";
import { MessageConverter } from "./services/messageConverter";
import { LLMClient } from "./services/llmClient";
import { logger } from "./logger";

export interface TestResult {
  success: boolean;
  error?: string;
  detectedMaxInputTokens?: number;
  detectedMaxOutputTokens?: number;
  visionSupported?: boolean;
  toolCallingSupported?: boolean;
  speed?: number;
}

export interface TestOptions {
  detectInput: boolean;
  detectOutput: boolean;
  checkVision: boolean;
  checkTools: boolean;
  checkSpeed: boolean;
}

export type ProgressCallback = (message: string) => void;

export class ModelTester {
  private static readonly COARSE_STEP = 64 * 1024;
  private static readonly VISION_TEST_IMAGE =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAZEAEAAgMAAAAAAAAAAAAAAAAAAQIxcbH/xAAVAQEBAAAAAAAAAAAAAAAAAAAGB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ALH64jUcAF1Qf//Z";

  static async testModelApi(provider: Provider, modelDraft: ModelDraft, options: TestOptions, token: AbortSignal, onProgress?: ProgressCallback): Promise<TestResult> {
    const result: TestResult = { success: false };

    try {
      // 1. Basic Connectivity
      onProgress?.("Checking connectivity...");
      const connectToken = "ADDI_CONNECT_OK";
      
      // Use configured maxOutputTokens to verify if the model supports the setting
      const testMaxTokens = (modelDraft.maxOutputTokens && modelDraft.maxOutputTokens > 0) ? modelDraft.maxOutputTokens : undefined;

      const payload: { type: "text" | "vision" | "tools"; prompt?: string; maxTokens?: number } = { 
          type: "text", 
          prompt: `Reply exactly '${connectToken}'`
      };
      if (testMaxTokens !== undefined) {
          payload.maxTokens = testMaxTokens;
      }

      const response = await this.performRequest(provider, modelDraft, payload, token);
      
      if (!response || !response.includes(connectToken)) {
        throw new Error(`Connection test failed: Model response did not contain expected token. Response: ${response ? response.slice(0, 100) : 'empty'}`);
      }
      result.success = true;

      // 2. Detect Token Limits
      if (options.detectOutput) {
        onProgress?.("Detecting output token limits...");
        result.detectedMaxOutputTokens = await this.detectLimit(provider, modelDraft, "output", token, onProgress);
        if (result.detectedMaxOutputTokens) {
            modelDraft.maxOutputTokens = result.detectedMaxOutputTokens;
        }
      }

      if (options.detectInput) {
        onProgress?.("Detecting input token limits...");
        result.detectedMaxInputTokens = await this.detectLimit(provider, modelDraft, "input", token, onProgress);
        if (result.detectedMaxInputTokens) {
            modelDraft.maxInputTokens = result.detectedMaxInputTokens;
        }
      }

      // 3. Vision Check
      if (options.checkVision) {
        onProgress?.("Verifying vision capabilities...");
        try {
          await this.performRequest(provider, modelDraft, { type: "vision" }, token);
          result.visionSupported = true;
        } catch (e) {
          result.visionSupported = false;
        }
      }

      // 4. Tools Check
      if (options.checkTools) {
        onProgress?.("Verifying tool calling capabilities...");
        try {
          await this.performRequest(provider, modelDraft, { type: "tools" }, token);
          result.toolCallingSupported = true;
        } catch (e) {
          result.toolCallingSupported = false;
        }
      }

      // 5. Speed Test
      if (options.checkSpeed) {
        onProgress?.("Measuring response speed...");
        result.speed = await this.measureSpeed(provider, modelDraft, token);
      }
    } catch (e) {
      result.success = false;
      result.error = e instanceof Error ? e.message : String(e);
    }

    return result;
  }

  private static async measureSpeed(provider: Provider, modelDraft: ModelDraft, token: AbortSignal): Promise<number> {
    const client = new LLMClient();
    const model: Model = { ...modelDraft, sid: "temp" };
    const messages = [vscode.LanguageModelChatMessage.User("Count from 1 to 50. e.g. 1, 2, 3...")];

    let firstTokenTime = 0;
    let endTime = 0;
    let tokenCount = 0;

    const progressReporter: vscode.Progress<vscode.LanguageModelResponsePart> = {
      report: () => {
        // no-op
      },
    };

    const cancellationToken: vscode.CancellationToken = {
      isCancellationRequested: token.aborted,
      onCancellationRequested: (listener) => {
        token.addEventListener("abort", listener);
        return { dispose: () => token.removeEventListener("abort", listener) };
      },
    };

    const onStats = (stats: { firstTokenTime: number; endTime: number; tokenCount: number }) => {
      firstTokenTime = stats.firstTokenTime;
      endTime = stats.endTime;
      tokenCount = stats.tokenCount;
    };

    try {
      if (provider.providerType === "openai" || provider.providerType === "generic") {
        await client.callOpenAiApi(provider, model, messages, undefined, undefined, progressReporter, cancellationToken, onStats);
      } else if (provider.providerType === "anthropic") {
        await client.callAnthropicApi(provider, model, messages, undefined, undefined, progressReporter, cancellationToken, undefined, onStats);
      } else if (provider.providerType === "google") {
        await client.callGoogleApi(provider, model, messages, undefined, undefined, progressReporter, cancellationToken, undefined, onStats);
      }
    } catch (e) {
      return 0;
    }

    if (firstTokenTime > 0 && tokenCount > 0) {
      const duration = Math.max((endTime - firstTokenTime) / 1000, 0.001);
      return tokenCount / duration;
    }
    return 0;
  }

  private static async detectLimit(provider: Provider, modelDraft: ModelDraft, mode: "input" | "output", token: AbortSignal, onProgress?: ProgressCallback): Promise<number> {
    // 1. Try to probe via error message first (Zero-cost)
    if (mode === 'output') {
        const probed = await this.probeLimitFromError(provider, modelDraft, token);
        if (probed > 0) {
            onProgress?.(`Probed ${mode} limit from API error: ${probed}`);
            return probed;
        }
    }

    // Coarse search (Reverse)
    const coarsePoints = [524288, 262144, 196608, 131072, 65536, 1024]; // 512k, 256k, 192k, 128k, 64k, 1k
    let high = 0;
    let low = 0;

    for (const point of coarsePoints) {
      if (token.aborted) {
        return 0;
      }
      onProgress?.(`Probing ${mode} limit: ${point} tokens...`);
      const success = await this.verifyLimit(provider, modelDraft, point, mode, token);
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
      const success = await this.verifyLimit(provider, modelDraft, mid, mode, token);
      if (success) {
        best = mid;
        l = mid;
      } else {
        r = mid;
      }
    }

    return best;
  }

  private static async probeLimitFromError(provider: Provider, modelDraft: ModelDraft, token: AbortSignal): Promise<number> {
      try {
          // Send a huge max_tokens to provoke an error
          const hugeValue = 100000000;
          const payload = { type: "text", maxTokens: hugeValue, prompt: "Reply 'OK'." };
          
          // We expect this to fail and throw an error string
          await this.performRequest(provider, modelDraft, payload as any, token);
          return 0; // Surprisingly succeeded?
      } catch (e) {
          const errorMsg = String(e).toLowerCase();
          
          // Regex patterns to extract limits from common error messages
          // OpenAI: "This model's maximum context length is 4097 tokens."
          // Anthropic: "max_tokens_to_sample exceeds limit of 100000"
          // Generic: "limit is 128000"
          
          const patterns = [
              /maximum context length is (\d+)/,
              /context window is (\d+)/,
              /limit of (\d+)/,
              /limit is (\d+)/,
              /supports at most (\d+)/,
              /max_tokens.*?(\d+)/
          ];

          for (const pattern of patterns) {
              const match = errorMsg.match(pattern);
              if (match && match[1]) {
                  const val = parseInt(match[1], 10);
                  if (!isNaN(val) && val > 0) {
                      return val;
                  }
              }
          }
          return 0;
      }
  }

  private static async verifyLimit(provider: Provider, modelDraft: ModelDraft, value: number, _mode: "input" | "output", token: AbortSignal): Promise<boolean> {
    try {
      const intValue = Math.floor(value);
      let payload: any = { type: "text" };
      
      // Use parameter validation to test limits.
      // We set maxTokens to the target value. If the API rejects it (e.g. exceeds context length or output limit),
      // it will throw an error (non-200 response).
      // This avoids sending large prompts which would consume user tokens.
      payload.maxTokens = intValue;
      payload.prompt = "Reply 'OK'.";

      const responseText = await this.performRequest(provider, modelDraft, payload, token);
      // If the API returns successfully, it means the parameters were accepted.
      return responseText !== undefined;
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

    const maxTokens = payload.maxTokens ?? 100; // Default to 100 to be safe
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

    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.length > 0) {
        return content;
    }
    // If content is missing or empty, return the raw JSON to help debug
    return JSON.stringify(data);
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

    const content = data.content?.[0]?.text;
    if (typeof content === 'string' && content.length > 0) {
        return content;
    }
    return JSON.stringify(data);
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

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof content === 'string' && content.length > 0) {
        return content;
    }
    return JSON.stringify(data);
  }

  private static sanitizeHeaders(headers: any): Record<string, string> {
    if (!headers) {
      return {};
    }
    const safeHeaders: Record<string, string> = {};
    
    let entries: [string, any][] = [];
    
    if (typeof headers.entries === 'function') {
        entries = Array.from(headers.entries());
    } else if (Array.isArray(headers)) {
        entries = headers as [string, any][];
    } else {
        entries = Object.entries(headers);
    }

    for (const [key, value] of entries) {
      if (key.toLowerCase() === "authorization" || key.toLowerCase() === "x-api-key") {
        safeHeaders[key] = "***";
      } else {
        safeHeaders[key] = String(value);
      }
    }
    return safeHeaders;
  }

  private static async doFetch(url: string, init: RequestInit, providerName: string): Promise<any> {
    logger.debug(`Sending ${providerName} API request (Tester)`, {
      url,
      headers: this.sanitizeHeaders(init.headers),
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body
    });

    const response = await fetch(url, init);

    logger.debug(`Received ${providerName} API response (Tester)`, {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

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
