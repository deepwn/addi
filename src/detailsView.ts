import * as vscode from "vscode";
import { ProviderModelManager, ProviderTreeItem } from "./provider";
import { ModelTreeItem } from "./model";
import { logger } from "./logger";
import { Provider, Model } from "./types";
import { TokenFormatter, ConfigManager } from "./utils";
import { ModelTester } from "./modelTester";

export class DetailsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "addiDetails";
  private _view?: vscode.WebviewView;
  private _currentItem?: ProviderTreeItem | ModelTreeItem | undefined;
  private _currentProvider: Provider | undefined;
  private _lastVerifiedData: string | undefined;
  private _detectedSpeed: number | undefined;
  private _viewState: { mode: 'edit' | 'create' | 'view'; type: 'provider' | 'model'; parentId?: string } = { mode: 'view', type: 'provider' };

  constructor(private readonly _extensionUri: vscode.Uri, private readonly _manager: ProviderModelManager, private readonly _refreshTree: () => void) {
    // Initialize context to false (hidden)
    vscode.commands.executeCommand('setContext', 'addi:showDetails', false);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
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
          this.cancelEdit();
          break;
        case "requestEdit":
          if (this._currentItem) {
            this.update(this._currentItem, 'edit');
          }
          break;
      }
    });

    if (this._viewState.mode === 'create') {
        if (this._viewState.type === 'provider') {
            this.showAddProvider();
        } else if (this._viewState.type === 'model' && this._viewState.parentId) {
            this.showAddModel(this._viewState.parentId);
        }
    } else {
        this.update(this._currentItem);
    }
  }

  public cancelEdit() {
      this._lastVerifiedData = undefined;
      vscode.commands.executeCommand('setContext', 'addi:showDetails', false);
      vscode.commands.executeCommand('setContext', 'addi:hasDetailsItem', false);
      vscode.commands.executeCommand('setContext', 'addi:isEditingDetails', false);
      this._currentItem = undefined;
      if (this._view) {
          this._view.webview.postMessage({
              type: 'update',
              mode: 'edit',
              item: null
          });
      }
  }

  public showAddProvider() {
      this._lastVerifiedData = undefined;
      vscode.commands.executeCommand('setContext', 'addi:showDetails', true);
      vscode.commands.executeCommand('setContext', 'addi:hasDetailsItem', true); // Treat creating as having item for context purposes
      vscode.commands.executeCommand('setContext', 'addi:isEditingDetails', true);
      vscode.commands.executeCommand('setContext', 'addi:detailsType', 'provider');
      
      this._currentItem = undefined;
      this._viewState = { mode: 'create', type: 'provider' };
      if (this._view) {
          try {
            this._view.show?.(true);
          } catch (e) { /* noop */ }
          this._view.webview.postMessage({
              type: 'update',
              mode: 'create',
              item: { type: 'provider', data: {} }
          });
      }
  }

  public showAddModel(providerId: string) {
      this._lastVerifiedData = undefined;
      vscode.commands.executeCommand('setContext', 'addi:showDetails', true);
      vscode.commands.executeCommand('setContext', 'addi:hasDetailsItem', true);
      vscode.commands.executeCommand('setContext', 'addi:isEditingDetails', true);
      vscode.commands.executeCommand('setContext', 'addi:detailsType', 'model');

      this._currentItem = undefined;
      this._currentProvider = this._manager.getProviders().find(p => p.id === providerId);
      this._viewState = { mode: 'create', type: 'model', parentId: providerId };
      if (this._view) {
          try {
            this._view.show?.(true);
          } catch (e) { /* noop */ }
          this._view.webview.postMessage({
              type: 'update',
              mode: 'create',
              item: { 
                  type: 'model', 
                  data: {
                      family: ConfigManager.getDefaultModelFamily(),
                      version: ConfigManager.getDefaultModelVersion(),
                      maxInputTokens: ConfigManager.getDefaultMaxInputTokens(),
                      maxOutputTokens: ConfigManager.getDefaultMaxOutputTokens()
                  } 
              }
          });
      }
  }

  public triggerEdit() {
      if (this._currentItem) {
          this.update(this._currentItem, 'edit');
      }
  }

  public triggerSave() {
      this._view?.webview.postMessage({ type: 'submit' });
  }

  public triggerCancel() {
      this.cancelEdit();
  }

  public triggerVerify() {
      this._view?.webview.postMessage({ type: 'verify' });
  }

  public update(item: ProviderTreeItem | ModelTreeItem | undefined, mode: 'view' | 'edit' = 'view') {
    this._lastVerifiedData = undefined;
    this._detectedSpeed = undefined;
    // Always show details view context since we removed the "when" clause, but we can keep this for other uses if any
    if (item) {
        vscode.commands.executeCommand('setContext', 'addi:showDetails', true);
        vscode.commands.executeCommand('setContext', 'addi:hasDetailsItem', true);
    } else {
        vscode.commands.executeCommand('setContext', 'addi:showDetails', false);
        vscode.commands.executeCommand('setContext', 'addi:hasDetailsItem', false);
    }
    this._currentItem = item;
    if (item instanceof ProviderTreeItem) {
        this._currentProvider = item.provider;
    } else if (item instanceof ModelTreeItem) {
        const parentId = this._getParentProviderId(item);
        this._currentProvider = parentId ? this._manager.getProviders().find(p => p.id === parentId) : undefined;
    } else {
        this._currentProvider = undefined;
    }
    
    const type = item instanceof ProviderTreeItem ? 'provider' : 'model';
    this._viewState = { mode: mode, type: type };
    
    vscode.commands.executeCommand('setContext', 'addi:isEditingDetails', mode === 'edit');
    vscode.commands.executeCommand('setContext', 'addi:detailsType', type);

    if (this._view) {
      if (item) {
        try {
          this._view.show?.(true); // Ensure view is visible when item is selected
        } catch (e) {
          // Ignore error if show is not available or fails
        }
      }
      this._view.webview.postMessage({
        type: "update",
        mode: mode,
        item: item
          ? {
              type: item instanceof ProviderTreeItem ? "provider" : "model",
              data: item instanceof ProviderTreeItem ? item.provider : item.model,
              parentId: item instanceof ModelTreeItem ? this._getParentProviderId(item) : undefined,
            }
          : null,
      });
    }
  }

  private _getParentProviderId(item: ModelTreeItem): string | undefined {
    // This is a bit tricky since ModelTreeItem doesn't hold a reference to its parent directly in the current implementation
    // We might need to find it via the manager
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
        // Clean up empty values
        if (!providerData.apiKey) { delete providerData.apiKey; }
        if (!providerData.apiEndpoint) { delete providerData.apiEndpoint; }
        if (!providerData.description) { delete providerData.description; }
        if (!providerData.website) { delete providerData.website; }

        try {
            const newProvider = await this._manager.addProvider(providerData);
            vscode.window.showInformationMessage(`Provider "${data.name}" added.`);
            this._refreshTree();
            
            this._currentItem = new ProviderTreeItem(newProvider);
            this.cancelEdit();
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
    
    // Clean up empty values
    if (!updates.apiKey) {
      delete updates.apiKey;
    }
    
    const success = await this._manager.updateProvider(provider.id, updates);
    if (success) {
      vscode.window.showInformationMessage(`Provider "${data.name}" updated.`);
      this._refreshTree();
      
      const updatedProvider = this._manager.getProviders().find(p => p.id === provider.id);
      if (updatedProvider) {
          this._currentItem = new ProviderTreeItem(updatedProvider);
      }
      this.cancelEdit();
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
            // Force full detection regardless of current values
            const result = await ModelTester.testModelApi(this._currentProvider!, modelDraft, {
                detectInput: true,
                detectOutput: true,
                checkVision: true,
                checkTools: true,
                checkSpeed: true // Retain statistics but don't fail on speed
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
                
                // Update UI if values detected or capabilities changed
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

                if (hasUpdates && this._view) {
                    this._view.webview.postMessage({
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

    const modelData: Partial<Model> = {
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

    if (this._detectedSpeed) {
        (modelData as any).averageSpeed = this._detectedSpeed;
        (modelData as any).speedHistory = [this._detectedSpeed];
    }

    if (this._currentProvider) {
        let verified = false;
        
        // Check if we already verified this exact data
        if (this._lastVerifiedData && this._lastVerifiedData === JSON.stringify(data)) {
            verified = true;
        } else {
            let errorMsg = "";
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Verifying model connection...",
                cancellable: true
            }, async (progress, token) => {
                 const controller = new AbortController();
                 token.onCancellationRequested(() => controller.abort());
                 try {
                     // For auto-verify on save, we only check basic connectivity.
                     // We do NOT auto-detect tokens or check capabilities here to keep it fast.
                     const result = await ModelTester.testModelApi(this._currentProvider!, modelData as any, {
                         detectInput: false,
                         detectOutput: false,
                         checkVision: false,
                         checkTools: false,
                         checkSpeed: false
                     }, controller.signal, (msg) => {
                         progress.report({ message: msg });
                     });
                     
                     if (result.success) {
                        verified = true;
                        this._lastVerifiedData = JSON.stringify(data);
                     } else {
                        throw new Error(result.error || "Verification failed");
                     }
                 } catch (e) {
                     errorMsg = e instanceof Error ? e.message : String(e);
                     this._lastVerifiedData = undefined;
                 }
            });

            if (!verified) {
                const selection = await vscode.window.showWarningMessage(
                    `Model verification failed: ${errorMsg}. Do you want to save anyway?`,
                    "Force Save",
                    "Cancel"
                );
                if (selection !== "Force Save") {
                    return;
                }
            }
        }
    }

    if (this._viewState.mode === 'create') {
        if (!this._viewState.parentId) {
            vscode.window.showErrorMessage("No parent provider specified for new model.");
            return;
        }
        try {
            const newModel = await this._manager.addModel(this._viewState.parentId, modelData as any);
            if (newModel) {
                vscode.window.showInformationMessage(`Model "${data.name}" added.`);
                this._refreshTree();
                
                this._currentItem = new ModelTreeItem(newModel);
                this.cancelEdit();
            } else {
                vscode.window.showErrorMessage("Failed to add model.");
            }
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

    const updates = modelData;

    const success = await this._manager.updateModel(parentId, model.sid, updates);
    if (success) {
      vscode.window.showInformationMessage(`Model "${data.name}" updated.`);
      this._refreshTree();
      
      const updatedProvider = this._manager.getProviders().find(p => p.id === parentId);
      const updatedModel = updatedProvider?.models.find(m => m.sid === model.sid);
      if (updatedModel) {
          this._currentItem = new ModelTreeItem(updatedModel);
      }
      this.cancelEdit();
    } else {
      vscode.window.showErrorMessage("Failed to update model.");
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const nonce = getNonce();

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Details</title>
                <style>
                    body { padding: 10px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
                    .hidden { display: none; }
                    .form-group { margin-bottom: 10px; }
                    label { display: block; margin-bottom: 4px; font-weight: bold; font-size: 0.9em; }
                    input[type="text"], input[type="password"], select { 
                        width: 100%; 
                        padding: 4px; 
                        background: var(--vscode-input-background); 
                        color: var(--vscode-input-foreground); 
                        border: 1px solid var(--vscode-input-border); 
                        box-sizing: border-box;
                    }
                    input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); }
                    button { 
                        background: var(--vscode-button-background); 
                        color: var(--vscode-button-foreground); 
                        border: none; 
                        padding: 6px 12px; 
                        cursor: pointer; 
                        width: 100%;
                    }
                    button:hover { background: var(--vscode-button-hoverBackground); }
                    .checkbox-group { display: flex; align-items: center; gap: 8px; }
                    .checkbox-group label { margin: 0; font-weight: normal; }
                    .info-text { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-top: 2px; }
                    .button-row { display: flex; gap: 10px; margin-top: 10px; }
                    .secondary-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
                    .secondary-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
                    
                    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 5px; }
                    
                    .view-mode input[type="password"] {
                        display: none; /* Hide API key in view mode */
                    }
                    .view-mode .api-key-container { display: none; } /* Hide API key container in view mode */
                    
                    .view-mode .info-text { display: none; }
                </style>
			</head>
			<body>
				<div id="placeholder">Select a provider or model to view details.</div>
                
                <div id="content-container" class="hidden">
                    <div id="provider-form" class="hidden">
                        <div class="form-group">
                            <label>Name</label>
                            <input type="text" id="p-name">
                        </div>
                        <div class="form-group">
                            <label>Type</label>
                            <select id="p-type">
                                <option value="openai">OpenAI</option>
                                <option value="anthropic">Anthropic</option>
                                <option value="google">Google</option>
                                <option value="generic">Generic</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>API Endpoint</label>
                            <input type="text" id="p-endpoint">
                        </div>
                        <div class="form-group api-key-container">
                            <label>API Key</label>
                            <input type="password" id="p-apikey" placeholder="Leave empty to keep unchanged">
                        </div>
                        <div class="form-group">
                            <label>Description</label>
                            <input type="text" id="p-description">
                        </div>
                        <div class="form-group">
                            <label>Website</label>
                            <input type="text" id="p-website">
                        </div>
                    </div>

                    <div id="model-form" class="hidden">
                        <div class="form-group">
                            <label>Name</label>
                            <input type="text" id="m-name">
                        </div>
                        <div class="form-group">
                            <label>Model ID (Remote)</label>
                            <input type="text" id="m-id">
                        </div>
                        <div class="form-group">
                            <label>Family</label>
                            <input type="text" id="m-family">
                        </div>
                        <div class="form-group">
                            <label>Version</label>
                            <input type="text" id="m-version">
                        </div>
                        <div class="form-group">
                            <label>Max Input Tokens</label>
                            <input type="text" id="m-input-tokens">
                            <div class="info-text">Supports 'k' suffix (e.g. 128k)</div>
                        </div>
                        <div class="form-group">
                            <label>Max Output Tokens</label>
                            <input type="text" id="m-output-tokens">
                            <div class="info-text">Supports 'k' suffix (e.g. 4k)</div>
                        </div>
                        <div class="form-group checkbox-group">
                            <input type="checkbox" id="m-vision">
                            <label for="m-vision">Vision (Image Input)</label>
                        </div>
                        <div class="form-group checkbox-group">
                            <input type="checkbox" id="m-tools">
                            <label for="m-tools">Tool Calling</label>
                        </div>
                    </div>
                </div>

				<script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    
                    const placeholder = document.getElementById('placeholder');
                    const contentContainer = document.getElementById('content-container');
                    const providerForm = document.getElementById('provider-form');
                    const modelForm = document.getElementById('model-form');

                    // Provider inputs
                    const pName = document.getElementById('p-name');
                    const pType = document.getElementById('p-type');
                    const pEndpoint = document.getElementById('p-endpoint');
                    const pApiKey = document.getElementById('p-apikey');
                    const pDesc = document.getElementById('p-description');
                    const pWeb = document.getElementById('p-website');

                    // Model inputs
                    const mName = document.getElementById('m-name');
                    const mId = document.getElementById('m-id');
                    const mFamily = document.getElementById('m-family');
                    const mVersion = document.getElementById('m-version');
                    const mInput = document.getElementById('m-input-tokens');
                    const mOutput = document.getElementById('m-output-tokens');
                    const mVision = document.getElementById('m-vision');
                    const mTools = document.getElementById('m-tools');

                    // Token formatter logic (simplified for JS)
                    function formatToken(val) {
                        if (!val) return '';
                        if (val >= 1024) return (val / 1024) + 'k';
                        return val.toString();
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'update':
                                updateContent(message.item, message.mode);
                                break;
                            case 'updateFields':
                                const updates = message.payload;
                                if (updates.maxInputTokens) mInput.value = updates.maxInputTokens;
                                if (updates.maxOutputTokens) mOutput.value = updates.maxOutputTokens;
                                if (updates.imageInput !== undefined) mVision.checked = updates.imageInput;
                                if (updates.toolCalling !== undefined) mTools.checked = updates.toolCalling;
                                break;
                            case 'submit':
                                submitForm();
                                break;
                            case 'verify':
                                verifyForm();
                                break;
                        }
                    });

                    function setInputsDisabled(disabled) {
                        const inputs = document.querySelectorAll('input, select');
                        inputs.forEach(input => {
                            input.disabled = disabled;
                        });
                    }

                    function updateContent(item, mode) {
                        if (!item) {
                            show(placeholder);
                            hide(contentContainer);
                            return;
                        }

                        hide(placeholder);
                        show(contentContainer);

                        const isCreate = mode === 'create';
                        const isEdit = mode === 'edit';
                        const isView = mode === 'view';

                        // Update container class for view mode styles
                        if (isView) {
                            contentContainer.classList.add('view-mode');
                            setInputsDisabled(true);
                        } else {
                            contentContainer.classList.remove('view-mode');
                            setInputsDisabled(false);
                        }

                        if (item.type === 'provider') {
                            show(providerForm);
                            hide(modelForm);
                            
                            const data = item.data;
                            pName.value = data.name || '';
                            pType.value = data.providerType || 'generic';
                            pEndpoint.value = data.apiEndpoint || '';
                            pApiKey.value = ''; 
                            pApiKey.placeholder = isCreate ? 'Required' : 'Leave empty to keep unchanged';
                            pDesc.value = data.description || '';
                            pWeb.value = data.website || '';
                        } else if (item.type === 'model') {
                            show(modelForm);
                            hide(providerForm);

                            const data = item.data;
                            mName.value = data.name || '';
                            mId.value = data.id || '';
                            mFamily.value = data.family || 'addi';
                            mVersion.value = data.version || '1.0.0';
                            mInput.value = formatToken(data.maxInputTokens);
                            mOutput.value = formatToken(data.maxOutputTokens);
                            
                            mVision.checked = !!(data.capabilities && data.capabilities.imageInput);
                            mTools.checked = !!(data.capabilities && (data.capabilities.toolCalling === true || typeof data.capabilities.toolCalling === 'number'));
                        }
                    }

                    function show(el) { el.classList.remove('hidden'); }
                    function hide(el) { el.classList.add('hidden'); }

                    function submitForm() {
                        if (!providerForm.classList.contains('hidden')) {
                            vscode.postMessage({
                                type: 'saveProvider',
                                payload: {
                                    name: pName.value,
                                    providerType: pType.value,
                                    apiEndpoint: pEndpoint.value,
                                    apiKey: pApiKey.value,
                                    description: pDesc.value,
                                    website: pWeb.value
                                }
                            });
                        } else if (!modelForm.classList.contains('hidden')) {
                            vscode.postMessage({
                                type: 'saveModel',
                                payload: {
                                    name: mName.value,
                                    id: mId.value,
                                    family: mFamily.value,
                                    version: mVersion.value,
                                    maxInputTokens: mInput.value,
                                    maxOutputTokens: mOutput.value,
                                    imageInput: mVision.checked,
                                    toolCalling: mTools.checked
                                }
                            });
                        }
                    }

                    function verifyForm() {
                        if (!modelForm.classList.contains('hidden')) {
                            vscode.postMessage({
                                type: 'verifyModel',
                                payload: {
                                    name: mName.value,
                                    id: mId.value,
                                    family: mFamily.value,
                                    version: mVersion.value,
                                    maxInputTokens: mInput.value,
                                    maxOutputTokens: mOutput.value,
                                    imageInput: mVision.checked,
                                    toolCalling: mTools.checked
                                }
                            });
                        }
                    }
				</script>
			</body>
			</html>`;
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
