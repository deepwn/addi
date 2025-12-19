import * as vscode from "vscode";
import * as crypto from "crypto";
import { ProviderModelManager, ProviderTreeItem, AddiTreeDataProvider } from "./provider";
import { ModelTreeItem } from "./model";
import { ConfigManager, IdGenerator, UserFeedback } from "./utils";
import { ModelDraft, Provider, Model } from "./types";
import { logger } from "./logger";
// playground logic moved to src/playground.ts
import PlaygroundManager from "./playground";

import { DetailsViewProvider } from "./detailsView";

interface RemoteModelInfo {
  id: string;
  name?: string;
  description?: string;
  family?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  capabilities?: Model["capabilities"];
}

type ModelSyncResult = {
  added: number;
  updated: number;
  totalRemote: number;
  mutated: boolean;
};

export class CommandHandler {
  private static readonly TOKEN_LIMIT = 1024 * 1024 * 4;
  private detailsViewProvider?: DetailsViewProvider;

  constructor(private readonly manager: ProviderModelManager, private readonly treeDataProvider: AddiTreeDataProvider, private readonly context?: vscode.ExtensionContext) {
    logger.debug("CommandHandler initialized", {
      hasContext: Boolean(context),
    });
  }

  public setDetailsViewProvider(provider: DetailsViewProvider) {
    this.detailsViewProvider = provider;
  }



  // Endpoint pattern helpers removed: providerType 现在由用户显式选择，不再通过 endpoint 推断。

  private normalizeBaseUrl(endpoint: string | undefined, fallback: string): string {
    const base = (endpoint && endpoint.trim()) || fallback;
    return base.replace(/\/+$/, "");
  }

  private buildUrl(base: string, path: string): string {
    const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  private resolveModelsUrl(endpoint: string, fallback: string): string {
    const baseUrl = this.normalizeBaseUrl(endpoint, fallback);
    const [baseWithoutQueryRaw, queryString] = baseUrl.split("?", 2);
    const baseWithoutQuery = baseWithoutQueryRaw || baseUrl;

    let path = baseWithoutQuery.replace(/\/(?:chat\/)?completions$/i, "");

    // Azure OpenAI style endpoints include deployment segment; models live under /openai.
    if (/\/openai\/deployments\//i.test(path)) {
      path = path.replace(/\/openai\/deployments\/[^/]+$/i, "/openai");
    }

    const modelsUrl = this.buildUrl(path, "/models");
    return queryString ? `${modelsUrl}?${queryString}` : modelsUrl;
  }



  private async readResponseError(response: Response): Promise<string> {
    const statusInfo = `${response.status} ${response.statusText}`;
    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      return statusInfo;
    }

    if (!body) {
      return statusInfo;
    }

    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.error === "string") {
        return `${statusInfo} - ${parsed.error}`;
      }
      if (parsed?.error?.message) {
        return `${statusInfo} - ${parsed.error.message}`;
      }
      return `${statusInfo} - ${body}`;
    } catch {
      return `${statusInfo} - ${body}`;
    }
  }



  private coercePositiveInteger(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.min(Math.floor(value), CommandHandler.TOKEN_LIMIT);
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(Math.floor(parsed), CommandHandler.TOKEN_LIMIT);
      }
    }
    return undefined;
  }





  private async fetchProviderModelsFromApi(provider: Provider): Promise<RemoteModelInfo[]> {
    const endpoint = provider.apiEndpoint?.trim();
    const apiKey = provider.apiKey?.trim();

    if (!endpoint) {
      throw new Error("Provider API endpoint is not configured");
    }

    if (!apiKey) {
      throw new Error("Provider API key is not configured");
    }

    const providerType = provider.providerType ?? "generic";
    logger.debug("fetchProviderModelsFromApi invoked", {
      provider: logger.sanitizeProvider(provider),
      providerType,
    });

    switch (providerType) {
      case "openai":
      case "generic": {
        const url = this.resolveModelsUrl(endpoint, "https://api.openai.com/v1");
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (!response.ok) {
          throw new Error(await this.readResponseError(response));
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const entries = Array.isArray(payload["data"]) ? payload["data"] : [];
        const models: RemoteModelInfo[] = [];

        for (const entry of entries) {
          if (!entry || typeof entry !== "object") {
            continue;
          }
          const record = entry as Record<string, unknown>;
          const id = typeof record["id"] === "string" ? record["id"] : undefined;
          if (!id) {
            continue;
          }
          const displayName = typeof record["display_name"] === "string" ? record["display_name"] : undefined;
          const ownedBy = typeof record["owned_by"] === "string" ? record["owned_by"] : undefined;
          const description = typeof record["description"] === "string" ? record["description"] : ownedBy ? `Owner: ${ownedBy}` : undefined;
          const info: RemoteModelInfo = {
            id,
            name: displayName ?? id,
          };
          if (description) {
            info.description = description;
          }
          if (ownedBy && ownedBy.trim()) {
            info.family = ownedBy.trim();
          }
          models.push(info);
        }

        logger.debug("Fetched OpenAI-compatible model list", {
          provider: logger.sanitizeProvider(provider),
          remoteCount: models.length,
        });
        return models;
      }
      case "anthropic": {
        const baseUrl = this.normalizeBaseUrl(endpoint, "https://api.anthropic.com");
        const url = this.buildUrl(baseUrl, "/v1/models");
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        });

        if (!response.ok) {
          throw new Error(await this.readResponseError(response));
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const listSource = Array.isArray(payload["models"]) ? payload["models"] : Array.isArray(payload["data"]) ? payload["data"] : [];
        const models: RemoteModelInfo[] = [];

        for (const entry of listSource) {
          if (!entry || typeof entry !== "object") {
            continue;
          }
          const record = entry as Record<string, unknown>;
          const id = typeof record["id"] === "string" ? record["id"] : typeof record["name"] === "string" ? record["name"] : undefined;
          if (!id) {
            continue;
          }
          const displayName = typeof record["display_name"] === "string" ? record["display_name"] : undefined;
          const description = typeof record["description"] === "string" ? record["description"] : undefined;
          const maxInputTokens = this.coercePositiveInteger(record["input_token_limit"] ?? record["context_length"] ?? record["context_limit"]);
          const maxOutputTokens = this.coercePositiveInteger(record["output_token_limit"] ?? record["max_output_tokens"]);

          const info: RemoteModelInfo = {
            id,
            name: displayName ?? id,
          };
          if (description) {
            info.description = description;
          }
          if (maxInputTokens !== undefined) {
            info.maxInputTokens = maxInputTokens;
          }
          if (maxOutputTokens !== undefined) {
            info.maxOutputTokens = maxOutputTokens;
          }
          models.push(info);
        }

        logger.debug("Fetched Anthropic model list", {
          provider: logger.sanitizeProvider(provider),
          remoteCount: models.length,
        });
        return models;
      }
      case "google": {
        const baseUrl = this.normalizeBaseUrl(endpoint, "https://generativelanguage.googleapis.com/v1beta");
        const url = `${this.buildUrl(baseUrl, "/models")}?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, {
          method: "GET",
        });

        if (!response.ok) {
          throw new Error(await this.readResponseError(response));
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const entries = Array.isArray(payload["models"]) ? payload["models"] : [];
        const models: RemoteModelInfo[] = [];

        for (const entry of entries) {
          if (!entry || typeof entry !== "object") {
            continue;
          }
          const record = entry as Record<string, unknown>;
          const name = typeof record["name"] === "string" ? record["name"] : undefined;
          if (!name) {
            continue;
          }
          const displayName = typeof record["displayName"] === "string" ? record["displayName"] : undefined;
          const description = typeof record["description"] === "string" ? record["description"] : undefined;
          const maxInputTokens = this.coercePositiveInteger(record["inputTokenLimit"]);
          const maxOutputTokens = this.coercePositiveInteger(record["outputTokenLimit"]);

          let capabilities: Model["capabilities"] | undefined;
          const modalitiesSource = (record["inputModalities"] ??
            record["supportedInputModalities"] ??
            record["allowedInputModalities"] ??
            record["supportedModalities"]) as unknown;
          if (Array.isArray(modalitiesSource)) {
            const hasImage = modalitiesSource.some((value) => typeof value === "string" && value.toUpperCase().includes("IMAGE"));
            if (hasImage) {
              capabilities = { imageInput: true };
            }
          }

          const info: RemoteModelInfo = {
            id: name,
            name: displayName ?? name,
          };
          if (description) {
            info.description = description;
          }
          if (maxInputTokens !== undefined) {
            info.maxInputTokens = maxInputTokens;
          }
          if (maxOutputTokens !== undefined) {
            info.maxOutputTokens = maxOutputTokens;
          }
          if (capabilities) {
            info.capabilities = capabilities;
          }
          models.push(info);
        }

        logger.debug("Fetched Google model list", {
          provider: logger.sanitizeProvider(provider),
          remoteCount: models.length,
        });
        return models;
      }
      default:
        logger.warn("fetchProviderModelsFromApi unsupported provider type", {
          provider: logger.sanitizeProvider(provider),
          providerType,
        });
        return [];
    }
  }

  // playground logic moved to PlaygroundManager

  async openPlayground(provider: Provider, model: Model | (ModelDraft & { id?: string; name?: string })): Promise<void> {
    logger.info("Command openPlayground invoked", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model as Model),
    });
    if (!this.context) {
      logger.error("openPlayground missing extension context");
      throw new Error("No extension context");
    }
    const mgr = new PlaygroundManager(this.context);
    // ensure model has the shape of Model
    const realModel = model as Model;
    await mgr.openPlayground(provider, realModel);
  }

  async addProvider(): Promise<void> {
    logger.info("Command addProvider invoked");
    if (this.detailsViewProvider) {
      this.detailsViewProvider.showAddProvider();
    } else {
      UserFeedback.showError("Details view provider not initialized");
    }
  }

  async editProvider(item: ProviderTreeItem): Promise<void> {
    logger.info("Command editProvider invoked", logger.sanitizeProvider(item.provider));
    if (this.detailsViewProvider) {
      this.detailsViewProvider.update(item);
      // Focus the details view
      vscode.commands.executeCommand("addiDetails.focus");
    } else {
      UserFeedback.showError("Details view provider not initialized");
    }
  }

  async deleteProvider(item: ProviderTreeItem): Promise<void> {
    logger.info("Command deleteProvider invoked", logger.sanitizeProvider(item.provider));
    
    if (ConfigManager.getConfirmDelete()) {
      const confirm = await UserFeedback.showConfirmDialog(
        `Are you sure you want to delete provider "${item.provider.name}"? This will also delete all of its models.`,
        "warning",
        true
      );

      if (!confirm) {
        logger.debug("deleteProvider canceled by user", logger.sanitizeProvider(item.provider));
        return;
      }
    }

    try {
      await UserFeedback.showProgress("Deleting provider...", async (_progress, _token) => {
        const success = await this.manager.deleteProvider(item.provider.id);
        if (success) {
          this.treeDataProvider.refresh();
          if (this.detailsViewProvider) {
            this.detailsViewProvider.cancelEdit();
          }
          UserFeedback.showInfo(`Provider "${item.provider.name}" deleted`);
          logger.info("Provider deleted", logger.sanitizeProvider(item.provider));
        } else {
          UserFeedback.showError("Failed to delete provider");
          logger.warn("deleteProvider manager returned false", logger.sanitizeProvider(item.provider));
        }
      });
    } catch (error) {
      UserFeedback.showError(`Failed to delete provider: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("deleteProvider failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async editApiKey(item: ProviderTreeItem): Promise<void> {
    logger.info("Command editApiKey invoked", logger.sanitizeProvider(item.provider));
    const currentApiKey = item.provider.apiKey || "";

    const newApiKey = await UserFeedback.showInputBox({
      prompt: `Edit API key for "${item.provider.name}" (leave empty to unset)`,
      value: currentApiKey,
      password: true,
      placeHolder: "Please enter the new API key",
    });

    if (newApiKey === undefined) {
      logger.debug("editApiKey canceled", logger.sanitizeProvider(item.provider));
      return;
    }

    try {
      const success = await this.manager.updateProvider(item.provider.id, { apiKey: newApiKey });
      if (success) {
        this.treeDataProvider.refresh();
        UserFeedback.showInfo(`Provider "${item.provider.name}" API key updated`);
        logger.info("Provider API key updated", logger.sanitizeProvider(item.provider));
      } else {
        UserFeedback.showError("Failed to update API key");
        logger.warn("editApiKey manager returned false", logger.sanitizeProvider(item.provider));
      }
    } catch (error) {
      UserFeedback.showError(`Failed to update API key: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("editApiKey failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async pullProviderModels(item: ProviderTreeItem): Promise<void> {
    logger.info("Command pullProviderModels invoked", logger.sanitizeProvider(item.provider));
    await this.syncProviderModels(item.provider.id, "manual");
  }

  private async syncProviderModels(providerId: string, source: "manual" | "auto"): Promise<void> {
    const providers = this.manager.getProviders();
    const providerIndex = providers.findIndex((p) => p.id === providerId);
    if (providerIndex < 0) {
      logger.warn("syncProviderModels missing provider", { providerId });
      if (source === "manual") {
        UserFeedback.showError("Provider not found");
      }
      return;
    }

    const provider = providers[providerIndex]!;
    const endpoint = provider.apiEndpoint?.trim();
    if (!endpoint) {
      const message = `Provider "${provider.name}" is missing an API endpoint. Configure it and try pulling models again.`;
      UserFeedback.showWarning(message);
      logger.warn("syncProviderModels missing endpoint", logger.sanitizeProvider(provider));
      return;
    }

    const apiKey = provider.apiKey?.trim();
    if (!apiKey) {
      const message = `Provider "${provider.name}" is missing an API key. Set the key and rerun "Pull Models List".`;
      UserFeedback.showWarning(message);
      logger.warn("syncProviderModels missing api key", logger.sanitizeProvider(provider));
      return;
    }

    const fetchableProvider: Provider = {
      ...provider,
      apiEndpoint: endpoint,
      apiKey,
    };

    logger.debug("syncProviderModels start", { provider: logger.sanitizeProvider(fetchableProvider), source });

    try {
      const result = await UserFeedback.showProgress<ModelSyncResult>("Fetching models list...", async (_progress, _token) => {
        const remoteModels = await this.fetchProviderModelsFromApi(fetchableProvider);
        const existingById = new Map(provider.models.map((model) => [model.id, model]));
        let added = 0;
        let updated = 0;

        if (remoteModels.length === 0) {
          logger.warn("fetchProviderModelsFromApi returned no models", { provider: logger.sanitizeProvider(fetchableProvider) });
          return { added, updated, totalRemote: 0, mutated: false } satisfies ModelSyncResult;
        }

        const defaultFamily = ConfigManager.getDefaultModelFamily().trim() || "addi";
        const defaultVersion = ConfigManager.getDefaultModelVersion().trim() || "1.0.0";
        const defaultMaxInputTokens = ConfigManager.getDefaultMaxInputTokens();
        const defaultMaxOutputTokens = ConfigManager.getDefaultMaxOutputTokens();

        for (const remote of remoteModels) {
          if (!remote.id) {
            continue;
          }

          const existing = existingById.get(remote.id);
          if (existing) {
            let changed = false;

            if (remote.name && remote.name !== existing.name && existing.name === existing.id) {
              existing.name = remote.name;
              changed = true;
            }

            const remoteFamily = remote.family?.trim();
            if (remoteFamily && remoteFamily !== existing.family) {
              existing.family = remoteFamily;
              changed = true;
            }

            if (remote.maxInputTokens !== undefined && remote.maxInputTokens !== existing.maxInputTokens && existing.maxInputTokens === defaultMaxInputTokens) {
              existing.maxInputTokens = remote.maxInputTokens;
              changed = true;
            }

            if (remote.maxOutputTokens !== undefined && remote.maxOutputTokens !== existing.maxOutputTokens && existing.maxOutputTokens === defaultMaxOutputTokens) {
              existing.maxOutputTokens = remote.maxOutputTokens;
              changed = true;
            }

            if (remote.capabilities) {
              const currentCaps = existing.capabilities ?? {};
              const nextCaps: Model["capabilities"] = { ...currentCaps };
              let capsChanged = false;

              if (remote.capabilities.imageInput !== undefined && currentCaps.imageInput !== remote.capabilities.imageInput) {
                nextCaps.imageInput = remote.capabilities.imageInput;
                capsChanged = true;
              }

              if (remote.capabilities.toolCalling !== undefined && currentCaps.toolCalling !== remote.capabilities.toolCalling) {
                nextCaps.toolCalling = remote.capabilities.toolCalling;
                capsChanged = true;
              }

              if (capsChanged) {
                existing.capabilities = nextCaps;
                changed = true;
              }
            }

            if (changed) {
              updated++;
            }

            continue;
          }

          const remoteFamily = remote.family?.trim();
          const model: Model = {
            sid: IdGenerator.generate(),
            id: remote.id.trim(),
            name: remote.name?.trim() || remote.id,
            family: remoteFamily || defaultFamily,
            version: defaultVersion,
            maxInputTokens: remote.maxInputTokens ?? defaultMaxInputTokens,
            maxOutputTokens: remote.maxOutputTokens ?? defaultMaxOutputTokens,
            capabilities: remote.capabilities ? { ...remote.capabilities } : {},
          };

          provider.models.push(model);
          existingById.set(remote.id, model);
          added++;
        }

        const mutated = added > 0 || updated > 0;
        if (mutated) {
          await this.manager.saveProviders(providers);
        }

        return { added, updated, totalRemote: remoteModels.length, mutated } satisfies ModelSyncResult;
      });

      if (!result) {
        return;
      }

      if (result.totalRemote === 0) {
        const message = `Provider "${provider.name}" did not return any models.`;
        UserFeedback.showWarning(message);
        logger.warn("syncProviderModels empty result", { provider: logger.sanitizeProvider(fetchableProvider) });
        return;
      }

      if (!result.mutated) {
        const message = `Provider "${provider.name}" already has all ${result.totalRemote} models.`;
        UserFeedback.showInfo(message);
        logger.info("syncProviderModels no changes", { provider: logger.sanitizeProvider(fetchableProvider), totalRemote: result.totalRemote });
        return;
      }

      this.treeDataProvider.refresh();
      const fragments: string[] = [];
      if (result.added > 0) {
        fragments.push(`${result.added} added`);
      }
      if (result.updated > 0) {
        fragments.push(`${result.updated} updated`);
      }
      const summary = fragments.length > 0 ? fragments.join(", ") : "updated";
      UserFeedback.showInfo(`Synced models for "${provider.name}" (${summary})`);
      logger.info("syncProviderModels success", {
        provider: logger.sanitizeProvider(fetchableProvider),
        added: result.added,
        updated: result.updated,
        totalRemote: result.totalRemote,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      UserFeedback.showError(`Failed to sync models for "${provider.name}": ${message}`);
      logger.error("syncProviderModels error", { provider: logger.sanitizeProvider(fetchableProvider), error: message });
    }
  }

  async addModel(item: ProviderTreeItem): Promise<void> {
    logger.info("Command addModel invoked", logger.sanitizeProvider(item.provider));
    if (this.detailsViewProvider) {
      this.detailsViewProvider.showAddModel(item.provider.id);
    } else {
      UserFeedback.showError("Details view provider not initialized");
    }
  }

  async editModel(item: ModelTreeItem): Promise<void> {
    logger.info("Command editModel invoked", {
      model: logger.sanitizeModel(item.model),
    });
    if (this.detailsViewProvider) {
      this.detailsViewProvider.update(item);
      // Focus the details view
      vscode.commands.executeCommand("addiDetails.focus");
    } else {
      UserFeedback.showError("Details view provider not initialized");
    }
  }

  async deleteModel(item: ModelTreeItem): Promise<void> {
    logger.info("Command deleteModel invoked", logger.sanitizeModel(item.model));
    
    if (ConfigManager.getConfirmDelete()) {
      const confirm = await UserFeedback.showConfirmDialog(
        `Are you sure you want to delete the model "${item.model.name}"?`,
        "warning",
        true
      );

      if (!confirm) {
        logger.debug("deleteModel canceled by user", logger.sanitizeModel(item.model));
        return;
      }
    }

    try {
      await UserFeedback.showProgress("Deleting model...", async (_progress, _token) => {
        const success = await this.manager.deleteModel(item.model.sid);
        if (success) {
          this.treeDataProvider.refresh();
          if (this.detailsViewProvider) {
            this.detailsViewProvider.cancelEdit();
          }
          UserFeedback.showInfo(`Model "${item.model.name}" deleted successfully`);
          logger.info("Model deleted", logger.sanitizeModel(item.model));
        } else {
          UserFeedback.showError("Failed to delete model");
          logger.warn("deleteModel manager returned false", logger.sanitizeModel(item.model));
        }
      });
    } catch (error) {
      UserFeedback.showError(`Failed to delete model: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("deleteModel failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private adjustExportUriForEncryption(uri: vscode.Uri, encrypted: boolean): vscode.Uri {
    const lowerPath = uri.path.toLowerCase();
    if (encrypted) {
      if (lowerPath.endsWith(".encrypt.txt")) {
        return uri;
      }
      const withoutExtension = uri.path.replace(/(\.[^/]+)?$/, "");
      return uri.with({ path: `${withoutExtension}.encrypt.txt` });
    }

    if (lowerPath.endsWith(".encrypt.txt")) {
      const base = uri.path.slice(0, -".encrypt.txt".length);
      return uri.with({ path: `${base}.json` });
    }

    return uri;
  }

  private encodeProvidersForExport(providers: Provider[], password?: string): string {
    const plainJson = JSON.stringify(providers, null, 2);

    if (!password) {
      return plainJson;
    }

    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const plainBuffer = Buffer.from(plainJson, "utf8");
    const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const payload = {
      v: 1,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: authTag.toString("base64"),
      data: encrypted.toString("base64"),
    } satisfies {
      v: number;
      salt: string;
      iv: string;
      tag: string;
      data: string;
    };

    const payloadBuffer = Buffer.from(JSON.stringify(payload), "utf8");
    return `aes:${payloadBuffer.toString("base64")}`;
  }

  private decodeProvidersFromContent(content: string, password?: string): Provider[] {
    const trimmed = content.trim();

    if (trimmed.startsWith("aes:")) {
      if (!password) {
        throw new Error("Password is required to import this encrypted configuration");
      }

      const payloadBase64 = trimmed.slice(4);
      let payloadJson: string;
      try {
        payloadJson = Buffer.from(payloadBase64, "base64").toString("utf8");
      } catch {
        throw new Error("Encrypted configuration is not valid base64");
      }

      let payload:
        | {
            v: number;
            salt: string;
            iv: string;
            tag: string;
            data: string;
          }
        | undefined;
      try {
        payload = JSON.parse(payloadJson);
      } catch {
        throw new Error("Encrypted configuration payload is malformed");
      }

      if (!payload || payload.v !== 1 || !payload.salt || !payload.iv || !payload.tag || !payload.data) {
        throw new Error("Encrypted configuration payload is incomplete");
      }

      let salt: Buffer;
      let iv: Buffer;
      let tag: Buffer;
      let encrypted: Buffer;
      try {
        salt = Buffer.from(payload.salt, "base64");
        iv = Buffer.from(payload.iv, "base64");
        tag = Buffer.from(payload.tag, "base64");
        encrypted = Buffer.from(payload.data, "base64");
      } catch {
        throw new Error("Encrypted configuration payload contains invalid base64 data");
      }

      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);

      let decrypted: Buffer;
      try {
        decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      } catch {
        throw new Error("Failed to decrypt configuration: invalid password or corrupted data");
      }

      try {
        return JSON.parse(decrypted.toString("utf8")) as Provider[];
      } catch {
        throw new Error("Decrypted configuration has invalid format");
      }
    }

    if (trimmed.startsWith("b64:")) {
      const base64Payload = trimmed.slice(4);
      let json: string;
      try {
        json = Buffer.from(base64Payload, "base64").toString("utf8");
      } catch {
        throw new Error("Configuration is not valid base64");
      }
      return JSON.parse(json) as Provider[];
    }

    return JSON.parse(trimmed) as Provider[];
  }

  async exportConfig(): Promise<void> {
    logger.info("Command exportConfig invoked");
    try {
      const providers = this.manager.getProviders();
      if (providers.length === 0) {
        UserFeedback.showWarning("No configurations to export");
        logger.warn("exportConfig aborted: no providers configured");
        return;
      }

      const passwordInput = await UserFeedback.showInputBox({
        prompt: "Enter password to encrypt configuration (optional)",
        placeHolder: "Leave empty to export without encryption",
        password: true,
        value: "",
        ignoreFocusOut: true,
      });

      if (passwordInput === undefined) {
        logger.debug("exportConfig canceled at password prompt");
        return;
      }

      const password = passwordInput.length > 0 ? passwordInput : undefined;
      const encrypted = Boolean(password);

      const defaultFileName = encrypted ? "addi-config.encrypt.txt" : "addi-config.json";
      const firstWorkspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const defaultUri = firstWorkspaceFolder ? vscode.Uri.joinPath(firstWorkspaceFolder, defaultFileName) : undefined;

      const saveDialogOptions: vscode.SaveDialogOptions = {
        filters: {
          "Config Files": ["json", "encrypt.txt"],
          "All Files": ["*"],
        },
        title: "Export Configuration",
      };

      if (defaultUri) {
        saveDialogOptions.defaultUri = defaultUri;
      }

      const uri = await vscode.window.showSaveDialog(saveDialogOptions);

      if (!uri) {
        logger.debug("exportConfig canceled at save dialog");
        return;
      }

      const targetUri = this.adjustExportUriForEncryption(uri, encrypted);

      await UserFeedback.showProgress("Exporting configuration...", async (_progress, _token) => {
        const encoded = this.encodeProvidersForExport(providers, password);
        await vscode.workspace.fs.writeFile(targetUri, Buffer.from(encoded, "utf8"));
        UserFeedback.showInfo(`Configuration exported${password ? " (encrypted)" : ""} to ${targetUri.fsPath}`);
        logger.info("Configuration exported", {
          providerCount: providers.length,
          encrypted,
          target: targetUri.fsPath,
        });
      });
    } catch (error) {
      UserFeedback.showError(`Failed to export configuration: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("exportConfig failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async importConfig(): Promise<void> {
    logger.info("Command importConfig invoked");
    try {
      const openDialogOptions: vscode.OpenDialogOptions = {
        filters: {
          "Config Files": ["json", "encrypt.txt"],
          "All Files": ["*"],
        },
        title: "Import Configuration",
        canSelectMany: false,
      };

      const uri = await vscode.window.showOpenDialog(openDialogOptions);

      if (!uri || uri.length === 0) {
        logger.debug("importConfig canceled at file selection");
        return;
      }

      const data = await vscode.workspace.fs.readFile(uri[0]!);
      const content = new TextDecoder().decode(data);
      const trimmedContent = content.trim();

      let password: string | undefined;
      if (trimmedContent.startsWith("aes:")) {
        const passwordInput = await UserFeedback.showInputBox({
          prompt: "Enter password to decrypt configuration",
          password: true,
          value: "",
        });

        if (passwordInput === undefined) {
          logger.debug("importConfig canceled at password prompt");
          return;
        }

        if (passwordInput.length === 0) {
          UserFeedback.showError("Password is required to import encrypted configuration");
          logger.warn("importConfig provided empty password for encrypted file");
          return;
        }

        password = passwordInput;
      }

      await UserFeedback.showProgress("Importing configuration...", async (_progress, _token) => {
        const providers = this.decodeProvidersFromContent(trimmedContent, password);

        if (!Array.isArray(providers)) {
          throw new Error("Configuration format is invalid");
        }

        for (const provider of providers) {
          if (!provider.id || !provider.name || !Array.isArray(provider.models)) {
            throw new Error("Configuration format is invalid");
          }

          if ("providerType" in provider && typeof provider.providerType !== "string") {
            throw new Error("Configuration providerType must be a string");
          }

          for (const model of provider.models) {
            if (!model || typeof model !== "object") {
              throw new Error("Configuration format is invalid");
            }
            const mm = model as unknown as Record<string, unknown>;
            if (!mm["id"] || !mm["name"] || !mm["family"] || !mm["version"] || typeof mm["maxInputTokens"] !== "number" || typeof mm["maxOutputTokens"] !== "number") {
              throw new Error("Configuration format is invalid");
            }

            const capabilitiesValue = mm["capabilities"];
            const hasCapabilitiesObject = typeof capabilitiesValue === "object" && capabilitiesValue !== null;
            const hasLegacyCapabilities = "imageInput" in mm || "toolCalling" in mm;

            if (!hasCapabilitiesObject && !hasLegacyCapabilities) {
              throw new Error("Configuration capabilities definition is missing");
            }

            if (hasCapabilitiesObject) {
              const caps = capabilitiesValue as Record<string, unknown>;
              if ("imageInput" in caps && typeof caps["imageInput"] !== "boolean") {
                throw new Error("Configuration capability imageInput must be boolean");
              }
              if ("toolCalling" in caps && typeof caps["toolCalling"] !== "boolean" && typeof caps["toolCalling"] !== "number") {
                throw new Error("Configuration capability toolCalling must be boolean or number");
              }
            }
          }
        }

        const currentProviders = this.manager.getProviders();
        if (currentProviders.length > 0) {
          const overwrite = await UserFeedback.showConfirmDialog("Current configuration already exists, do you want to overwrite it?");

          if (!overwrite) {
            return;
          }
        }

        await this.manager.saveProviders(providers);
        this.treeDataProvider.refresh();
        UserFeedback.showInfo(`Configuration imported from ${uri[0]!.fsPath}`);
        logger.info("Configuration imported", {
          providerCount: providers.length,
          source: uri[0]!.fsPath,
        });
      });
    } catch (error) {
      UserFeedback.showError(`Failed to import configuration: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("importConfig failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
