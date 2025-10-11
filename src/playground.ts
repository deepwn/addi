import * as vscode from "vscode";
import { Provider, Model } from "./types";
import { ConfigManager } from "./utils";
import { ChatMessage } from "./apiClient";
import { TextDecoder } from "util";
import { logger } from "./logger";

const PLAYGROUND_TOKEN_LIMIT = 1024 * 1024 * 4; // allow up to ~4M tokens when overridden

export class PlaygroundManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private createPlaygroundHtmlPlaceholder(): string {
    return `<!DOCTYPE html><html><body><p>Loading playground...</p></body></html>`;
  }

  async openPlayground(provider: Provider, model: Model): Promise<void> {
    logger.info("Opening playground", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
    });
    const panel = vscode.window.createWebviewPanel("addiPlayground", `Playground · ${model.name || model.id || "model"}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    type AddiPanelState = vscode.WebviewPanel & { _addiCancellation?: vscode.CancellationTokenSource };
    const addiPanel = panel as AddiPanelState;

    // 使用 VS Code/主机提供的 markdown 渲染（通过 stream.markdown）
    // playground 将不再对 markdown 进行本地渲染；它只是把原始 markdown 片段转发给前端/主机。

    // 不再在扩展端更改或定制 markdown-it 的渲染规则；前端/主机会自行处理渲染样式

    const history: ChatMessage[] = [];
    const presetKey = `addi.playground.params`;
    const stored = this.context?.workspaceState.get<unknown>(presetKey);
    let temperature = 0.7;
    let topP: number | undefined = 1.0;
    let maxInputTokens: number | undefined = model.maxInputTokens ? Math.min(model.maxInputTokens, PLAYGROUND_TOKEN_LIMIT) : ConfigManager.getDefaultMaxInputTokens();
    let maxOutputTokens: number | undefined = model.maxOutputTokens ? Math.min(model.maxOutputTokens, PLAYGROUND_TOKEN_LIMIT) : 1024;
    let presencePenalty: number | undefined = 0;
    let frequencyPenalty: number | undefined = 0;
    let systemPrompt: string | undefined = undefined;
    if (stored && typeof stored === "object") {
      const s = stored as Record<string, unknown>;
      if (typeof s["temperature"] === "number") {
        temperature = s["temperature"] as number;
      }
      if (typeof s["topP"] === "number") {
        topP = s["topP"] as number;
      }
      if (typeof s["maxInputTokens"] === "number") {
        const candidate = s["maxInputTokens"] as number;
        if (Number.isFinite(candidate) && candidate > 0) {
          maxInputTokens = Math.min(Math.floor(candidate), PLAYGROUND_TOKEN_LIMIT);
        }
      }
      if (typeof s["maxOutputTokens"] === "number") {
        const candidate = s["maxOutputTokens"] as number;
        if (Number.isFinite(candidate) && candidate > 0) {
          maxOutputTokens = Math.min(Math.floor(candidate), PLAYGROUND_TOKEN_LIMIT);
        }
      }
      if (typeof s["presencePenalty"] === "number") {
        presencePenalty = s["presencePenalty"] as number;
      }
      if (typeof s["frequencyPenalty"] === "number") {
        frequencyPenalty = s["frequencyPenalty"] as number;
      }
      if (typeof s["systemPrompt"] === "string") {
        systemPrompt = s["systemPrompt"] as string;
      }
    }

    const saveParams = () => {
      void this.context?.workspaceState.update(presetKey, {
        temperature,
        topP,
        maxInputTokens,
        maxOutputTokens,
        presencePenalty,
        frequencyPenalty,
        systemPrompt,
      });
    };

    try {
      const fileUri = vscode.Uri.joinPath(this.context.extensionUri, "resources", "playground.html");
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      let html = new TextDecoder().decode(bytes);
      const cspSource = panel.webview.cspSource;
      html = html.replace(/script-src 'nonce-PLAYGROUND';/, `script-src 'nonce-PLAYGROUND' ${cspSource};`);
      panel.webview.html = html;
    } catch (e) {
      panel.webview.html = this.createPlaygroundHtmlPlaceholder();
      logger.warn("Failed to load playground HTML", { error: e instanceof Error ? e.message : String(e) });
    }

    const postInit = () => {
      panel.webview.postMessage({
        type: "playgroundInit",
        payload: {
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          modelName: model.name || model.id,
          params: { temperature, topP, maxInputTokens, maxOutputTokens, presencePenalty, frequencyPenalty, systemPrompt },
        },
      });
    };

    panel.webview.onDidReceiveMessage(async (msg) => {
      logger.debug("Playground message received", { type: msg?.type });
      if (msg?.type === "playgroundSend") {
        const prompt: string = (msg.prompt || "").trim();
        if (!prompt) {
          logger.warn("Playground send ignored due to empty prompt");
          return;
        }

        const localTemp = typeof msg.temperature === "number" ? msg.temperature : temperature;
        temperature = localTemp;
        if (typeof msg.topP === "number") {
          topP = Math.min(Math.max(msg.topP, 0), 1);
        }
        if (typeof msg.maxInputTokens === "number") {
          const v = Math.floor(msg.maxInputTokens);
          if (isFinite(v) && v > 0) {
            maxInputTokens = Math.min(Math.max(v, 1), PLAYGROUND_TOKEN_LIMIT);
          }
        }
        if (typeof msg.maxOutputTokens === "number") {
          const v = Math.floor(msg.maxOutputTokens);
          if (isFinite(v) && v > 0) {
            maxOutputTokens = Math.min(Math.max(v, 1), PLAYGROUND_TOKEN_LIMIT);
          }
        }
        if (typeof msg.presencePenalty === "number") {
          presencePenalty = Math.min(Math.max(msg.presencePenalty, -2), 2);
        }
        if (typeof msg.frequencyPenalty === "number") {
          frequencyPenalty = Math.min(Math.max(msg.frequencyPenalty, -2), 2);
        }
        if (typeof msg.systemPrompt === "string") {
          const sp = msg.systemPrompt.trim();
          systemPrompt = sp.length ? sp : undefined;
        }

        const chatModel = await this.selectChatModel(model);
        if (!chatModel) {
          logger.warn("Playground could not select chat model", logger.sanitizeModel(model));
          panel.webview.postMessage({ type: "playgroundError", payload: { message: "No Addi chat model is available. Configure a provider first." } });
          return;
        }

        const messages = this.createChatMessages(history, prompt, systemPrompt);
        if (messages.length === 0) {
          panel.webview.postMessage({ type: "playgroundError", payload: { message: "Unable to build chat prompt." } });
          return;
        }

        const requestOptionsInput: {
          temperature?: number;
          topP?: number;
          maxInputTokens?: number;
          maxOutputTokens?: number;
          presencePenalty?: number;
          frequencyPenalty?: number;
        } = { temperature: localTemp };
        if (typeof topP === "number") {
          requestOptionsInput.topP = topP;
        }
        if (typeof maxInputTokens === "number") {
          requestOptionsInput.maxInputTokens = maxInputTokens;
        }
        if (typeof maxOutputTokens === "number") {
          requestOptionsInput.maxOutputTokens = maxOutputTokens;
        }
        if (typeof presencePenalty === "number") {
          requestOptionsInput.presencePenalty = presencePenalty;
        }
        if (typeof frequencyPenalty === "number") {
          requestOptionsInput.frequencyPenalty = frequencyPenalty;
        }

        const requestOptions = this.createChatRequestOptions(requestOptionsInput);

        const streaming = msg.stream === true;
        const cts = new vscode.CancellationTokenSource();
        addiPanel._addiCancellation = cts;

        const priorLength = history.length;
        history.push({ role: "user", content: prompt });

        try {
          const response = await chatModel.sendRequest(messages, requestOptions, cts.token);
          logger.debug("Playground chatModel.sendRequest started", {
            streaming,
            messageCount: messages.length,
          });
          let assembled = "";

          // Create a small adapter that mimics the ChatResponseStream.markdown behaviour
          // and forwards HTML-rendered deltas to the playground webview. This keeps
          // playground rendering semantics close to the official stream.markdown API.
          const webviewStream = {
            markdown: (md: string) => {
              if (typeof md !== "string" || md.length === 0) {
                return;
              }
              assembled += md;
              if (streaming) {
                panel.webview.postMessage({
                  type: "playgroundStreamDelta",
                  payload: {
                    delta: md,
                    full: assembled,
                  },
                });
              }
            },
            // progress/other methods could be added later if needed
          };

          for await (const fragment of response.text) {
            webviewStream.markdown(String(fragment ?? ""));
          }

          history.push({ role: "assistant", content: assembled });
          panel.webview.postMessage({ type: "playgroundResponse", payload: { text: assembled } });
          logger.info("Playground response completed", { length: assembled.length });
        } catch (error) {
          const cancelled = cts.token.isCancellationRequested;
          const message = error instanceof Error ? error.message : String(error);
          panel.webview.postMessage({ type: "playgroundError", payload: { message: cancelled ? "Request cancelled" : message } });
          history.splice(priorLength); // remove pending user entry on error
          logger.warn("Playground request failed", { cancelled, error: message });
        } finally {
          cts.dispose();
          delete addiPanel._addiCancellation;
          logger.debug("Playground request finalized");
        }
      } else if (msg?.type === "playgroundSetParams") {
        if (typeof msg.temperature === "number") {
          temperature = msg.temperature;
        }
        if (typeof msg.topP === "number") {
          topP = Math.min(Math.max(msg.topP, 0), 1);
        }
        if (typeof msg.maxInputTokens === "number") {
          const v = Math.floor(msg.maxInputTokens);
          if (isFinite(v) && v > 0) {
            maxInputTokens = Math.min(Math.max(v, 1), PLAYGROUND_TOKEN_LIMIT);
          }
        }
        if (typeof msg.maxOutputTokens === "number") {
          const v = Math.floor(msg.maxOutputTokens);
          if (isFinite(v) && v > 0) {
            maxOutputTokens = Math.min(Math.max(v, 1), PLAYGROUND_TOKEN_LIMIT);
          }
        }
        if (typeof msg.presencePenalty === "number") {
          presencePenalty = Math.min(Math.max(msg.presencePenalty, -2), 2);
        }
        if (typeof msg.frequencyPenalty === "number") {
          frequencyPenalty = Math.min(Math.max(msg.frequencyPenalty, -2), 2);
        }
        if (typeof msg.systemPrompt === "string") {
          const sp = msg.systemPrompt.trim();
          systemPrompt = sp.length ? sp : undefined;
        }
        saveParams();
        logger.debug("Playground parameters updated", {
          temperature,
          topP,
          maxOutputTokens,
          presencePenalty,
          frequencyPenalty,
          hasSystemPrompt: Boolean(systemPrompt),
        });
      } else if (msg?.type === "playgroundReset") {
        const cts = addiPanel._addiCancellation;
        if (cts) {
          try {
            cts.cancel();
          } catch (_e) {
            /* noop */
          }
          delete addiPanel._addiCancellation;
        }
        history.length = 0;
        panel.webview.postMessage({ type: "playgroundResetAck" });
        logger.debug("Playground reset by user");
      } else if (msg?.type === "playgroundAbort") {
        const cts = addiPanel._addiCancellation;
        if (cts) {
          try {
            cts.cancel();
          } catch (_e) {
            /* noop */
          }
          delete addiPanel._addiCancellation;
        }
        logger.debug("Playground request aborted");
      }
    });

    postInit();
  }

  private async selectChatModel(model?: Model): Promise<vscode.LanguageModelChat | undefined> {
    try {
      if (model?.id) {
        const [match] = await vscode.lm.selectChatModels({ id: `addi-provider:${model.id}` });
        if (match) {
          return match;
        }
      }
      const [fallback] = await vscode.lm.selectChatModels({ vendor: "addi-provider" });
      return fallback;
    } catch (error) {
      logger.warn("Failed to select chat model", { error: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  }

  private createChatMessages(history: ChatMessage[], prompt: string, systemPrompt?: string): vscode.LanguageModelChatMessage[] {
    const factory = vscode.LanguageModelChatMessage as unknown as {
      User: (value: string) => vscode.LanguageModelChatMessage;
      Assistant: (value: string) => vscode.LanguageModelChatMessage;
      System?: (value: string) => vscode.LanguageModelChatMessage;
    };

    if (!factory || typeof factory.User !== "function" || typeof factory.Assistant !== "function") {
      return [];
    }

    const messages: vscode.LanguageModelChatMessage[] = [];

    if (systemPrompt && systemPrompt.trim().length > 0) {
      const trimmed = systemPrompt.trim();
      if (typeof factory.System === "function") {
        messages.push(factory.System(trimmed));
      } else {
        messages.push(factory.User(trimmed));
      }
    }

    for (const entry of history) {
      const content = entry.content?.trim();
      if (!content) {
        continue;
      }
      if (entry.role === "assistant") {
        messages.push(factory.Assistant(content));
      } else if (entry.role === "system" && typeof factory.System === "function") {
        messages.push(factory.System(content));
      } else {
        messages.push(factory.User(content));
      }
    }

    if (prompt.trim().length > 0) {
      messages.push(factory.User(prompt.trim()));
    }

    return messages;
  }

  private createChatRequestOptions(params: {
    temperature?: number;
    topP?: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
  }): Record<string, unknown> {
    const options: Record<string, unknown> = {};

    if (typeof params.temperature === "number" && Number.isFinite(params.temperature)) {
      options["temperature"] = params.temperature;
    }
    if (typeof params.topP === "number" && Number.isFinite(params.topP)) {
      options["topP"] = Math.min(Math.max(params.topP, 0), 1);
    }
    if (typeof params.maxInputTokens === "number" && Number.isFinite(params.maxInputTokens)) {
      options["maxInputTokens"] = Math.min(Math.max(Math.floor(params.maxInputTokens), 1), PLAYGROUND_TOKEN_LIMIT);
    }
    if (typeof params.maxOutputTokens === "number" && Number.isFinite(params.maxOutputTokens)) {
      options["maxOutputTokens"] = Math.min(Math.max(Math.floor(params.maxOutputTokens), 1), PLAYGROUND_TOKEN_LIMIT);
    }
    if (typeof params.presencePenalty === "number" && Number.isFinite(params.presencePenalty)) {
      options["presencePenalty"] = Math.min(Math.max(params.presencePenalty, -2), 2);
    }
    if (typeof params.frequencyPenalty === "number" && Number.isFinite(params.frequencyPenalty)) {
      options["frequencyPenalty"] = Math.min(Math.max(params.frequencyPenalty, -2), 2);
    }

    return options;
  }
}

export default PlaygroundManager;
