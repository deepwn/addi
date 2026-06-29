import * as vscode from 'vscode';
import type { ByokConfig, ByokProvider, ByokModel } from './byokTypes';

/**
 * ByokFileManager
 *
 * Manages reading and writing of VS Code's `chatLanguageModels.json` file.
 * The file is stored at `%APPDATA%/Code/User/chatLanguageModels.json` (user-level)
 * or `.vscode/chatLanguageModels.json` (workspace-level).
 *
 * Since Addi manages the **user-level** config (跨工作区生效),
 * we target the user-level file by default.
 */
export class ByokFileManager {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Fired when the file changes externally */
  readonly onDidChange = this._onDidChange.event;

  private _providers: ByokProvider[] = [];
  private _watcher: vscode.FileSystemWatcher | undefined;
  private _disposables: vscode.Disposable[] = [];
  private _fileUri: vscode.Uri;

  constructor() {
    // Target user-level chatLanguageModels.json
    this._fileUri = this._getUserFileUri();
    this._startWatching();
    // Load existing config immediately (fire-and-forget, tree refreshes when loaded)
    this._reload().then(() => this._onDidChange.fire());
  }

  private _getUserFileUri(): vscode.Uri {
    // Use VS Code's URI for the user config directory
    // %APPDATA%/Code/User/chatLanguageModels.json
    const userDir = vscode.Uri.joinPath(
      vscode.Uri.file(process.env['APPDATA'] || ''),
      'Code',
      'User'
    );
    return vscode.Uri.joinPath(userDir, 'chatLanguageModels.json');
  }

  private _startWatching(): void {
    // Watch the user config directory for changes
    const pattern = new vscode.RelativePattern(
      vscode.Uri.joinPath(this._fileUri, '..'),
      'chatLanguageModels.json'
    );
    this._watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this._disposables.push(
      this._watcher,
      this._watcher.onDidChange(() => {
        this._reload();
        this._onDidChange.fire();
      }),
      this._watcher.onDidCreate(() => {
        this._reload();
        this._onDidChange.fire();
      }),
      this._watcher.onDidDelete(() => {
        this._providers = [];
        this._onDidChange.fire();
      })
    );
  }

  private async _reload(): Promise<void> {
    try {
      const content = await vscode.workspace.fs.readFile(this._fileUri);
      const text = Buffer.from(content).toString('utf-8');
      this._providers = JSON.parse(text) as ByokConfig;
    } catch {
      // File doesn't exist or is invalid, use empty config
      this._providers = [];
    }
  }

  /**
   * Initialize: load providers from disk.
   * Should be called once at extension activation.
   */
  async initialize(): Promise<void> {
    await this._reload();
  }

  /**
   * Get all providers from the file.
   */
  getProviders(): ByokProvider[] {
    return [...this._providers];
  }

  /**
   * Get a provider by name.
   */
  getProvider(name: string): ByokProvider | undefined {
    return this._providers.find(p => p.name === name);
  }

  /**
   * Persist the current provider list to disk.
   */
  async save(): Promise<void> {
    const content = Buffer.from(
      JSON.stringify(this._providers, null, 2),
      'utf-8'
    );
    await vscode.workspace.fs.writeFile(this._fileUri, content);
  }

  /**
   * Add a new provider.
   */
  async addProvider(provider: ByokProvider): Promise<void> {
    this._providers.push(provider);
    await this.save();
  }

  /**
   * Update an existing provider by name.
   */
  async updateProvider(name: string, updates: Partial<ByokProvider>): Promise<boolean> {
    const idx = this._providers.findIndex(p => p.name === name);
    if (idx < 0) return false;
    this._providers[idx] = { ...this._providers[idx], ...updates } as ByokProvider;
    await this.save();
    return true;
  }

  /**
   * Delete a provider by name.
   */
  async deleteProvider(name: string): Promise<boolean> {
    const idx = this._providers.findIndex(p => p.name === name);
    if (idx < 0) return false;
    this._providers.splice(idx, 1);
    await this.save();
    return true;
  }

  /**
   * Add a model to a provider.
   */
  async addModel(providerName: string, model: ByokModel): Promise<boolean> {
    const provider = this._providers.find(p => p.name === providerName);
    if (!provider) return false;
    if (!provider.models) provider.models = [];
    provider.models.push(model);
    await this.save();
    return true;
  }

  /**
   * Update a model within a provider.
   */
  async updateModel(
    providerName: string,
    modelId: string,
    updates: Partial<ByokModel>
  ): Promise<boolean> {
    const provider = this._providers.find(p => p.name === providerName);
    if (!provider?.models) return false;
    const idx = provider.models.findIndex(m => m.id === modelId);
    if (idx < 0) return false;
    provider.models[idx] = { ...provider.models[idx], ...updates } as ByokModel;
    await this.save();
    return true;
  }

  /**
   * Delete a model from a provider.
   */
  async deleteModel(providerName: string, modelId: string): Promise<boolean> {
    const provider = this._providers.find(p => p.name === providerName);
    if (!provider?.models) return false;
    const len = provider.models.length;
    provider.models = provider.models.filter(m => m.id !== modelId);
    if (provider.models.length === len) return false;
    await this.save();
    return true;
  }

  /**
   * Delete multiple models from a provider by their IDs.
   */
  async deleteModels(providerName: string, modelIds: string[]): Promise<number> {
    const provider = this._providers.find(p => p.name === providerName);
    if (!provider?.models) return 0;
    const before = provider.models.length;
    provider.models = provider.models.filter(m => !modelIds.includes(m.id));
    const deleted = before - provider.models.length;
    if (deleted > 0) await this.save();
    return deleted;
  }

  /**
   * Get the file URI for the user-level chatLanguageModels.json.
   */
  getFileUri(): vscode.Uri {
    return this._fileUri;
  }

  /**
   * Dispose watchers.
   */
  dispose(): void {
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];
    this._onDidChange.dispose();
  }
}
