import * as vscode from 'vscode';
import { Provider, ProviderConfig, ModelConfig, ModelStats, Model } from '../../common/types';
import { IStorageService } from '../../common/interfaces';
import { logger } from '../../common/logger';

export class StorageService implements IStorageService {
  private static readonly STORAGE_KEY = 'addi.providers';
  private static readonly STATS_STORAGE_KEY = 'addi.providers.stats';
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
      // Initially read as Provider[] to handle migration from old format
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
        // We will save using the new strict saveProviders method which handles types correctly
        await this.saveProviders(stored);
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
  private getExtendedData(): Map<string, Map<string, ModelStats>> {
    const stored = this.context.globalState.get<Record<string, Record<string, ModelStats>>>(
      StorageService.STATS_STORAGE_KEY,
      {}
    );
    const result = new Map<string, Map<string, ModelStats>>();

    for (const [providerId, models] of Object.entries(stored)) {
      const modelMap = new Map<string, ModelStats>();
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
    const extendData: Record<string, Record<string, ModelStats>> = {};

    for (const provider of providers) {
      const providerStats: Record<string, ModelStats> = {};

      for (const model of provider.models) {
        if (model.speedHistory || model.averageSpeed !== undefined) {
          const stats: ModelStats = {};
          if (model.speedHistory) {stats.speedHistory = model.speedHistory;}
          if (model.averageSpeed !== undefined) {stats.averageSpeed = model.averageSpeed;}
          
          if (Object.keys(stats).length > 0) {
            providerStats[model.sid] = stats;
          }
        }
      }

      if (Object.keys(providerStats).length > 0) {
        extendData[provider.id] = providerStats;
      }
    }

    await this.context.globalState.update(StorageService.STATS_STORAGE_KEY, extendData);
  }

  /**
   * Loads providers from storage.
   * Reconstitutes full Provider objects from Config (synced), Secrets (secure), and Stats (local).
   * @returns The list of providers with secrets and stats attached.
   */
  getProviders(): Provider[] {
    // Read persisted config (no stats, no secrets)
    const stored = this.context.globalState.get<ProviderConfig[]>(StorageService.STORAGE_KEY, []);
    const extendedData = this.getExtendedData();

    // Reassemble full Provider objects
    return stored.map(config => {
      const provider: Provider = {
        ...config,
        models: [] // Will be populated below
      };

      // 1. Attach API Secret
      if (this.secretsCache.has(config.id)) {
        const secret = this.secretsCache.get(config.id);
        if (secret !== undefined) {
          provider.apiKey = secret;
        }
      }

      // 2. Attach Model Stats
      const providerStats = extendedData.get(config.id);
      
      provider.models = config.models.map(modelConfig => {
        const model: Model = { ...modelConfig };
        
        if (providerStats) {
          const stats = providerStats.get(model.sid);
          if (stats) {
            if (stats.speedHistory) {model.speedHistory = stats.speedHistory;}
            if (stats.averageSpeed !== undefined) {model.averageSpeed = stats.averageSpeed;}
          }
        }
        return model;
      });

      return provider;
    });
  }

  /**
   * Saves providers to storage.
   * Splits data into:
   * 1. Config (Synced): Provider info, Model definitions
   * 2. Secrets (Secure): API Keys
   * 3. Stats (Local): Runtime statistics
   * @param providers The full provider objects to save.
   */
  async saveProviders(providers: Provider[]): Promise<void> {
    const configToSave: ProviderConfig[] = [];

    // Detect deleted providers to clean up secrets
    // Note: We use the raw globalState access here to get previous IDs cheaply
    const oldConfig = this.context.globalState.get<ProviderConfig[]>(StorageService.STORAGE_KEY, []);
    const newIds = new Set(providers.map((p) => p.id));

    // Load all existing secrets for preservation logic
    const existingSecrets = new Map<string, string | undefined>();
    for (const p of oldConfig) {
      if (!newIds.has(p.id)) {
         // Cleanup secrets for deleted providers
        const secretKey = `addi.provider.apikey.${p.id}`;
        await this.context.secrets.delete(secretKey);
        this.secretsCache.delete(p.id);
      } else {
         // Keep track of secrets for existing providers (in case we need to preserve them)
         const secret = await this.context.secrets.get(`addi.provider.apikey.${p.id}`);
         existingSecrets.set(p.id, secret);
      }
    }

    for (const p of providers) {
      const secretKey = `addi.provider.apikey.${p.id}`;

      // --- 1. Handle Secrets ---
      if (p.apiKey !== undefined && p.apiKey !== '') {
        // Store new API key
        await this.context.secrets.store(secretKey, p.apiKey);
        this.secretsCache.set(p.id, p.apiKey);
      } else if (p.apiKey === undefined) {
        // If apiKey is undefined (not empty string), try to preserve existing secret
        // This handles cases where UI sends partial updates or imports config without secrets
        let existingSecret: string | undefined;
        if (this.secretsCache.has(p.id)) {
          existingSecret = this.secretsCache.get(p.id);
        } else {
          existingSecret = existingSecrets.get(p.id);
        }

        if (existingSecret !== undefined) {
          this.secretsCache.set(p.id, existingSecret);
        }
      }
      // If p.apiKey === '', we treat it as "clear secret", so we do nothing here 
      // (and it will overwrite the old secret effectively if we don't preserve it? 
      // Actually secrets API doesn't have "update if exists", store overwrites.
      // So if apiKey is empty string, we might want to delete it? 
      // For now, let's assume empty string means "no change" in some contexts or "clear" in others.
      // The safest bet is: if provided and not empty -> store. If undefined -> preserve.
      
      // --- 2. Prepare Config (Strip Stats & Secrets) ---
      const { apiKey, models, ...restProvider } = p;
      
      const modelsConfig: ModelConfig[] = models.map((model) => {
        // Destructure to remove stats properties
        const { speedHistory, averageSpeed, ...staticConfig } = model;
        return staticConfig as ModelConfig;
      });

      configToSave.push({
        ...restProvider,
        models: modelsConfig
      });
    }

    // --- 3. Save Stats (Local) ---
    await this.saveExtendedData(providers);

    // --- 4. Save Config (Synced) ---
    await this.context.globalState.update(StorageService.STORAGE_KEY, configToSave);
    
    this._onDidUpdate.fire();
  }
}
