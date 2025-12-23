import * as vscode from "vscode";
import { ProviderModelManager, ProviderTreeItem } from "./provider";
import { ModelTreeItem } from "./model";
import { logger } from "./logger";
import { Provider, Model } from "./types";
import { TokenFormatter, ConfigManager } from "./utils";
import { ModelTester } from "./modelTester";

export class EditorViewManager {
  public static readonly viewType = "addiEditor";
  private _panel: vscode.WebviewPanel | undefined;
  private _currentItem: ProviderTreeItem | ModelTreeItem | undefined;
  private _currentProvider: Provider | undefined;
  private _lastVerifiedData: string | undefined;
  private _detectedSpeed: number | undefined;
  private _viewState: { mode: 'edit' | 'create'; type: 'provider' | 'model'; parentId?: string; prefillData?: any } = { mode: 'edit', type: 'provider' };

  constructor(private readonly _extensionUri: vscode.Uri, private readonly _manager: ProviderModelManager, private readonly _refreshTree: () => void) {}

  public openEditor(item: ProviderTreeItem | ModelTreeItem | undefined, mode: 'edit' | 'create', parentId?: string, prefillData?: any) {
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

      this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

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
                    body { padding: 20px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); max-width: 1200px; margin: 0 auto; }
                    .hidden { display: none; }
                    .container { display: flex; gap: 20px; }
                    .left-col { flex: 1; min-width: 300px; }
                    .right-col { flex: 1; min-width: 300px; border-left: 1px solid var(--vscode-widget-border); padding-left: 20px; }
                    
                    .form-group { margin-bottom: 15px; }
                    label { display: block; margin-bottom: 6px; font-weight: bold; font-size: 0.9em; }
                    input[type="text"], input[type="password"], select, textarea { 
                        width: 100%; 
                        padding: 6px; 
                        background: var(--vscode-input-background); 
                        color: var(--vscode-input-foreground); 
                        border: 1px solid var(--vscode-input-border); 
                        box-sizing: border-box;
                    }
                    textarea { min-height: 100px; font-family: var(--vscode-editor-font-family); }
                    input:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
                    button { 
                        background: var(--vscode-button-background); 
                        color: var(--vscode-button-foreground); 
                        border: none; 
                        padding: 8px 16px; 
                        cursor: pointer; 
                        width: auto;
                    }
                    button:hover { background: var(--vscode-button-hoverBackground); }
                    .checkbox-group { display: flex; align-items: center; gap: 8px; }
                    .checkbox-group label { margin: 0; font-weight: normal; }
                    .info-text { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-top: 4px; }
                    .button-row { display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end; }
                    .secondary-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
                    .secondary-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
                    
                    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 10px; }
                    h2 { margin: 0; }
                    h3 { margin-top: 0; margin-bottom: 10px; font-size: 1.1em; }
                    
                    .preview-box {
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-widget-border);
                        padding: 10px;
                        margin-bottom: 20px;
                        font-family: var(--vscode-editor-font-family);
                        font-size: 0.9em;
                        white-space: pre-wrap;
                        overflow-x: auto;
                        max-height: 800px;
                        overflow-y: auto;
                    }
                </style>
			</head>
			<body>
                <div id="content-container" class="hidden container">
                    <div class="left-col">
                        <div id="provider-form" class="hidden">
                            <div class="header"><h2>Provider Details</h2></div>
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
                            <div class="header"><h2>Model Details</h2></div>
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
                            
                            <div class="form-group">
                                <label>Request Additional Data (JSON)</label>
                                <textarea id="m-req-additional" placeholder='{"key": "value"}'></textarea>
                                <div class="info-text">Additional JSON properties to merge into the request body.</div>
                            </div>
                        </div>

                        <div class="button-row">
                            <button id="btn-verify" class="secondary-btn hidden">Verify & Detect</button>
                            <button id="btn-cancel" class="secondary-btn">Cancel</button>
                            <button id="btn-save">Save</button>
                        </div>
                    </div>
                    
                    <div class="right-col hidden" id="preview-col">
                        <h3>Request Preview</h3>
                        <div class="info-text" style="margin-bottom: 5px;">Simulated request body sent to provider:</div>
                        <div id="req-preview" class="preview-box"></div>
                    </div>
                </div>

				<script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    
                    const contentContainer = document.getElementById('content-container');
                    const providerForm = document.getElementById('provider-form');
                    const modelForm = document.getElementById('model-form');
                    const previewCol = document.getElementById('preview-col');

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
                    const mReqAdd = document.getElementById('m-req-additional');
                    
                    // Preview elements
                    const reqPreview = document.getElementById('req-preview');

                    // Buttons
                    const btnSave = document.getElementById('btn-save');
                    const btnCancel = document.getElementById('btn-cancel');
                    const btnVerify = document.getElementById('btn-verify');

                    // Mock data
                    const mockRequestBase = {
                        model: "model-id",
                        messages: [
                            { role: "system", content: "You are a helpful assistant." },
                            { role: "user", content: "Hello" }
                        ],
                        stream: true,
                        max_tokens: 1024
                    };

                    // Token formatter logic
                    function formatToken(val) {
                        if (!val) return '';
                        if (val >= 1024) return (val / 1024) + 'k';
                        return val.toString();
                    }
                    
                    function updatePreviews() {
                        // Request Preview
                        let req = { ...mockRequestBase };
                        req.model = mId.value || "model-id";
                        
                        // Handle Vision
                        if (mVision.checked) {
                            req.messages = [
                                { role: "system", content: "You are a helpful assistant." },
                                { 
                                    role: "user", 
                                    content: [
                                        { type: "text", text: "What is in this image?" },
                                        { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }
                                    ]
                                }
                            ];
                        } else {
                            req.messages = [
                                { role: "system", content: "You are a helpful assistant." },
                                { role: "user", content: "Hello" }
                            ];
                        }

                        // Handle Tools
                        if (mTools.checked) {
                            req.tools = [
                                {
                                    type: "function",
                                    function: {
                                        name: "get_weather",
                                        description: "Get current weather",
                                        parameters: {
                                            type: "object",
                                            properties: {
                                                location: { type: "string" }
                                            },
                                            required: ["location"]
                                        }
                                    }
                                }
                            ];
                            req.tool_choice = "auto";
                        }

                        try {
                            const additional = mReqAdd.value ? JSON.parse(mReqAdd.value) : {};
                            req = { ...req, ...additional };
                            reqPreview.textContent = JSON.stringify(req, null, 2);
                            reqPreview.style.color = 'var(--vscode-foreground)';
                        } catch (e) {
                            reqPreview.textContent = "Invalid JSON in Request Additional Data";
                            reqPreview.style.color = 'var(--vscode-errorForeground)';
                        }
                    }
                    
                    // Add listeners for live preview
                    mId.addEventListener('input', updatePreviews);
                    mReqAdd.addEventListener('input', updatePreviews);
                    mVision.addEventListener('change', updatePreviews);
                    mTools.addEventListener('change', updatePreviews);

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
                                updatePreviews();
                                break;
                        }
                    });

                    function updateContent(item, mode) {
                        if (!item) {
                            hide(contentContainer);
                            return;
                        }

                        show(contentContainer);

                        const isCreate = mode === 'create';

                        if (item.type === 'provider') {
                            show(providerForm);
                            hide(modelForm);
                            hide(btnVerify);
                            hide(previewCol);
                            
                            const data = item.data;
                            pName.value = data.name || '';
                            pType.value = data.providerType || 'generic';
                            pEndpoint.value = data.apiEndpoint || '';
                            
                            if (isCreate && data.apiKey) {
                                pApiKey.value = data.apiKey;
                            } else {
                                pApiKey.value = '';
                            }
                            pApiKey.placeholder = isCreate && !data.apiKey ? 'Required' : 'Leave empty to keep unchanged';
                            
                            pDesc.value = data.description || '';
                            pWeb.value = data.website || '';
                        } else if (item.type === 'model') {
                            show(modelForm);
                            hide(providerForm);
                            show(btnVerify);
                            show(previewCol);

                            const data = item.data;
                            mName.value = data.name || '';
                            mId.value = data.id || '';
                            mFamily.value = data.family || 'addi';
                            mVersion.value = data.version || '1.0.0';
                            mInput.value = formatToken(data.maxInputTokens);
                            mOutput.value = formatToken(data.maxOutputTokens);
                            
                            mVision.checked = !!(data.capabilities && data.capabilities.imageInput);
                            mTools.checked = !!(data.capabilities && (data.capabilities.toolCalling === true || typeof data.capabilities.toolCalling === 'number'));
                            
                            mReqAdd.value = data.requestAdditional || '';
                            
                            updatePreviews();
                        }
                    }

                    function show(el) { el.classList.remove('hidden'); }
                    function hide(el) { el.classList.add('hidden'); }

                    btnSave.addEventListener('click', () => {
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
                                    toolCalling: mTools.checked,
                                    requestAdditional: mReqAdd.value
                                }
                            });
                        }
                    });

                    btnCancel.addEventListener('click', () => {
                        vscode.postMessage({ type: 'cancel' });
                    });

                    btnVerify.addEventListener('click', () => {
                        vscode.postMessage({
                            type: 'verifyModel',
                            payload: {
                                id: mId.value
                            }
                        });
                    });
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
