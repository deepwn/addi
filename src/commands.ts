import * as vscode from "vscode";
import * as crypto from "crypto";
import { ProviderModelManager, ProviderTreeItem, AddiTreeDataProvider } from "./provider";
import { ModelTreeItem } from "./model";
import { ConfigManager, InputValidator, TokenFormatter, UserFeedback } from "./utils";
import { ModelDraft, Provider, Model } from "./types";
import { logger } from "./logger";
// playground logic moved to src/playground.ts
import PlaygroundManager from "./playground";

interface RemoteModelInfo {
  id: string;
  name?: string;
  description?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  capabilities?: Model["capabilities"];
}

type ModelSyncResult = {
  added: number;
  updated: number;
  totalRemote: number;
  mutated: boolean;
};

export class CommandHandler {
  private static readonly TOKEN_LIMIT = 1024 * 1024 * 4;

  constructor(private readonly manager: ProviderModelManager, private readonly treeDataProvider: AddiTreeDataProvider, private readonly context?: vscode.ExtensionContext) {
    logger.debug("CommandHandler initialized", {
      hasContext: Boolean(context),
    });
  }

  private async promptModelApiTest(provider: Provider, modelDraft: ModelDraft, continueLabel: string): Promise<boolean> {
    logger.debug("promptModelApiTest invoked", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(modelDraft),
    });
    const testChoice = await vscode.window.showQuickPick([{ label: "check" }, { label: "skip" }], { placeHolder: "should check model API?" });

    if (!testChoice) {
      UserFeedback.showWarning("canceled model operation");
      logger.warn("Model API test selection canceled", {
        provider: logger.sanitizeProvider(provider),
        model: logger.sanitizeModel(modelDraft),
      });
      return false;
    }

    if (testChoice.label === "skip") {
      logger.debug("Model API test skipped", {
        provider: logger.sanitizeProvider(provider),
        model: logger.sanitizeModel(modelDraft),
      });
      return true;
    }

    try {
      await UserFeedback.showProgress("Testing model API...", async (_progress, token) => {
        await this.testModelApi(provider, modelDraft, token);
      });
      UserFeedback.showInfo("Model API test passed");
      logger.info("Model API test passed", {
        provider: logger.sanitizeProvider(provider),
        model: logger.sanitizeModel(modelDraft),
      });
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn("Model API test failed", {
        provider: logger.sanitizeProvider(provider),
        model: logger.sanitizeModel(modelDraft),
        error: errorMsg,
      });
      const decision = await UserFeedback.showWarningWithActions(`Model API test failed: ${errorMsg}`, ["Cancel", continueLabel]);
      if (decision !== continueLabel) {
        UserFeedback.showWarning("Canceled model operation");
        logger.debug("User canceled after failed API test", {
          provider: logger.sanitizeProvider(provider),
          model: logger.sanitizeModel(modelDraft),
        });
        return false;
      }
      return true;
    }
  }

  private async testModelApi(provider: Provider, modelDraft: ModelDraft, token: vscode.CancellationToken): Promise<void> {
    const apiEndpoint = provider.apiEndpoint?.trim();
    const apiKey = provider.apiKey?.trim();

    if (!apiEndpoint) {
      logger.warn("testModelApi aborted due to missing endpoint", logger.sanitizeProvider(provider));
      throw new Error("unconfigured API endpoint for the provider");
    }

    if (!apiKey) {
      logger.warn("testModelApi aborted due to missing API key", logger.sanitizeProvider(provider));
      throw new Error("unconfigured API key for the provider");
    }

    logger.debug("testModelApi starting", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(modelDraft),
    });

    const abortController = new AbortController();
    const subscription = token.onCancellationRequested(() => abortController.abort());

    try {
      switch (provider.providerType) {
        case "openai":
          await this.testOpenAiApi(apiEndpoint, apiKey, modelDraft, abortController.signal);
          logger.debug("testModelApi openai completed", logger.sanitizeProvider(provider));
          return;
        case "anthropic":
          await this.testAnthropicApi(apiEndpoint, apiKey, modelDraft, abortController.signal);
          logger.debug("testModelApi anthropic completed", logger.sanitizeProvider(provider));
          return;
        case "google":
          await this.testGoogleApi(apiEndpoint, apiKey, modelDraft, abortController.signal);
          logger.debug("testModelApi google completed", logger.sanitizeProvider(provider));
          return;
        default:
          await this.testGenericOpenAiCompatibleApi(apiEndpoint, apiKey, modelDraft, abortController.signal);
          logger.debug("testModelApi generic completed", logger.sanitizeProvider(provider));
          return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        logger.warn("testModelApi aborted", logger.sanitizeProvider(provider));
        throw new Error("Model API test canceled");
      }
      logger.warn("testModelApi failed", {
        provider: logger.sanitizeProvider(provider),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      subscription.dispose();
      logger.debug("testModelApi finished cleanup", logger.sanitizeProvider(provider));
    }
  }

  // Endpoint pattern helpers removed: providerType 现在由用户显式选择，不再通过 endpoint 推断。

  private normalizeBaseUrl(endpoint: string | undefined, fallback: string): string {
    const base = (endpoint && endpoint.trim()) || fallback;
    return base.replace(/\/+$/, "");
  }

  private buildUrl(base: string, path: string): string {
    const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  private resolveModelsUrl(endpoint: string, fallback: string): string {
    const baseUrl = this.normalizeBaseUrl(endpoint, fallback);
  const [baseWithoutQueryRaw, queryString] = baseUrl.split("?", 2);
  const baseWithoutQuery = baseWithoutQueryRaw || baseUrl;

  let path = baseWithoutQuery.replace(/\/(?:chat\/)?completions$/i, "");

    // Azure OpenAI style endpoints include deployment segment; models live under /openai.
    if (/\/openai\/deployments\//i.test(path)) {
      path = path.replace(/\/openai\/deployments\/[^/]+$/i, "/openai");
    }

    const modelsUrl = this.buildUrl(path, "/models");
    return queryString ? `${modelsUrl}?${queryString}` : modelsUrl;
  }

  private resolveChatCompletionsUrl(endpoint: string, fallback: string): string {
    const base = this.normalizeBaseUrl(endpoint, fallback);
    const lower = base.toLowerCase();
    if (lower.endsWith("/chat/completions")) {
      return base;
    }
    return this.buildUrl(base, "/chat/completions");
  }

  private async readResponseError(response: Response): Promise<string> {
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

  private getTestPrompt(): string {
    return "Hello from Addi connectivity test.";
  }

  private ensureMaxTokens(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return 128;
    }
    return Math.min(Math.max(Math.floor(value), 1), CommandHandler.TOKEN_LIMIT);
  }

  private coercePositiveInteger(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.min(Math.floor(value), CommandHandler.TOKEN_LIMIT);
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(Math.floor(parsed), CommandHandler.TOKEN_LIMIT);
      }
    }
    return undefined;
  }

  private resolveModelIdentifierFromDraft(modelDraft: ModelDraft): string {
    const trimmedId = modelDraft.id?.trim();
    if (trimmedId && !/^[0-9]+$/.test(trimmedId)) {
      return trimmedId;
    }
    const trimmedFamily = (modelDraft.family ?? "addi").trim();
    if (trimmedFamily) {
      return trimmedFamily;
    }
    return trimmedId || "addi";
  }

  private async testOpenAiApi(apiEndpoint: string, apiKey: string, modelDraft: ModelDraft, signal: AbortSignal): Promise<void> {
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

  private async testAnthropicApi(apiEndpoint: string, apiKey: string, modelDraft: ModelDraft, signal: AbortSignal): Promise<void> {
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

  private async testGoogleApi(apiEndpoint: string, apiKey: string, modelDraft: ModelDraft, signal: AbortSignal): Promise<void> {
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

  private async testGenericOpenAiCompatibleApi(apiEndpoint: string, apiKey: string, modelDraft: ModelDraft, signal: AbortSignal): Promise<void> {
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

  private async fetchProviderModelsFromApi(provider: Provider): Promise<RemoteModelInfo[]> {
    const endpoint = provider.apiEndpoint?.trim();
    const apiKey = provider.apiKey?.trim();

    if (!endpoint) {
      throw new Error("Provider API endpoint is not configured");
    }

    if (!apiKey) {
      throw new Error("Provider API key is not configured");
    }

    const providerType = provider.providerType ?? "generic";
    logger.debug("fetchProviderModelsFromApi invoked", {
      provider: logger.sanitizeProvider(provider),
      providerType,
    });

    switch (providerType) {
      case "openai":
      case "generic": {
        const url = this.resolveModelsUrl(endpoint, "https://api.openai.com/v1");
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (!response.ok) {
          throw new Error(await this.readResponseError(response));
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const entries = Array.isArray(payload["data"]) ? payload["data"] : [];
        const models: RemoteModelInfo[] = [];

        for (const entry of entries) {
          if (!entry || typeof entry !== "object") {
            continue;
          }
          const record = entry as Record<string, unknown>;
          const id = typeof record["id"] === "string" ? record["id"] : undefined;
          if (!id) {
            continue;
          }
          const displayName = typeof record["display_name"] === "string" ? record["display_name"] : undefined;
          const ownedBy = typeof record["owned_by"] === "string" ? record["owned_by"] : undefined;
          const description = typeof record["description"] === "string" ? record["description"] : ownedBy ? `Owner: ${ownedBy}` : undefined;
          const info: RemoteModelInfo = {
            id,
            name: displayName ?? id,
          };
          if (description) {
            info.description = description;
          }
          models.push(info);
        }

        logger.debug("Fetched OpenAI-compatible model list", {
          provider: logger.sanitizeProvider(provider),
          remoteCount: models.length,
        });
        return models;
      }
      case "anthropic": {
        const baseUrl = this.normalizeBaseUrl(endpoint, "https://api.anthropic.com");
        const url = this.buildUrl(baseUrl, "/v1/models");
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        });

        if (!response.ok) {
          throw new Error(await this.readResponseError(response));
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const listSource = Array.isArray(payload["models"]) ? payload["models"] : Array.isArray(payload["data"]) ? payload["data"] : [];
        const models: RemoteModelInfo[] = [];

        for (const entry of listSource) {
          if (!entry || typeof entry !== "object") {
            continue;
          }
          const record = entry as Record<string, unknown>;
          const id = typeof record["id"] === "string" ? record["id"] : typeof record["name"] === "string" ? record["name"] : undefined;
          if (!id) {
            continue;
          }
          const displayName = typeof record["display_name"] === "string" ? record["display_name"] : undefined;
          const description = typeof record["description"] === "string" ? record["description"] : undefined;
          const maxInputTokens = this.coercePositiveInteger(record["input_token_limit"] ?? record["context_length"] ?? record["context_limit"]);
          const maxOutputTokens = this.coercePositiveInteger(record["output_token_limit"] ?? record["max_output_tokens"]);

          const info: RemoteModelInfo = {
            id,
            name: displayName ?? id,
          };
          if (description) {
            info.description = description;
          }
          if (maxInputTokens !== undefined) {
            info.maxInputTokens = maxInputTokens;
          }
          if (maxOutputTokens !== undefined) {
            info.maxOutputTokens = maxOutputTokens;
          }
          models.push(info);
        }

        logger.debug("Fetched Anthropic model list", {
          provider: logger.sanitizeProvider(provider),
          remoteCount: models.length,
        });
        return models;
      }
      case "google": {
        const baseUrl = this.normalizeBaseUrl(endpoint, "https://generativelanguage.googleapis.com/v1beta");
        const url = `${this.buildUrl(baseUrl, "/models")}?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, {
          method: "GET",
        });

        if (!response.ok) {
          throw new Error(await this.readResponseError(response));
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const entries = Array.isArray(payload["models"]) ? payload["models"] : [];
        const models: RemoteModelInfo[] = [];

        for (const entry of entries) {
          if (!entry || typeof entry !== "object") {
            continue;
          }
          const record = entry as Record<string, unknown>;
          const name = typeof record["name"] === "string" ? record["name"] : undefined;
          if (!name) {
            continue;
          }
          const displayName = typeof record["displayName"] === "string" ? record["displayName"] : undefined;
          const description = typeof record["description"] === "string" ? record["description"] : undefined;
          const maxInputTokens = this.coercePositiveInteger(record["inputTokenLimit"]);
          const maxOutputTokens = this.coercePositiveInteger(record["outputTokenLimit"]);

          let capabilities: Model["capabilities"] | undefined;
          const modalitiesSource = (record["inputModalities"] ??
            record["supportedInputModalities"] ??
            record["allowedInputModalities"] ??
            record["supportedModalities"]) as unknown;
          if (Array.isArray(modalitiesSource)) {
            const hasImage = modalitiesSource.some((value) => typeof value === "string" && value.toUpperCase().includes("IMAGE"));
            if (hasImage) {
              capabilities = { imageInput: true };
            }
          }

          const info: RemoteModelInfo = {
            id: name,
            name: displayName ?? name,
          };
          if (description) {
            info.description = description;
          }
          if (maxInputTokens !== undefined) {
            info.maxInputTokens = maxInputTokens;
          }
          if (maxOutputTokens !== undefined) {
            info.maxOutputTokens = maxOutputTokens;
          }
          if (capabilities) {
            info.capabilities = capabilities;
          }
          models.push(info);
        }

        logger.debug("Fetched Google model list", {
          provider: logger.sanitizeProvider(provider),
          remoteCount: models.length,
        });
        return models;
      }
      default:
        logger.warn("fetchProviderModelsFromApi unsupported provider type", {
          provider: logger.sanitizeProvider(provider),
          providerType,
        });
        return [];
    }
  }

  // playground logic moved to PlaygroundManager

  async openPlayground(provider: Provider, model: Model | (ModelDraft & { id?: string; name?: string })): Promise<void> {
    logger.info("Command openPlayground invoked", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model as Model),
    });
    if (!this.context) {
      logger.error("openPlayground missing extension context");
      throw new Error("No extension context");
    }
    const mgr = new PlaygroundManager(this.context);
    // ensure model has the shape of Model
    const realModel = model as Model;
    await mgr.openPlayground(provider, realModel);
  }

  async addProvider(): Promise<void> {
    logger.info("Command addProvider invoked");
    const name = await UserFeedback.showInputBox({
      prompt: "Please enter the provider name",
      validateInput: InputValidator.validateName,
    });

    if (!name) {
      logger.debug("addProvider canceled at name input");
      return;
    }

    const description = await UserFeedback.showInputBox({
      prompt: "Please enter the provider description (optional)",
      value: "",
    });

    const website = await UserFeedback.showInputBox({
      prompt: "Please enter the provider website (optional)",
      value: "",
    });

    // 先选择 providerType，再决定是否需要/如何填写 endpoint
    const typePick = await vscode.window.showQuickPick(
      [
        { label: "OpenAI", value: "openai" },
        { label: "Anthropic", value: "anthropic" },
        { label: "Google", value: "google" },
        { label: "Generic (OpenAI Compatible)", value: "generic" },
      ],
      { placeHolder: "Select provider type", canPickMany: false, title: "Provider Type" }
    );
    if (!typePick) {
      UserFeedback.showWarning("Provider creation canceled (no type selected)");
      logger.warn("addProvider canceled at type selection");
      return;
    }
    const providerType = typePick.value as Provider["providerType"];

    // 不同类型给出默认 endpoint 建议（用户可修改）
    let suggestedEndpoint = "";
    switch (providerType) {
      case "openai":
        suggestedEndpoint = "https://api.openai.com/v1";
        break;
      case "anthropic":
        suggestedEndpoint = "https://api.anthropic.com";
        break;
      case "google":
        suggestedEndpoint = "https://generativelanguage.googleapis.com/v1beta";
        break;
      default:
        suggestedEndpoint = ""; // generic 不强制
        break;
    }

    const apiEndpoint = await UserFeedback.showInputBox({
      prompt: providerType === "generic" ? "Please enter the API endpoint" : "API endpoint (auto-filled, you can adjust)",
      value: suggestedEndpoint,
    });

    const apiKey = await UserFeedback.showInputBox({
      prompt: "Please enter the API key (optional)",
      value: "",
      password: true,
    });

    try {
      const providerData: Omit<Provider, "id" | "models"> = { name, providerType };

      if (description) {
        providerData.description = description;
      }
      if (website) {
        providerData.website = website;
      }
      if (apiEndpoint) {
        providerData.apiEndpoint = apiEndpoint;
      }
      if (apiKey) {
        providerData.apiKey = apiKey;
      }
      if (providerType) {
        providerData.providerType = providerType;
      }

      logger.debug("Submitting provider for creation", {
        provider: logger.sanitizeProvider(providerData as Provider),
      });
      const created = await this.manager.addProvider(providerData);
      this.treeDataProvider.refresh();
      UserFeedback.showInfo(`Provider "${name}" added`);
      logger.info("Provider created", logger.sanitizeProvider(created));
      await this.syncProviderModels(created.id, "auto");
    } catch (error) {
      UserFeedback.showError(`Failed to add provider: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("addProvider failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async editProvider(item: ProviderTreeItem): Promise<void> {
    logger.info("Command editProvider invoked", logger.sanitizeProvider(item.provider));
    const name = await UserFeedback.showInputBox({
      prompt: "Edit provider name",
      value: item.provider.name,
      validateInput: InputValidator.validateName,
    });

    if (!name) {
      logger.debug("editProvider canceled at name input", logger.sanitizeProvider(item.provider));
      return;
    }

    const description = await UserFeedback.showInputBox({
      prompt: "Edit provider description (optional)",
      value: item.provider.description || "",
    });

    const website = await UserFeedback.showInputBox({
      prompt: "Edit provider website (optional)",
      value: item.provider.website || "",
    });

    // 先选择 / 修改 providerType
    const currentType = item.provider.providerType || "generic";
    const typePick = await vscode.window.showQuickPick(
      [
        { label: "OpenAI", value: "openai", picked: currentType === "openai" },
        { label: "Anthropic", value: "anthropic", picked: currentType === "anthropic" },
        { label: "Google", value: "google", picked: currentType === "google" },
        { label: "Generic (OpenAI Compatible)", value: "generic", picked: currentType === "generic" },
      ],
      { placeHolder: "Select provider type", canPickMany: false, title: "Provider Type" }
    );
    const providerType: Provider["providerType"] = (typePick?.value as Provider["providerType"]) || currentType;

    // 如果之前没有 endpoint，且类型是已知的，给出默认建议
    let suggestedEndpoint = item.provider.apiEndpoint || "";
    if (!suggestedEndpoint) {
      switch (providerType) {
        case "openai":
          suggestedEndpoint = "https://api.openai.com/v1";
          break;
        case "anthropic":
          suggestedEndpoint = "https://api.anthropic.com";
          break;
        case "google":
          suggestedEndpoint = "https://generativelanguage.googleapis.com/v1beta";
          break;
        default:
          suggestedEndpoint = "";
          break;
      }
    }

    const apiEndpoint = await UserFeedback.showInputBox({
      prompt: providerType === "generic" ? "Edit API endpoint (optional)" : "Edit API endpoint (auto-suggested; adjust if needed)",
      value: suggestedEndpoint,
    });

    const apiKey = await UserFeedback.showInputBox({
      prompt: "Edit API key (optional)",
      value: item.provider.apiKey || "",
      password: true,
    });

    try {
      const providerData: Partial<Omit<Provider, "id" | "models">> = { name, providerType };

      if (description) {
        providerData.description = description;
      }
      if (website) {
        providerData.website = website;
      }
      if (apiEndpoint) {
        providerData.apiEndpoint = apiEndpoint;
      }
      if (apiKey) {
        providerData.apiKey = apiKey;
      }
      providerData.providerType = providerType;

      logger.debug("Submitting provider update", {
        original: logger.sanitizeProvider(item.provider),
        update: logger.sanitizeProvider(providerData as Provider),
      });
      const success = await this.manager.updateProvider(item.provider.id, providerData);
      if (success) {
        this.treeDataProvider.refresh();
        UserFeedback.showInfo(`Provider "${name}" updated`);
        logger.info("Provider updated", logger.sanitizeProvider({ ...item.provider, ...providerData } as Provider));
      } else {
        UserFeedback.showError("Failed to update provider");
        logger.warn("Provider update failed", logger.sanitizeProvider(item.provider));
      }
    } catch (error) {
      UserFeedback.showError(`Failed to update provider: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("editProvider failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async deleteProvider(item: ProviderTreeItem): Promise<void> {
    logger.info("Command deleteProvider invoked", logger.sanitizeProvider(item.provider));
    const confirm = await UserFeedback.showConfirmDialog(`Are you sure you want to delete provider "${item.provider.name}"? This will also delete all of its models.`);

    if (!confirm) {
      logger.debug("deleteProvider canceled by user", logger.sanitizeProvider(item.provider));
      return;
    }

    try {
      await UserFeedback.showProgress("Deleting provider...", async (_progress, _token) => {
        const success = await this.manager.deleteProvider(item.provider.id);
        if (success) {
          this.treeDataProvider.refresh();
          UserFeedback.showInfo(`Provider "${item.provider.name}" deleted`);
          logger.info("Provider deleted", logger.sanitizeProvider(item.provider));
        } else {
          UserFeedback.showError("Failed to delete provider");
          logger.warn("deleteProvider manager returned false", logger.sanitizeProvider(item.provider));
        }
      });
    } catch (error) {
      UserFeedback.showError(`Failed to delete provider: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("deleteProvider failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async editApiKey(item: ProviderTreeItem): Promise<void> {
    logger.info("Command editApiKey invoked", logger.sanitizeProvider(item.provider));
    const currentApiKey = item.provider.apiKey || "";

    const newApiKey = await UserFeedback.showInputBox({
      prompt: `Edit API key for "${item.provider.name}" (leave empty to unset)`,
      value: currentApiKey,
      password: true,
      placeHolder: "Please enter the new API key",
    });

    if (newApiKey === undefined) {
      logger.debug("editApiKey canceled", logger.sanitizeProvider(item.provider));
      return;
    }

    try {
      const success = await this.manager.updateProvider(item.provider.id, { apiKey: newApiKey });
      if (success) {
        this.treeDataProvider.refresh();
        UserFeedback.showInfo(`Provider "${item.provider.name}" API key updated`);
        logger.info("Provider API key updated", logger.sanitizeProvider(item.provider));
      } else {
        UserFeedback.showError("Failed to update API key");
        logger.warn("editApiKey manager returned false", logger.sanitizeProvider(item.provider));
      }
    } catch (error) {
      UserFeedback.showError(`Failed to update API key: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("editApiKey failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async pullProviderModels(item: ProviderTreeItem): Promise<void> {
    logger.info("Command pullProviderModels invoked", logger.sanitizeProvider(item.provider));
    await this.syncProviderModels(item.provider.id, "manual");
  }

  private async syncProviderModels(providerId: string, source: "manual" | "auto"): Promise<void> {
    const providers = this.manager.getProviders();
    const providerIndex = providers.findIndex((p) => p.id === providerId);
    if (providerIndex < 0) {
      logger.warn("syncProviderModels missing provider", { providerId });
      if (source === "manual") {
        UserFeedback.showError("Provider not found");
      }
      return;
    }

    const provider = providers[providerIndex]!;
    const endpoint = provider.apiEndpoint?.trim();
    if (!endpoint) {
      const message = `Provider "${provider.name}" is missing an API endpoint. Configure it and try pulling models again.`;
      UserFeedback.showWarning(message);
      logger.warn("syncProviderModels missing endpoint", logger.sanitizeProvider(provider));
      return;
    }

    const apiKey = provider.apiKey?.trim();
    if (!apiKey) {
      const message = `Provider "${provider.name}" is missing an API key. Set the key and rerun "Pull Models List".`;
      UserFeedback.showWarning(message);
      logger.warn("syncProviderModels missing api key", logger.sanitizeProvider(provider));
      return;
    }

    const fetchableProvider: Provider = {
      ...provider,
      apiEndpoint: endpoint,
      apiKey,
    };

    logger.debug("syncProviderModels start", { provider: logger.sanitizeProvider(fetchableProvider), source });

    try {
      const result = await UserFeedback.showProgress<ModelSyncResult>("Fetching models list...", async (_progress, _token) => {
        const remoteModels = await this.fetchProviderModelsFromApi(fetchableProvider);
        const existingById = new Map(provider.models.map((model) => [model.id, model]));
        let added = 0;
        let updated = 0;

        if (remoteModels.length === 0) {
          logger.warn("fetchProviderModelsFromApi returned no models", { provider: logger.sanitizeProvider(fetchableProvider) });
          return { added, updated, totalRemote: 0, mutated: false } satisfies ModelSyncResult;
        }

        const defaultFamily = ConfigManager.getDefaultModelFamily().trim() || "addi";
        const defaultVersion = ConfigManager.getDefaultModelVersion().trim() || "1.0.0";
        const defaultMaxInputTokens = ConfigManager.getDefaultMaxInputTokens();
        const defaultMaxOutputTokens = ConfigManager.getDefaultMaxOutputTokens();

        for (const remote of remoteModels) {
          if (!remote.id) {
            continue;
          }

          const existing = existingById.get(remote.id);
          if (existing) {
            let changed = false;

            if (remote.name && remote.name !== existing.name && existing.name === existing.id) {
              existing.name = remote.name;
              changed = true;
            }

            if (remote.description) {
              if (!existing.detail) {
                existing.detail = remote.description;
                changed = true;
              } else if (!existing.tooltip) {
                existing.tooltip = remote.description;
                changed = true;
              }
            }

            if (remote.maxInputTokens !== undefined && remote.maxInputTokens !== existing.maxInputTokens && existing.maxInputTokens === defaultMaxInputTokens) {
              existing.maxInputTokens = remote.maxInputTokens;
              changed = true;
            }

            if (remote.maxOutputTokens !== undefined && remote.maxOutputTokens !== existing.maxOutputTokens && existing.maxOutputTokens === defaultMaxOutputTokens) {
              existing.maxOutputTokens = remote.maxOutputTokens;
              changed = true;
            }

            if (remote.capabilities) {
              const currentCaps = existing.capabilities ?? {};
              const nextCaps: Model["capabilities"] = { ...currentCaps };
              let capsChanged = false;

              if (remote.capabilities.imageInput !== undefined && currentCaps.imageInput !== remote.capabilities.imageInput) {
                nextCaps.imageInput = remote.capabilities.imageInput;
                capsChanged = true;
              }

              if (remote.capabilities.toolCalling !== undefined && currentCaps.toolCalling !== remote.capabilities.toolCalling) {
                nextCaps.toolCalling = remote.capabilities.toolCalling;
                capsChanged = true;
              }

              if (capsChanged) {
                existing.capabilities = nextCaps;
                changed = true;
              }
            }

            if (changed) {
              updated++;
            }

            continue;
          }

          const model: Model = {
            id: remote.id,
            name: remote.name?.trim() || remote.id,
            family: defaultFamily,
            version: defaultVersion,
            maxInputTokens: remote.maxInputTokens ?? defaultMaxInputTokens,
            maxOutputTokens: remote.maxOutputTokens ?? defaultMaxOutputTokens,
            capabilities: remote.capabilities ? { ...remote.capabilities } : {},
          };

          if (remote.description) {
            model.detail = remote.description;
          }

          provider.models.push(model);
          existingById.set(remote.id, model);
          added++;
        }

        const mutated = added > 0 || updated > 0;
        if (mutated) {
          await this.manager.saveProviders(providers);
        }

        return { added, updated, totalRemote: remoteModels.length, mutated } satisfies ModelSyncResult;
      });

      if (!result) {
        return;
      }

      if (result.totalRemote === 0) {
        const message = `Provider "${provider.name}" did not return any models.`;
        UserFeedback.showWarning(message);
        logger.warn("syncProviderModels empty result", { provider: logger.sanitizeProvider(fetchableProvider) });
        return;
      }

      if (!result.mutated) {
        const message = `Provider "${provider.name}" already has all ${result.totalRemote} models.`;
        UserFeedback.showInfo(message);
        logger.info("syncProviderModels no changes", { provider: logger.sanitizeProvider(fetchableProvider), totalRemote: result.totalRemote });
        return;
      }

      this.treeDataProvider.refresh();
      const fragments: string[] = [];
      if (result.added > 0) {
        fragments.push(`${result.added} added`);
      }
      if (result.updated > 0) {
        fragments.push(`${result.updated} updated`);
      }
      const summary = fragments.length > 0 ? fragments.join(", ") : "updated";
      UserFeedback.showInfo(`Synced models for "${provider.name}" (${summary})`);
      logger.info("syncProviderModels success", {
        provider: logger.sanitizeProvider(fetchableProvider),
        added: result.added,
        updated: result.updated,
        totalRemote: result.totalRemote,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      UserFeedback.showError(`Failed to sync models for "${provider.name}": ${message}`);
      logger.error("syncProviderModels error", { provider: logger.sanitizeProvider(fetchableProvider), error: message });
    }
  }

  async addModel(item: ProviderTreeItem): Promise<void> {
    logger.info("Command addModel invoked", logger.sanitizeProvider(item.provider));
    let id = await UserFeedback.showInputBox({
      prompt: "Enter model ID (unique identifier, recommended: alphanumeric / underscore)",
      validateInput: (v) => (v.trim().length > 0 ? null : "Model ID cannot be empty"),
    });
    if (!id) {
      logger.debug("addModel canceled at id input", logger.sanitizeProvider(item.provider));
      return;
    }
    id = id.trim();

    const name = await UserFeedback.showInputBox({
      prompt: "Enter model name",
      validateInput: InputValidator.validateName,
      value: id,
    });
    if (!name) {
      logger.debug("addModel canceled at name input", logger.sanitizeProvider(item.provider));
      return;
    }

    // family 不再让用户输入，统一使用默认 "addi"。如后续需要多家族扩展，可在设置中开启高级模式再暴露输入。
    const family = ConfigManager.getDefaultModelFamily().trim() || "addi";

    // 版本隐藏，默认 1.0.0
    const version = ConfigManager.getDefaultModelVersion().trim() || "1.0.0";

    const maxInputTokensStr = await UserFeedback.showInputBox({
      prompt: "Enter max input tokens",
      value: ConfigManager.getDefaultMaxInputTokens().toString(),
      validateInput: InputValidator.validateTokens,
    });
    if (!maxInputTokensStr) {
      logger.debug("addModel canceled at maxInputTokens input", logger.sanitizeProvider(item.provider));
      return;
    }

    const maxOutputTokensStr = await UserFeedback.showInputBox({
      prompt: "Enter max output tokens",
      value: ConfigManager.getDefaultMaxOutputTokens().toString(),
      validateInput: InputValidator.validateTokens,
    });
    if (!maxOutputTokensStr) {
      logger.debug("addModel canceled at maxOutputTokens input", logger.sanitizeProvider(item.provider));
      return;
    }

    const imageInputPick = await vscode.window.showQuickPick([{ label: "Yes" }, { label: "No" }], {
      placeHolder: "Does it support visual processing (image input)?",
      canPickMany: false,
    });
    if (!imageInputPick) {
      UserFeedback.showWarning("Model addition canceled");
      logger.warn("addModel canceled at imageInput selection", logger.sanitizeProvider(item.provider));
      return;
    }

    const toolCallingPick = await vscode.window.showQuickPick([{ label: "Yes" }, { label: "No" }], {
      placeHolder: "Does it support tool calling?",
      canPickMany: false,
    });
    if (!toolCallingPick) {
      UserFeedback.showWarning("Model addition canceled");
      logger.warn("addModel canceled at toolCalling selection", logger.sanitizeProvider(item.provider));
      return;
    }

    const imageInput = imageInputPick.label === "Yes";
    const toolCalling = toolCallingPick.label === "Yes";
    const maxInputTokens = TokenFormatter.parse(maxInputTokensStr);
    const maxOutputTokens = TokenFormatter.parse(maxOutputTokensStr);
    if (!maxInputTokens || !maxOutputTokens) {
      UserFeedback.showError("Token values are invalid");
      return;
    }
    const modelDraft: ModelDraft = {
      id,
      name,
      family,
      version,
      maxInputTokens,
      maxOutputTokens,
      capabilities: {
        imageInput,
        toolCalling,
      },
    };

    const proceed = await this.promptModelApiTest(item.provider, modelDraft, "Still add");
    if (!proceed) {
      logger.warn("addModel aborted after API test", {
        provider: logger.sanitizeProvider(item.provider),
        model: logger.sanitizeModel(modelDraft),
      });
      return;
    }

    try {
      const model = await this.manager.addModel(item.provider.id, {
        ...modelDraft,
      });
      if (model) {
        this.treeDataProvider.refresh();
        UserFeedback.showInfo(`Model "${name}" added to provider "${item.provider.name}"`);
        logger.info("Model added", {
          provider: logger.sanitizeProvider(item.provider),
          model: logger.sanitizeModel(model),
        });
      } else {
        UserFeedback.showError("Failed to add model");
        logger.warn("addModel manager returned null", {
          provider: logger.sanitizeProvider(item.provider),
          model: logger.sanitizeModel(modelDraft),
        });
      }
    } catch (error) {
      UserFeedback.showError(`Failed to add model: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("addModel failed", {
        error: error instanceof Error ? error.message : String(error),
        provider: logger.sanitizeProvider(item.provider),
      });
    }
  }

  async editModel(item: ModelTreeItem): Promise<void> {
    logger.info("Command editModel invoked", {
      model: logger.sanitizeModel(item.model),
    });
    const result = this.manager.findModel(item.model.id);
    if (!result) {
      UserFeedback.showError("Model not found");
      logger.warn("editModel failed to find model", { modelId: item.model.id });
      return;
    }
    const { provider, model } = result;

    let id = await UserFeedback.showInputBox({
      prompt: "Edit model ID (unique identifier, recommended: alphanumeric / underscore)",
      value: model.id,
      validateInput: (v) => (v.trim().length > 0 ? null : "Model ID cannot be empty"),
    });
    if (!id) {
      logger.debug("editModel canceled at id input", {
        provider: logger.sanitizeProvider(provider),
        model: logger.sanitizeModel(model),
      });
      return;
    }
    id = id.trim();

    const name = await UserFeedback.showInputBox({
      prompt: "Edit model name",
      value: model.name,
      validateInput: InputValidator.validateName,
    });
    if (!name) {
      logger.debug("editModel canceled at name input", logger.sanitizeModel(model));
      return;
    }

    // 编辑时同样隐藏 family，保持原值；若原值为空则回退 addi
    const family = (model.family && model.family.trim()) || "addi";

    // 编辑时隐藏版本，沿用原值，缺失则设为 1.0.0
    const version = model.version || "1.0.0";

    const maxInputTokensStr = await UserFeedback.showInputBox({
      prompt: "Enter max input tokens",
      value: model.maxInputTokens.toString(),
      validateInput: InputValidator.validateTokens,
    });
    if (!maxInputTokensStr) {
      logger.debug("editModel canceled at maxInputTokens input", logger.sanitizeModel(model));
      return;
    }

    const maxOutputTokensStr = await UserFeedback.showInputBox({
      prompt: "Enter max output tokens",
      value: model.maxOutputTokens.toString(),
      validateInput: InputValidator.validateTokens,
    });
    if (!maxOutputTokensStr) {
      logger.debug("editModel canceled at maxOutputTokens input", logger.sanitizeModel(model));
      return;
    }

    const imageInputPick = await vscode.window.showQuickPick([{ label: "Yes" }, { label: "No" }], {
      placeHolder: "Does it support visual processing (image input)?",
      canPickMany: false,
    });
    if (!imageInputPick) {
      UserFeedback.showWarning("Model editing canceled");
      logger.warn("editModel canceled at imageInput selection", logger.sanitizeModel(model));
      return;
    }

    const toolCallingPick = await vscode.window.showQuickPick([{ label: "Yes" }, { label: "No" }], {
      placeHolder: "Does it support tool calling?",
      canPickMany: false,
    });
    if (!toolCallingPick) {
      UserFeedback.showWarning("Model editing canceled");
      logger.warn("editModel canceled at toolCalling selection", logger.sanitizeModel(model));
      return;
    }

    const imageInput = imageInputPick.label === "Yes";
    const toolCalling = toolCallingPick.label === "Yes";
    const maxInputTokens = TokenFormatter.parse(maxInputTokensStr);
    const maxOutputTokens = TokenFormatter.parse(maxOutputTokensStr);
    if (!maxInputTokens || !maxOutputTokens) {
      UserFeedback.showError("Token values are invalid");
      return;
    }
    const modelDraft: ModelDraft = {
      id,
      name,
      family,
      version,
      maxInputTokens,
      maxOutputTokens,
      capabilities: {
        imageInput,
        toolCalling,
      },
    };

    const proceed = await this.promptModelApiTest(provider, modelDraft, "still update");
    if (!proceed) {
      logger.warn("editModel aborted after API test", {
        provider: logger.sanitizeProvider(provider),
        model: logger.sanitizeModel(modelDraft),
      });
      return;
    }

    try {
      const success = await this.manager.updateModel(provider.id, model.id, {
        ...modelDraft,
      });
      if (success) {
        this.treeDataProvider.refresh();
        UserFeedback.showInfo(`Model "${name}" updated successfully`);
        logger.info("Model updated", {
          provider: logger.sanitizeProvider(provider),
          model: logger.sanitizeModel({ ...modelDraft, id: modelDraft.id } as Model),
        });
      } else {
        UserFeedback.showError("Failed to update model");
        logger.warn("editModel manager returned false", {
          provider: logger.sanitizeProvider(provider),
          model: logger.sanitizeModel(model),
        });
      }
    } catch (error) {
      UserFeedback.showError(`Failed to update model: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("editModel failed", {
        error: error instanceof Error ? error.message : String(error),
        provider: logger.sanitizeProvider(provider),
      });
    }
  }

  async deleteModel(item: ModelTreeItem): Promise<void> {
    logger.info("Command deleteModel invoked", logger.sanitizeModel(item.model));
    const confirm = await UserFeedback.showConfirmDialog(`Are you sure you want to delete the model "${item.model.name}"?`);

    if (!confirm) {
      logger.debug("deleteModel canceled by user", logger.sanitizeModel(item.model));
      return;
    }

    try {
      await UserFeedback.showProgress("Deleting model...", async (_progress, _token) => {
        const success = await this.manager.deleteModel(item.model.id);
        if (success) {
          this.treeDataProvider.refresh();
          UserFeedback.showInfo(`Model "${item.model.name}" deleted successfully`);
          logger.info("Model deleted", logger.sanitizeModel(item.model));
        } else {
          UserFeedback.showError("Failed to delete model");
          logger.warn("deleteModel manager returned false", logger.sanitizeModel(item.model));
        }
      });
    } catch (error) {
      UserFeedback.showError(`Failed to delete model: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("deleteModel failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private adjustExportUriForEncryption(uri: vscode.Uri, encrypted: boolean): vscode.Uri {
    const lowerPath = uri.path.toLowerCase();
    if (encrypted) {
      if (lowerPath.endsWith(".encrypt.txt")) {
        return uri;
      }
      const withoutExtension = uri.path.replace(/(\.[^/]+)?$/, "");
      return uri.with({ path: `${withoutExtension}.encrypt.txt` });
    }

    if (lowerPath.endsWith(".encrypt.txt")) {
      const base = uri.path.slice(0, -".encrypt.txt".length);
      return uri.with({ path: `${base}.json` });
    }

    return uri;
  }

  private encodeProvidersForExport(providers: Provider[], password?: string): string {
    const plainJson = JSON.stringify(providers, null, 2);

    if (!password) {
      return plainJson;
    }

    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const plainBuffer = Buffer.from(plainJson, "utf8");
    const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const payload = {
      v: 1,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: authTag.toString("base64"),
      data: encrypted.toString("base64"),
    } satisfies {
      v: number;
      salt: string;
      iv: string;
      tag: string;
      data: string;
    };

    const payloadBuffer = Buffer.from(JSON.stringify(payload), "utf8");
    return `aes:${payloadBuffer.toString("base64")}`;
  }

  private decodeProvidersFromContent(content: string, password?: string): Provider[] {
    const trimmed = content.trim();

    if (trimmed.startsWith("aes:")) {
      if (!password) {
        throw new Error("Password is required to import this encrypted configuration");
      }

      const payloadBase64 = trimmed.slice(4);
      let payloadJson: string;
      try {
        payloadJson = Buffer.from(payloadBase64, "base64").toString("utf8");
      } catch {
        throw new Error("Encrypted configuration is not valid base64");
      }

      let payload:
        | {
            v: number;
            salt: string;
            iv: string;
            tag: string;
            data: string;
          }
        | undefined;
      try {
        payload = JSON.parse(payloadJson);
      } catch {
        throw new Error("Encrypted configuration payload is malformed");
      }

      if (!payload || payload.v !== 1 || !payload.salt || !payload.iv || !payload.tag || !payload.data) {
        throw new Error("Encrypted configuration payload is incomplete");
      }

      let salt: Buffer;
      let iv: Buffer;
      let tag: Buffer;
      let encrypted: Buffer;
      try {
        salt = Buffer.from(payload.salt, "base64");
        iv = Buffer.from(payload.iv, "base64");
        tag = Buffer.from(payload.tag, "base64");
        encrypted = Buffer.from(payload.data, "base64");
      } catch {
        throw new Error("Encrypted configuration payload contains invalid base64 data");
      }

      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);

      let decrypted: Buffer;
      try {
        decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      } catch {
        throw new Error("Failed to decrypt configuration: invalid password or corrupted data");
      }

      try {
        return JSON.parse(decrypted.toString("utf8")) as Provider[];
      } catch {
        throw new Error("Decrypted configuration has invalid format");
      }
    }

    if (trimmed.startsWith("b64:")) {
      const base64Payload = trimmed.slice(4);
      let json: string;
      try {
        json = Buffer.from(base64Payload, "base64").toString("utf8");
      } catch {
        throw new Error("Configuration is not valid base64");
      }
      return JSON.parse(json) as Provider[];
    }

    return JSON.parse(trimmed) as Provider[];
  }

  async exportConfig(): Promise<void> {
    logger.info("Command exportConfig invoked");
    try {
      const providers = this.manager.getProviders();
      if (providers.length === 0) {
        UserFeedback.showWarning("No configurations to export");
        logger.warn("exportConfig aborted: no providers configured");
        return;
      }

      const passwordInput = await UserFeedback.showInputBox({
        prompt: "Enter password to encrypt configuration (optional)",
        placeHolder: "Leave empty to export without encryption",
        password: true,
        value: "",
        ignoreFocusOut: true,
      });

      if (passwordInput === undefined) {
        logger.debug("exportConfig canceled at password prompt");
        return;
      }

      const password = passwordInput.length > 0 ? passwordInput : undefined;
      const encrypted = Boolean(password);

      const defaultFileName = encrypted ? "addi-config.encrypt.txt" : "addi-config.json";
      const firstWorkspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const defaultUri = firstWorkspaceFolder ? vscode.Uri.joinPath(firstWorkspaceFolder, defaultFileName) : undefined;

      const saveDialogOptions: vscode.SaveDialogOptions = {
        filters: {
          "Config Files": ["json", "encrypt.txt"],
          "All Files": ["*"],
        },
        title: "Export Configuration",
      };

      if (defaultUri) {
        saveDialogOptions.defaultUri = defaultUri;
      }

      const uri = await vscode.window.showSaveDialog(saveDialogOptions);

      if (!uri) {
        logger.debug("exportConfig canceled at save dialog");
        return;
      }

      const targetUri = this.adjustExportUriForEncryption(uri, encrypted);

      await UserFeedback.showProgress("Exporting configuration...", async (_progress, _token) => {
        const encoded = this.encodeProvidersForExport(providers, password);
        await vscode.workspace.fs.writeFile(targetUri, Buffer.from(encoded, "utf8"));
        UserFeedback.showInfo(`Configuration exported${password ? " (encrypted)" : ""} to ${targetUri.fsPath}`);
        logger.info("Configuration exported", {
          providerCount: providers.length,
          encrypted,
          target: targetUri.fsPath,
        });
      });
    } catch (error) {
      UserFeedback.showError(`Failed to export configuration: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("exportConfig failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async importConfig(): Promise<void> {
    logger.info("Command importConfig invoked");
    try {
      const openDialogOptions: vscode.OpenDialogOptions = {
        filters: {
          "Config Files": ["json", "encrypt.txt"],
          "All Files": ["*"],
        },
        title: "Import Configuration",
        canSelectMany: false,
      };

      const uri = await vscode.window.showOpenDialog(openDialogOptions);

      if (!uri || uri.length === 0) {
        logger.debug("importConfig canceled at file selection");
        return;
      }

      const data = await vscode.workspace.fs.readFile(uri[0]!);
      const content = new TextDecoder().decode(data);
      const trimmedContent = content.trim();

      let password: string | undefined;
      if (trimmedContent.startsWith("aes:")) {
        const passwordInput = await UserFeedback.showInputBox({
          prompt: "Enter password to decrypt configuration",
          password: true,
          value: "",
        });

        if (passwordInput === undefined) {
          logger.debug("importConfig canceled at password prompt");
          return;
        }

        if (passwordInput.length === 0) {
          UserFeedback.showError("Password is required to import encrypted configuration");
          logger.warn("importConfig provided empty password for encrypted file");
          return;
        }

        password = passwordInput;
      }

      await UserFeedback.showProgress("Importing configuration...", async (_progress, _token) => {
        const providers = this.decodeProvidersFromContent(trimmedContent, password);

        if (!Array.isArray(providers)) {
          throw new Error("Configuration format is invalid");
        }

        for (const provider of providers) {
          if (!provider.id || !provider.name || !Array.isArray(provider.models)) {
            throw new Error("Configuration format is invalid");
          }

          for (const model of provider.models) {
            if (!model || typeof model !== "object") {
              throw new Error("Configuration format is invalid");
            }
            const mm = model as unknown as Record<string, unknown>;
            if (!mm["id"] || !mm["name"] || !mm["family"] || !mm["version"] || typeof mm["maxInputTokens"] !== "number" || typeof mm["maxOutputTokens"] !== "number") {
              throw new Error("Configuration format is invalid");
            }

            const capabilitiesValue = mm["capabilities"];
            const hasCapabilitiesObject = typeof capabilitiesValue === "object" && capabilitiesValue !== null;
            const hasLegacyCapabilities = "imageInput" in mm || "toolCalling" in mm;

            if (!hasCapabilitiesObject && !hasLegacyCapabilities) {
              throw new Error("Configuration capabilities definition is missing");
            }

            if (hasCapabilitiesObject) {
              const caps = capabilitiesValue as Record<string, unknown>;
              if ("imageInput" in caps && typeof caps["imageInput"] !== "boolean") {
                throw new Error("Configuration capability imageInput must be boolean");
              }
              if ("toolCalling" in caps && typeof caps["toolCalling"] !== "boolean" && typeof caps["toolCalling"] !== "number") {
                throw new Error("Configuration capability toolCalling must be boolean or number");
              }
            }
          }
        }

        const currentProviders = this.manager.getProviders();
        if (currentProviders.length > 0) {
          const overwrite = await UserFeedback.showConfirmDialog("Current configuration already exists, do you want to overwrite it?");

          if (!overwrite) {
            return;
          }
        }

        await this.manager.saveProviders(providers);
        this.treeDataProvider.refresh();
        UserFeedback.showInfo(`Configuration imported from ${uri[0]!.fsPath}`);
        logger.info("Configuration imported", {
          providerCount: providers.length,
          source: uri[0]!.fsPath,
        });
      });
    } catch (error) {
      UserFeedback.showError(`Failed to import configuration: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("importConfig failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
