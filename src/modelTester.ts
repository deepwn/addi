import * as vscode from "vscode";
import { ModelDraft, Provider, Model } from "./types";
import { AIProviderRegistry } from "./services/aiRegistry";
import { generateText, ModelMessage, Tool, jsonSchema } from "ai";
import { logger } from "./logger";
import { LLMService } from "./services/llmService";

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

      const payload: { type: "text" | "vision" | "tools"; prompt?: string; maxOutputTokens?: number } = { 
          type: "text", 
          prompt: `Reply exactly '${connectToken}'`
      };
      if (testMaxTokens !== undefined) {
          payload.maxOutputTokens = testMaxTokens;
      }

      const response = await this.performRequest(provider, modelDraft, payload, token);
      
      if (!response || !response.includes(connectToken)) {
        throw new Error(`Connection test failed: Model response did not contain expected token. Response: ${response ? response.slice(0, 100) : 'empty'}`);
      }
      result.success = true;

      // 2. Detect Token Limits
      if (options.detectOutput) {
        onProgress?.("Detecting output token limits...");
        const limit = await this.detectLimit(provider, modelDraft, "output", token, onProgress);
        if (limit !== undefined) {
            result.detectedMaxOutputTokens = limit;
            modelDraft.maxOutputTokens = limit;
        }
      }

      if (options.detectInput) {
        onProgress?.("Detecting input token limits...");
        const limit = await this.detectLimit(provider, modelDraft, "input", token, onProgress);
        if (limit !== undefined) {
            result.detectedMaxInputTokens = limit;
            modelDraft.maxInputTokens = limit;
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

    } catch (error: any) {
      result.error = error.message || String(error);
      logger.error("Model test failed", error);
    }

    return result;
  }

  private static async performRequest(
    provider: Provider,
    modelDraft: ModelDraft,
    payload: { type: "text" | "vision" | "tools"; prompt?: string; maxOutputTokens?: number },
    signal: AbortSignal
  ): Promise<string | undefined> {
    
    const aiModel = AIProviderRegistry.createModel(provider, this.resolveModelIdentifierFromDraft(modelDraft));
    
    let messages: ModelMessage[] = [];
    let tools: Record<string, Tool> | undefined = undefined;

    if (payload.type === "vision") {
      // Construct a vision message
      messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: "Describe this image" },
            { type: 'image', image: Buffer.from(this.VISION_TEST_IMAGE, "base64") }
          ]
        }
      ];
    } else {
      messages = [
        { role: 'user', content: [{ type: 'text', text: payload.prompt ?? "Reply 'OK'." }] }
      ];
    }

    if (payload.type === "tools") {
      tools = {
        test_tool: {
          description: "A test tool",
          inputSchema: jsonSchema({ type: "object", properties: {} }),
        } as any
      };
    }

    const result = await generateText({
      model: aiModel,
      messages,
      maxOutputTokens: payload.maxOutputTokens ?? 100,
      tools,
      abortSignal: signal,
    } as any);

    if (payload.type === "tools") {
        // Check if tool was called
        if (result.toolCalls && result.toolCalls.length > 0) {
            return "Tool called";
        }
        return "Tool not called";
    }

    return result.text;
  }

  private static async measureSpeed(provider: Provider, modelDraft: ModelDraft, token: AbortSignal): Promise<number> {
    // Use LLMService to measure speed
    const llmService = new LLMService();
    const model: Model = { ...modelDraft, sid: "temp" };
    const messages = [new vscode.LanguageModelTextPart("Count from 1 to 50. e.g. 1, 2, 3...")];
    
    // Mock VS Code message
    const vsMessages: vscode.LanguageModelChatRequestMessage[] = [{
        role: vscode.LanguageModelChatMessageRole.User,
        content: messages,
        name: undefined
    }];

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
      }
    };

    await llmService.chat(
        provider,
        model,
        vsMessages,
        undefined,
        progressReporter,
        cancellationToken,
        (stats) => {
            firstTokenTime = stats.firstTokenTime;
            endTime = stats.endTime;
            tokenCount = stats.tokenCount;
        }
    );

    if (tokenCount > 0 && endTime > firstTokenTime) {
      const duration = (endTime - firstTokenTime) / 1000;
      return tokenCount / duration;
    }
    return 0;
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

  private static async detectLimit(
    provider: Provider,
    modelDraft: ModelDraft,
    mode: "input" | "output",
    token: AbortSignal,
    onProgress?: ProgressCallback
  ): Promise<number | undefined> {
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
        if (point === coarsePoints[0]) {
          return point;
        }
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
          const payload = { type: "text", maxOutputTokens: hugeValue, prompt: "Reply 'OK'." };
          
          // We expect this to fail and throw an error string
          await this.performRequest(provider, modelDraft, payload as any, token);
          return 0; // Surprisingly succeeded?
      } catch (e) {
          const errorMsg = String(e).toLowerCase();
          
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
      
      payload.maxOutputTokens = intValue;
      payload.prompt = "Reply 'OK'.";

      const responseText = await this.performRequest(provider, modelDraft, payload, token);
      return responseText !== undefined;
    } catch (e) {
      return false;
    }
  }

}
