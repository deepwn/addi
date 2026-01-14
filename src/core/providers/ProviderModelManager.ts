import * as vscode from 'vscode';
import { Model, Provider, ModelDraft, RemoteModelInfo } from '../../common/types';
import { IStorageService } from '../../common/interfaces';
import { ConfigManager, IdGenerator, InputValidator } from '../../common/utils';
import { logger } from '../../common/logger';

/**
 * Business Logic for managing AI Providers and Models.
 * - Handles CRUD operations for providers/models.
 * - Normalizes legacy data structures.
 * - Bridges the Gap between raw storage/config and the Application's object model.
 * - Dependent only on interfaces (DIP compliant).
 */
export class ProviderModelManager {
  private static readonly TOKEN_LIMIT = 1024 * 1024 * 4;
  private _onDidUpdate = new vscode.EventEmitter<void>();
  public readonly onDidUpdate = this._onDidUpdate.event;

  constructor(private storageService: IStorageService) {
    this.storageService.onDidUpdate(() => this._onDidUpdate.fire());

    // Initialize storage with normalization callback
    this.storageService.initialize((providers) => {
      const { mutated } = this.normalizeProvidersInPlace(
        providers as Array<Provider & Record<string, unknown>>
      );
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
    const { mutated, critical } = this.normalizeProvidersInPlace(
      stored as Array<Provider & Record<string, unknown>>
    );

    if (critical) {
      // Only save if critical changes (like missing IDs) occurred.
      void this.storageService.saveProviders(stored);
      logger.debug('Persisted critical provider data normalization', {
        providerCount: stored.length,
      });
    } else if (mutated) {
      logger.debug('Applied cosmetic provider data normalization (in-memory only)', {
        providerCount: stored.length,
      });
    }

    logger.debug('Loaded providers', { providerCount: stored.length });
    return stored;
  }

  async saveProviders(providers: Provider[]): Promise<void> {
    this.normalizeProvidersInPlace(providers as Array<Provider & Record<string, unknown>>);
    await this.storageService.saveProviders(providers);
    logger.info('Saved providers', { providerCount: providers.length });
  }

  private normalizeProvidersInPlace(providers: Array<Provider & Record<string, unknown>>): {
    mutated: boolean;
    critical: boolean;
  } {
    let mutated = false;
    let critical = false;

    for (const provider of providers) {
      if (!provider.providerType) {
        const endpoint = (provider.apiEndpoint || '').toLowerCase();
        if (endpoint.includes('openai.com')) {
          provider.providerType = 'openai';
        } else if (endpoint.includes('anthropic.com')) {
          provider.providerType = 'anthropic';
        } else if (endpoint.includes('googleapis.com')) {
          provider.providerType = 'google';
        } else {
          provider.providerType = 'generic';
        }
        mutated = true;
        // Provider type inference is useful to persist but not strictly critical for ID stability.
        // However, if we don't save it, we re-infer every time.
        // Let's consider it cosmetic-ish unless we want to lock it.
      }

      if (!Array.isArray(provider.models)) {
        logger.warn('Provider models array invalid, resetting', logger.sanitizeProvider(provider));
        provider.models = [];
        mutated = true;
        critical = true; // Data loss/reset is critical
        continue;
      }

      // Filter out invalid entries that may be present in persisted state
      const initialLength = provider.models.length;
      provider.models = provider.models.filter((m) => m && typeof m === 'object');
      if (provider.models.length !== initialLength) {
        mutated = true;
        critical = true; // Deletion is critical
      }

      provider.models = provider.models.map((model) => {
        const mutableModel = model as unknown as Record<string, unknown>;
        let changed = false;
        let modelCritical = false;

        // Ensure token defaults exist for older or malformed saved models
        if (typeof mutableModel['maxInputTokens'] !== 'number') {
          mutableModel['maxInputTokens'] = ConfigManager.getDefaultMaxInputTokens();
          changed = true;
        }
        if (typeof mutableModel['maxOutputTokens'] !== 'number') {
          mutableModel['maxOutputTokens'] = ConfigManager.getDefaultMaxOutputTokens();
          changed = true;
        }
        if (!mutableModel['capabilities'] || typeof mutableModel['capabilities'] !== 'object') {
          mutableModel['capabilities'] = {} as Record<string, unknown>;
          changed = true;
        }

        const capabilitiesRecord = mutableModel['capabilities'] as Record<string, unknown>;

        if (
          capabilitiesRecord['imageInput'] === undefined &&
          typeof mutableModel['imageInput'] === 'boolean'
        ) {
          (capabilitiesRecord as Record<string, unknown>)['imageInput'] =
            mutableModel['imageInput'];
          changed = true;
        }

        if (
          capabilitiesRecord['toolCalling'] === undefined &&
          mutableModel['toolCalling'] !== undefined
        ) {
          const legacyToolCalling = mutableModel['toolCalling'];
          (capabilitiesRecord as Record<string, unknown>)['toolCalling'] =
            typeof legacyToolCalling === 'number' ? legacyToolCalling : Boolean(legacyToolCalling);
          changed = true;
        }

        if ('imageInput' in mutableModel) {
          delete mutableModel['imageInput'];
          changed = true;
        }

        if ('toolCalling' in mutableModel) {
          delete mutableModel['toolCalling'];
          changed = true;
        }

        if (mutableModel['tooltip'] !== undefined && typeof mutableModel['tooltip'] !== 'string') {
          delete mutableModel['tooltip'];
          changed = true;
        }

        if (mutableModel['detail'] !== undefined && typeof mutableModel['detail'] !== 'string') {
          delete mutableModel['detail'];
          changed = true;
        }

        // Ensure speed fields are preserved/initialized
        if (
          mutableModel['speedHistory'] !== undefined &&
          !Array.isArray(mutableModel['speedHistory'])
        ) {
          mutableModel['speedHistory'] = [];
          changed = true;
        }
        if (
          mutableModel['averageSpeed'] !== undefined &&
          typeof mutableModel['averageSpeed'] !== 'number'
        ) {
          delete mutableModel['averageSpeed'];
          changed = true;
        }

        const normalizedCapabilities = this.normalizeCapabilities(
          capabilitiesRecord as Model['capabilities']
        );
        if (
          normalizedCapabilities.imageInput !== capabilitiesRecord['imageInput'] ||
          normalizedCapabilities.toolCalling !== capabilitiesRecord['toolCalling']
        ) {
          changed = true;
        }
        mutableModel['capabilities'] = normalizedCapabilities;

        const sidCandidate =
          typeof mutableModel['sid'] === 'string' ? mutableModel['sid'].trim() : '';
        if (!sidCandidate) {
          mutableModel['sid'] = IdGenerator.generate();
          changed = true;
          modelCritical = true; // Generating ID is critical
        }

        const remoteIdRaw = typeof mutableModel['id'] === 'string' ? mutableModel['id'].trim() : '';
        if (!remoteIdRaw) {
          mutableModel['id'] = mutableModel['sid'] as string;
          changed = true;
          // If we inferred ID from SID, and SID was generated, it's critical.
          // If SID existed but ID was missing, it's also critical to lock it in.
          modelCritical = true;
        } else if (remoteIdRaw !== mutableModel['id']) {
          mutableModel['id'] = remoteIdRaw;
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

  private normalizeCapabilities(
    source?: Model['capabilities'],
    fallback?: Model['capabilities']
  ): Model['capabilities'] {
    const normalized: Model['capabilities'] = {};
    const base = fallback ?? {};
    const candidate = source ?? {};

    if (candidate.imageInput !== undefined || base.imageInput !== undefined) {
      normalized.imageInput = Boolean(candidate.imageInput ?? base.imageInput);
    }

    const toolSource = candidate.toolCalling ?? base.toolCalling;
    if (toolSource !== undefined) {
      normalized.toolCalling = typeof toolSource === 'number' ? toolSource : Boolean(toolSource);
    }

    return normalized;
  }

  async addProvider(providerData: Omit<Provider, 'id' | 'models'>): Promise<Provider> {
    if (InputValidator.validateName(providerData.name)) {
      throw new Error('Provider name is required');
    }

    const providers = this.getProviders();
    const newProvider: Provider = {
      ...providerData,
      id: IdGenerator.generate(),
      models: [],
    };
    // 确保 providerType 存在
    if (!newProvider.providerType) {
      newProvider.providerType = 'generic';
    }

    if (
      newProvider.providerType === 'generic' &&
      (!newProvider.apiEndpoint || !newProvider.apiEndpoint.trim())
    ) {
      throw new Error('API Endpoint is required for Generic provider');
    }

    providers.push(newProvider);
    await this.saveProviders(providers);
    logger.info('Provider added', logger.sanitizeProvider(newProvider));
    return newProvider;
  }

  async updateProvider(
    id: string,
    providerData: Partial<Omit<Provider, 'id' | 'models'>>
  ): Promise<boolean> {
    const providers = this.getProviders();
    const index = providers.findIndex((p) => p.id === id);
    if (index >= 0 && providers[index]) {
      const updatedProvider = {
        ...providers[index]!,
        ...providerData,
      };

      if (InputValidator.validateName(updatedProvider.name)) {
        throw new Error('Provider name cannot be empty');
      }

      if (!updatedProvider.providerType) {
        updatedProvider.providerType = 'generic';
      }

      if (
        updatedProvider.providerType === 'generic' &&
        (!updatedProvider.apiEndpoint || !updatedProvider.apiEndpoint.trim())
      ) {
        throw new Error('API Endpoint is required for Generic provider');
      }

      providers[index] = updatedProvider;
      await this.saveProviders(providers);
      logger.info('Provider updated', logger.sanitizeProvider(providers[index]!));
      return true;
    }
    logger.warn('Attempted to update missing provider', { providerId: id });
    return false;
  }

  async deleteProvider(id: string): Promise<boolean> {
    const providers = this.getProviders();
    const filtered = providers.filter((p) => p.id !== id);
    if (filtered.length !== providers.length) {
      await this.saveProviders(filtered);
      logger.info('Provider deleted', { providerId: id });
      return true;
    }
    logger.warn('Attempted to delete missing provider', { providerId: id });
    return false;
  }

  async addModel(providerId: string, modelData: ModelDraft): Promise<Model | null> {
    if (InputValidator.validateName(modelData.name)) {
      throw new Error('Model name is required');
    }

    const providers = this.getProviders();
    const providerIndex = providers.findIndex((p) => p.id === providerId);
    if (providerIndex >= 0) {
      const sid = modelData.sid?.trim() || IdGenerator.generate();

      if (!modelData.id || !modelData.id.trim()) {
        throw new Error('Model ID is required');
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
      logger.info('Model added', {
        provider: logger.sanitizeProvider(providers[providerIndex]!),
        model: logger.sanitizeModel(newModel),
      });
      return newModel;
    }
    logger.warn('Attempted to add model to missing provider', { providerId });
    return null;
  }

  async updateModel(
    providerId: string,
    modelSid: string,
    modelData: Partial<ModelDraft>
  ): Promise<boolean> {
    const providers = this.getProviders();
    const providerIndex = providers.findIndex((p) => p.id === providerId);
    if (providerIndex >= 0) {
      const modelIndex = providers[providerIndex]!.models.findIndex((m) => m.sid === modelSid);
      if (modelIndex >= 0) {
        const existingModel = providers[providerIndex]!.models[modelIndex]!;

        if (modelData.name !== undefined && InputValidator.validateName(modelData.name)) {
          throw new Error('Model name cannot be empty');
        }
        if (modelData.id !== undefined && (!modelData.id || !modelData.id.trim())) {
          throw new Error('Model ID cannot be empty');
        }

        const updatedModel: Model = {
          sid: existingModel.sid,
          id: (modelData.id ?? existingModel.id)?.trim() || existingModel.id,
          name: modelData.name ?? existingModel.name,
          family: modelData.family ?? existingModel.family,
          version: modelData.version ?? existingModel.version,
          maxInputTokens: modelData.maxInputTokens ?? existingModel.maxInputTokens,
          maxOutputTokens: modelData.maxOutputTokens ?? existingModel.maxOutputTokens,
          capabilities: this.normalizeCapabilities(
            modelData.capabilities,
            existingModel.capabilities
          ),
          ...((modelData.requestAdditional ?? existingModel.requestAdditional)
            ? { requestAdditional: modelData.requestAdditional ?? existingModel.requestAdditional }
            : {}),
          ...((modelData.speedHistory ?? existingModel.speedHistory)
            ? { speedHistory: modelData.speedHistory ?? existingModel.speedHistory }
            : {}),
          ...((modelData.averageSpeed ?? existingModel.averageSpeed) !== undefined
            ? { averageSpeed: modelData.averageSpeed ?? existingModel.averageSpeed }
            : {}),
        };
        providers[providerIndex]!.models[modelIndex] = updatedModel;
        await this.saveProviders(providers);
        logger.info('Model updated', {
          provider: logger.sanitizeProvider(providers[providerIndex]!),
          model: logger.sanitizeModel(updatedModel),
        });
        return true;
      }
    }
    logger.warn('Attempted to update missing model', { providerId, modelSid });
    return false;
  }

  async updateModelSpeed(providerId: string, modelSid: string, speed: number): Promise<void> {
    logger.debug('updateModelSpeed called', { providerId, modelSid, speed });
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
        logger.debug('Model speed updated', { modelSid, speed, average });
      } else {
        logger.warn('Model not found for speed update', { modelSid });
      }
    } else {
      logger.warn('Provider not found for speed update', { providerId });
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
      logger.info('Model deleted', { modelSid });
    }

    return deleted;
  }

  findModel(modelSid: string): { provider: Provider; model: Model } | null {
    const providers = this.getProviders();
    for (const provider of providers) {
      const model = provider.models.find((m) => m.sid === modelSid);
      if (model) {
        logger.debug('Model lookup hit', {
          provider: logger.sanitizeProvider(provider),
          model: logger.sanitizeModel(model),
        });
        return { provider, model };
      }
    }
    logger.warn('Model lookup miss', { modelSid });
    return null;
  }

  // --- Network / Sync Logic ---

  public async fetchProviderModelsFromApi(provider: Provider): Promise<RemoteModelInfo[]> {
    const endpoint = provider.apiEndpoint?.trim();
    const apiKey = provider.apiKey?.trim();

    if (!endpoint) {
      throw new Error('Provider API endpoint is not configured');
    }

    if (!apiKey) {
      throw new Error('Provider API key is not configured');
    }

    const providerType = provider.providerType ?? 'generic';
    logger.debug('fetchProviderModelsFromApi invoked', {
      provider: logger.sanitizeProvider(provider),
      providerType,
    });

    try {
      switch (providerType) {
        case 'openai':
        case 'generic': {
          const url = this.resolveModelsUrl(endpoint, 'https://api.openai.com/v1');
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          });

          if (!response.ok) {
            throw new Error(await this.readResponseError(response));
          }

          const payload = (await response.json()) as Record<string, unknown>;
          const entries = Array.isArray(payload['data']) ? payload['data'] : [];
          const models: RemoteModelInfo[] = [];

          for (const entry of entries) {
            if (!entry || typeof entry !== 'object') {
              continue;
            }
            const record = entry as Record<string, unknown>;
            const id = typeof record['id'] === 'string' ? record['id'] : undefined;
            if (!id) {
              continue;
            }
            const displayName =
              typeof record['display_name'] === 'string' ? record['display_name'] : undefined;
            const ownedBy = typeof record['owned_by'] === 'string' ? record['owned_by'] : undefined;
            const description =
              typeof record['description'] === 'string'
                ? record['description']
                : ownedBy
                  ? `Owner: ${ownedBy}`
                  : undefined;
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
          return models;
        }
        case 'anthropic': {
          const baseUrl = this.normalizeBaseUrl(endpoint, 'https://api.anthropic.com');
          const url = this.buildUrl(baseUrl, '/v1/models');
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
          });

          if (!response.ok) {
            throw new Error(await this.readResponseError(response));
          }

          const payload = (await response.json()) as Record<string, unknown>;
          const listSource = Array.isArray(payload['models'])
            ? payload['models']
            : Array.isArray(payload['data'])
              ? payload['data']
              : [];
          const models: RemoteModelInfo[] = [];

          for (const entry of listSource) {
            if (!entry || typeof entry !== 'object') {
              continue;
            }
            const record = entry as Record<string, unknown>;
            const id =
              typeof record['id'] === 'string'
                ? record['id']
                : typeof record['name'] === 'string'
                  ? record['name']
                  : undefined;
            if (!id) {
              continue;
            }
            const displayName =
              typeof record['display_name'] === 'string' ? record['display_name'] : undefined;
            const description =
              typeof record['description'] === 'string' ? record['description'] : undefined;
            const maxInputTokens = this.coercePositiveInteger(
              record['input_token_limit'] ?? record['context_length'] ?? record['context_limit']
            );
            const maxOutputTokens = this.coercePositiveInteger(
              record['output_token_limit'] ?? record['max_output_tokens']
            );

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
          return models;
        }
        case 'google': {
          const baseUrl = this.normalizeBaseUrl(
            endpoint,
            'https://generativelanguage.googleapis.com/v1beta'
          );
          const url = `${this.buildUrl(baseUrl, '/models')}?key=${encodeURIComponent(apiKey)}`;
          const response = await fetch(url, {
            method: 'GET',
          });

          if (!response.ok) {
            throw new Error(await this.readResponseError(response));
          }

          const payload = (await response.json()) as Record<string, unknown>;
          const entries = Array.isArray(payload['models']) ? payload['models'] : [];
          const models: RemoteModelInfo[] = [];

          for (const entry of entries) {
            if (!entry || typeof entry !== 'object') {
              continue;
            }
            const record = entry as Record<string, unknown>;
            const name = typeof record['name'] === 'string' ? record['name'] : undefined;
            if (!name) {
              continue;
            }
            const displayName =
              typeof record['displayName'] === 'string' ? record['displayName'] : undefined;
            const description =
              typeof record['description'] === 'string' ? record['description'] : undefined;
            const maxInputTokens = this.coercePositiveInteger(record['inputTokenLimit']);
            const maxOutputTokens = this.coercePositiveInteger(record['outputTokenLimit']);

            let capabilities: Model['capabilities'] | undefined;
            const modalitiesSource = (record['inputModalities'] ??
              record['supportedInputModalities'] ??
              record['allowedInputModalities'] ??
              record['supportedModalities']) as unknown;
            if (Array.isArray(modalitiesSource)) {
              const hasImage = modalitiesSource.some(
                (value) => typeof value === 'string' && value.toUpperCase().includes('IMAGE')
              );
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
          return models;
        }
        default:
          return [];
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('Error fetching provider models', { error: msg });
      throw new Error(`Failed to fetch models: ${msg}`);
    }
  }

  private normalizeBaseUrl(endpoint: string | undefined, fallback: string): string {
    const base = (endpoint && endpoint.trim()) || fallback;
    return base.replace(/\/+$/, '');
  }

  private buildUrl(base: string, path: string): string {
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  private resolveModelsUrl(endpoint: string, fallback: string): string {
    const baseUrl = this.normalizeBaseUrl(endpoint, fallback);
    const [baseWithoutQueryRaw, queryString] = baseUrl.split('?', 2);
    const baseWithoutQuery = baseWithoutQueryRaw || baseUrl;

    let path = baseWithoutQuery.replace(/\/(?:chat\/)?completions$/i, '');
    if (/\/openai\/deployments\//i.test(path)) {
      path = path.replace(/\/openai\/deployments\/[^/]+$/i, '/openai');
    }

    const modelsUrl = this.buildUrl(path, '/models');
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
      if (typeof parsed?.error === 'string') {
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
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.min(Math.floor(value), ProviderModelManager.TOKEN_LIMIT);
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(Math.floor(parsed), ProviderModelManager.TOKEN_LIMIT);
      }
    }
    return undefined;
  }
}
