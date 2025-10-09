import * as vscode from "vscode";
import { Model, Provider } from "./types";
import { ConfigManager } from "./utils";
import { ModelTreeItem } from "./model";
import { logger } from "./logger";

export class ProviderModelManager {
  // Key used to persist providers in globalState and optionally sync via Settings Sync
  public static readonly STORAGE_KEY = "addi.providers";
  private syncEnabled = false;

  constructor(private context: vscode.ExtensionContext) {}

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
    return this.syncEnabled;
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
    logger.debug("Saved providers", { providerCount: providers.length });
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

        const normalizedCapabilities = this.normalizeCapabilities(capabilitiesRecord as Model["capabilities"]);
        if (normalizedCapabilities.imageInput !== capabilitiesRecord["imageInput"] || normalizedCapabilities.toolCalling !== capabilitiesRecord["toolCalling"]) {
          changed = true;
        }
        mutableModel["capabilities"] = normalizedCapabilities;

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
    const providers = this.getProviders();
    const newProvider: Provider = {
      ...providerData,
      id: Date.now().toString(),
      models: [],
    };
    // 确保 providerType 存在
    if (!newProvider.providerType) {
      newProvider.providerType = "generic";
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
      providers[index] = {
        ...providers[index]!,
        ...providerData,
      };
      if (!providers[index]!.providerType) {
        providers[index]!.providerType = "generic";
      }
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

  async addModel(providerId: string, modelData: Omit<Model, "id"> & { id?: string }): Promise<Model | null> {
    const providers = this.getProviders();
    const providerIndex = providers.findIndex((p) => p.id === providerId);
    if (providerIndex >= 0) {
      const newModel: Model = {
        id: modelData.id ?? Date.now().toString(),
        name: modelData.name,
        family: modelData.family,
        version: modelData.version,
        maxInputTokens: modelData.maxInputTokens,
        maxOutputTokens: modelData.maxOutputTokens,
        capabilities: this.normalizeCapabilities(modelData.capabilities),
      };
      if (modelData.tooltip !== undefined) {
        newModel.tooltip = modelData.tooltip;
      }
      if (modelData.detail !== undefined) {
        newModel.detail = modelData.detail;
      }
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

  async updateModel(providerId: string, modelId: string, modelData: Partial<Model>): Promise<boolean> {
    const providers = this.getProviders();
    const providerIndex = providers.findIndex((p) => p.id === providerId);
    if (providerIndex >= 0) {
      const modelIndex = providers[providerIndex]!.models.findIndex((m) => m.id === modelId);
      if (modelIndex >= 0) {
        const existingModel = providers[providerIndex]!.models[modelIndex]!;
        const updatedModel: Model = {
          id: (modelData.id ?? existingModel.id) as string,
          name: modelData.name ?? existingModel.name,
          family: modelData.family ?? existingModel.family,
          version: modelData.version ?? existingModel.version,
          maxInputTokens: modelData.maxInputTokens ?? existingModel.maxInputTokens,
          maxOutputTokens: modelData.maxOutputTokens ?? existingModel.maxOutputTokens,
          capabilities: this.normalizeCapabilities(modelData.capabilities, existingModel.capabilities),
        };
        const tooltip = modelData.tooltip !== undefined ? modelData.tooltip : existingModel.tooltip;
        if (tooltip !== undefined) {
          updatedModel.tooltip = tooltip;
        }
        const detail = modelData.detail !== undefined ? modelData.detail : existingModel.detail;
        if (detail !== undefined) {
          updatedModel.detail = detail;
        }
        providers[providerIndex]!.models[modelIndex] = updatedModel;
        await this.saveProviders(providers);
          logger.info("Model updated", {
            provider: logger.sanitizeProvider(providers[providerIndex]!),
            model: logger.sanitizeModel(updatedModel),
          });
        return true;
      }
    }
      logger.warn("Attempted to update missing model", { providerId, modelId });
    return false;
  }

  async deleteModel(modelId: string): Promise<boolean> {
    const providers = this.getProviders();
    let deleted = false;

    for (const provider of providers) {
      const initialLength = provider.models.length;
      provider.models = provider.models.filter((m) => m.id !== modelId);
      if (provider.models.length !== initialLength) {
        deleted = true;
        break;
      }
    }

    if (deleted) {
      await this.saveProviders(providers);
        logger.info("Model deleted", { modelId });
    }

    return deleted;
  }

  findModel(modelId: string): { provider: Provider; model: Model } | null {
    const providers = this.getProviders();
    for (const provider of providers) {
      const model = provider.models.find((m) => m.id === modelId);
      if (model) {
          logger.debug("Model lookup hit", {
            provider: logger.sanitizeProvider(provider),
            model: logger.sanitizeModel(model),
          });
        return { provider, model };
      }
    }
      logger.warn("Model lookup miss", { modelId });
    return null;
  }
}

export class ProviderTreeItem extends vscode.TreeItem {
  constructor(public provider: Provider) {
    super(provider.name, vscode.TreeItemCollapsibleState.Collapsed);
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
    if (!element) {
      const providers = this.manager.getProviders();
      return providers.map((p) => new ProviderTreeItem(p));
    }
    if (element instanceof ProviderTreeItem) {
      return element.provider.models.map((m) => new ModelTreeItem(m));
    }
    return [];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}
