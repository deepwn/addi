import * as vscode from 'vscode';
import { Provider } from '../../common/types';
import { IStorageService } from '../../common/interfaces';
import { logger } from '../../common/logger';

export class StorageService implements IStorageService {
  private static readonly STORAGE_KEY = 'addi.providers';
  private static readonly EXTEND_STORAGE_KEY = 'addi.providers.extend';
  private secretsCache: Map<string, string> = new Map();
  private syncEnabled = false;
  private readonly _onDidUpdate = new vscode.EventEmitter<void>();
  public readonly onDidUpdate = this._onDidUpdate.event;

  constructor(private context: vscode.ExtensionContext) {
    // Listen for secret changes from other windows or background processes
    this.context.secrets.onDidChange(async (e) => {
      if (e.key.startsWith('addi.provider.apikey.')) {
        const providerId = e.key.replace('addi.provider.apikey.', '');
        const secret = await this.context.secrets.get(e.key);
        if (secret) {
          this.secretsCache.set(providerId, secret);
        } else {
          this.secretsCache.delete(providerId);
        }
        this._onDidUpdate.fire();
      }
    });
  }

  /**
   * Initializes the storage service.
   * Performs migration of API keys from globalState to SecretStorage.
   * @param normalizer A function to normalize provider data during initialization.
   */
  async initialize(normalizer?: (providers: Provider[]) => { mutated: boolean }) {
    try {
      const stored = this.context.globalState.get<Provider[]>(StorageService.STORAGE_KEY, []);
      let migrationNeeded = false;

      // Perform data migration/normalization once on startup
      if (normalizer) {
        const { mutated } = normalizer(stored);
        if (mutated) {
          migrationNeeded = true;
        }
      }

      for (const p of stored) {
        const secretKey = `addi.provider.apikey.${p.id}`;
        const secret = await this.context.secrets.get(secretKey);
        if (secret) {
          this.secretsCache.set(p.id, secret);
        } else if (p.apiKey) {
          // Migration: Found in globalState but not in secrets
          await this.context.secrets.store(secretKey, p.apiKey);
          this.secretsCache.set(p.id, p.apiKey);
          migrationNeeded = true;
        }
      }

      if (migrationNeeded) {
        // Remove apiKeys from globalState and save normalized data
        const cleaned = stored.map((p) => {
          const { apiKey, ...rest } = p;
          return rest as Provider;
        });
        await this.context.globalState.update(StorageService.STORAGE_KEY, cleaned);
        logger.info('Migrated API keys and normalized data on startup');
      }

      this._onDidUpdate.fire();
    } catch (error) {
      logger.error('Failed to initialize secrets', error);
    }
  }

  setSettingsSync(enabled: boolean): void {
    if (this.syncEnabled === enabled) {
      logger.debug('Settings sync already at requested state', { enabled });
      return;
    }
    this.syncEnabled = enabled;
    if (enabled) {
      this.context.globalState.setKeysForSync([StorageService.STORAGE_KEY]);
    } else {
      this.context.globalState.setKeysForSync([]);
    }
    logger.info('Settings sync preference updated', { enabled });
  }

  isSettingsSyncEnabled(): boolean {
    return this.syncEnabled ?? false;
  }

  /**
   * Loads extended data from storage.
   * Extended data includes auxiliary information like speedHistory, averageSpeed, etc.
   * This data is NOT synced to avoid frequent sync operations.
   * @returns A map of provider ID to model SID to extended data.
   */
  private getExtendedData(): Map<string, Map<string, { speedHistory?: number[]; averageSpeed?: number }>> {
    const stored = this.context.globalState.get<Record<string, Record<string, { speedHistory?: number[]; averageSpeed?: number }>>>(StorageService.EXTEND_STORAGE_KEY, {});
    const result = new Map<string, Map<string, { speedHistory?: number[]; averageSpeed?: number }>>();
    
    for (const [providerId, models] of Object.entries(stored)) {
      const modelMap = new Map<string, { speedHistory?: number[]; averageSpeed?: number }>();
      for (const [modelSid, extendData] of Object.entries(models)) {
        modelMap.set(modelSid, extendData);
      }
      result.set(providerId, modelMap);
    }
    
    return result;
  }

  /**
   * Saves extended data to storage.
   * Extended data includes auxiliary information like speedHistory, averageSpeed, etc.
   * This data is NOT synced to avoid frequent sync operations.
   * @param providers The providers to extract extended data from.
   */
  private async saveExtendedData(providers: Provider[]): Promise<void> {
    const extendData: Record<string, Record<string, { speedHistory?: number[]; averageSpeed?: number }>> = {};
    
    for (const provider of providers) {
      const providerExtendData: Record<string, { speedHistory?: number[]; averageSpeed?: number }> = {};
      
      for (const model of provider.models) {
        if (model.speedHistory || model.averageSpeed !== undefined) {
          const modelExtendData: { speedHistory?: number[]; averageSpeed?: number } = {};
          if (model.speedHistory) {
            modelExtendData.speedHistory = model.speedHistory;
          }
          if (model.averageSpeed !== undefined) {
            modelExtendData.averageSpeed = model.averageSpeed;
          }
          providerExtendData[model.sid] = modelExtendData;
        }
      }
      
      if (Object.keys(providerExtendData).length > 0) {
        extendData[provider.id] = providerExtendData;
      }
    }
    
    await this.context.globalState.update(StorageService.EXTEND_STORAGE_KEY, extendData);
  }

  /**
   * Loads providers from storage.
   * @returns The list of providers with secrets attached.
   */
  getProviders(): Provider[] {
    const stored = this.context.globalState.get<Provider[]>(StorageService.STORAGE_KEY, []);
    const extendedData = this.getExtendedData();

    // Attach secrets from cache and merge extended data
    for (const p of stored) {
      // Attach API key from secrets cache
      if (this.secretsCache.has(p.id)) {
        const secret = this.secretsCache.get(p.id);
        if (secret !== undefined) {
          p.apiKey = secret;
        }
      }
      
      // Merge extended data (speedHistory, averageSpeed) for each model
      const providerExtendData = extendedData.get(p.id);
      if (providerExtendData) {
        for (const model of p.models) {
          const modelExtendData = providerExtendData.get(model.sid);
          if (modelExtendData) {
            if (modelExtendData.speedHistory) {
              model.speedHistory = modelExtendData.speedHistory;
            }
            if (modelExtendData.averageSpeed !== undefined) {
              model.averageSpeed = modelExtendData.averageSpeed;
            }
          }
        }
      }
    }

    return stored as Provider[];
  }

  /**
   * Saves providers to storage.
   * Handles splitting API keys to SecretStorage and separating extended data.
   * Extended data (speedHistory, averageSpeed) is saved separately and NOT synced.
   * @param providers The providers to save.
   */
  async saveProviders(providers: Provider[]): Promise<void> {
    const providersToSave: Provider[] = [];

    // Detect deleted providers to clean up secrets
    const oldProviders = this.context.globalState.get<Provider[]>(StorageService.STORAGE_KEY, []);
    const newIds = new Set(providers.map((p) => p.id));

    // Load all existing secrets before processing to preserve them during import
    const existingSecrets = new Map<string, string | undefined>();
    for (const p of oldProviders) {
      const secretKey = `addi.provider.apikey.${p.id}`;
      const secret = await this.context.secrets.get(secretKey);
      existingSecrets.set(p.id, secret);
    }

    for (const oldP of oldProviders) {
      if (!newIds.has(oldP.id)) {
        const secretKey = `addi.provider.apikey.${oldP.id}`;
        await this.context.secrets.delete(secretKey);
        this.secretsCache.delete(oldP.id);
      }
    }

    for (const p of providers) {
      const secretKey = `addi.provider.apikey.${p.id}`;
      
      if (p.apiKey !== undefined) {
        // Store new API key (even if empty, to overwrite previous value)
        await this.context.secrets.store(secretKey, p.apiKey);
        this.secretsCache.set(p.id, p.apiKey);
      } else {
        // No apiKey provided - check if we should preserve existing secret
        let existingSecret: string | undefined;
        
        // First check secretsCache (for updates within the same session)
        if (this.secretsCache.has(p.id)) {
          existingSecret = this.secretsCache.get(p.id);
        } else {
          // Then check existingSecrets (for imports from unencrypted configs)
          existingSecret = existingSecrets.get(p.id);
        }
        
        if (existingSecret !== undefined) {
          // Preserve existing secret
          this.secretsCache.set(p.id, existingSecret);
        }
      }

      // Clone and remove apiKey AND extended data (speedHistory, averageSpeed)
      const { apiKey, ...restProvider } = p;
      // Remove extended data from the provider to save to STORAGE_KEY
      const modelsWithoutExtendedData = restProvider.models.map((model) => {
        const { speedHistory, averageSpeed, ...restModel } = model;
        return restModel as any; // TypeScript workaround for conditional typing
      });
      providersToSave.push({ ...restProvider, models: modelsWithoutExtendedData } as Provider);
    }

    // Save extended data separately (NOT synced)
    await this.saveExtendedData(providers);
    
    // Save main provider data (synced if enabled)
    await this.context.globalState.update(StorageService.STORAGE_KEY, providersToSave);
    this._onDidUpdate.fire();
  }
}
