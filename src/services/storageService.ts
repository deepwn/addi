import * as vscode from "vscode";
import { Provider } from "../types";
import { logger } from "../logger";

export class StorageService {
  private static readonly STORAGE_KEY = "addi.providers";
  private secretsCache: Map<string, string> = new Map();
  private syncEnabled = false;
  private readonly _onDidUpdate = new vscode.EventEmitter<void>();
  public readonly onDidUpdate = this._onDidUpdate.event;

  constructor(private context: vscode.ExtensionContext) {
    // Listen for secret changes from other windows or background processes
    this.context.secrets.onDidChange(async (e) => {
      if (e.key.startsWith("addi.provider.apikey.")) {
        const providerId = e.key.replace("addi.provider.apikey.", "");
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
        logger.info("Migrated API keys and normalized data on startup");
      }

      this._onDidUpdate.fire();
    } catch (error) {
      logger.error("Failed to initialize secrets", error);
    }
  }

  setSettingsSync(enabled: boolean): void {
    if (this.syncEnabled === enabled) {
      logger.debug("Settings sync already at requested state", { enabled });
      return;
    }
    this.syncEnabled = enabled;
    if (enabled) {
      this.context.globalState.setKeysForSync([StorageService.STORAGE_KEY]);
    } else {
      this.context.globalState.setKeysForSync([]);
    }
    logger.info("Settings sync preference updated", { enabled });
  }

  isSettingsSyncEnabled(): boolean {
    return this.syncEnabled ?? false;
  }

  /**
   * Loads providers from storage.
   * @returns The list of providers with secrets attached.
   */
  getProviders(): Provider[] {
    const stored = this.context.globalState.get<Provider[]>(StorageService.STORAGE_KEY, []);
    
    // Attach secrets from cache
    for (const p of stored) {
      if (this.secretsCache.has(p.id)) {
        const secret = this.secretsCache.get(p.id);
        if (secret !== undefined) {
          p.apiKey = secret;
        }
      }
    }

    return stored as Provider[];
  }

  /**
   * Saves providers to storage.
   * Handles splitting API keys to SecretStorage.
   * @param providers The providers to save.
   */
  async saveProviders(providers: Provider[]): Promise<void> {
    const providersToSave: Provider[] = [];

    // Detect deleted providers to clean up secrets
    const oldProviders = this.context.globalState.get<Provider[]>(StorageService.STORAGE_KEY, []);
    const newIds = new Set(providers.map((p) => p.id));

    for (const oldP of oldProviders) {
      if (!newIds.has(oldP.id)) {
        const secretKey = `addi.provider.apikey.${oldP.id}`;
        await this.context.secrets.delete(secretKey);
        this.secretsCache.delete(oldP.id);
      }
    }

    for (const p of providers) {
      if (p.apiKey !== undefined) {
        const secretKey = `addi.provider.apikey.${p.id}`;
        // Store even if empty, to overwrite previous value
        await this.context.secrets.store(secretKey, p.apiKey);
        this.secretsCache.set(p.id, p.apiKey);
      } else if (this.secretsCache.has(p.id)) {
        // Preserve existing secret if not provided in the update object
        // (This logic depends on how the update object is constructed. 
        // If the caller passes the full object from getProviders, it has the key.
        // If it passes a partial object without key, we might lose it if we don't handle it carefully.
        // But here we iterate over `providers` which are the *new* state.
        // If the new state doesn't have apiKey, it means it was cleared or not loaded?
        // In `ProviderModelManager.saveProviders`, we pass the full list.
        // And `getProviders` attaches the key. So the key should be there unless cleared.)
      }

      // Clone and remove apiKey
      const { apiKey, ...rest } = p;
      providersToSave.push(rest as Provider);
    }

    await this.context.globalState.update(StorageService.STORAGE_KEY, providersToSave);
    this._onDidUpdate.fire();
  }
}
