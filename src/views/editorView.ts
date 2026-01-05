import * as vscode from "vscode";
import { ProviderModelManager } from "../provider";
import { ProviderTreeItem } from "./providerView";
import { ModelTreeItem } from "../model";
import { logger } from "../logger";
import { Provider, Model } from "../types";
import { TokenFormatter, ConfigManager } from "../utils";
import { ModelTester } from "../modelTester";
import { TextDecoder } from "util";

export class EditorViewManager {
  public static readonly viewType = "addiEditor";
  private _panel: vscode.WebviewPanel | undefined;
  private _currentItem: ProviderTreeItem | ModelTreeItem | undefined;
  private _currentProvider: Provider | undefined;
  private _lastVerifiedData: string | undefined;
  private _detectedSpeed: number | undefined;
  private _viewState: { mode: 'edit' | 'create'; type: 'provider' | 'model'; parentId?: string; prefillData?: any } = { mode: 'edit', type: 'provider' };

  constructor(private readonly _extensionUri: vscode.Uri, private readonly _manager: ProviderModelManager, private readonly _refreshTree: () => void) {}

  public async openEditor(item: ProviderTreeItem | ModelTreeItem | undefined, mode: 'edit' | 'create', parentId?: string, prefillData?: any) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (this._panel) {
      this._panel.reveal(column);
    } else {
      this._panel = vscode.window.createWebviewPanel(
        EditorViewManager.viewType,
        "Addi Editor",
        column || vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [this._extensionUri],
        }
      );

      this._panel.onDidDispose(() => {
        this._panel = undefined;
      });

      this._panel.webview.html = await this._getHtmlForWebview(this._panel.webview);

      this._panel.webview.onDidReceiveMessage(async (data) => {
        switch (data.type) {
          case "saveProvider":
            await this._saveProvider(data.payload);
            break;
          case "saveModel":
            await this._saveModel(data.payload);
            break;
          case "verifyModel":
            await this._verifyModel(data.payload);
            break;
          case "log":
            logger.info("Webview log", data.payload);
            break;
          case "cancel":
            this._panel?.dispose();
            break;
        }
      });
    }

    this._updatePanelContent(item, mode, parentId, prefillData);
  }

  private _updatePanelContent(item: ProviderTreeItem | ModelTreeItem | undefined, mode: 'edit' | 'create', parentId?: string, prefillData?: any) {
    this._currentItem = item;
    this._lastVerifiedData = undefined;
    this._detectedSpeed = undefined;

    if (item instanceof ProviderTreeItem) {
        this._currentProvider = item.provider;
    } else if (item instanceof ModelTreeItem) {
        const pId = this._getParentProviderId(item);
        this._currentProvider = pId ? this._manager.getProviders().find(p => p.id === pId) : undefined;
    } else if (mode === 'create' && parentId) {
        this._currentProvider = this._manager.getProviders().find(p => p.id === parentId);
    } else {
        this._currentProvider = undefined;
    }

    const type = (item instanceof ProviderTreeItem) || (mode === 'create' && !parentId) ? 'provider' : 'model';
    this._viewState = { mode, type, prefillData };
    if (parentId) {
        this._viewState.parentId = parentId;
    }

    let title = "Addi Editor";
    if (mode === 'create') {
        title = `Create ${type === 'provider' ? 'Provider' : 'Model'}`;
    } else {
        if (item instanceof ProviderTreeItem) {
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
                maxOutputTokens: ConfigManager.getDefaultMaxOutputTokens()
            };
        }
    } else {
        dataToSend = (item instanceof ProviderTreeItem ? item.provider : item?.model);
    }

    if (this._panel) {
        this._panel.title = title;
        this._panel.webview.postMessage({
            type: "update",
            mode: mode,
            item: {
                type: type,
                data: dataToSend,
                parentId: parentId || (item instanceof ModelTreeItem ? this._getParentProviderId(item) : undefined)
            }
        });
    }
  }

  private _getParentProviderId(item: ModelTreeItem): string | undefined {
    const result = this._manager.findModel(item.model.sid);
    return result?.provider.id;
  }

  private async _saveProvider(data: any) {
    if (this._viewState.mode === 'create') {
        const providerData: Omit<Provider, "id" | "models"> = {
            name: data.name,
            providerType: data.providerType,
            apiEndpoint: data.apiEndpoint,
            apiKey: data.apiKey,
            description: data.description,
            website: data.website
        };
        if (!providerData.apiKey) { delete providerData.apiKey; }
        if (!providerData.apiEndpoint) { delete providerData.apiEndpoint; }
        if (!providerData.description) { delete providerData.description; }
        if (!providerData.website) { delete providerData.website; }

        try {
            await this._manager.addProvider(providerData);
            vscode.window.showInformationMessage(`Provider "${data.name}" added.`);
            this._refreshTree();
            this._panel?.dispose();
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to add provider: ${e instanceof Error ? e.message : String(e)}`);
        }
        return;
    }

    if (!this._currentItem || !(this._currentItem instanceof ProviderTreeItem)) {
      return;
    }
    const provider = this._currentItem.provider;
    const updates: Partial<Provider> = {
      name: data.name,
      description: data.description,
      website: data.website,
      apiEndpoint: data.apiEndpoint,
      apiKey: data.apiKey,
      providerType: data.providerType,
    };
    
    if (!updates.apiKey) {
      delete updates.apiKey;
    }
    
    const success = await this._manager.updateProvider(provider.id, updates);
    if (success) {
      vscode.window.showInformationMessage(`Provider "${data.name}" updated.`);
      this._refreshTree();
      this._panel?.dispose();
    } else {
      vscode.window.showErrorMessage("Failed to update provider.");
    }
  }

  private async _verifyModel(data: any) {
    if (!this._currentProvider) {
        vscode.window.showErrorMessage("No provider context found.");
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
            toolCalling: data.toolCalling
        }
    };

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Detecting parameters for ${data.name || data.id}...`,
        cancellable: true
    }, async (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => {
            controller.abort();
        });
        try {
            const result = await ModelTester.testModelApi(this._currentProvider!, modelDraft, {
                detectInput: true,
                detectOutput: true,
                checkVision: true,
                checkTools: true,
                checkSpeed: true
            }, controller.signal, (msg) => {
                progress.report({ message: msg });
            });

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
                
                if (result.visionSupported !== undefined && result.visionSupported !== data.imageInput) {
                    updates.imageInput = result.visionSupported;
                    msg += result.visionSupported ? " (Vision detected)" : " (Vision removed)";
                    hasUpdates = true;
                }
                
                if (result.toolCallingSupported !== undefined && result.toolCallingSupported !== data.toolCalling) {
                    updates.toolCalling = result.toolCallingSupported;
                    msg += result.toolCallingSupported ? " (Tools detected)" : " (Tools removed)";
                    hasUpdates = true;
                }

                if (hasUpdates && this._panel) {
                    this._panel.webview.postMessage({
                        type: 'updateFields',
                        payload: updates
                    });
                }

                vscode.window.showInformationMessage(msg);
            } else {
                throw new Error(result.error || "Unknown error");
            }
        } catch (e) {
            this._lastVerifiedData = undefined;
            vscode.window.showErrorMessage(`Verification failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    });
  }

  private async _saveModel(data: any) {
    const maxInputTokens = TokenFormatter.parse(data.maxInputTokens);
    const maxOutputTokens = TokenFormatter.parse(data.maxOutputTokens);

    if (!maxInputTokens || !maxOutputTokens) {
        vscode.window.showErrorMessage("Invalid token values.");
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
          toolCalling: data.toolCalling
      }
    };

    if (this._detectedSpeed) {
        (modelData as any).averageSpeed = this._detectedSpeed;
        (modelData as any).speedHistory = [this._detectedSpeed];
    }

    if (this._viewState.mode === 'create') {
        if (!this._viewState.parentId) {
            vscode.window.showErrorMessage("No parent provider specified for new model.");
            return;
        }
        try {
            await this._manager.addModel(this._viewState.parentId, modelData as any);
            vscode.window.showInformationMessage(`Model "${data.name}" added.`);
            this._refreshTree();
            this._panel?.dispose();
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to add model: ${e instanceof Error ? e.message : String(e)}`);
        }
        return;
    }

    if (!this._currentItem || !(this._currentItem instanceof ModelTreeItem)) {
      return;
    }
    const model = this._currentItem.model;
    const parentId = this._getParentProviderId(this._currentItem);
    
    if (!parentId) {
        vscode.window.showErrorMessage("Could not find parent provider for model.");
        return;
    }

    const success = await this._manager.updateModel(parentId, model.sid, modelData);
    if (success) {
      vscode.window.showInformationMessage(`Model "${data.name}" updated.`);
      this._refreshTree();
      this._panel?.dispose();
    } else {
      vscode.window.showErrorMessage("Failed to update model.");
    }
  }

  private async _getHtmlForWebview(webview: vscode.Webview): Promise<string> {
    const nonce = getNonce();
    try {
        const fileUri = vscode.Uri.joinPath(this._extensionUri, "resources", "editor.html");
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        let html = new TextDecoder().decode(bytes);
        
        html = html.replace(/{{cspSource}}/g, webview.cspSource);
        html = html.replace(/{{nonce}}/g, nonce);
        
        return html;
    } catch (e) {
        logger.error("Failed to load editor HTML", e);
        return `<!DOCTYPE html><html><body><p>Error loading editor. Check logs.</p></body></html>`;
    }
  }
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
