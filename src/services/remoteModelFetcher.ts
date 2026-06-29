/**
 * Remote Model Fetcher (BYOK Edition)
 *
 * Fetches available models from remote AI provider APIs via the listApi endpoint.
 * Supports the mainstream API formats corresponding to each BYOK vendor type:
 *   - OpenAI-compatible APIs (/v1/models)
 *   - Anthropic Messages API (/v1/models)
 *   - Google Generative AI API (/models)
 *
 * Adapted from the original Addi AI SDK version's remoteModelFetcher.
 */

import type { ByokProvider } from './byokTypes';
import { logger, LogScope } from '../common/logger';

/**
 * Resolve a potentially relative listApi URL against the provider's base URL.
 *
 * If listApi starts with "/" (relative path), it's joined onto the origin of
 * the provider's base URL. Otherwise it's returned as-is (absolute URL).
 *
 * Examples:
 *   url="https://api.openai.com/v1", listApi="/v1/models"
 *     → "https://api.openai.com/v1/models"
 *   url="https://api.deepseek.com", listApi="/models"
 *     → "https://api.deepseek.com/models"
 *   url="https://api.example.com", listApi="https://models.example.com/v1/models"
 *     → "https://models.example.com/v1/models" (absolute, returned as-is)
 */
function resolveListApiUrl(listApi: string, baseUrl?: string): string {
  if (!listApi.startsWith('/') || !baseUrl) return listApi;

  try {
    const base = new URL(baseUrl);
    // Build: origin + listApi path (strips path from baseUrl)
    const resolved = new URL(listApi, base.origin);
    return resolved.toString();
  } catch {
    // If baseUrl is invalid, return listApi as-is
    return listApi;
  }
}

/** Lightweight remote model info returned from listApi */
export interface RemoteModelInfo {
  id: string;
  name?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

/**
 * Determine the API format to use based on the provider's vendor type.
 */
function detectApiFormat(provider: ByokProvider): 'openai' | 'anthropic' | 'google' | 'generic' {
  const v = provider.vendor;
  if (v === 'openai' || v === 'copilot' || v === 'github') return 'openai';
  if (v === 'anthropic') return 'anthropic';
  if (v === 'google') return 'google';
  // For 'custom', 'customendpoint', 'azure' — default to OpenAI format
  if (v === 'azure') return 'openai';
  return 'openai'; // default for customendpoint
}

/**
 * Fetch available models from a remote provider's listApi endpoint.
 *
 * @param provider - The provider configuration
 * @param apiKey - The resolved API key (plain text)
 * @returns Array of remote model info (id, name, etc.)
 */
export async function fetchProviderModels(
  provider: ByokProvider,
  apiKey: string,
): Promise<RemoteModelInfo[]> {
  const defaults = (provider._addi_defaults ?? {}) as Record<string, unknown>;
  const rawListApi = typeof defaults['listApi'] === 'string' ? defaults['listApi'].trim() : '';
  const baseUrl = typeof defaults['url'] === 'string' ? defaults['url'].trim() : undefined;

  if (!rawListApi) {
    throw new Error('Provider has no listApi configured in _addi_defaults');
  }

  // Resolve relative paths (e.g. "/v1/models") against baseUrl
  const listApi = resolveListApiUrl(rawListApi, baseUrl);

  if (!apiKey) {
    throw new Error('Provider API key is not configured');
  }

  const format = detectApiFormat(provider);

  logger.debug(
    'fetchProviderModels invoked',
    { provider: provider.name, vendor: provider.vendor, format, listApi },
    LogScope.REMOTE_FETCHER,
  );

  try {
    switch (format) {
      case 'openai':
        return fetchOpenAIFormat(listApi, apiKey);
      case 'anthropic':
        return fetchAnthropicFormat(listApi, apiKey);
      case 'google':
        return fetchGoogleFormat(listApi, apiKey);
      default:
        return fetchOpenAIFormat(listApi, apiKey);
    }
  } catch (error) {
    logger.error(
      'fetchProviderModels failed',
      { provider: provider.name, error: error instanceof Error ? error.message : String(error) },
      LogScope.REMOTE_FETCHER,
    );
    throw error;
  }
}

// ---- OpenAI-compatible format ----

async function fetchOpenAIFormat(url: string, apiKey: string): Promise<RemoteModelInfo[]> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'Vscode Extension: Addi (https://github.com/deepwn/addi)',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await readErrorBody(response)}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const entries = Array.isArray(payload['data']) ? payload['data'] : [];
  const models: RemoteModelInfo[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record['id'] === 'string' ? record['id'] : undefined;
    if (!id) continue;

    models.push({
      id,
      name: typeof record['display_name'] === 'string' ? record['display_name'] : id,
    });
  }
  return models;
}

// ---- Anthropic format ----

async function fetchAnthropicFormat(url: string, apiKey: string): Promise<RemoteModelInfo[]> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'User-Agent': 'Vscode Extension: Addi (https://github.com/deepwn/addi)',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await readErrorBody(response)}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const entries = Array.isArray(payload['models'])
    ? payload['models']
    : Array.isArray(payload['data'])
      ? payload['data']
      : [];
  const models: RemoteModelInfo[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id =
      typeof record['id'] === 'string'
        ? record['id']
        : typeof record['name'] === 'string'
          ? record['name']
          : undefined;
    if (!id) continue;

    const displayName =
      typeof record['display_name'] === 'string' ? record['display_name'] : undefined;

    const model: RemoteModelInfo = {
      id,
      name: displayName ?? id,
    };
    const mit = coerceInt(record['input_token_limit'] ?? record['context_length'] ?? record['context_limit']);
    if (mit !== undefined) model.maxInputTokens = mit;
    const mot = coerceInt(record['output_token_limit'] ?? record['max_output_tokens']);
    if (mot !== undefined) model.maxOutputTokens = mot;
    models.push(model);
  }
  return models;
}

// ---- Google Generative AI format ----

async function fetchGoogleFormat(url: string, apiKey: string): Promise<RemoteModelInfo[]> {
  const separator = url.includes('?') ? '&' : '?';
  const fullUrl = `${url}${separator}key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(fullUrl, {
    method: 'GET',
    headers: {
      'User-Agent': 'Vscode Extension: Addi (https://github.com/deepwn/addi)',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await readErrorBody(response)}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const entries = Array.isArray(payload['models']) ? payload['models'] : [];
  const models: RemoteModelInfo[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record['name'] === 'string' ? record['name'] : undefined;
    if (!name) continue;

    const model: RemoteModelInfo = {
      id: name,
      name: typeof record['displayName'] === 'string' ? record['displayName'] : name,
    };
    const mit = coerceInt(record['inputTokenLimit']);
    if (mit !== undefined) model.maxInputTokens = mit;
    const mot = coerceInt(record['outputTokenLimit']);
    if (mot !== undefined) model.maxOutputTokens = mot;
    models.push(model);
  }
  return models;
}

// ---- Helpers ----

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '(unable to read error body)';
  }
}

function coerceInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}
