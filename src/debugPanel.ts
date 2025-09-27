import * as vscode from "vscode";
import { Model, Provider } from "./types";

export interface DebugPanelContextMessage {
  type: "sendRequest" | "clearLog" | "exportLog";
  prompt?: string;
  temperature?: number;
  conversation?: Array<{ role: string; content: string }>;
  interactionId?: string;
}

export interface DebugInteraction {
  id: string;
  prompt: string;
  responseText: string;
  timestamp: string;
  latencyMs: number;
  requestPayload: unknown;
  responsePayload: unknown;
}

export interface DebugLogEntry {
  id: string;
  level: "info" | "error" | "debug";
  message: string;
  details?: unknown;
  timestamp: string;
}

export class ModelDebugPanel {
  private static readonly panels = new Map<string, ModelDebugPanel>();

  static createOrShow(_context: vscode.ExtensionContext, provider: Provider, model: Model, messageHandler: (message: DebugPanelContextMessage) => void): ModelDebugPanel {
    const panelKey = `${provider.id}:${model.id}`;
    const existing = ModelDebugPanel.panels.get(panelKey);

    if (existing) {
      existing.reveal(provider, model);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel("addiModelDebug", ModelDebugPanel.buildTitle(provider, model), vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    const instance = new ModelDebugPanel(panelKey, panel, provider, model, messageHandler);
    ModelDebugPanel.panels.set(panelKey, instance);
    return instance;
  }

  private static buildTitle(provider: Provider, model: Model): string {
    return `debug · ${model.name} (${provider.name})`;
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panelKey: string,
    private readonly panel: vscode.WebviewPanel,
    provider: Provider,
    model: Model,
    private readonly messageHandler: (message: DebugPanelContextMessage) => void
  ) {
    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview, provider, model);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.onDidChangeViewState(
      (event) => {
        if (event.webviewPanel.active) {
          this.panel.webview.postMessage({
            type: "panelFocus",
          });
        }
      },
      null,
      this.disposables
    );

    this.panel.webview.onDidReceiveMessage(
      (message) => {
        try {
          this.messageHandler(message as DebugPanelContextMessage);
        } catch (error) {
          void vscode.window.showErrorMessage(`Error processing debug message: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      undefined,
      this.disposables
    );
  }

  reveal(provider: Provider, model: Model): void {
    this.panel.title = ModelDebugPanel.buildTitle(provider, model);
    this.panel.reveal(vscode.ViewColumn.Active);
    this.panel.webview.postMessage({
      type: "modelInfo",
      payload: this.buildModelInfo(provider, model),
    });
  }

  postBusyState(isBusy: boolean): void {
    this.panel.webview.postMessage({
      type: "busyState",
      payload: { isBusy },
    });
  }

  postInteraction(interaction: DebugInteraction): void {
    this.panel.webview.postMessage({
      type: "interactionComplete",
      payload: interaction,
    });
  }

  postError(message: string, details?: unknown): void {
    this.panel.webview.postMessage({
      type: "interactionError",
      payload: {
        message,
        details,
      },
    });
  }

  appendLog(entry: DebugLogEntry): void {
    this.panel.webview.postMessage({
      type: "logEntry",
      payload: entry,
    });
  }

  onDidDispose(callback: () => void): void {
    this.disposables.push(this.panel.onDidDispose(callback));
  }

  dispose(): void {
    ModelDebugPanel.panels.delete(this.panelKey);
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      try {
        disposable?.dispose();
      } catch (error) {
        console.warn("Dispose debug panel error", error);
      }
    }
  }

  private buildModelInfo(provider: Provider, model: Model) {
    return {
      provider: {
        id: provider.id,
        name: provider.name,
        description: provider.description ?? "",
        website: provider.website ?? "",
        apiEndpoint: provider.apiEndpoint ?? "",
      },
      model: {
        id: model.id,
        name: model.name,
        family: model.family,
        version: model.version,
        maxInputTokens: model.maxInputTokens,
        maxOutputTokens: model.maxOutputTokens,
        imageInput: !!model.imageInput,
        toolCalling: !!model.toolCalling,
      },
    };
  }

  private getHtmlForWebview(webview: vscode.Webview, provider: Provider, model: Model): string {
    const nonce = ModelDebugPanel.getNonce();
    const modelInfo = this.buildModelInfo(provider, model);
    const initialState = JSON.stringify(modelInfo).replace(/</g, "\\u003c");
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>模型调试</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-input-border, rgba(128,128,128,0.3));
      --accent: var(--vscode-button-background);
      --accent-foreground: var(--vscode-button-foreground);
      --muted: var(--vscode-descriptionForeground);
      --error: var(--vscode-errorForeground);
      --success: var(--vscode-testing-iconPassed);
    }
    body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      color: var(--fg);
      background: var(--bg);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    header .meta {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    header .meta .title {
      font-size: 18px;
      font-weight: 600;
    }
    header .meta .subtitle {
      font-size: 13px;
      color: var(--muted);
    }
    header .actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    header button {
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 6px 12px;
      background: transparent;
      color: var(--fg);
      cursor: pointer;
    }
    header button:hover {
      background: rgba(128, 128, 128, 0.1);
    }
    main {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
      flex: 1;
      overflow: hidden;
    }
    section.playground {
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border);
      min-width: 0;
    }
    section.playground form {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      border-bottom: 1px solid var(--border);
    }
    textarea {
      width: 100%;
      min-height: 120px;
      max-height: 220px;
      resize: vertical;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      font-size: 14px;
      font-family: inherit;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
    }
    .control-row {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    .control-row label {
      font-size: 13px;
      color: var(--muted);
      display: flex;
      gap: 8px;
      align-items: center;
    }
    input[type="range"] {
      width: 160px;
    }
    .control-row .spacer {
      flex: 1;
    }
    .control-row button {
      border-radius: 4px;
      border: none;
      padding: 8px 14px;
      font-size: 13px;
      cursor: pointer;
    }
    .control-row button.primary {
      background: var(--accent);
      color: var(--accent-foreground);
    }
    .control-row button.secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
    }
    .conversation {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .interaction {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: rgba(128,128,128,0.04);
    }
    .interaction .prompt {
      font-weight: 600;
    }
    .interaction .response pre {
      white-space: pre-wrap;
      font-size: 13px;
      margin: 0;
    }
    .interaction .meta {
      font-size: 12px;
      color: var(--muted);
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    aside.logs {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    aside.logs header {
      border-bottom: 1px solid var(--border);
    }
    .logs .entries {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .log-entry {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
      font-size: 12px;
      background: rgba(128,128,128,0.03);
    }
    .log-entry .timestamp {
      color: var(--muted);
      margin-bottom: 6px;
    }
    .log-entry pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .status-banner {
      padding: 8px 16px;
      font-size: 12px;
      color: var(--muted);
      border-top: 1px solid var(--border);
    }
    .status-banner.busy {
      color: var(--accent-foreground);
      background: rgba(56, 139, 253, 0.12);
    }
    @media (max-width: 960px) {
      main {
        grid-template-columns: 1fr;
      }
      section.playground {
        border-right: none;
        border-bottom: 1px solid var(--border);
      }
      aside.logs header {
        border-top: 1px solid var(--border);
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="meta" id="model-meta"></div>
    <div class="actions">
      <button id="clear-log" type="button">Clear Log</button>
      <button id="export-log" type="button">Export Log</button>
    </div>
  </header>
  <main>
    <section class="playground">
      <form id="request-form">
        <textarea id="prompt-input" placeholder="Enter the prompt to send to the model..." autofocus></textarea>
        <div class="control-row">
          <label>Temperature <span id="temperature-value">0.7</span>
            <input type="range" id="temperature" min="0" max="2" step="0.1" value="0.7" />
          </label>
          <div class="spacer"></div>
          <button id="send-btn" class="primary" type="submit">Send Request</button>
          <button id="reset-btn" class="secondary" type="button">Clear Input</button>
        </div>
      </form>
      <div class="conversation" id="conversation"></div>
    </section>
    <aside class="logs">
      <header>
        <div class="meta">
          <div class="title">Debug Log</div>
          <div class="subtitle">Records the raw payloads of requests and responses</div>
        </div>
      </header>
      <div class="entries" id="log-entries"></div>
      <div class="status-banner" id="status-banner">Ready</div>
    </aside>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = {
      modelInfo: ${initialState},
      interactions: [],
      logs: [],
      busy: false,
    };

    const metaEl = document.getElementById('model-meta');
    const conversationEl = document.getElementById('conversation');
    const logEntriesEl = document.getElementById('log-entries');
    const statusBannerEl = document.getElementById('status-banner');
    const formEl = document.getElementById('request-form');
    const promptInputEl = document.getElementById('prompt-input');
    const temperatureEl = document.getElementById('temperature');
    const temperatureValueEl = document.getElementById('temperature-value');
    const sendBtn = document.getElementById('send-btn');
    const resetBtn = document.getElementById('reset-btn');
    const clearLogBtn = document.getElementById('clear-log');
    const exportLogBtn = document.getElementById('export-log');

    function renderMeta(info) {
      metaEl.innerHTML = \`
        <div class="title">\${info.model.name}</div>
        <div class="subtitle">
          <span>Provider: \${info.provider.name}</span>
          <span> · Model Family: \${info.model.family} v\${info.model.version}</span>
          <span> · Token: \${info.model.maxInputTokens}/\${info.model.maxOutputTokens}</span>
        </div>
      \`;
    }

    function renderConversation() {
      conversationEl.innerHTML = state.interactions
        .map((interaction) => {
          return \`
            <div class="interaction" data-id="\${interaction.id}">
              <div class="prompt">👤 \${interaction.prompt}</div>
              <div class="response"><pre>\${interaction.responseText || '（Waiting...）'}</pre></div>
              <div class="meta">
                <span>\${interaction.timestamp}</span>
                <span>take times: \${interaction.latencyMs ?? 0}ms</span>
              </div>
            </div>
          \`;
        })
        .join('');
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }

    function renderLogs() {
      logEntriesEl.innerHTML = state.logs
        .map((entry) => {
          const levelIcon = entry.level === 'error' ? '⚠️' : entry.level === 'debug' ? '🛠' : 'ℹ️';
          const details = entry.details ? \`\\n\${JSON.stringify(entry.details, null, 2)}\` : '';
          return \`
            <div class="log-entry" data-id="\${entry.id}">
              <div class="timestamp">\${levelIcon} \${entry.timestamp}</div>
              <pre>\${entry.message}\${details}</pre>
            </div>
          \`;
        })
        .join('');
      logEntriesEl.scrollTop = logEntriesEl.scrollHeight;
    }

    function setBusy(isBusy) {
      state.busy = isBusy;
      sendBtn.disabled = isBusy;
      statusBannerEl.textContent = isBusy ? 'calling model...' : 'Ready';
      statusBannerEl.classList.toggle('busy', isBusy);
    }

    function addInteraction(interaction) {
      const existingIndex = state.interactions.findIndex((item) => item.id === interaction.id);
      if (existingIndex >= 0) {
        state.interactions[existingIndex] = interaction;
      } else {
        state.interactions.push(interaction);
      }
      renderConversation();
    }

    function addLog(entry) {
      state.logs.push(entry);
      renderLogs();
    }

    formEl.addEventListener('submit', (event) => {
      event.preventDefault();
      const prompt = promptInputEl.value.trim();
      if (!prompt || state.busy) {
        return;
      }

    const temperature = Number(temperatureEl.value);
    const interactionId = 'interaction-' + Date.now();
      const timestamp = new Date().toLocaleString();
      state.interactions.push({ id: interactionId, prompt, responseText: '（Waiting...）', timestamp, latencyMs: 0 });
      renderConversation();
      setBusy(true);

      vscode.postMessage({
        type: 'sendRequest',
        prompt,
        temperature,
        interactionId,
        conversation: state.interactions.map((item) => ({ role: 'user', content: item.prompt })),
      });
    });

    resetBtn.addEventListener('click', () => {
      promptInputEl.value = '';
      promptInputEl.focus();
    });

    clearLogBtn.addEventListener('click', () => {
      state.logs = [];
      renderLogs();
      vscode.postMessage({ type: 'clearLog' });
    });

    exportLogBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'exportLog' });
    });

    temperatureEl.addEventListener('input', () => {
      temperatureValueEl.textContent = Number(temperatureEl.value).toFixed(1);
    });

    renderMeta(state.modelInfo);

    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'modelInfo':
          state.modelInfo = message.payload;
          renderMeta(state.modelInfo);
          break;
        case 'busyState':
          setBusy(Boolean(message.payload?.isBusy));
          break;
        case 'interactionComplete':
          addInteraction(message.payload);
          setBusy(false);
          break;
        case 'interactionError':
          setBusy(false);
          addLog({
            id: 'log-' + Date.now(),
            level: 'error',
            message: message.payload?.message ?? 'unknown error',
            details: message.payload?.details,
            timestamp: new Date().toLocaleString(),
          });
          statusBannerEl.textContent = message.payload?.message ?? 'unknown error';
          statusBannerEl.classList.add('busy');
          break;
        case 'logEntry':
          addLog(message.payload);
          break;
        default:
          break;
      }
    });
  </script>
</body>
</html>`;
  }

  private static getNonce(): string {
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let text = "";
    for (let i = 0; i < 16; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
