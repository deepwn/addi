import * as vscode from "vscode";
import { ProviderModelManager, ProviderTreeItem, AddiTreeDataProvider } from "./provider";
import { ModelTreeItem } from "./model";
import { ConfigManager, InputValidator, UserFeedback } from "./utils";
import { Model, ModelDraft, Provider } from "./types";
import { ModelDebugPanel, DebugPanelContextMessage, DebugInteraction, DebugLogEntry } from "./debugPanel";
import { invokeChatCompletion, ChatMessage, ChatRequestOptions } from "./apiClient";

type DebugSessionState = {
  panel: ModelDebugPanel;
  provider: Provider;
  model: Model;
  history: ChatMessage[];
  logs: DebugLogEntry[];
};

export class CommandHandler {
  private readonly debugSessions = new Map<string, DebugSessionState>();

  constructor(private readonly context: vscode.ExtensionContext, private readonly manager: ProviderModelManager, private readonly treeDataProvider: AddiTreeDataProvider) {}

  private async promptModelApiTest(provider: Provider, modelDraft: ModelDraft, continueLabel: string): Promise<boolean> {
    const testChoice = await vscode.window.showQuickPick([{ label: "check" }, { label: "skip" }], { placeHolder: "should check model API?" });

    if (!testChoice) {
      UserFeedback.showWarning("canceled model operation");
      return false;
    }

    if (testChoice.label === "skip") {
      return true;
    }

    try {
      await UserFeedback.showProgress("Testing model API...", async (_progress, token) => {
        await this.testModelApi(provider, modelDraft, token);
      });
      UserFeedback.showInfo("Model API test passed");
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const decision = await vscode.window.showWarningMessage(`Model API test failed: ${errorMsg}`, { modal: true }, "Cancel", continueLabel);
      if (decision !== continueLabel) {
        UserFeedback.showWarning("Canceled model operation");
        return false;
      }
      return true;
    }
  }

  private async testModelApi(provider: Provider, modelDraft: ModelDraft, token: vscode.CancellationToken): Promise<void> {
    const apiEndpoint = provider.apiEndpoint?.trim();
    const apiKey = provider.apiKey?.trim();

    if (!apiEndpoint) {
      throw new Error("unconfigured API endpoint for the provider");
    }

    if (!apiKey) {
      throw new Error("unconfigured API key for the provider");
    }

    const abortController = new AbortController();
    const subscription = token.onCancellationRequested(() => abortController.abort());

    try {
      if (this.isOpenAiEndpoint(apiEndpoint)) {
        await this.testOpenAiApi(apiEndpoint, apiKey, modelDraft, abortController.signal);
        return;
      }

      if (this.isAnthropicEndpoint(apiEndpoint)) {
        await this.testAnthropicApi(apiEndpoint, apiKey, modelDraft, abortController.signal);
        return;
      }

      if (this.isGoogleEndpoint(apiEndpoint)) {
        await this.testGoogleApi(apiEndpoint, apiKey, modelDraft, abortController.signal);
        return;
      }

      await this.testGenericOpenAiCompatibleApi(apiEndpoint, apiKey, modelDraft, abortController.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Model API test canceled");
      }
      throw error;
    } finally {
      subscription.dispose();
    }
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

  private normalizeBaseUrl(endpoint: string | undefined, fallback: string): string {
    const base = (endpoint && endpoint.trim()) || fallback;
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
    return Math.min(Math.max(Math.floor(value), 1), 1024);
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

    const data: any = await response.json();
    if (!Array.isArray(data?.choices) || data.choices.length === 0) {
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

    const data: any = await response.json();
    if (!data?.content) {
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

    const data: any = await response.json();
    if (!Array.isArray(data?.candidates) || data.candidates.length === 0) {
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

    const data: any = await response.json();
    if (!Array.isArray(data?.choices) || data.choices.length === 0) {
      throw new Error("OpenAI compatible API response format error");
    }
  }

  private getSessionKey(providerId: string, modelId: string): string {
    return `${providerId}:${modelId}`;
  }

  private createLogEntry(level: DebugLogEntry["level"], message: string, details?: unknown): DebugLogEntry {
    return {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level,
      message,
      details,
      timestamp: new Date().toLocaleString(),
    };
  }

  private appendLog(session: DebugSessionState, entry: DebugLogEntry): void {
    session.logs.push(entry);
    session.panel.appendLog(entry);
  }

  private async exportDebugLogs(session: DebugSessionState): Promise<void> {
    if (session.logs.length === 0) {
      UserFeedback.showWarning("No logs available for export");
      return;
    }

    const safeFileName = `addi-${session.provider.name}-${session.model.name}-logs.json`.replace(/[\\/:*?"<>|]/g, "_");
    const uri = await vscode.window.showSaveDialog({
      title: "Export Model Debug Logs",
      filters: { JSON: ["json"] },
      defaultUri: vscode.Uri.file(safeFileName),
    });

    if (!uri) {
      return;
    }

    const data = JSON.stringify(session.logs, null, 2);
    const encoded = new TextEncoder().encode(data);
    await vscode.workspace.fs.writeFile(uri, encoded);
    UserFeedback.showInfo(`Logs exported to ${uri.fsPath}`);
  }

  private async handleDebugMessage(sessionKey: string, message: DebugPanelContextMessage): Promise<void> {
    const session = this.debugSessions.get(sessionKey);
    if (!session) {
      return;
    }

    switch (message.type) {
      case "sendRequest": {
        const prompt = (message.prompt ?? "").trim();
        if (!prompt) {
          session.panel.postError("Please enter a prompt");
          return;
        }

        const interactionId = message.interactionId ?? `interaction-${Date.now()}`;
        const hasTemperature = typeof message.temperature === "number";
        const temperature = hasTemperature ? (message.temperature as number) : undefined;
        const history = [...session.history];

        this.appendLog(
          session,
          this.createLogEntry("debug", "Preparing to invoke model", {
            provider: session.provider.name,
            model: session.model.name,
            temperature: hasTemperature ? temperature : undefined,
            historyLength: history.length,
          })
        );

        session.panel.postBusyState(true);

        try {
          const requestOptions: ChatRequestOptions = {
            prompt,
            conversation: history,
          };
          if (hasTemperature && typeof temperature === "number") {
            requestOptions.temperature = temperature;
          }

          const result = await invokeChatCompletion(session.provider, session.model, requestOptions);

          const interaction: DebugInteraction = {
            id: interactionId,
            prompt,
            responseText: result.responseText || "",
            timestamp: new Date().toLocaleString(),
            latencyMs: result.latencyMs,
            requestPayload: result.requestPayload,
            responsePayload: result.responsePayload,
          };

          session.panel.postInteraction(interaction);
          this.appendLog(
            session,
            this.createLogEntry("info", `Request sent (${result.providerType})`, {
              endpoint: result.endpoint,
              requestPayload: result.requestPayload,
            })
          );
          this.appendLog(
            session,
            this.createLogEntry("info", "Received model response", {
              responseText: interaction.responseText,
              responsePayload: result.responsePayload,
              latencyMs: result.latencyMs,
            })
          );

          session.history.push({ role: "user", content: prompt });
          if (interaction.responseText) {
            session.history.push({ role: "assistant", content: interaction.responseText });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          session.panel.postError(`Model invocation failed: ${msg}`, error instanceof Error ? { stack: error.stack } : undefined);
          this.appendLog(
            session,
            this.createLogEntry("error", `Model invocation failed: ${msg}`, {
              prompt,
              temperature: hasTemperature ? temperature : undefined,
            })
          );
        } finally {
          session.panel.postBusyState(false);
        }
        break;
      }
      case "clearLog":
        session.logs = [];
        break;
      case "exportLog":
        await this.exportDebugLogs(session);
        break;
      default:
        break;
    }
  }

  async useModel(item: ModelTreeItem): Promise<void> {
    const result = this.manager.findModel(item.model.id);
    if (!result) {
      UserFeedback.showError("Cannot find the specified model");
      return;
    }

    const { provider, model } = result;
    const sessionKey = this.getSessionKey(provider.id, model.id);

    const panel = ModelDebugPanel.createOrShow(this.context, provider, model, (message) => {
      void this.handleDebugMessage(sessionKey, message);
    });

    let session = this.debugSessions.get(sessionKey);

    if (!session) {
      session = {
        panel,
        provider,
        model,
        history: [],
        logs: [],
      };
      this.debugSessions.set(sessionKey, session);
      panel.onDidDispose(() => this.debugSessions.delete(sessionKey));
      this.appendLog(
        session,
        this.createLogEntry("info", "Model debug panel opened", {
          provider: provider.name,
          model: model.name,
        })
      );
    } else {
      session.panel = panel;
      session.provider = provider;
      session.model = model;
    }
  }

  async addProvider(): Promise<void> {
    const name = await UserFeedback.showInputBox({
      prompt: "Please enter the provider name",
      validateInput: InputValidator.validateName,
    });

    if (!name) {
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

    const apiEndpoint = await UserFeedback.showInputBox({
      prompt: "Please enter the API endpoint (optional)",
      value: "",
    });

    const apiKey = await UserFeedback.showInputBox({
      prompt: "Please enter the API key (optional)",
      value: "",
      password: true,
    });

    try {
      const providerData: Omit<Provider, "id" | "models"> = { name };

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

      await this.manager.addProvider(providerData);
      this.treeDataProvider.refresh();
      UserFeedback.showInfo(`Provider "${name}" added`);
    } catch (error) {
      UserFeedback.showError(`Failed to add provider: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async editProvider(item: ProviderTreeItem): Promise<void> {
    const name = await UserFeedback.showInputBox({
      prompt: "Edit provider name",
      value: item.provider.name,
      validateInput: InputValidator.validateName,
    });

    if (!name) {
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

    const apiEndpoint = await UserFeedback.showInputBox({
      prompt: "Edit API endpoint (optional)",
      value: item.provider.apiEndpoint || "",
    });

    const apiKey = await UserFeedback.showInputBox({
      prompt: "Edit API key (optional)",
      value: item.provider.apiKey || "",
      password: true,
    });

    try {
      const providerData: Partial<Omit<Provider, "id" | "models">> = { name };

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

      const success = await this.manager.updateProvider(item.provider.id, providerData);
      if (success) {
        this.treeDataProvider.refresh();
        UserFeedback.showInfo(`Provider "${name}" updated`);
      } else {
        UserFeedback.showError("Failed to update provider");
      }
    } catch (error) {
      UserFeedback.showError(`Failed to update provider: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async deleteProvider(item: ProviderTreeItem): Promise<void> {
    const confirm = await UserFeedback.showConfirmDialog(`Are you sure you want to delete provider "${item.provider.name}"? This will also delete all of its models.`);

    if (!confirm) {
      return;
    }

    try {
      await UserFeedback.showProgress("Deleting provider...", async (_progress, _token) => {
        const success = await this.manager.deleteProvider(item.provider.id);
        if (success) {
          this.treeDataProvider.refresh();
          UserFeedback.showInfo(`Provider "${item.provider.name}" deleted`);
        } else {
          UserFeedback.showError("Failed to delete provider");
        }
      });
    } catch (error) {
      UserFeedback.showError(`Failed to delete provider: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async editApiKey(item: ProviderTreeItem): Promise<void> {
    const currentApiKey = item.provider.apiKey || "";

    const newApiKey = await UserFeedback.showInputBox({
      prompt: `Edit API key for "${item.provider.name}" (leave empty to unset)`,
      value: currentApiKey,
      password: true,
      placeHolder: "Please enter the new API key",
    });

    if (newApiKey === undefined) {
      return;
    }

    try {
      const success = await this.manager.updateProvider(item.provider.id, { apiKey: newApiKey });
      if (success) {
        this.treeDataProvider.refresh();
        UserFeedback.showInfo(`Provider "${item.provider.name}" API key updated`);
      } else {
        UserFeedback.showError("Failed to update API key");
      }
    } catch (error) {
      UserFeedback.showError(`Failed to update API key: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async addModel(item: ProviderTreeItem): Promise<void> {
    let id = await UserFeedback.showInputBox({
      prompt: "Enter model ID (unique identifier, recommended: alphanumeric / underscore)",
      validateInput: (v) => (v.trim().length > 0 ? null : "Model ID cannot be empty"),
    });
    if (!id) {
      return;
    }
    id = id.trim();

    const name = await UserFeedback.showInputBox({
      prompt: "Enter model name",
      validateInput: InputValidator.validateName,
      value: id,
    });
    if (!name) {
      return;
    }

    // family 不再让用户输入，统一使用默认 "addi"。如后续需要多家族扩展，可在设置中开启高级模式再暴露输入。
    const family = "addi";

    const version = await UserFeedback.showInputBox({
      prompt: "Enter model version",
      value: ConfigManager.getDefaultModelVersion(),
      validateInput: InputValidator.validateVersion,
    });
    if (!version) {
      return;
    }

    const maxInputTokensStr = await UserFeedback.showInputBox({
      prompt: "Enter max input tokens",
      value: ConfigManager.getDefaultMaxInputTokens().toString(),
      validateInput: InputValidator.validateTokens,
    });
    if (!maxInputTokensStr) {
      return;
    }

    const maxOutputTokensStr = await UserFeedback.showInputBox({
      prompt: "Enter max output tokens",
      value: ConfigManager.getDefaultMaxOutputTokens().toString(),
      validateInput: InputValidator.validateTokens,
    });
    if (!maxOutputTokensStr) {
      return;
    }

    const imageInputPick = await vscode.window.showQuickPick([{ label: "Yes" }, { label: "No" }], {
      placeHolder: "Does it support visual processing (image input)?",
      canPickMany: false,
    });
    if (!imageInputPick) {
      UserFeedback.showWarning("Model addition canceled");
      return;
    }

    const toolCallingPick = await vscode.window.showQuickPick([{ label: "Yes" }, { label: "No" }], {
      placeHolder: "Does it support tool calling?",
      canPickMany: false,
    });
    if (!toolCallingPick) {
      UserFeedback.showWarning("Model addition canceled");
      return;
    }

    const imageInput = imageInputPick.label === "Yes";
    const toolCalling = toolCallingPick.label === "Yes";
    const maxInputTokens = parseInt(maxInputTokensStr, 10);
    const maxOutputTokens = parseInt(maxOutputTokensStr, 10);
    const modelDraft: ModelDraft = {
      id,
      name,
      family,
      version,
      maxInputTokens,
      maxOutputTokens,
      imageInput,
      toolCalling,
    };

    const proceed = await this.promptModelApiTest(item.provider, modelDraft, "Still add");
    if (!proceed) {
      return;
    }

    try {
      const model = await this.manager.addModel(item.provider.id, {
        ...modelDraft,
      });
      if (model) {
        this.treeDataProvider.refresh();
        UserFeedback.showInfo(`Model "${name}" added to provider "${item.provider.name}"`);
      } else {
        UserFeedback.showError("Failed to add model");
      }
    } catch (error) {
      UserFeedback.showError(`Failed to add model: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async editModel(item: ModelTreeItem): Promise<void> {
    const result = this.manager.findModel(item.model.id);
    if (!result) {
      UserFeedback.showError("Model not found");
      return;
    }
    const { provider, model } = result;

    let id = await UserFeedback.showInputBox({
      prompt: "Edit model ID (unique identifier, recommended: alphanumeric / underscore)",
      value: model.id,
      validateInput: (v) => (v.trim().length > 0 ? null : "Model ID cannot be empty"),
    });
    if (!id) {
      return;
    }
    id = id.trim();

    const name = await UserFeedback.showInputBox({
      prompt: "Edit model name",
      value: model.name,
      validateInput: InputValidator.validateName,
    });
    if (!name) {
      return;
    }

    // 编辑时同样隐藏 family，保持原值；若原值为空则回退 addi
    const family = (model.family && model.family.trim()) || "addi";

    const version = await UserFeedback.showInputBox({
      prompt: "Edit model version",
      value: model.version,
      validateInput: InputValidator.validateVersion,
    });
    if (!version) {
      return;
    }

    const maxInputTokensStr = await UserFeedback.showInputBox({
      prompt: "Enter max input tokens",
      value: model.maxInputTokens.toString(),
      validateInput: InputValidator.validateTokens,
    });
    if (!maxInputTokensStr) {
      return;
    }

    const maxOutputTokensStr = await UserFeedback.showInputBox({
      prompt: "Enter max output tokens",
      value: model.maxOutputTokens.toString(),
      validateInput: InputValidator.validateTokens,
    });
    if (!maxOutputTokensStr) {
      return;
    }

    const imageInputPick = await vscode.window.showQuickPick([{ label: "Yes" }, { label: "No" }], {
      placeHolder: "Does it support visual processing (image input)?",
      canPickMany: false,
    });
    if (!imageInputPick) {
      UserFeedback.showWarning("Model editing canceled");
      return;
    }

    const toolCallingPick = await vscode.window.showQuickPick([{ label: "Yes" }, { label: "No" }], {
      placeHolder: "Does it support tool calling?",
      canPickMany: false,
    });
    if (!toolCallingPick) {
      UserFeedback.showWarning("Model editing canceled");
      return;
    }

    const imageInput = imageInputPick.label === "Yes";
    const toolCalling = toolCallingPick.label === "Yes";
    const maxInputTokens = parseInt(maxInputTokensStr, 10);
    const maxOutputTokens = parseInt(maxOutputTokensStr, 10);
    const modelDraft: ModelDraft = {
      id,
      name,
      family,
      version,
      maxInputTokens,
      maxOutputTokens,
      imageInput,
      toolCalling,
    };

    const proceed = await this.promptModelApiTest(provider, modelDraft, "still update");
    if (!proceed) {
      return;
    }

    try {
      const success = await this.manager.updateModel(provider.id, model.id, {
        ...modelDraft,
      });
      if (success) {
        this.treeDataProvider.refresh();
        UserFeedback.showInfo(`Model "${name}" updated successfully`);
      } else {
        UserFeedback.showError("Failed to update model");
      }
    } catch (error) {
      UserFeedback.showError(`Failed to update model: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async deleteModel(item: ModelTreeItem): Promise<void> {
    const confirm = await UserFeedback.showConfirmDialog(`Are you sure you want to delete the model "${item.model.name}"?`);

    if (!confirm) {
      return;
    }

    try {
      await UserFeedback.showProgress("Deleting model...", async (_progress, _token) => {
        const success = await this.manager.deleteModel(item.model.id);
        if (success) {
          this.treeDataProvider.refresh();
          UserFeedback.showInfo(`Model "${item.model.name}" deleted successfully`);
        } else {
          UserFeedback.showError("Failed to delete model");
        }
      });
    } catch (error) {
      UserFeedback.showError(`Failed to delete model: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async exportConfig(): Promise<void> {
    try {
      const providers = this.manager.getProviders();
      if (providers.length === 0) {
        UserFeedback.showWarning("No configurations to export");
        return;
      }

      const uri = await vscode.window.showSaveDialog({
        filters: { JSON: ["json"] },
        title: "Export Configuration",
        defaultUri: vscode.Uri.file("addi-config.json"),
      });

      if (!uri) {
        return;
      }

      await UserFeedback.showProgress("Exporting configuration...", async (_progress, _token) => {
        const data = JSON.stringify(providers, null, 2);
        const encoded = new TextEncoder().encode(data);
        await vscode.workspace.fs.writeFile(uri, encoded);
        UserFeedback.showInfo(`Configuration exported to ${uri.fsPath}`);
      });
    } catch (error) {
      UserFeedback.showError(`Failed to export configuration: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async importConfig(): Promise<void> {
    try {
      const uri = await vscode.window.showOpenDialog({
        filters: { JSON: ["json"] },
        title: "Import Configuration",
        canSelectMany: false,
      });

      if (!uri || uri.length === 0) {
        return;
      }

      await UserFeedback.showProgress("Importing configuration...", async (_progress, _token) => {
        const data = await vscode.workspace.fs.readFile(uri[0]!);
        const content = new TextDecoder().decode(data);
        const providers = JSON.parse(content) as Provider[];

        if (!Array.isArray(providers)) {
          throw new Error("Configuration format is invalid");
        }

        for (const provider of providers) {
          if (!provider.id || !provider.name || !Array.isArray(provider.models)) {
            throw new Error("Configuration format is invalid");
          }

          for (const model of provider.models) {
            if (!model.id || !model.name || !model.family || !model.version || typeof model.maxInputTokens !== "number" || typeof model.maxOutputTokens !== "number") {
              throw new Error("Configuration format is invalid");
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
      });
    } catch (error) {
      UserFeedback.showError(`Failed to import configuration: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}
