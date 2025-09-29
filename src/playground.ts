import * as vscode from "vscode";
import { Provider, Model } from "./types";
import { invokeChatCompletion, ChatMessage, streamChatCompletion } from "./apiClient";
import { TextDecoder } from "util";
import MarkdownIt from "markdown-it";

export class PlaygroundManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private createPlaygroundHtmlPlaceholder(): string {
    return `<!DOCTYPE html><html><body><p>Loading playground...</p></body></html>`;
  }

  async openPlayground(provider: Provider, model: Model): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      "addiPlayground",
      `Playground · ${model.name || model.id || "model"}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    // 使用 markdown-it 进行渲染（项目中已安装）
    // 开启 linkify/typographer，使内联渲染更接近商业化聊天界面效果
    const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
    const escapeHtml = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const renderInline = (text: string) => {
      try {
        return md.renderInline(text);
      } catch (e) {
        return `<code>${escapeHtml(text)}</code>`;
      }
    };

    const render = (text: string) => {
      try {
        return md.render(text);
      } catch (e) {
        return `<pre>${escapeHtml(text)}</pre>`;
      }
    };

    // 优化内联代码渲染，添加 class 便于前端样式调整
    try {
      md.renderer.rules = md.renderer.rules || {};
      // code_inline rule
      md.renderer.rules.code_inline = (tokens: readonly unknown[], idx: number) => {
        const entry = tokens && Array.isArray(tokens) ? tokens[idx] as Record<string, unknown> | undefined : undefined;
        const content = entry && typeof entry["content"] === "string" ? entry["content"] as string : "";
        return `<code class="inline-code">${escapeHtml(String(content))}</code>`;
      };
    } catch (_e) {
      // ignore if renderer.rules not available for this md version
    }

    const history: ChatMessage[] = [];
    const presetKey = `addi.playground.params`;
    const stored = this.context?.workspaceState.get<unknown>(presetKey);
    let temperature = 0.7;
    let topP: number | undefined = 1.0;
    let maxOutputTokens: number | undefined = model.maxOutputTokens || 1024;
    let presencePenalty: number | undefined = 0;
    let frequencyPenalty: number | undefined = 0;
    let systemPrompt: string | undefined = undefined;
    if (stored && typeof stored === "object") {
      const s = stored as Record<string, unknown>;
      if (typeof s["temperature"] === "number") { temperature = s["temperature"] as number; }
      if (typeof s["topP"] === "number") { topP = s["topP"] as number; }
      if (typeof s["maxOutputTokens"] === "number") { maxOutputTokens = s["maxOutputTokens"] as number; }
      if (typeof s["presencePenalty"] === "number") { presencePenalty = s["presencePenalty"] as number; }
      if (typeof s["frequencyPenalty"] === "number") { frequencyPenalty = s["frequencyPenalty"] as number; }
      if (typeof s["systemPrompt"] === "string") { systemPrompt = s["systemPrompt"] as string; }
    }

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
      const fileUri = vscode.Uri.joinPath(this.context.extensionUri, "resources", "playground.html");
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      let html = new TextDecoder().decode(bytes);
      const cspSource = panel.webview.cspSource;
      html = html.replace(/script-src 'nonce-PLAYGROUND';/, `script-src 'nonce-PLAYGROUND' ${cspSource};`);
      panel.webview.html = html;
    } catch (e) {
      panel.webview.html = this.createPlaygroundHtmlPlaceholder();
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
          const req = { prompt, conversation: convo, temperature: localTemp, overrideMaxOutputTokens: maxOutputTokens } as import("./apiClient").ChatRequestOptions;
          if (typeof topP === "number") { req.topP = topP; }
          if (typeof presencePenalty === "number") { req.presencePenalty = presencePenalty; }
          if (typeof frequencyPenalty === "number") { req.frequencyPenalty = frequencyPenalty; }
          const useStream = msg.stream === true;
          history.push({ role: "user", content: prompt });
          if (useStream) {
            streamAbort = new AbortController();
            req.signal = streamAbort.signal;
            // attach abort controller as a non-standard property on the panel for housekeeping
            (panel as unknown as Record<string, unknown>)["_addiCurrentAbort"] = streamAbort;
            let assembled = "";
            try {
              for await (const chunk of streamChatCompletion(provider, model, req)) {
                if (chunk.type === "delta" && chunk.deltaText) {
                  assembled += chunk.deltaText;
                  // 使用 renderInline 回退 / 渲染
                  panel.webview.postMessage({ type: "playgroundStreamDelta", payload: { delta: chunk.deltaText, full: assembled, html: renderInline(assembled) } });
                } else if (chunk.type === "done") {
                  history.push({ role: "assistant", content: assembled });
                  // 使用 render 回退 / 渲染
                  panel.webview.postMessage({ type: "playgroundResponse", payload: { text: assembled, html: render(assembled) } });
                } else if (chunk.type === "error") {
                  if (chunk.error === "aborted") {
                    panel.webview.postMessage({ type: "playgroundError", payload: { message: "aborted" } });
                  } else {
                    panel.webview.postMessage({ type: "playgroundError", payload: { message: chunk.error || "stream error" } });
                  }
                }
              }
            } finally {
              (panel as unknown as Record<string, unknown>)["_addiCurrentAbort"] = undefined;
            }
          } else {
            const result = await invokeChatCompletion(provider, model, req);
            if (result.responseText) { history.push({ role: "assistant", content: result.responseText }); }
            panel.webview.postMessage({ type: "playgroundResponse", payload: { text: result.responseText || "", html: render(result.responseText || "") } });
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
  const ac: AbortController | undefined = (panel as unknown as Record<string, unknown>)["_addiCurrentAbort"] as AbortController | undefined;
        if (ac) {
          ac.abort();
          (panel as unknown as Record<string, unknown>)["_addiCurrentAbort"] = undefined;
        }
        history.length = 0;
        panel.webview.postMessage({ type: "playgroundResetAck" });
      } else if (msg?.type === "playgroundAbort") {
  const ac: AbortController | undefined = (panel as unknown as Record<string, unknown>)["_addiCurrentAbort"] as AbortController | undefined;
        if (ac) {
          ac.abort();
          (panel as unknown as Record<string, unknown>)["_addiCurrentAbort"] = undefined;
        }
      }
    });

    postInit();
  }
}

export default PlaygroundManager;
