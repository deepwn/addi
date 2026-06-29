import * as vscode from 'vscode';
import type { ByokProvider, ByokModel, ByokVendor, ByokApiType } from '../../services/byokTypes';
import { getProviderDefaults } from '../../services/byokTypes';
import type { ProviderModelManager } from '../../core/providers/ProviderModelManager';
import { ProviderTreeItem } from './providerView';
import { ModelTreeItem } from './treeItems';
import { logger, LogScope } from '../../common/logger';
import { resolveApiKey, storeApiKey } from '../commands/base';

// ---- Webview message types ----

interface WebviewMessage {
  type: string;
  payload?: unknown;
}

/** Data for provider editing sent to webview */
interface ProviderUpdateData {
  name: string;
  vendor: string;
  apiType?: string;
  apiKey?: string;
  /** Provider-level API URL (stored in _addi_defaults.url) */
  url?: string;
  /** Model list API endpoint (stored in _addi_defaults.listApi) */
  listApi?: string;
  models?: unknown[];
  defaultSettings?: Record<string, unknown>;
  settings?: Record<string, Record<string, unknown>>;
}

/** Data for model editing sent to webview */
interface ModelUpdateData {
  id: string;
  name?: string;
  url?: string;
  toolCalling?: boolean;
  vision?: boolean;
  thinking?: boolean;
  streaming?: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  editTools?: unknown;
  supportsReasoningEffort?: unknown;
  reasoningEffortFormat?: string;
  requestHeaders?: Record<string, string>;
  // Extra metadata
  providerDefaults?: Record<string, unknown>;
  remoteModels?: Array<{ id: string; name?: string }>;
  isBatchMode?: boolean;
  batchCount?: number;
  parentProviderName?: string;
}

type UpdateItemData = ProviderUpdateData | ModelUpdateData;

interface UpdateMessagePayload {
  type: 'update';
  locale: string;
  mode: 'edit' | 'create';
  item: {
    type: 'provider' | 'model';
    data: UpdateItemData;
    parentId?: string;
    isBatchMode?: boolean;
    batchCount?: number;
  };
}

// ---- Form payload types from webview ----

interface ProviderFormPayload {
  name: string;
  vendor: string;
  apiType?: string;
  apiKey?: string;
  /** Provider-level API URL */
  url?: string;
  /** Model list API endpoint */
  listApi?: string;
  defaultSettings?: Record<string, unknown>;
}

interface ModelFormPayload {
  id: string;
  name?: string;
  url?: string;
  toolCalling: boolean;
  vision: boolean;
  thinking: boolean;
  streaming: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  editTools?: unknown;
  supportsReasoningEffort?: unknown;
  reasoningEffortFormat?: string;
  requestHeaders?: Record<string, string>;
}

/**
 * EditorViewManager (BYOK Edition)
 *
 * Opens a webview panel for creating/editing providers and models.
 * Supports single-model editing and batch-model editing.
 * Provider forms include _addi_defaults settings, listApi, and quick-add presets.
 */
export class EditorViewManager {
  public static readonly viewType = 'addiEditor';
  private _panel: vscode.WebviewPanel | undefined;

  /** Current edit target — single item for provider/model, array for batch model edit */
  private _currentItem: ProviderTreeItem | ModelTreeItem | undefined;
  private _batchItems: ModelTreeItem[] | undefined;

  private _viewState: {
    mode: 'edit' | 'create';
    type: 'provider' | 'model';
    parentId?: string;
  } = { mode: 'edit', type: 'provider' };

  private _lastUpdateMessage: UpdateMessagePayload | undefined;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _manager: ProviderModelManager,
    private readonly _refreshTree: () => void,
    private readonly _context: vscode.ExtensionContext,
  ) {}

  // ==================== Public API ====================

  /**
   * Open the editor.
   * @param item Single tree item, array of items (batch), or undefined (create).
   * @param mode 'edit' or 'create'
   * @param parentId Provider name (for creating models)
   * @param prefill Optional prefill data for copy operations
   */
  public async openEditor(
    item: ProviderTreeItem | ModelTreeItem | ModelTreeItem[] | undefined,
    mode: 'edit' | 'create',
    parentId?: string,
    prefill?: Partial<ByokProvider> | Partial<ByokModel>,
  ): Promise<void> {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (this._panel) {
      this._panel.reveal(column);
    } else {
      this._panel = this._createPanel(column);
    }

    await this._updatePanelContent(item, mode, parentId, prefill);
  }

  // ==================== Panel lifecycle ====================

  private _createPanel(column?: vscode.ViewColumn): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      EditorViewManager.viewType,
      vscode.l10n.t('Addi Editor'),
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this._extensionUri],
      },
    );

    panel.onDidDispose(() => {
      this._panel = undefined;
      this._currentItem = undefined;
      this._batchItems = undefined;
    });

    void this._initPanelHtml(panel);

    return panel;
  }

  private async _initPanelHtml(panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.html = await this._getHtmlForWebview(panel.webview);

    panel.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
      logger.debug('Webview message received', data, LogScope.VIEW);
      switch (data['type']) {
        case 'saveProvider':
          await this._saveProvider(data['payload'] as ProviderFormPayload);
          break;
        case 'saveModel':
          await this._saveModel(data['payload'] as ModelFormPayload);
          break;
        case 'ready':
          if (this._lastUpdateMessage) {
            this._panel?.webview.postMessage(this._lastUpdateMessage);
          }
          break;
        case 'cancel':
          this._panel?.dispose();
          break;
        case 'showError': {
          const p = data['payload'] as { message?: string } | undefined;
          await vscode.window.showErrorMessage(
            p?.message || vscode.l10n.t('An error occurred'),
          );
          break;
        }
      }
    });
  }

  // ==================== Panel content update ====================

  private async _updatePanelContent(
    item: ProviderTreeItem | ModelTreeItem | ModelTreeItem[] | undefined,
    mode: 'edit' | 'create',
    parentId?: string,
    prefill?: Partial<ByokProvider> | Partial<ByokModel>,
  ): Promise<void> {
    // Normalize: single item vs batch
    const isBatch = Array.isArray(item);
    if (isBatch) {
      this._batchItems = item as ModelTreeItem[];
      this._currentItem = undefined;
    } else {
      this._currentItem = item as ProviderTreeItem | ModelTreeItem | undefined;
      this._batchItems = undefined;
    }

    // Determine type
    let type: 'provider' | 'model';
    if (isBatch) {
      type = 'model';
    } else if (item instanceof ProviderTreeItem) {
      type = 'provider';
    } else if (item instanceof ModelTreeItem) {
      type = 'model';
    } else if (mode === 'create' && parentId) {
      type = 'model';
    } else {
      type = 'provider';
    }

    this._viewState = parentId !== undefined ? { mode, type, parentId } : { mode, type };

    // ---- Build title ----
    const batchItems = this._batchItems;
    let title: string;
    if (isBatch && batchItems) {
      title = vscode.l10n.t('Edit {0} Models', String(batchItems.length));
    } else if (mode === 'create') {
      title = type === 'provider'
        ? vscode.l10n.t('Create Provider')
        : vscode.l10n.t('Create Model');
    } else if (item instanceof ProviderTreeItem) {
      title = vscode.l10n.t('Edit {0}', item.provider.name);
    } else if (item instanceof ModelTreeItem) {
      title = vscode.l10n.t('Edit {0}', item.model.name || item.model.id);
    } else {
      title = vscode.l10n.t('Addi Editor');
    }

    // ---- Build data payload ----
    const data = await this._buildUpdateData(item, mode, parentId, prefill, isBatch);

    // ---- Send update message ----
    if (this._panel) {
      this._panel.title = title;
      const itemPayload: UpdateMessagePayload['item'] = {
        type,
        data,
      };
      if (parentId !== undefined) itemPayload.parentId = parentId;
      if (isBatch) {
        itemPayload.isBatchMode = true;
        if (batchItems) itemPayload.batchCount = batchItems.length;
      }
      this._lastUpdateMessage = {
        type: 'update',
        locale: vscode.env.language,
        mode,
        item: itemPayload,
      };
      this._panel.webview.postMessage(this._lastUpdateMessage);
    }
  }

  /** Build the data object sent to the webview for rendering */
  private async _buildUpdateData(
    item: ProviderTreeItem | ModelTreeItem | ModelTreeItem[] | undefined,
    mode: 'edit' | 'create',
    parentId?: string,
    prefill?: Partial<ByokProvider> | Partial<ByokModel>,
    isBatch = false,
  ): Promise<UpdateItemData> {
    // ---- CREATE mode ----
    if (mode === 'create') {
      return this._buildCreateData(parentId, prefill);
    }

    // ---- Batch EDIT mode ----
    if (isBatch) {
      return this._buildBatchData(item as ModelTreeItem[]);
    }

    // ---- Single EDIT mode ----
    if (item instanceof ProviderTreeItem) {
      const data: ProviderUpdateData = {
        name: item.provider.name,
        vendor: item.provider.vendor,
      };
      if (item.provider.apiType !== undefined) data.apiType = item.provider.apiType;
      if (item.provider.apiKey !== undefined) data.apiKey = item.provider.apiKey;
      if (item.provider.models !== undefined) data.models = item.provider.models;
      if (item.provider.settings !== undefined) data.settings = item.provider.settings;
      const defaults = getProviderDefaults(item.provider);
      if (Object.keys(defaults).length > 0) {
        data.defaultSettings = defaults as Record<string, unknown>;
      }
      // Extract top-level fields from _addi_defaults
      if (defaults.url) data.url = defaults.url;
      if (defaults.listApi) data.listApi = defaults.listApi;
      return data;
    }

    if (item instanceof ModelTreeItem) {
      const data: ModelUpdateData = {
        id: item.model.id,
        toolCalling: item.model.toolCalling ?? true,
        vision: item.model.vision ?? false,
        thinking: item.model.thinking ?? false,
        streaming: item.model.streaming ?? true,
        parentProviderName: item.providerName,
      };
      if (item.model.name !== undefined) data.name = item.model.name;
      if (item.model.url !== undefined) data.url = item.model.url;
      if (item.model.maxInputTokens !== undefined) data.maxInputTokens = item.model.maxInputTokens;
      if (item.model.maxOutputTokens !== undefined) data.maxOutputTokens = item.model.maxOutputTokens;
      if (item.model.editTools !== undefined) data.editTools = item.model.editTools;
      if (item.model.supportsReasoningEffort !== undefined) data.supportsReasoningEffort = item.model.supportsReasoningEffort;
      if (item.model.reasoningEffortFormat !== undefined) data.reasoningEffortFormat = item.model.reasoningEffortFormat;
      if (item.model.requestHeaders !== undefined) data.requestHeaders = item.model.requestHeaders;
      return data;
    }

    // Fallback
    return { name: '', vendor: 'customendpoint' };
  }

  /** Build data for the create path */
  private async _buildCreateData(
    parentId?: string,
    prefill?: Partial<ByokProvider> | Partial<ByokModel>,
  ): Promise<UpdateItemData> {
    // Creating a MODEL
    if (parentId) {
      const data: ModelUpdateData = {
        id: '',
        name: '',
        toolCalling: true,
        maxInputTokens: 128000,
        maxOutputTokens: 64000,
      };

      // Apply prefill (e.g., from copy)
      if (prefill) {
        const p = prefill as Partial<ByokModel>;
        if (p.id !== undefined) data.id = p.id;
        if (p.name !== undefined) data.name = p.name;
        if (p.url !== undefined) data.url = p.url;
        if (p.toolCalling !== undefined) data.toolCalling = p.toolCalling;
        if (p.vision !== undefined) data.vision = p.vision;
        if (p.thinking !== undefined) data.thinking = p.thinking;
        if (p.maxInputTokens !== undefined) data.maxInputTokens = p.maxInputTokens;
        if (p.maxOutputTokens !== undefined) data.maxOutputTokens = p.maxOutputTokens;
      }

      // Apply provider _addi_defaults settings
      const parentProvider = this._manager.getProvider(parentId);
      if (parentProvider) {
        const defaults = getProviderDefaults(parentProvider);
        if (Object.keys(defaults).length > 0) {
          data.providerDefaults = defaults as Record<string, unknown>;
        }

        // Apply defaults on top of prefill (prefill takes priority)
        if (!prefill) {
          if (defaults.toolCalling !== undefined) data.toolCalling = defaults.toolCalling;
          if (defaults.vision !== undefined) data.vision = defaults.vision;
          if (defaults.thinking !== undefined) data.thinking = defaults.thinking;
          if (defaults.streaming !== undefined) data.streaming = defaults.streaming;
          if (defaults.maxInputTokens !== undefined) data.maxInputTokens = defaults.maxInputTokens;
          if (defaults.maxOutputTokens !== undefined) data.maxOutputTokens = defaults.maxOutputTokens;
          if (defaults.supportsReasoningEffort !== undefined) data.supportsReasoningEffort = defaults.supportsReasoningEffort;
          if (defaults.url !== undefined) data.url = defaults.url;
        }

        // Fetch remote models if listApi is configured
        if (defaults.listApi && parentProvider.apiKey) {
          try {
            const apiKey = await resolveApiKey(parentProvider.apiKey, parentProvider.name, this._context);
            if (apiKey) {
              const { fetchProviderModels } = await import('../../services/remoteModelFetcher.js');
              const remoteModels = await fetchProviderModels(parentProvider, apiKey);
              data.remoteModels = remoteModels.map(m => {
                const entry: { id: string; name?: string } = { id: m.id };
                if (m.name !== undefined) entry.name = m.name;
                return entry;
              });
            }
          } catch (err) {
            logger.warn('Failed to fetch remote models for editor', err, LogScope.VIEW);
          }
        }
      }

      return data;
    }

    // Creating a PROVIDER
    const data: ProviderUpdateData = {
      name: '',
      vendor: 'customendpoint',
      apiKey: '',
      url: '',
      listApi: '',
      defaultSettings: {},
    };

    if (prefill) {
      const p = prefill as Partial<ByokProvider>;
      if (p.name !== undefined) data.name = p.name;
      if (p.vendor !== undefined) data.vendor = p.vendor;
      if (p.apiType !== undefined) data.apiType = p.apiType;
      if (p.apiKey !== undefined) data.apiKey = p.apiKey;
    }

    return data;
  }

  /** Build data for batch model editing */
  private _buildBatchData(items: ModelTreeItem[]): ModelUpdateData {
    const first = items[0];
    if (!first) return { id: '', toolCalling: true, vision: false, thinking: false, streaming: true };

    const data: ModelUpdateData = {
      id: first.model.id,
      toolCalling: first.model.toolCalling ?? true,
      vision: first.model.vision ?? false,
      thinking: first.model.thinking ?? false,
      streaming: first.model.streaming ?? true,
      parentProviderName: first.providerName,
      isBatchMode: true,
      batchCount: items.length,
    };
    if (first.model.name !== undefined) data.name = first.model.name;
    if (first.model.url !== undefined) data.url = first.model.url;
    if (first.model.maxInputTokens !== undefined) data.maxInputTokens = first.model.maxInputTokens;
    if (first.model.maxOutputTokens !== undefined) data.maxOutputTokens = first.model.maxOutputTokens;
    if (first.model.editTools !== undefined) data.editTools = first.model.editTools;
    if (first.model.supportsReasoningEffort !== undefined) data.supportsReasoningEffort = first.model.supportsReasoningEffort;
    if (first.model.reasoningEffortFormat !== undefined) data.reasoningEffortFormat = first.model.reasoningEffortFormat;
    if (first.model.requestHeaders !== undefined) data.requestHeaders = first.model.requestHeaders;
    return data;
  }

  // ==================== Save handlers ====================

  private async _saveProvider(data: ProviderFormPayload): Promise<void> {
    if (this._viewState.mode === 'create') {
      // Build provider — only set optional fields when they have values
      const providerData: ByokProvider = {
        name: data.name,
        vendor: (data.vendor || 'customendpoint') as ByokVendor,
        models: [],
      };
      if (data.apiKey) {
        // Encrypt: store in extension secrets, write ${input:} reference to file
        providerData.apiKey = await storeApiKey(data.apiKey, data.name, this._context);
      }
      if (data.apiType) providerData.apiType = data.apiType as ByokApiType;

      // Merge url, listApi, and defaultSettings into _addi_defaults
      const defaults: Record<string, unknown> = { ...(data.defaultSettings || {}) };
      if (data.url) defaults['url'] = data.url;
      if (data.listApi) defaults['listApi'] = data.listApi;
      if (Object.keys(defaults).length > 0) {
        providerData._addi_defaults = defaults;
      }

      if (!providerData.name.trim()) {
        vscode.window.showErrorMessage(vscode.l10n.t('Provider name is required'));
        return;
      }

      try {
        await this._manager.addProvider(providerData);
        vscode.window.showInformationMessage(vscode.l10n.t('Provider "{0}" added.', data.name));
        this._refreshTree();
        this._panel?.dispose();
      } catch (e: unknown) {
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    // ---- Edit mode ----
    if (!this._currentItem || !(this._currentItem instanceof ProviderTreeItem)) return;
    const provider = this._currentItem.provider;

    const updates: Partial<ByokProvider> = {};
    if (data.name !== provider.name) updates.name = data.name;
    if (data.vendor !== provider.vendor) updates.vendor = data.vendor as ByokVendor;
    if (data.apiType !== provider.apiType && data.apiType !== undefined) {
      updates.apiType = data.apiType as ByokApiType;
    }
    if (data.apiKey !== provider.apiKey) {
      if (data.apiKey) {
        // Encrypt new key: store in extension secrets, write ${input:} reference
        updates.apiKey = await storeApiKey(data.apiKey, data.name, this._context);
      }
    }

    // Handle _addi_defaults changes — merge url, listApi + defaultSettings
    const oldDefaults = getProviderDefaults(provider);
    const newDefaults: Record<string, unknown> = { ...(data.defaultSettings || {}) };
    if (data.url !== undefined) newDefaults['url'] = data.url || undefined;
    if (data.listApi !== undefined) newDefaults['listApi'] = data.listApi || undefined;

    // Clean undefined/empty values
    for (const k of Object.keys(newDefaults)) {
      if (newDefaults[k] === undefined || newDefaults[k] === '') {
        delete newDefaults[k];
      }
    }
    const oldKeys = Object.keys(oldDefaults);
    const newKeys = Object.keys(newDefaults);
    const defaultsChanged =
      oldKeys.length !== newKeys.length ||
      oldKeys.some(k => newDefaults[k] !== (oldDefaults as Record<string, unknown>)[k]);

    if (defaultsChanged) {
      updates._addi_defaults = newKeys.length > 0 ? newDefaults : undefined;
    }

    if (Object.keys(updates).length === 0) {
      this._panel?.dispose();
      return;
    }

    const success = await this._manager.updateProvider(provider.name, updates);
    if (success) {
      vscode.window.showInformationMessage(vscode.l10n.t('Provider "{0}" updated.', data.name));
      this._refreshTree();
      this._panel?.dispose();
    }
  }

  private async _saveModel(data: ModelFormPayload): Promise<void> {
    if (this._viewState.mode === 'create') {
      if (!this._viewState.parentId) {
        vscode.window.showErrorMessage(vscode.l10n.t('No parent provider specified.'));
        return;
      }

      // Build model — only set optional fields when they have values
      const model: ByokModel = {
        id: data.id || data.name || '',
        toolCalling: data.toolCalling !== false,
        vision: Boolean(data.vision),
        thinking: Boolean(data.thinking),
        streaming: data.streaming !== false,
      };
      if (data.name) model.name = data.name;
      if (data.url) model.url = data.url;
      if (data.maxInputTokens !== undefined && data.maxInputTokens > 0) model.maxInputTokens = data.maxInputTokens;
      if (data.maxOutputTokens !== undefined && data.maxOutputTokens > 0) model.maxOutputTokens = data.maxOutputTokens;
      if (data.editTools !== undefined) model.editTools = data.editTools as boolean | string[];
      if (data.supportsReasoningEffort !== undefined) model.supportsReasoningEffort = data.supportsReasoningEffort as 'low' | 'medium' | 'high' | ('low' | 'medium' | 'high')[];
      if (data.reasoningEffortFormat) model.reasoningEffortFormat = data.reasoningEffortFormat as 'api-token' | 'api-header-proxy' | 'api-key';
      if (data.requestHeaders) model.requestHeaders = data.requestHeaders;

      if (!model.id.trim()) {
        vscode.window.showErrorMessage(vscode.l10n.t('Model ID is required'));
        return;
      }

      try {
        await this._manager.addModel(this._viewState.parentId, model);
        vscode.window.showInformationMessage(vscode.l10n.t('Model "{0}" added.', model.name || model.id));
        this._refreshTree();
        this._panel?.dispose();
      } catch (e: unknown) {
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    // ---- Edit mode (single) ----
    if (!this._currentItem || !(this._currentItem instanceof ModelTreeItem)) return;
    const model = this._currentItem.model;
    const providerName = this._currentItem.providerName;

    const updates: Partial<ByokModel> = {};
    if (data.name !== model.name && data.name !== undefined) updates.name = data.name;
    if (data.url !== model.url) {
      if (data.url) updates.url = data.url;
    }
    if (data.toolCalling !== model.toolCalling) updates.toolCalling = data.toolCalling;
    if (data.vision !== model.vision) updates.vision = data.vision;
    if (data.thinking !== model.thinking) updates.thinking = data.thinking;
    if (data.maxInputTokens !== model.maxInputTokens) {
      if (data.maxInputTokens !== undefined && data.maxInputTokens > 0) updates.maxInputTokens = data.maxInputTokens;
    }
    if (data.maxOutputTokens !== model.maxOutputTokens) {
      if (data.maxOutputTokens !== undefined && data.maxOutputTokens > 0) updates.maxOutputTokens = data.maxOutputTokens;
    }
    if (data.editTools !== model.editTools) {
      if (data.editTools !== undefined) updates.editTools = data.editTools as boolean | string[];
    }
    if (data.supportsReasoningEffort !== model.supportsReasoningEffort) {
      if (data.supportsReasoningEffort !== undefined) updates.supportsReasoningEffort = data.supportsReasoningEffort as 'low' | 'medium' | 'high' | ('low' | 'medium' | 'high')[];
    }
    if (data.reasoningEffortFormat !== model.reasoningEffortFormat) {
      if (data.reasoningEffortFormat !== undefined) updates.reasoningEffortFormat = data.reasoningEffortFormat as 'api-token' | 'api-header-proxy' | 'api-key';
    }
    if (data.requestHeaders !== model.requestHeaders) {
      if (data.requestHeaders) updates.requestHeaders = data.requestHeaders;
    }

    if (Object.keys(updates).length === 0) {
      this._panel?.dispose();
      return;
    }

    const success = await this._manager.updateModel(providerName, model.id, updates);
    if (success) {
      vscode.window.showInformationMessage(vscode.l10n.t('Model "{0}" updated.', data.name || model.id));
      this._refreshTree();
      this._panel?.dispose();
    }
  }

  // ==================== Helpers ====================

  private async _getHtmlForWebview(webview: vscode.Webview): Promise<string> {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'assets', 'index.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'assets', 'index.css'),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Addi Editor</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
