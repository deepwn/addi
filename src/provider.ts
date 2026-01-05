import * as vscode from "vscode";
import { Model, Provider, ModelDraft } from "./types";
import { ConfigManager, IdGenerator, InputValidator } from "./utils";
import { logger } from "./logger";
import { StorageService } from "./services/storageService";

export class ProviderModelManager {
  private storageService: StorageService;
  private _onDidUpdate = new vscode.EventEmitter<void>();
  public readonly onDidUpdate = this._onDidUpdate.event;

  constructor(context: vscode.ExtensionContext) {
    this.storageService = new StorageService(context);
    this.storageService.onDidUpdate(() => this._onDidUpdate.fire());

    // Initialize storage with normalization callback
    this.storageService.initialize((providers) => {
      const { mutated } = this.normalizeProvidersInPlace(providers as Array<Provider & Record<string, unknown>>);
      return { mutated };
    });
  }

  dispose() {
    // No cleanup needed
  }

  setSettingsSync(enabled: boolean): void {
    this.storageService.setSettingsSync(enabled);
  }

  isSettingsSyncEnabled(): boolean {
    return this.storageService.isSettingsSyncEnabled();
  }

  refresh(): void {
    this._onDidUpdate.fire();
  }

  getProviders(): Provider[] {
    const stored = this.storageService.getProviders();
    const { mutated, critical } = this.normalizeProvidersInPlace(stored as Array<Provider & Record<string, unknown>>);
    
    if (critical) {
      // Only save if critical changes (like missing IDs) occurred.
      void this.storageService.saveProviders(stored);
      logger.debug("Persisted critical provider data normalization", { providerCount: stored.length });
    } else if (mutated) {
      logger.debug("Applied cosmetic provider data normalization (in-memory only)", { providerCount: stored.length });
    }

    logger.debug("Loaded providers", { providerCount: stored.length });
    return stored;
  }

  async saveProviders(providers: Provider[]): Promise<void> {
    this.normalizeProvidersInPlace(providers as Array<Provider & Record<string, unknown>>);
    await this.storageService.saveProviders(providers);
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

