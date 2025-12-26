import * as vscode from "vscode";
import { Model, Provider, ModelDraft } from "./types";
import { ConfigManager, IdGenerator, InputValidator } from "./utils";
import { ModelTreeItem } from "./model";
import { logger } from "./logger";

export class ProviderModelManager {
  // Key used to persist providers in globalState
  public static readonly STORAGE_KEY = "addi.providers";
  private readonly _onDidUpdate = new vscode.EventEmitter<void>();
  public readonly onDidUpdate = this._onDidUpdate.event;
  private syncEnabled = false;

  constructor(private context: vscode.ExtensionContext) {
    // No polling needed
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
    const mutated = this.normalizeProvidersInPlace(stored as Array<Provider & Record<string, unknown>>);
    if (mutated) {
      void this.context.globalState.update(ProviderModelManager.STORAGE_KEY, stored);
      logger.debug("Normalized provider data on load", { providerCount: stored.length });
    }
    logger.debug("Loaded providers", { providerCount: stored.length });
    return stored as Provider[];
  }

  async saveProviders(providers: Provider[]): Promise<void> {
    this.normalizeProvidersInPlace(providers as Array<Provider & Record<string, unknown>>);
    await this.context.globalState.update(ProviderModelManager.STORAGE_KEY, providers);
    
    this._onDidUpdate.fire();
    logger.info("Saved providers", { providerCount: providers.length });
  }

  private normalizeProvidersInPlace(providers: Array<Provider & Record<string, unknown>>): boolean {
    let mutated = false;

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
      }

      if (!Array.isArray(provider.models)) {
        logger.warn("Provider models array invalid, resetting", logger.sanitizeProvider(provider));
        provider.models = [];
        mutated = true;
        continue;
      }

      // Filter out invalid entries that may be present in persisted state
      provider.models = provider.models.filter((m) => m && typeof m === "object");

      provider.models = provider.models.map((model) => {
        const mutableModel = model as unknown as Record<string, unknown>;
        let changed = false;

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
        }

        const remoteIdRaw = typeof mutableModel["id"] === "string" ? mutableModel["id"].trim() : "";
        if (!remoteIdRaw) {
          mutableModel["id"] = mutableModel["sid"] as string;
          changed = true;
        } else if (remoteIdRaw !== mutableModel["id"]) {
          mutableModel["id"] = remoteIdRaw;
          changed = true;
        }

        if (!changed) {
          return model;
        }

        mutated = true;
        return mutableModel as unknown as Model;
      });
    }

    return mutated;
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

export class ProviderTreeItem extends vscode.TreeItem {
  constructor(public provider: Provider) {
    super(provider.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = provider.id;
    this.contextValue = "provider";

    if (provider.description) {
      this.description = provider.description;
    }

    let tooltip = `${provider.name} (${provider.models.length} models)`;
    if (provider.description) {
      tooltip += `\nDescription: ${provider.description}`;
    }
    if (provider.website) {
      tooltip += `\nWebsite: ${provider.website}`;
    }
    if (provider.apiEndpoint) {
      tooltip += `\nAPI Endpoint: ${provider.apiEndpoint}`;
    }
    if (provider.providerType) {
      tooltip += `\nType: ${provider.providerType}`;
    }
    this.tooltip = tooltip;
  }
}

export class AddiTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private manager: ProviderModelManager) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    const config = vscode.workspace.getConfiguration("addi");
    const sortRule = config.get<string>("sortRule", "none");
    const sortTarget = config.get<string>("sortTarget", "both");

    if (!element) {
      let providers = this.manager.getProviders();
      // Sort providers only if target includes providers
      if (sortRule !== "none" && (sortTarget === "providers" || sortTarget === "both")) {
        if (sortRule === "alphabet") {
          providers = [...providers].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
        } else if (sortRule === "input tokens") {
          providers = [...providers].sort((a, b) => {
            const maxA = Math.max(...a.models.map((m) => m.maxInputTokens || 0), 0);
            const maxB = Math.max(...b.models.map((m) => m.maxInputTokens || 0), 0);
            return maxB - maxA;
          });
        } else if (sortRule === "output tokens") {
          providers = [...providers].sort((a, b) => {
            const maxA = Math.max(...a.models.map((m) => m.maxOutputTokens || 0), 0);
            const maxB = Math.max(...b.models.map((m) => m.maxOutputTokens || 0), 0);
            return maxB - maxA;
          });
        }
      }
      return providers.map((p) => new ProviderTreeItem(p));
    }
    if (element instanceof ProviderTreeItem) {
      let models = [...element.provider.models];
      // Sort models only if target includes models
      if (sortRule !== "none" && (sortTarget === "models" || sortTarget === "both")) {
        models.sort((a, b) => {
          if (sortRule === "alphabet") {
            return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          }
          // Numeric sort for tokens (more to less)
          if (sortRule === "input tokens") {
            return (b.maxInputTokens || 0) - (a.maxInputTokens || 0);
          }
          if (sortRule === "output tokens") {
            return (b.maxOutputTokens || 0) - (a.maxOutputTokens || 0);
          }
          return 0;
        });
      }
      return models.map((m) => new ModelTreeItem(m));
    }
    return [];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}
