import * as vscode from 'vscode';
import type { ByokProvider, ByokModel } from '../../services/byokTypes';
import { ByokFileManager } from '../../services/byokFileManager';
import { logger, LogScope } from '../../common/logger';

/**
 * ProviderModelManager (BYOK Edition)
 *
 * Lightweight adapter between the BYOK file manager and the Addi tree view UI.
 * - Reads/writes chatLanguageModels.json via ByokFileManager
 * - Fires onDidUpdate events for tree view refresh
 * - No AI SDK, no custom storage, no backup system
 */
export class ProviderModelManager {
  private _onDidUpdate = new vscode.EventEmitter<void>();
  readonly onDidUpdate = this._onDidUpdate.event;

  constructor(private fileManager: ByokFileManager) {
    this.fileManager.onDidChange(() => this._onDidUpdate.fire());
  }

  /** Get all providers from the BYOK file */
  getProviders(): ByokProvider[] {
    return this.fileManager.getProviders();
  }

  /** Get a provider by name */
  getProvider(name: string): ByokProvider | undefined {
    return this.fileManager.getProvider(name);
  }

  /** Add a new provider */
  async addProvider(providerData: Omit<ByokProvider, 'models'> & { models?: ByokModel[] }): Promise<ByokProvider> {
    const newProvider: ByokProvider = {
      name: providerData.name,
      vendor: providerData.vendor || 'customendpoint',
      models: providerData.models || [],
    };
    if (providerData.apiKey !== undefined) newProvider.apiKey = providerData.apiKey;
    if (providerData.apiType !== undefined) newProvider.apiType = providerData.apiType;

    if (!newProvider.name?.trim()) {
      throw new Error('Provider name is required');
    }

    // Check for duplicate name
    const existing = this.fileManager.getProvider(newProvider.name);
    if (existing) {
      throw new Error(`Provider "${newProvider.name}" already exists`);
    }

    await this.fileManager.addProvider(newProvider);
    logger.info('Provider added', { name: newProvider.name, vendor: newProvider.vendor }, LogScope.PROVIDER_MGR);
    return newProvider;
  }

  /** Update an existing provider by name */
  async updateProvider(name: string, updates: Partial<ByokProvider>): Promise<boolean> {
    const result = await this.fileManager.updateProvider(name, updates);
    if (result) {
      logger.info('Provider updated', { name }, LogScope.PROVIDER_MGR);
    }
    return result;
  }

  /** Delete a provider by name */
  async deleteProvider(name: string): Promise<boolean> {
    const result = await this.fileManager.deleteProvider(name);
    if (result) {
      logger.info('Provider deleted', { name }, LogScope.PROVIDER_MGR);
    }
    return result;
  }

  /** Add a model to a provider */
  async addModel(providerName: string, model: ByokModel): Promise<boolean> {
    if (model.id === undefined && model.name !== undefined) {
      model.id = model.name;
    }
    if (!model.id?.trim()) {
      throw new Error('Model ID is required');
    }
    const result = await this.fileManager.addModel(providerName, model);
    if (result) {
      logger.info('Model added', { providerName, modelId: model.id }, LogScope.PROVIDER_MGR);
    }
    return result;
  }

  /** Update a model within a provider */
  async updateModel(providerName: string, modelId: string, updates: Partial<ByokModel>): Promise<boolean> {
    const result = await this.fileManager.updateModel(providerName, modelId, updates);
    if (result) {
      logger.info('Model updated', { providerName, modelId }, LogScope.PROVIDER_MGR);
    }
    return result;
  }

  /** Delete a model from a provider */
  async deleteModel(providerName: string, modelId: string): Promise<boolean> {
    return this.fileManager.deleteModel(providerName, modelId);
  }

  /** Delete multiple models from a provider */
  async deleteModels(providerName: string, modelIds: string[]): Promise<number> {
    return this.fileManager.deleteModels(providerName, modelIds);
  }

  /** Find which provider contains a given model ID */
  findModel(modelId: string): { provider: ByokProvider; model: ByokModel } | undefined {
    for (const provider of this.fileManager.getProviders()) {
      const model = provider.models?.find(m => m.id === modelId);
      if (model) {
        return { provider, model };
      }
    }
    return undefined;
  }

  /** Trigger a refresh event */
  refresh(): void {
    this._onDidUpdate.fire();
  }
}
