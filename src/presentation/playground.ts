import * as vscode from 'vscode';
import { Provider, Model, UIMessage, UIPart } from '../common/types';
import { ConfigManager } from '../common/utils';
import { TextDecoder } from 'util';
import { logger } from '../common/logger';
import { MessageConverter } from '../core/llm/messageConverter';
import { LLMService } from '../core/llm/llmService';

const PLAYGROUND_TOKEN_LIMIT = 1024 * 1024 * 4; // allow up to ~4M tokens when overridden

export class PlaygroundManager {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly llmService: LLMService
  ) {}

  private createPlaygroundHtmlPlaceholder(): string {
    return `<!DOCTYPE html><html><body><p>Loading playground...</p></body></html>`;
  }

  async openPlayground(provider: Provider, model: Model): Promise<void> {
    logger.info('Opening playground', {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
    });
    const panel = vscode.window.createWebviewPanel(
      'addiPlayground',
      `Playground · ${model.name || model.id || 'model'}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    type AddiPanelState = vscode.WebviewPanel & {
      _addiCancellation?: vscode.CancellationTokenSource;
    };
    const addiPanel = panel as AddiPanelState;

    // 使用 VS Code/主机提供的 markdown 渲染（通过 stream.markdown）
    // playground 将不再对 markdown 进行本地渲染；它只是把原始 markdown 片段转发给前端/主机。

    // 不再在扩展端更改或定制 markdown-it 的渲染规则；前端/主机会自行处理渲染样式

    const history: UIMessage[] = [];
    const presetKey = `addi.playground.params.${model.sid}`;
    const stored = this.context?.workspaceState.get<unknown>(presetKey);
    let temperature = 0.7;
    let topP: number | undefined = 1.0;
    let maxInputTokens: number | undefined = model.maxInputTokens
      ? Math.min(model.maxInputTokens, PLAYGROUND_TOKEN_LIMIT)
      : ConfigManager.getDefaultMaxInputTokens();
    let maxOutputTokens: number | undefined = model.maxOutputTokens
      ? Math.min(model.maxOutputTokens, PLAYGROUND_TOKEN_LIMIT)
      : 1024;
    let presencePenalty: number | undefined = 0;
    let frequencyPenalty: number | undefined = 0;
    let systemPrompt: string | undefined = undefined;
    if (stored && typeof stored === 'object') {
      const s = stored as Record<string, unknown>;
      if (typeof s['temperature'] === 'number') {
        temperature = s['temperature'] as number;
      }
      if (typeof s['topP'] === 'number') {
        topP = s['topP'] as number;
      }
      if (typeof s['maxInputTokens'] === 'number') {
        const candidate = s['maxInputTokens'] as number;
        if (Number.isFinite(candidate) && candidate > 0) {
          maxInputTokens = Math.min(Math.floor(candidate), PLAYGROUND_TOKEN_LIMIT);
        }
      }
      if (typeof s['maxOutputTokens'] === 'number') {
        const candidate = s['maxOutputTokens'] as number;
        if (Number.isFinite(candidate) && candidate > 0) {
          maxOutputTokens = Math.min(Math.floor(candidate), PLAYGROUND_TOKEN_LIMIT);
        }
      }
      if (typeof s['presencePenalty'] === 'number') {
        presencePenalty = s['presencePenalty'] as number;
      }
      if (typeof s['frequencyPenalty'] === 'number') {
        frequencyPenalty = s['frequencyPenalty'] as number;
      }
      if (typeof s['systemPrompt'] === 'string') {
        systemPrompt = s['systemPrompt'] as string;
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
      const fileUri = vscode.Uri.joinPath(
        this.context.extensionUri,
        'resources',
        'playground.html'
      );
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      let html = new TextDecoder().decode(bytes);
      const cspSource = panel.webview.cspSource;
      html = html.replace(
        /script-src 'nonce-PLAYGROUND';/,
        `script-src 'nonce-PLAYGROUND' ${cspSource};`
      );
      panel.webview.html = html;
    } catch (e) {
      panel.webview.html = this.createPlaygroundHtmlPlaceholder();
      logger.warn('Failed to load playground HTML', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const postInit = () => {
      panel.webview.postMessage({
        type: 'playgroundInit',
        payload: {
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          modelName: model.name || model.id,
          params: {
            temperature,
            topP,
            maxInputTokens,
            maxOutputTokens,
            presencePenalty,
            frequencyPenalty,
            systemPrompt,
          },
        },
      });
    };

    panel.webview.onDidReceiveMessage(async (msg) => {
      logger.debug('Playground message received', { type: msg?.type });
      if (msg?.type === 'playgroundSend') {
        const prompt: string = (msg.prompt || '').trim();
        if (!prompt) {
          logger.warn('Playground send ignored due to empty prompt');
          return;
        }

        const localTemp = typeof msg.temperature === 'number' ? msg.temperature : temperature;
        temperature = localTemp;
        if (typeof msg.topP === 'number') {
          topP = Math.min(Math.max(msg.topP, 0), 1);
        }
        if (typeof msg.maxInputTokens === 'number') {
          const v = Math.floor(msg.maxInputTokens);
          if (isFinite(v) && v > 0) {
            maxInputTokens = Math.min(Math.max(v, 1), PLAYGROUND_TOKEN_LIMIT);
          }
        }
        if (typeof msg.maxOutputTokens === 'number') {
          const v = Math.floor(msg.maxOutputTokens);
          if (isFinite(v) && v > 0) {
            maxOutputTokens = Math.min(Math.max(v, 1), PLAYGROUND_TOKEN_LIMIT);
          }
        }
        if (typeof msg.presencePenalty === 'number') {
          presencePenalty = Math.min(Math.max(msg.presencePenalty, -2), 2);
        }
        if (typeof msg.frequencyPenalty === 'number') {
          frequencyPenalty = Math.min(Math.max(msg.frequencyPenalty, -2), 2);
        }
        if (typeof msg.systemPrompt === 'string') {
          const sp = msg.systemPrompt.trim();
          systemPrompt = sp.length ? sp : undefined;
        }

        const streaming = msg.stream === true;
        const cts = new vscode.CancellationTokenSource();
        addiPanel._addiCancellation = cts;

        const priorLength = history.length;
        history.push({
          id: Math.random().toString(36).substring(7),
          role: 'user',
          parts: [{ type: 'text', text: prompt }],
        });

        const coreMessages = MessageConverter.uiMessagesToCoreMessages(history);

        try {
          logger.debug('Playground using direct LLMService optimization');
          let assembled = '';
          let reasoningAssembled = '';

          await this.llmService.chatStream({
            provider,
            model,
            messages: coreMessages,
            systemMessage: systemPrompt || undefined,
            token: cts.token,
            onProgress: (delta: string) => {
              if (delta) {
                assembled += delta;
                if (streaming) {
                  panel.webview.postMessage({
                    type: 'playgroundStreamDelta',
                    payload: {
                      delta: delta,
                      full: assembled,
                    },
                  });
                }
              }
            },
            onReasoning: (delta: string) => {
              if (delta) {
                reasoningAssembled += delta;
                panel.webview.postMessage({
                  type: 'playgroundStreamReasoningDelta',
                  payload: { delta },
                });
              }
            },
            onStats: (stats: any) => {
              logger.debug('Playground direct stats', stats);
            },
          } as any);

          const assistantParts: UIPart[] = [];
          if (reasoningAssembled) {
            assistantParts.push({ type: 'reasoning', reasoning: reasoningAssembled });
          }
          assistantParts.push({ type: 'text', text: assembled });

          history.push({
            id: Math.random().toString(36).substring(7),
            role: 'assistant',
            parts: assistantParts,
          });
          panel.webview.postMessage({ type: 'playgroundResponse', payload: { text: assembled } });
          logger.info('Playground response completed', { length: assembled.length });
        } catch (error) {
          const cancelled = cts.token.isCancellationRequested;
          const message = error instanceof Error ? error.message : String(error);
          panel.webview.postMessage({
            type: 'playgroundError',
            payload: { message: cancelled ? 'Request cancelled' : message },
          });
          history.splice(priorLength); // remove pending user entry on error
          logger.warn('Playground request failed', { cancelled, error: message });
        } finally {
          cts.dispose();
          delete addiPanel._addiCancellation;
          logger.debug('Playground request finalized');
        }
      } else if (msg?.type === 'playgroundSetParams') {
        if (typeof msg.temperature === 'number') {
          temperature = msg.temperature;
        }
        if (typeof msg.topP === 'number') {
          topP = Math.min(Math.max(msg.topP, 0), 1);
        }
        if (typeof msg.maxInputTokens === 'number') {
          const v = Math.floor(msg.maxInputTokens);
          if (isFinite(v) && v > 0) {
            maxInputTokens = Math.min(Math.max(v, 1), PLAYGROUND_TOKEN_LIMIT);
          }
        }
        if (typeof msg.maxOutputTokens === 'number') {
          const v = Math.floor(msg.maxOutputTokens);
          if (isFinite(v) && v > 0) {
            maxOutputTokens = Math.min(Math.max(v, 1), PLAYGROUND_TOKEN_LIMIT);
          }
        }
        if (typeof msg.presencePenalty === 'number') {
          presencePenalty = Math.min(Math.max(msg.presencePenalty, -2), 2);
        }
        if (typeof msg.frequencyPenalty === 'number') {
          frequencyPenalty = Math.min(Math.max(msg.frequencyPenalty, -2), 2);
        }
        if (typeof msg.systemPrompt === 'string') {
          const sp = msg.systemPrompt.trim();
          systemPrompt = sp.length ? sp : undefined;
        }
        saveParams();
        logger.debug('Playground parameters updated', {
          temperature,
          topP,
          maxOutputTokens,
          presencePenalty,
          frequencyPenalty,
          hasSystemPrompt: Boolean(systemPrompt),
        });
      } else if (msg?.type === 'playgroundReset') {
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
        panel.webview.postMessage({ type: 'playgroundResetAck' });
        logger.debug('Playground reset by user');
      } else if (msg?.type === 'playgroundAbort') {
        const cts = addiPanel._addiCancellation;
        if (cts) {
          try {
            cts.cancel();
          } catch (_e) {
            /* noop */
          }
          delete addiPanel._addiCancellation;
        }
        logger.debug('Playground request aborted');
      }
    });

    postInit();
  }
}

export default PlaygroundManager;
