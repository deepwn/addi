import * as vscode from 'vscode';
import { ProviderModelManager } from '../../core/providers/ProviderModelManager';
import { ProviderTreeItem } from './providerView';
import { ModelTreeItem } from '../../core/providers/AddiChatProvider';
import { logger, maskSecret } from '../../common/logger';
import { Provider, Model } from '../../common/types';
import { TokenFormatter, ConfigManager } from '../../common/utils';
import { ModelTester } from '../../core/llm/modelTester';
import { TextDecoder } from 'util';

export class EditorViewManager {
  public static readonly viewType = 'addiEditor';
  private _panel: vscode.WebviewPanel | undefined;
  private _currentItem: ProviderTreeItem | ModelTreeItem | undefined;
  private _currentItems: ModelTreeItem[] = []; // For batch editing
  private _currentProvider: Provider | undefined;
  private _lastVerifiedData: string | undefined;
  private _detectedSpeed: number | undefined;
  private _viewState: {
    mode: 'edit' | 'create';
    type: 'provider' | 'model';
    parentId?: string;
    prefillData?: any;
    isBatch?: boolean; // Flag for batch edit mode
    batchCount?: number; // Number of items in batch
  } = { mode: 'edit', type: 'provider' };

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _manager: ProviderModelManager,
    private readonly _refreshTree: () => void
  ) {}

  public async openEditor(
    item: ProviderTreeItem | ModelTreeItem | ModelTreeItem[] | undefined,
    mode: 'edit' | 'create',
    parentId?: string,
    prefillData?: any
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (this._panel) {
      this._panel.reveal(column);
    } else {
      this._panel = vscode.window.createWebviewPanel(
        EditorViewManager.viewType,
        'Addi Editor',
        column || vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this._extensionUri],
        }
      );

      this._panel.onDidDispose(() => {
        this._panel = undefined;
      });

      this._panel.webview.html = await this._getHtmlForWebview(this._panel.webview);

      this._panel.webview.onDidReceiveMessage(async (data) => {
        switch (data.type) {
          case 'saveProvider':
            await this._saveProvider(data.payload);
            break;
          case 'saveModel':
            await this._saveModel(data.payload);
            break;
          case 'verifyModel':
            await this._verifyModel(data.payload);
            break;
          case 'log':
            logger.info('Webview log', data.payload);
            break;
          case 'cancel':
            this._panel?.dispose();
            break;
          case 'showError':
            await vscode.window.showErrorMessage(data.payload?.message || 'An error occurred');
            break;
        }
      });
    }

    this._updatePanelContent(item, mode, parentId, prefillData);
  }

  private _updatePanelContent(
    item: ProviderTreeItem | ModelTreeItem | ModelTreeItem[] | undefined,
    mode: 'edit' | 'create',
    parentId?: string,
    prefillData?: any
  ) {
    // Handle array of items for batch editing
    this._currentItems = [];
    if (Array.isArray(item)) {
      this._currentItems = item;
      // If more than 1 item, use batch mode (name/id not editable)
      // If 1 item, treat as single edit (name/id editable)
      if (item.length > 1) {
        item = undefined; // Will use batch data
      } else if (item.length === 1) {
        item = item[0]; // Single item, use existing logic
      } else {
        item = undefined;
      }
    }

    this._currentItem = item;
    this._lastVerifiedData = undefined;
    this._detectedSpeed = undefined;

    // Determine if we're in batch mode (more than 1 item)
    const isBatchMode = this._currentItems.length > 1;
    const batchCount = this._currentItems.length;

    if (item instanceof ProviderTreeItem) {
      this._currentProvider = item.provider;
    } else if (item instanceof ModelTreeItem) {
      const pId = this._getParentProviderId(item);
      this._currentProvider = pId
        ? this._manager.getProviders().find((p) => p.id === pId)
        : undefined;
    } else if (mode === 'create' && parentId) {
      this._currentProvider = this._manager.getProviders().find((p) => p.id === parentId);
    } else if (isBatchMode && this._currentItems.length > 0) {
      // For batch mode, get provider from first item
      const firstItem = this._currentItems[0];
      if (firstItem) {
        const pId = this._getParentProviderId(firstItem);
        this._currentProvider = pId
          ? this._manager.getProviders().find((p) => p.id === pId)
          : undefined;
      }
    } else {
      this._currentProvider = undefined;
    }

    const type =
      item instanceof ProviderTreeItem || (mode === 'create' && !parentId) ? 'provider' : 'model';
    this._viewState = { mode, type, prefillData, isBatch: isBatchMode, batchCount };
    if (parentId) {
      this._viewState.parentId = parentId;
    }

    let title = 'Addi Editor';
    if (mode === 'create') {
      title = `Create ${type === 'provider' ? 'Provider' : 'Model'}`;
    } else {
      if (isBatchMode) {
        title = `Edit ${batchCount} Models`;
      } else if (item instanceof ProviderTreeItem) {
        title = `Edit ${item.provider.name}`;
      } else if (item instanceof ModelTreeItem) {
        title = `Edit ${item.model.name}`;
      }
    }

    let dataToSend: any = {};
    if (mode === 'create') {
      if (prefillData) {
        dataToSend = prefillData;
      } else if (type === 'model') {
        dataToSend = {
          family: ConfigManager.getDefaultModelFamily(),
          version: ConfigManager.getDefaultModelVersion(),
          maxInputTokens: ConfigManager.getDefaultMaxInputTokens(),
          maxOutputTokens: ConfigManager.getDefaultMaxOutputTokens(),
        };
      }
    } else if (isBatchMode) {
      // For batch mode, send placeholder data
      dataToSend = {
        name: `Selected ${batchCount} models`,
        id: `Selected ${batchCount} models`,
        isBatchMode: true,
        batchCount: batchCount,
      };
    } else {
      if (item instanceof ProviderTreeItem) {
        // Clone provider and inject masked API key for UI display
        dataToSend = {
          ...item.provider,
          maskedApiKey: maskSecret(item.provider.apiKey),
        };
      } else {
        dataToSend = item?.model;
      }
    }

    if (this._panel) {
      this._panel.title = title;
      this._panel.webview.postMessage({
        type: 'update',
        mode: mode,
        item: {
          type: type,
          isBatchMode: isBatchMode,
          batchCount: batchCount,
          data: dataToSend,
          parentId:
            parentId ||
            (item instanceof ModelTreeItem ? this._getParentProviderId(item) : undefined),
        },
      });
    }
  }

  private _getParentProviderId(item: ModelTreeItem): string | undefined {
    const result = this._manager.findModel(item.model.sid);
    return result?.provider.id;
  }

  private async _saveProvider(data: any) {
    if (this._viewState.mode === 'create') {
      const providerData: Omit<Provider, 'id' | 'models'> = {
        name: data.name,
        providerType: data.providerType,
        apiEndpoint: data.apiEndpoint,
        apiKey: data.apiKey,
        description: data.description,
        website: data.website,
      };
      if (!providerData.apiKey) {
        delete providerData.apiKey;
      }
      if (!providerData.apiEndpoint) {
        delete providerData.apiEndpoint;
      }
      if (!providerData.description) {
        delete providerData.description;
      }
      if (!providerData.website) {
        delete providerData.website;
      }

      try {
        await this._manager.addProvider(providerData);
        vscode.window.showInformationMessage(`Provider "${data.name}" added.`);
        this._refreshTree();
        this._panel?.dispose();
      } catch (e) {
        vscode.window.showErrorMessage(
          `Failed to add provider: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      return;
    }

    if (!this._currentItem || !(this._currentItem instanceof ProviderTreeItem)) {
      return;
    }
    const provider = this._currentItem.provider;
    const apiKeyTouched = Boolean(data.apiKeyTouched);
    const trimmedApiKey = typeof data.apiKey === 'string' ? data.apiKey.trim() : undefined;
    const updates: Partial<Provider> = {
      name: data.name,
      description: data.description,
      website: data.website,
      apiEndpoint: data.apiEndpoint,
      providerType: data.providerType,
    };

    if (apiKeyTouched) {
      updates.apiKey = trimmedApiKey ?? '';
    }

    const success = await this._manager.updateProvider(provider.id, updates);
    if (success) {
      vscode.window.showInformationMessage(`Provider "${data.name}" updated.`);
      this._refreshTree();
      this._panel?.dispose();
    } else {
      vscode.window.showErrorMessage('Failed to update provider.');
    }
  }

  private async _verifyModel(data: any) {
    if (!this._currentProvider) {
      vscode.window.showErrorMessage('No provider context found.');
      return;
    }

    const maxInputTokens = TokenFormatter.parse(data.maxInputTokens);
    const maxOutputTokens = TokenFormatter.parse(data.maxOutputTokens);

    const modelDraft: any = {
      id: data.id,
      name: data.name,
      family: data.family,
      version: data.version,
      maxInputTokens: maxInputTokens,
      maxOutputTokens: maxOutputTokens,
      capabilities: {
        imageInput: data.imageInput,
        toolCalling: data.toolCalling,
      },
    };

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Detecting parameters for ${data.name || data.id}...`,
        cancellable: true,
      },
      async (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => {
          controller.abort();
        });
        try {
          const result = await ModelTester.testModelApi(
            this._currentProvider!,
            modelDraft,
            {
              detectInput: true,
              detectOutput: true,
              checkVision: true,
              checkTools: true,
              checkSpeed: false,
            },
            controller.signal,
            (msg) => {
              progress.report({ message: msg });
            }
          );

          if (result.success) {
            this._lastVerifiedData = JSON.stringify(data);
            this._detectedSpeed = result.speed;
            let msg = `Detection successful for ${data.name || data.id}!`;

            if (result.speed) {
              msg += ` Speed: ${result.speed.toFixed(1)} t/s`;
            }

            const updates: any = {};
            let hasUpdates = false;

            if (result.detectedMaxInputTokens) {
              updates.maxInputTokens = result.detectedMaxInputTokens;
              msg += ` Input: ${result.detectedMaxInputTokens}`;
              hasUpdates = true;
            }
            if (result.detectedMaxOutputTokens) {
              updates.maxOutputTokens = result.detectedMaxOutputTokens;
              msg += ` Output: ${result.detectedMaxOutputTokens}`;
              hasUpdates = true;
            }

            if (
              result.visionSupported !== undefined &&
              result.visionSupported !== data.imageInput
            ) {
              updates.imageInput = result.visionSupported;
              msg += result.visionSupported ? ' (Vision detected)' : ' (Vision removed)';
              hasUpdates = true;
            }

            if (
              result.toolCallingSupported !== undefined &&
              result.toolCallingSupported !== data.toolCalling
            ) {
              updates.toolCalling = result.toolCallingSupported;
              msg += result.toolCallingSupported ? ' (Tools detected)' : ' (Tools removed)';
              hasUpdates = true;
            }

            if (hasUpdates && this._panel) {
              this._panel.webview.postMessage({
                type: 'updateFields',
                payload: updates,
              });
            }

            vscode.window.showInformationMessage(msg);
          } else {
            throw new Error(result.error || 'Unknown error');
          }
        } catch (e) {
          this._lastVerifiedData = undefined;
          vscode.window.showErrorMessage(
            `Verification failed: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    );
  }

  private async _saveModel(data: any) {
    const maxInputTokens = TokenFormatter.parse(data.maxInputTokens);
    const maxOutputTokens = TokenFormatter.parse(data.maxOutputTokens);

    if (!maxInputTokens || !maxOutputTokens) {
      vscode.window.showErrorMessage('Invalid token values.');
      return;
    }

    // Use _lastVerifiedData to check if we can skip verification or warn user
    // For now, we just log it or ignore it as we trust the user's explicit save action
    if (this._lastVerifiedData && this._lastVerifiedData !== JSON.stringify(data)) {
      // Data changed since last verification
    }

    const modelData: Partial<Model> = {
      id: data.id,
      name: data.name,
      family: data.family,
      version: data.version,
      maxInputTokens: maxInputTokens,
      maxOutputTokens: maxOutputTokens,
      requestAdditional: data.requestAdditional,
      capabilities: {
        imageInput: data.imageInput,
        toolCalling: data.toolCalling,
      },
    };

    if (this._detectedSpeed) {
      (modelData as any).averageSpeed = this._detectedSpeed;
      (modelData as any).speedHistory = [this._detectedSpeed];
    }

    // Default toolCalling to true for new models
    if (modelData.capabilities && modelData.capabilities.toolCalling === undefined) {
      modelData.capabilities.toolCalling = true;
    }

    if (this._viewState.mode === 'create') {
      // For new models, don't set speedHistory (no history yet)
      if (this._detectedSpeed) {
        delete (modelData as any).speedHistory;
      }
      if (!this._viewState.parentId) {
        vscode.window.showErrorMessage('No parent provider specified for new model.');
        return;
      }
      try {
        await this._manager.addModel(this._viewState.parentId, modelData as any);
        vscode.window.showInformationMessage(`Model "${data.name}" added.`);
        this._refreshTree();
        this._panel?.dispose();
      } catch (e) {
        vscode.window.showErrorMessage(
          `Failed to add model: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      return;
    }

    // Handle batch mode
    if (this._viewState.isBatch && this._currentItems.length > 0) {
      await this._saveBatchModels(modelData);
      return;
    }

    // Single model edit mode
    if (!this._currentItem || !(this._currentItem instanceof ModelTreeItem)) {
      return;
    }
    const model = this._currentItem.model;
    const parentId = this._getParentProviderId(this._currentItem);

    if (!parentId) {
      vscode.window.showErrorMessage('Could not find parent provider for model.');
      return;
    }

    // Update model speed separately to preserve speedHistory
    if (this._detectedSpeed) {
      await this._manager.updateModelSpeed(parentId, model.sid, this._detectedSpeed);
      // Remove speedHistory and averageSpeed from modelData to avoid overriding
      delete (modelData as any).speedHistory;
      delete (modelData as any).averageSpeed;
    }

    const success = await this._manager.updateModel(parentId, model.sid, modelData);
    if (success) {
      vscode.window.showInformationMessage(`Model "${data.name}" updated.`);
      this._refreshTree();
      this._panel?.dispose();
    } else {
      vscode.window.showErrorMessage('Failed to update model.');
    }
  }

  private async _saveBatchModels(modelData: Partial<Model>) {
    if (!this._currentProvider) {
      vscode.window.showErrorMessage('No provider context found for batch update.');
      return;
    }

    const parentId = this._currentProvider.id;

    // Don't include name/id in batch update - those are handled per-model
    const { name, id, version, ...batchUpdateData } = modelData;

    try {
      const sids = this._currentItems.map((i) => i.model.sid);
      const updatedCount = await this._manager.updateModels(parentId, sids, batchUpdateData as any);
      vscode.window.showInformationMessage(`${updatedCount} model(s) updated successfully.`);
      this._refreshTree();
      this._panel?.dispose();
    } catch (e) {
      vscode.window.showErrorMessage(
        `Failed to update models: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  private async _getHtmlForWebview(webview: vscode.Webview): Promise<string> {
    const nonce = getNonce();
    try {
      const fileUri = vscode.Uri.joinPath(this._extensionUri, 'resources', 'editor.html');
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      let html = new TextDecoder().decode(bytes);

      html = html.replace(/{{cspSource}}/g, webview.cspSource);
      html = html.replace(/{{nonce}}/g, nonce);

      return html;
    } catch (e) {
      logger.error('Failed to load editor HTML', e);
      return `<!DOCTYPE html><html><body><p>Error loading editor. Check logs.</p></body></html>`;
    }
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
