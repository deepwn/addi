import * as vscode from "vscode";
import { Model, Provider, ModelDraft } from "./types";
import { ConfigManager, IdGenerator, InputValidator } from "./utils";
import { logger } from "./logger";

export class ProviderModelManager {
  // Key used to persist providers in globalState
  public static readonly STORAGE_KEY = "addi.providers";
  private readonly _onDidUpdate = new vscode.EventEmitter<void>();
  public readonly onDidUpdate = this._onDidUpdate.event;
  private syncEnabled = false;
  private secretsCache: Map<string, string> = new Map();

  constructor(private context: vscode.ExtensionContext) {
    // Initialize secrets asynchronously
    this.initializeSecrets();
    
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
        // We don't fire update here to avoid loops if the update came from us, 
        // but strictly speaking we should if it came from outside.
        // Since we can't distinguish, and this is just a cache update, 
        // we can let the next getProviders() pick it up.
        // However, if the UI shows "Key Set", we might want to refresh.
        this._onDidUpdate.fire();
      }
    });
  }

  private async initializeSecrets() {
    try {
      const stored = this.context.globalState.get<Provider[]>(ProviderModelManager.STORAGE_KEY, []);
      let migrationNeeded = false;

      // Perform data migration/normalization once on startup
      const { mutated } = this.normalizeProvidersInPlace(stored as Array<Provider & Record<string, unknown>>);
      if (mutated) {
        migrationNeeded = true;
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
        await this.context.globalState.update(ProviderModelManager.STORAGE_KEY, cleaned);
        logger.info("Migrated API keys and normalized data on startup");
      }

      this._onDidUpdate.fire();
    } catch (error) {
      logger.error("Failed to initialize secrets", error);
    }
  }

  dispose() {
    // No cleanup needed
  }

  setSettingsSync(enabled: boolean): void {
    if (this.syncEnabled === enabled) {
      logger.debug("Settings sync already at requested state", { enabled });
      return;
    }
    this.syncEnabled = enabled;
    if (enabled) {
      this.context.globalState.setKeysForSync([ProviderModelManager.STORAGE_KEY]);
    } else {
      this.context.globalState.setKeysForSync([]);
    }
    logger.info("Settings sync preference updated", { enabled });
  }

  isSettingsSyncEnabled(): boolean {
    return this.syncEnabled ?? false;
  }

  refresh(): void {
    this._onDidUpdate.fire();
  }

  getProviders(): Provider[] {
    const stored = this.context.globalState.get<Provider[]>(ProviderModelManager.STORAGE_KEY, []);
    const { mutated, critical } = this.normalizeProvidersInPlace(stored as Array<Provider & Record<string, unknown>>);
    
    if (critical) {
      // Only save if critical changes (like missing IDs) occurred.
      // We avoid saving for cosmetic changes (defaults) to prevent race conditions with Settings Sync.
      void this.context.globalState.update(ProviderModelManager.STORAGE_KEY, stored);
      logger.debug("Persisted critical provider data normalization", { providerCount: stored.length });
    } else if (mutated) {
      logger.debug("Applied cosmetic provider data normalization (in-memory only)", { providerCount: stored.length });
    }

    // Attach secrets from cache
    for (const p of stored) {
      if (this.secretsCache.has(p.id)) {
        const secret = this.secretsCache.get(p.id);
        if (secret !== undefined) {
          p.apiKey = secret;
        }
      }
    }

    logger.debug("Loaded providers", { providerCount: stored.length });
    return stored as Provider[];
  }

  async saveProviders(providers: Provider[]): Promise<void> {
    this.normalizeProvidersInPlace(providers as Array<Provider & Record<string, unknown>>);

    // Handle secrets
    const providersToSave: Provider[] = [];

    // Detect deleted providers to clean up secrets
    const oldProviders = this.context.globalState.get<Provider[]>(ProviderModelManager.STORAGE_KEY, []);
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
        // If apiKey is undefined in the incoming object, should we keep the old one?
        // Usually saveProviders implies a full overwrite.
        // But if the UI didn't send the apiKey (e.g. for security), we might want to preserve it?
        // Assuming the UI sends the apiKey if it was modified or if it wants to keep it.
        // If the UI sends a provider *without* apiKey property, it might mean "unchanged" or "cleared"?
        // Given the context, let's assume we should preserve the existing secret if not provided?
        // No, that's dangerous. If user wants to clear it, they send empty string.
        // If they send undefined, it's ambiguous.
        // However, looking at `getProviders`, we attach the key. So the UI *should* have it.
        // So if it comes back as undefined, it might be lost.
        // But let's stick to: if it's in the object, update secret.
      }

      // Clone and remove apiKey
      const { apiKey, ...rest } = p;
      providersToSave.push(rest as Provider);
    }

    await this.context.globalState.update(ProviderModelManager.STORAGE_KEY, providersToSave);

    this._onDidUpdate.fire();
    logger.info("Saved providers", { providerCount: providers.length });
  }

  private normalizeProvidersInPlace(providers: Array<Provider & Record<string, unknown>>): { mutated: boolean; critical: boolean } {
    let mutated = false;
    let critical = false;

    for (const provider of providers) {
      if (!provider.providerType) {
        const endpoint = (provider.apiEndpoint || "").toLowerCase();
        if (endpoint.includes("openai.com")) {
          provider.providerType = "openai";
        } else if (endpoint.includes("anthropic.com")) {
          provider.providerType = "anthropic";
        } else if (endpoint.includes("googleapis.com")) {
          provider.providerType = "google";
        } else {
          provider.providerType = "generic";
        }
        mutated = true;
        // Provider type inference is useful to persist but not strictly critical for ID stability.
        // However, if we don't save it, we re-infer every time.
        // Let's consider it cosmetic-ish unless we want to lock it.
      }

      if (!Array.isArray(provider.models)) {
        logger.warn("Provider models array invalid, resetting", logger.sanitizeProvider(provider));
        provider.models = [];
        mutated = true;
        critical = true; // Data loss/reset is critical
        continue;
      }

      // Filter out invalid entries that may be present in persisted state
      const initialLength = provider.models.length;
      provider.models = provider.models.filter((m) => m && typeof m === "object");
      if (provider.models.length !== initialLength) {
        mutated = true;
        critical = true; // Deletion is critical
      }

      provider.models = provider.models.map((model) => {
        const mutableModel = model as unknown as Record<string, unknown>;
        let changed = false;
        let modelCritical = false;

        // Ensure token defaults exist for older or malformed saved models
        if (typeof mutableModel["maxInputTokens"] !== "number") {
          mutableModel["maxInputTokens"] = ConfigManager.getDefaultMaxInputTokens();
          changed = true;
        }
        if (typeof mutableModel["maxOutputTokens"] !== "number") {
          mutableModel["maxOutputTokens"] = ConfigManager.getDefaultMaxOutputTokens();
          changed = true;
        }
        if (!mutableModel["capabilities"] || typeof mutableModel["capabilities"] !== "object") {
          mutableModel["capabilities"] = {} as Record<string, unknown>;
          changed = true;
        }

        const capabilitiesRecord = mutableModel["capabilities"] as Record<string, unknown>;

        if (capabilitiesRecord["imageInput"] === undefined && typeof mutableModel["imageInput"] === "boolean") {
          (capabilitiesRecord as Record<string, unknown>)["imageInput"] = mutableModel["imageInput"];
          changed = true;
        }

        if (capabilitiesRecord["toolCalling"] === undefined && mutableModel["toolCalling"] !== undefined) {
          const legacyToolCalling = mutableModel["toolCalling"];
          (capabilitiesRecord as Record<string, unknown>)["toolCalling"] = typeof legacyToolCalling === "number" ? legacyToolCalling : Boolean(legacyToolCalling);
          changed = true;
        }

        if ("imageInput" in mutableModel) {
          delete mutableModel["imageInput"];
          changed = true;
        }

        if ("toolCalling" in mutableModel) {
          delete mutableModel["toolCalling"];
          changed = true;
        }

        if (mutableModel["tooltip"] !== undefined && typeof mutableModel["tooltip"] !== "string") {
          delete mutableModel["tooltip"];
          changed = true;
        }

        if (mutableModel["detail"] !== undefined && typeof mutableModel["detail"] !== "string") {
          delete mutableModel["detail"];
          changed = true;
        }

        // Ensure speed fields are preserved/initialized
        if (mutableModel["speedHistory"] !== undefined && !Array.isArray(mutableModel["speedHistory"])) {
          mutableModel["speedHistory"] = [];
          changed = true;
        }
        if (mutableModel["averageSpeed"] !== undefined && typeof mutableModel["averageSpeed"] !== "number") {
          delete mutableModel["averageSpeed"];
          changed = true;
        }

        const normalizedCapabilities = this.normalizeCapabilities(capabilitiesRecord as Model["capabilities"]);
        if (normalizedCapabilities.imageInput !== capabilitiesRecord["imageInput"] || normalizedCapabilities.toolCalling !== capabilitiesRecord["toolCalling"]) {
          changed = true;
        }
        mutableModel["capabilities"] = normalizedCapabilities;

        const sidCandidate = typeof mutableModel["sid"] === "string" ? mutableModel["sid"].trim() : "";
        if (!sidCandidate) {
          mutableModel["sid"] = IdGenerator.generate();
          changed = true;
          modelCritical = true; // Generating ID is critical
        }

        const remoteIdRaw = typeof mutableModel["id"] === "string" ? mutableModel["id"].trim() : "";
        if (!remoteIdRaw) {
          mutableModel["id"] = mutableModel["sid"] as string;
          changed = true;
          // If we inferred ID from SID, and SID was generated, it's critical.
          // If SID existed but ID was missing, it's also critical to lock it in.
          modelCritical = true; 
        } else if (remoteIdRaw !== mutableModel["id"]) {
          mutableModel["id"] = remoteIdRaw;
          changed = true;
        }

        if (!changed) {
          return model;
        }

        mutated = true;
        if (modelCritical) {
            critical = true;
        }
        return mutableModel as unknown as Model;
      });
    }

    return { mutated, critical };
  }

  private normalizeCapabilities(source?: Model["capabilities"], fallback?: Model["capabilities"]): Model["capabilities"] {
    const normalized: Model["capabilities"] = {};
    const base = fallback ?? {};
    const candidate = source ?? {};

    if (candidate.imageInput !== undefined || base.imageInput !== undefined) {
      normalized.imageInput = Boolean(candidate.imageInput ?? base.imageInput);
    }

    const toolSource = candidate.toolCalling ?? base.toolCalling;
    if (toolSource !== undefined) {
      normalized.toolCalling = typeof toolSource === "number" ? toolSource : Boolean(toolSource);
    }

    return normalized;
  }

  async addProvider(providerData: Omit<Provider, "id" | "models">): Promise<Provider> {
    if (InputValidator.validateName(providerData.name)) {
      throw new Error("Provider name is required");
    }

    const providers = this.getProviders();
    const newProvider: Provider = {
      ...providerData,
      id: IdGenerator.generate(),
      models: [],
    };
    // 确保 providerType 存在
    if (!newProvider.providerType) {
      newProvider.providerType = "generic";
    }

    if (newProvider.providerType === "generic" && (!newProvider.apiEndpoint || !newProvider.apiEndpoint.trim())) {
      throw new Error("API Endpoint is required for Generic provider");
    }

    providers.push(newProvider);
    await this.saveProviders(providers);
    logger.info("Provider added", logger.sanitizeProvider(newProvider));
    return newProvider;
  }

  async updateProvider(id: string, providerData: Partial<Omit<Provider, "id" | "models">>): Promise<boolean> {
    const providers = this.getProviders();
    const index = providers.findIndex((p) => p.id === id);
    if (index >= 0 && providers[index]) {
      const updatedProvider = {
        ...providers[index]!,
        ...providerData,
      };

      if (InputValidator.validateName(updatedProvider.name)) {
        throw new Error("Provider name cannot be empty");
      }

      if (!updatedProvider.providerType) {
        updatedProvider.providerType = "generic";
      }

      if (updatedProvider.providerType === "generic" && (!updatedProvider.apiEndpoint || !updatedProvider.apiEndpoint.trim())) {
        throw new Error("API Endpoint is required for Generic provider");
      }

      providers[index] = updatedProvider;
      await this.saveProviders(providers);
      logger.info("Provider updated", logger.sanitizeProvider(providers[index]!));
      return true;
    }
    logger.warn("Attempted to update missing provider", { providerId: id });
    return false;
  }

  async deleteProvider(id: string): Promise<boolean> {
    const providers = this.getProviders();
    const filtered = providers.filter((p) => p.id !== id);
    if (filtered.length !== providers.length) {
      await this.saveProviders(filtered);
      logger.info("Provider deleted", { providerId: id });
      return true;
    }
    logger.warn("Attempted to delete missing provider", { providerId: id });
    return false;
  }

  async addModel(providerId: string, modelData: ModelDraft): Promise<Model | null> {
    if (InputValidator.validateName(modelData.name)) {
      throw new Error("Model name is required");
    }

    const providers = this.getProviders();
    const providerIndex = providers.findIndex((p) => p.id === providerId);
    if (providerIndex >= 0) {
      const sid = modelData.sid?.trim() || IdGenerator.generate();
      
      if (!modelData.id || !modelData.id.trim()) {
        throw new Error("Model ID is required");
      }
      const remoteId = modelData.id.trim();

      const newModel: Model = {
        sid,
        id: remoteId,
        name: modelData.name,
        family: modelData.family,
        version: modelData.version,
        maxInputTokens: modelData.maxInputTokens,
        maxOutputTokens: modelData.maxOutputTokens,
        capabilities: this.normalizeCapabilities(modelData.capabilities),
        ...(modelData.requestAdditional ? { requestAdditional: modelData.requestAdditional } : {}),
      };
      providers[providerIndex]!.models.push(newModel);
      await this.saveProviders(providers);
      logger.info("Model added", {
        provider: logger.sanitizeProvider(providers[providerIndex]!),
        model: logger.sanitizeModel(newModel),
      });
      return newModel;
    }
    logger.warn("Attempted to add model to missing provider", { providerId });
    return null;
  }

  async updateModel(providerId: string, modelSid: string, modelData: Partial<ModelDraft>): Promise<boolean> {
    const providers = this.getProviders();
    const providerIndex = providers.findIndex((p) => p.id === providerId);
    if (providerIndex >= 0) {
      const modelIndex = providers[providerIndex]!.models.findIndex((m) => m.sid === modelSid);
      if (modelIndex >= 0) {
        const existingModel = providers[providerIndex]!.models[modelIndex]!;

        if (modelData.name !== undefined && InputValidator.validateName(modelData.name)) {
          throw new Error("Model name cannot be empty");
        }
        if (modelData.id !== undefined && (!modelData.id || !modelData.id.trim())) {
          throw new Error("Model ID cannot be empty");
        }

        const updatedModel: Model = {
          sid: existingModel.sid,
          id: (modelData.id ?? existingModel.id)?.trim() || existingModel.id,
          name: modelData.name ?? existingModel.name,
          family: modelData.family ?? existingModel.family,
          version: modelData.version ?? existingModel.version,
          maxInputTokens: modelData.maxInputTokens ?? existingModel.maxInputTokens,
          maxOutputTokens: modelData.maxOutputTokens ?? existingModel.maxOutputTokens,
          capabilities: this.normalizeCapabilities(modelData.capabilities, existingModel.capabilities),
          ...((modelData.requestAdditional ?? existingModel.requestAdditional) ? { requestAdditional: modelData.requestAdditional ?? existingModel.requestAdditional } : {}),
          ...((modelData.speedHistory ?? existingModel.speedHistory) ? { speedHistory: modelData.speedHistory ?? existingModel.speedHistory } : {}),
          ...((modelData.averageSpeed ?? existingModel.averageSpeed) !== undefined ? { averageSpeed: modelData.averageSpeed ?? existingModel.averageSpeed } : {}),
        };
        providers[providerIndex]!.models[modelIndex] = updatedModel;
        await this.saveProviders(providers);
        logger.info("Model updated", {
          provider: logger.sanitizeProvider(providers[providerIndex]!),
          model: logger.sanitizeModel(updatedModel),
        });
        return true;
      }
    }
    logger.warn("Attempted to update missing model", { providerId, modelSid });
    return false;
  }

  async updateModelSpeed(providerId: string, modelSid: string, speed: number): Promise<void> {
    logger.debug("updateModelSpeed called", { providerId, modelSid, speed });
    const providers = this.getProviders();
    const providerIndex = providers.findIndex((p) => p.id === providerId);
    if (providerIndex >= 0) {
      const modelIndex = providers[providerIndex]!.models.findIndex((m) => m.sid === modelSid);
      if (modelIndex >= 0) {
        const model = providers[providerIndex]!.models[modelIndex]!;
        const history = model.speedHistory ? [...model.speedHistory] : [];
        history.push(speed);
        if (history.length > 5) {
          history.shift();
        }
        const average = history.reduce((a, b) => a + b, 0) / history.length;

        providers[providerIndex]!.models[modelIndex] = {
          ...model,
          speedHistory: history,
          averageSpeed: average,
        };
        await this.saveProviders(providers);
        logger.debug("Model speed updated", { modelSid, speed, average });
      } else {
        logger.warn("Model not found for speed update", { modelSid });
      }
    } else {
      logger.warn("Provider not found for speed update", { providerId });
    }
  }

  async deleteModel(modelSid: string): Promise<boolean> {
    const providers = this.getProviders();
    let deleted = false;

    for (const provider of providers) {
      const initialLength = provider.models.length;
      provider.models = provider.models.filter((m) => m.sid !== modelSid);
      if (provider.models.length !== initialLength) {
        deleted = true;
        break;
      }
    }

    if (deleted) {
      await this.saveProviders(providers);
      logger.info("Model deleted", { modelSid });
    }

    return deleted;
  }

  findModel(modelSid: string): { provider: Provider; model: Model } | null {
    const providers = this.getProviders();
    for (const provider of providers) {
      const model = provider.models.find((m) => m.sid === modelSid);
      if (model) {
        logger.debug("Model lookup hit", {
          provider: logger.sanitizeProvider(provider),
          model: logger.sanitizeModel(model),
        });
        return { provider, model };
      }
    }
    logger.warn("Model lookup miss", { modelSid });
    return null;
  }
}

