import * as vscode from "vscode";
import * as crypto from "crypto";
import { ProviderModelManager, ProviderTreeItem, AddiTreeDataProvider } from "./provider";
import { ModelTreeItem } from "./model";
import { ConfigManager, InputValidator, UserFeedback } from "./utils";
import { ModelDraft, Provider, Model } from "./types";
import { invokeChatCompletion, ChatMessage, streamChatCompletion } from "./apiClient";

export class CommandHandler {
  constructor(private readonly manager: ProviderModelManager, private readonly treeDataProvider: AddiTreeDataProvider, private readonly context?: vscode.ExtensionContext) {}

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
      switch (provider.providerType) {
        case "openai":
          await this.testOpenAiApi(apiEndpoint, apiKey, modelDraft, abortController.signal);
          return;
        case "anthropic":
          await this.testAnthropicApi(apiEndpoint, apiKey, modelDraft, abortController.signal);
          return;
        case "google":
          await this.testGoogleApi(apiEndpoint, apiKey, modelDraft, abortController.signal);
          return;
        default:
          await this.testGenericOpenAiCompatibleApi(apiEndpoint, apiKey, modelDraft, abortController.signal);
          return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Model API test canceled");
      }
      throw error;
    } finally {
      subscription.dispose();
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

  // playground 模式不再需要 session key

  private createPlaygroundHtml(): string {
    // 直接读取 resources/playground.html 的内容更好；此处简化为占位，实际载入文件以支持 CSP。
    // 为保持简单，这里内联 minimal 占位，将很快被真正的文件替换（我们使用本地文件读取更可靠）。
    return `<!DOCTYPE html><html><body><p>Loading playground...</p></body></html>`;
  }

  async openPlayground(provider: Provider, model: Model | (ModelDraft & { id?: string; name?: string })): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      "addiPlayground",
      `Playground · ${model.name || model.id || "model"}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    const history: ChatMessage[] = [];
    const presetKey = `addi.playground.params`; // global per workspace
    const stored = this.context?.workspaceState.get<any>(presetKey);
    let temperature = typeof stored?.temperature === "number" ? stored.temperature : 0.7;
    let topP: number | undefined = typeof stored?.topP === "number" ? stored.topP : 1.0;
    let maxOutputTokens: number | undefined = typeof stored?.maxOutputTokens === "number" ? stored.maxOutputTokens : (model.maxOutputTokens || 1024);
    let presencePenalty: number | undefined = typeof stored?.presencePenalty === "number" ? stored.presencePenalty : 0;
    let frequencyPenalty: number | undefined = typeof stored?.frequencyPenalty === "number" ? stored.frequencyPenalty : 0;
    let systemPrompt: string | undefined = typeof stored?.systemPrompt === "string" ? stored.systemPrompt : undefined;
    const saveParams = () => {
      void this.context?.workspaceState.update(presetKey, {
        temperature,
        topP,
        maxOutputTokens,
        presencePenalty,
        frequencyPenalty,
        systemPrompt,
      });
    };

    try {
      if (!this.context) { throw new Error("No extension context"); }
      const fileUri = vscode.Uri.joinPath(this.context.extensionUri, "resources", "playground.html");
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      let html = new TextDecoder().decode(bytes);
      // 注入 webview.cspSource 以允许加载本地资源（保留固定 nonce=PLAYGROUND 的 inline script）
      const cspSource = panel.webview.cspSource;
      html = html.replace(/script-src 'nonce-PLAYGROUND';/, `script-src 'nonce-PLAYGROUND' ${cspSource};`);
      panel.webview.html = html;
    } catch (e) {
      panel.webview.html = this.createPlaygroundHtml();
      console.warn('[Addi] Failed to load playground.html from extension path:', e);
    }

    const postInit = () => {
      panel.webview.postMessage({
        type: "playgroundInit",
        payload: {
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          modelName: model.name || model.id,
          params: { temperature, topP, maxOutputTokens, presencePenalty, frequencyPenalty, systemPrompt },
        },
      });
    };

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === "playgroundSend") {
        const prompt: string = (msg.prompt || "").trim();
        if (!prompt) { return; }
        // 每次发送新请求时重置上一次的 abortController
        let streamAbort: AbortController | undefined;
        const localTemp = typeof msg.temperature === "number" ? msg.temperature : temperature;
        temperature = localTemp;
        if (typeof msg.topP === "number") { topP = Math.min(Math.max(msg.topP, 0), 1); }
        if (typeof msg.maxOutputTokens === "number") {
          const v = Math.floor(msg.maxOutputTokens);
          if (isFinite(v) && v > 0) { maxOutputTokens = Math.min(Math.max(v, 1), 8192); }
        }
        if (typeof msg.presencePenalty === "number") { presencePenalty = Math.min(Math.max(msg.presencePenalty, -2), 2); }
        if (typeof msg.frequencyPenalty === "number") { frequencyPenalty = Math.min(Math.max(msg.frequencyPenalty, -2), 2); }
        if (typeof msg.systemPrompt === "string") {
          const sp = msg.systemPrompt.trim();
          systemPrompt = sp.length ? sp : undefined;
        }
        try {
          const convo = systemPrompt ? [{ role: "system", content: systemPrompt } as ChatMessage, ...history] : [...history];
          const req: any = { prompt, conversation: convo, temperature: localTemp, overrideMaxOutputTokens: maxOutputTokens };
          if (typeof topP === "number") { req.topP = topP; }
          if (typeof presencePenalty === "number") { req.presencePenalty = presencePenalty; }
          if (typeof frequencyPenalty === "number") { req.frequencyPenalty = frequencyPenalty; }
          const useStream = msg.stream === true;
          history.push({ role: "user", content: prompt });
          if (useStream) {
            streamAbort = new AbortController();
            req.signal = streamAbort.signal;
            (panel as any)._addiCurrentAbort = streamAbort; // 绑定到 panel 实例便于后续 abort
            let assembled = "";
            try {
              for await (const chunk of streamChatCompletion(provider as any, model as any, req)) {
                if (chunk.type === "delta" && chunk.deltaText) {
                  assembled += chunk.deltaText;
                  panel.webview.postMessage({ type: "playgroundStreamDelta", payload: { delta: chunk.deltaText, full: assembled } });
                } else if (chunk.type === "done") {
                  history.push({ role: "assistant", content: assembled });
                  panel.webview.postMessage({ type: "playgroundResponse", payload: { text: assembled } });
                } else if (chunk.type === "error") {
                  if (chunk.error === "aborted") {
                    panel.webview.postMessage({ type: "playgroundError", payload: { message: "aborted" } });
                  } else {
                    panel.webview.postMessage({ type: "playgroundError", payload: { message: chunk.error || "stream error" } });
                  }
                }
              }
            } finally {
              (panel as any)._addiCurrentAbort = undefined;
            }
          } else {
            const result = await invokeChatCompletion(provider as any, model as any, req);
            if (result.responseText) { history.push({ role: "assistant", content: result.responseText }); }
            panel.webview.postMessage({ type: "playgroundResponse", payload: { text: result.responseText || "" } });
          }
        } catch (error) {
          panel.webview.postMessage({ type: "playgroundError", payload: { message: error instanceof Error ? error.message : String(error) } });
        }
      } else if (msg?.type === "playgroundSetParams") {
        if (typeof msg.temperature === "number") { temperature = msg.temperature; }
        if (typeof msg.topP === "number") { topP = Math.min(Math.max(msg.topP, 0), 1); }
        if (typeof msg.maxOutputTokens === "number") {
          const v = Math.floor(msg.maxOutputTokens);
          if (isFinite(v) && v > 0) { maxOutputTokens = Math.min(Math.max(v, 1), 8192); }
        }
        if (typeof msg.presencePenalty === "number") { presencePenalty = Math.min(Math.max(msg.presencePenalty, -2), 2); }
        if (typeof msg.frequencyPenalty === "number") { frequencyPenalty = Math.min(Math.max(msg.frequencyPenalty, -2), 2); }
        if (typeof msg.systemPrompt === "string") {
          const sp = msg.systemPrompt.trim();
          systemPrompt = sp.length ? sp : undefined;
        }
        saveParams();
      } else if (msg?.type === "playgroundReset") {
          const ac: AbortController | undefined = (panel as any)._addiCurrentAbort;
          if (ac) {
            ac.abort();
            (panel as any)._addiCurrentAbort = undefined;
          }
        history.length = 0;
        panel.webview.postMessage({ type: "playgroundResetAck" });
      } else if (msg?.type === "playgroundAbort") {
        const ac: AbortController | undefined = (panel as any)._addiCurrentAbort;
        if (ac) {
          ac.abort();
          (panel as any)._addiCurrentAbort = undefined;
        }
      }
    });

    // 初始化消息
    postInit();
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

    // 版本隐藏，默认 1.0.0
    const version = "1.0.0";

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

    // 编辑时隐藏版本，沿用原值，缺失则设为 1.0.0
    const version = model.version || "1.0.0";

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
    const plainBuffer = Buffer.from(plainJson, "utf8");

    if (!password) {
      return `b64:${plainBuffer.toString("base64")}`;
    }

    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
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
    try {
      const providers = this.manager.getProviders();
      if (providers.length === 0) {
        UserFeedback.showWarning("No configurations to export");
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
        return;
      }

      const password = passwordInput.length > 0 ? passwordInput : undefined;
      const encrypted = Boolean(password);

      const defaultFileName = encrypted ? "addi-config.encrypt.txt" : "addi-config.json";
      const firstWorkspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const defaultUri = firstWorkspaceFolder ? vscode.Uri.joinPath(firstWorkspaceFolder, defaultFileName) : undefined;

      const saveDialogOptions: vscode.SaveDialogOptions = {
        filters: {
          "Config Files": ["json", "txt"],
          "All Files": ["*"]
        },
        title: "Export Configuration",
      };

      if (defaultUri) {
        saveDialogOptions.defaultUri = defaultUri;
      }

      const uri = await vscode.window.showSaveDialog(saveDialogOptions);

      if (!uri) {
        return;
      }

      const targetUri = this.adjustExportUriForEncryption(uri, encrypted);

      await UserFeedback.showProgress("Exporting configuration...", async (_progress, _token) => {
        const encoded = this.encodeProvidersForExport(providers, password);
        await vscode.workspace.fs.writeFile(targetUri, Buffer.from(encoded, "utf8"));
        UserFeedback.showInfo(`Configuration exported${password ? " (encrypted)" : ""} to ${targetUri.fsPath}`);
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
          return;
        }

        if (passwordInput.length === 0) {
          UserFeedback.showError("Password is required to import encrypted configuration");
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
