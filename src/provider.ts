import * as vscode from "vscode";
import { Model, Provider } from "./types";
import { ModelTreeItem } from "./model";

export class ProviderModelManager {
  private static readonly STORAGE_KEY = "addi.providers";
  private syncEnabled = false;

  constructor(private context: vscode.ExtensionContext) {}

  setSettingsSync(enabled: boolean): void {
    if (this.syncEnabled === enabled) {
      return;
    }
    this.syncEnabled = enabled;
    if (enabled) {
      this.context.globalState.setKeysForSync([ProviderModelManager.STORAGE_KEY]);
    } else {
      this.context.globalState.setKeysForSync([]);
    }
  }

  getProviders(): Provider[] {
    const stored = this.context.globalState.get<Provider[]>(ProviderModelManager.STORAGE_KEY, []);
    let mutated = false;
    for (const p of stored) {
      if (!(p as any).providerType) {
        // infer from apiEndpoint
        const endpoint = (p.apiEndpoint || "").toLowerCase();
        if (endpoint.includes("openai.com")) {
          (p as any).providerType = "openai";
        } else if (endpoint.includes("anthropic.com")) {
          (p as any).providerType = "anthropic";
        } else if (endpoint.includes("googleapis.com")) {
          (p as any).providerType = "google";
        } else {
          (p as any).providerType = "generic";
        }
        mutated = true;
      }
    }
    if (mutated) {
      void this.saveProviders(stored); // fire-and-forget, no await in getter
    }
    return stored as Provider[];
  }

  async saveProviders(providers: Provider[]): Promise<void> {
    await this.context.globalState.update(ProviderModelManager.STORAGE_KEY, providers);
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
      return true;
    }
    return false;
  }

  async deleteProvider(id: string): Promise<boolean> {
    const providers = this.getProviders();
    const filtered = providers.filter((p) => p.id !== id);
    if (filtered.length !== providers.length) {
      await this.saveProviders(filtered);
      return true;
    }
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
        imageInput: modelData.imageInput ?? false,
        toolCalling: modelData.toolCalling ?? false,
      };
      providers[providerIndex]!.models.push(newModel);
      await this.saveProviders(providers);
      return newModel;
    }
    return null;
  }

  async updateModel(providerId: string, modelId: string, modelData: Partial<Model>): Promise<boolean> {
    const providers = this.getProviders();
    const providerIndex = providers.findIndex((p) => p.id === providerId);
    if (providerIndex >= 0) {
      const modelIndex = providers[providerIndex]!.models.findIndex((m) => m.id === modelId);
      if (modelIndex >= 0) {
        const existingModel = providers[providerIndex]!.models[modelIndex]!;
        providers[providerIndex]!.models[modelIndex] = {
          id: (modelData.id ?? existingModel.id) as string,
          name: modelData.name ?? existingModel.name,
          family: modelData.family ?? existingModel.family,
          version: modelData.version ?? existingModel.version,
          maxInputTokens: modelData.maxInputTokens ?? existingModel.maxInputTokens,
          maxOutputTokens: modelData.maxOutputTokens ?? existingModel.maxOutputTokens,
          imageInput: modelData.imageInput !== undefined ? modelData.imageInput : existingModel.imageInput !== undefined ? existingModel.imageInput : false,
          toolCalling: modelData.toolCalling !== undefined ? modelData.toolCalling : existingModel.toolCalling !== undefined ? existingModel.toolCalling : false,
        };
        await this.saveProviders(providers);
        return true;
      }
    }
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
    }

    return deleted;
  }

  findModel(modelId: string): { provider: Provider; model: Model } | null {
    const providers = this.getProviders();
    for (const provider of providers) {
      const model = provider.models.find((m) => m.id === modelId);
      if (model) {
        return { provider, model };
      }
    }
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
