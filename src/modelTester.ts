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
  private static readonly PROBE_LEVELS = [4096, 8192, 16384, 32768, 65536, 128000];

  static async testModelApi(provider: Provider, modelDraft: ModelDraft, options: TestOptions, token: AbortSignal, onProgress?: ProgressCallback): Promise<TestResult> {
    const result: TestResult = { success: false };
    
    try {
        // 1. Basic Connectivity
        onProgress?.("Checking connectivity...");
        await this.performRequest(provider, modelDraft, { type: 'text', prompt: "Reply 'OK'." }, token);
        result.success = true;

        // 2. Vision Check
        if (options.checkVision) {
            onProgress?.("Verifying vision capabilities...");
            try {
                await this.performRequest(provider, modelDraft, { type: 'vision' }, token);
                result.visionSupported = true;
            } catch (e) {
                result.visionSupported = false;
            }
        }

        // 3. Tools Check
        if (options.checkTools) {
            onProgress?.("Verifying tool calling capabilities...");
            try {
                await this.performRequest(provider, modelDraft, { type: 'tools' }, token);
                result.toolCallingSupported = true;
            } catch (e) {
                result.toolCallingSupported = false;
            }
        }

        // 4. Detect Token Limits
        // We use max_tokens to probe limits. This avoids sending large input payloads which are expensive.
        // This accurately detects Output limits. For Input limits, it provides a safe lower bound (as Output <= Input usually).
        if (options.detectInput || options.detectOutput) {
            onProgress?.("Detecting token limits...");
            let maxConfirmed = 0;
            for (const level of this.PROBE_LEVELS) {
                if (token.aborted) { break; }
                onProgress?.(`Probing limit: ${level} tokens...`);
                try {
                    await this.performRequest(provider, modelDraft, { 
                        type: 'text', 
                        prompt: "Hi", 
                        maxTokens: level 
                    }, token);
                    maxConfirmed = level;
                } catch (e) {
                    break;
                }
            }
            if (maxConfirmed > 0) {
                if (options.detectOutput) {
                    result.detectedMaxOutputTokens = maxConfirmed;
                }
                if (options.detectInput) {
                    result.detectedMaxInputTokens = maxConfirmed;
                }
            }
        }

    } catch (e) {
        result.success = false;
        result.error = e instanceof Error ? e.message : String(e);
    }

    return result;
  }

  private static async performRequest(
      provider: Provider, 
      modelDraft: ModelDraft, 
      payload: { type: 'text' | 'vision' | 'tools', prompt?: string, maxTokens?: number }, 
      signal: AbortSignal
  ): Promise<void> {
      const apiEndpoint = provider.apiEndpoint?.trim();
      const apiKey = provider.apiKey?.trim();

      if (!apiEndpoint) { throw new Error("Unconfigured API endpoint"); }
      if (!apiKey) { throw new Error("Unconfigured API key"); }

      const maxTokens = payload.maxTokens ?? 10; // Default small for speed
      const prompt = payload.prompt ?? "Reply 'OK'.";

      // Construct body based on provider type and payload type
      // This is a simplified dispatcher. Real implementation needs to handle provider specifics.
      // For brevity, I'll reuse the existing logic but adapted.
      
      switch (provider.providerType) {
        case "openai":
        case "generic":
            await this.requestOpenAI(apiEndpoint, apiKey, modelDraft, payload, signal, maxTokens, prompt);
            break;
        case "anthropic":
            await this.requestAnthropic(apiEndpoint, apiKey, modelDraft, payload, signal, maxTokens, prompt);
            break;
        case "google":
            await this.requestGoogle(apiEndpoint, apiKey, modelDraft, payload, signal, maxTokens, prompt);
            break;
      }
  }

  private static async requestOpenAI(endpoint: string, key: string, draft: ModelDraft, payload: any, signal: AbortSignal, maxTokens: number, prompt: string) {
      const url = this.resolveChatCompletionsUrl(endpoint, "https://api.openai.com/v1");
      
      let messages: any[];
      if (payload.type === 'vision') {
          const imagePart = new vscode.LanguageModelDataPart(
              Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
              "image/gif"
          );
          const mockMsg = {
              role: vscode.LanguageModelChatMessageRole.User,
              content: [
                  new vscode.LanguageModelTextPart("Describe this image"),
                  imagePart
              ],
              name: undefined
          } as unknown as vscode.LanguageModelChatRequestMessage;
          messages = MessageConverter.toOpenAiMessages([mockMsg]);
      } else {
          messages = [{ role: "user", content: prompt }];
      }

      const body: any = {
          model: this.resolveModelIdentifierFromDraft(draft),
          messages,
          max_tokens: maxTokens,
          stream: false
      };

      if (payload.type === 'tools') {
          body.tools = [{
              type: "function",
              function: {
                  name: "test_tool",
                  description: "A test tool",
                  parameters: { type: "object", properties: {} }
              }
          }];
          body.tool_choice = "none";
      }

      await this.doFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          signal
      }, "OpenAI");
  }

  private static async requestAnthropic(endpoint: string, key: string, draft: ModelDraft, payload: any, signal: AbortSignal, maxTokens: number, prompt: string) {
      const baseUrl = this.normalizeBaseUrl(endpoint, "https://api.anthropic.com");
      const url = this.buildUrl(baseUrl, "/v1/messages");
      
      let messages: any[];
      if (payload.type === 'vision') {
          const imagePart = new vscode.LanguageModelDataPart(
              Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
              "image/gif"
          );
          const mockMsg = {
              role: vscode.LanguageModelChatMessageRole.User,
              content: [
                  new vscode.LanguageModelTextPart("Describe this image"),
                  imagePart
              ],
              name: undefined
          } as unknown as vscode.LanguageModelChatRequestMessage;
          messages = MessageConverter.toAnthropicMessages([mockMsg]);
      } else {
          messages = [{ role: "user", content: prompt }];
      }

      const body: any = {
          model: this.resolveModelIdentifierFromDraft(draft),
          max_tokens: maxTokens,
          messages,
          stream: false
      };

      if (payload.type === 'tools') {
          body.tools = [{
              name: "test_tool",
              description: "A test tool",
              input_schema: { type: "object", properties: {} }
          }];
      }

      await this.doFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify(body),
          signal
      }, "Anthropic");
  }

  private static async requestGoogle(endpoint: string, key: string, draft: ModelDraft, payload: any, signal: AbortSignal, maxTokens: number, prompt: string) {
      const baseUrl = this.normalizeBaseUrl(endpoint, "https://generativelanguage.googleapis.com/v1beta");
      const modelId = this.resolveModelIdentifierFromDraft(draft);
      const url = `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`;

      let contents: any[];
      if (payload.type === 'vision') {
          const imagePart = new vscode.LanguageModelDataPart(
              Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
              "image/gif"
          );
          const mockMsg = {
              role: vscode.LanguageModelChatMessageRole.User,
              content: [
                  new vscode.LanguageModelTextPart("Describe this image"),
                  imagePart
              ],
              name: undefined
          } as unknown as vscode.LanguageModelChatRequestMessage;
          contents = MessageConverter.toGoogleMessages([mockMsg]);
      } else {
          contents = [{ role: "user", parts: [{ text: prompt }] }];
      }

      const body: any = {
          contents,
          generationConfig: { maxOutputTokens: maxTokens }
      };

      if (payload.type === 'tools') {
          body.tools = [{ function_declarations: [{ name: "test_tool", description: "A test tool" }] }];
      }

      await this.doFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal
      }, "Google");
  }

  private static async doFetch(url: string, init: RequestInit, providerName: string) {
      const response = await fetch(url, init);
      if (!response.ok) {
          throw new Error(await this.readResponseError(response));
      }
      const data: any = await response.json();
      if (!data || typeof data !== "object") {
          throw new Error(`${providerName} API response format error`);
      }
      // Basic validation of response structure could be added here
  }

  private static resolveModelIdentifierFromDraft(modelDraft: ModelDraft): string {
    const trimmedId = modelDraft.id?.trim();
    if (trimmedId) { return trimmedId; }
    const trimmedFamily = (modelDraft.family ?? "addi").trim();
    if (trimmedFamily) { return trimmedFamily; }
    const draftSid = modelDraft.sid?.trim();
    if (draftSid) { return draftSid; }
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
    if (!body) { return statusInfo; }
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.error === "string") { return `${statusInfo} - ${parsed.error}`; }
      if (parsed?.error?.message) { return `${statusInfo} - ${parsed.error.message}`; }
      return `${statusInfo} - ${body}`;
    } catch {
      return `${statusInfo} - ${body}`;
    }
  }

  private static resolveChatCompletionsUrl(endpoint: string, fallback: string): string {
    const base = this.normalizeBaseUrl(endpoint, fallback);
    const lower = base.toLowerCase();
    if (lower.endsWith("/chat/completions")) { return base; }
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
