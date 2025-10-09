import { Model, Provider } from "./types";
import { logger } from "./logger";

export type ChatMessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

export interface ChatRequestOptions {
  prompt: string;
  temperature?: number;
  conversation?: ChatMessage[];
  maxOutputTokens?: number;
  topP?: number;
  overrideMaxOutputTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  signal?: AbortSignal;
}

export interface ChatResponse {
  providerType: "openai" | "anthropic" | "google" | "generic";
  endpoint: string;
  requestPayload: unknown;
  responsePayload: unknown;
  responseText: string;
  latencyMs: number;
}

export interface ChatStreamChunk {
  type: "delta" | "done" | "error";
  deltaText?: string;
  fullText?: string;
  error?: string;
}

/**
 * 将 OpenAI / 兼容 SSE 行解析成 json 对象（忽略空行与以 : 开头的注释）
 */
export function parseSseLine(line: string): unknown | undefined {
  if (!line) {
    return undefined;
  }
  if (line.startsWith(":")) {
    return undefined;
  }
  const prefix = "data:";
  if (!line.startsWith(prefix)) {
    return undefined;
  }
  const data = line.slice(prefix.length).trim();
  if (data === "[DONE]") {
    return { done: true };
  }
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * OpenAI / 兼容 SSE 流式调用（目前仅支持 chat.completions 风格）。
 * Anthropic / Google 暂未接入流式（后续可扩展）。
 */
export async function* streamChatCompletion(provider: Provider, model: Model, options: ChatRequestOptions): AsyncGenerator<ChatStreamChunk> {
  logger.debug("streamChatCompletion invoked", {
    provider: logger.sanitizeProvider(provider),
    model: logger.sanitizeModel(model),
    hasConversation: Boolean(options.conversation?.length),
    stream: true,
  });
  const apiEndpoint = provider.apiEndpoint?.trim();
  const apiKey = provider.apiKey?.trim();
  if (!apiEndpoint) {
    yield { type: "error", error: "unconfigured API endpoint" };
    logger.warn("streamChatCompletion missing endpoint", logger.sanitizeProvider(provider));
    return;
  }
  if (!apiKey) {
    yield { type: "error", error: "unconfigured API key" };
    logger.warn("streamChatCompletion missing API key", logger.sanitizeProvider(provider));
    return;
  }
  if (!(isOpenAiEndpoint(apiEndpoint) || (!isAnthropicEndpoint(apiEndpoint) && !isGoogleEndpoint(apiEndpoint)))) {
    // 仅在 openai 或 generic 情况下启用，其他 provider 回退错误（可未来扩展）
    yield { type: "error", error: "Streaming currently only supported for OpenAI / OpenAI-compatible endpoints" };
    logger.warn("streamChatCompletion unsupported endpoint", logger.sanitizeProvider(provider));
    return;
  }
  const messages = buildConversation(options.conversation ?? [], options.prompt);
  const requestedMax = options.overrideMaxOutputTokens ?? options.maxOutputTokens ?? model.maxOutputTokens;
  const maxOutputTokens = ensureMaxTokens(requestedMax);
  const modelIdentifier = resolveModelIdentifier(model);
  const temperature = typeof options.temperature === "number" ? options.temperature : undefined;

  const url = resolveChatCompletionsUrl(apiEndpoint, "https://api.openai.com/v1");
  const payload: Record<string, unknown> = {
    model: modelIdentifier,
    messages: toOpenAiMessages(messages),
    max_tokens: maxOutputTokens,
    stream: true,
  };
  if (typeof temperature === "number") {
    payload["temperature"] = temperature;
  }
  if (typeof options.topP === "number") {
    payload["top_p"] = Math.min(Math.max(options.topP, 0), 1);
  }
  if (typeof options.presencePenalty === "number") {
    payload["presence_penalty"] = Math.min(Math.max(options.presencePenalty, -2), 2);
  }
  if (typeof options.frequencyPenalty === "number") {
    payload["frequency_penalty"] = Math.min(Math.max(options.frequencyPenalty, -2), 2);
  }

  // startedAt 可在后续需要 latency 时启用
  let full = "";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: options.signal ?? null,
    });
    if (!response.ok || !response.body) {
      const errText = !response.ok ? await readResponseError(response) : "Readable stream not supported";
      yield { type: "error", error: errText };
      logger.warn("streamChatCompletion HTTP error", {
        provider: logger.sanitizeProvider(provider),
        error: errText,
      });
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        const parsed = parseSseLine(line);
        if (!parsed || typeof parsed !== "object") {
          continue;
        }
        // Narrow to expected OpenAI-compatible SSE shape
        type OpenAiSse = { done?: boolean; choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
        const p = parsed as OpenAiSse;
        if (p.done) {
          break;
        }
        const delta = p.choices?.[0]?.delta?.content ?? p.choices?.[0]?.message?.content;
        if (typeof delta === "string" && delta.length) {
          full += delta;
          yield { type: "delta", deltaText: delta, fullText: full };
        }
      }
    }
    // 完成
    yield { type: "done", fullText: full };
    logger.debug("streamChatCompletion finished", {
      provider: logger.sanitizeProvider(provider),
      model: logger.sanitizeModel(model),
      totalLength: full.length,
    });
  } catch (e: unknown) {
    const err = e as { name?: string } | undefined;
    if (err?.name === "AbortError") {
      yield { type: "error", error: "aborted" };
      logger.warn("streamChatCompletion aborted", logger.sanitizeProvider(provider));
    } else {
      yield { type: "error", error: e instanceof Error ? e.message : String(e) };
      logger.warn("streamChatCompletion failed", {
        provider: logger.sanitizeProvider(provider),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  // latency 可在最后一帧由调用端计算，如需可扩展。
}

export async function invokeChatCompletion(provider: Provider, model: Model, options: ChatRequestOptions): Promise<ChatResponse> {
  logger.debug("invokeChatCompletion invoked", {
    provider: logger.sanitizeProvider(provider),
    model: logger.sanitizeModel(model),
    hasConversation: Boolean((options.conversation ?? []).length),
  });
  const apiEndpoint = provider.apiEndpoint?.trim();
  const apiKey = provider.apiKey?.trim();

  if (!apiEndpoint) {
    logger.warn("invokeChatCompletion missing endpoint", logger.sanitizeProvider(provider));
    throw new Error("unconfigured API endpoint for the provider");
  }

  if (!apiKey) {
    logger.warn("invokeChatCompletion missing API key", logger.sanitizeProvider(provider));
    throw new Error("unconfigured API key for the provider");
  }

  const messages = buildConversation(options.conversation ?? [], options.prompt);
  const requestedMax = options.overrideMaxOutputTokens ?? options.maxOutputTokens ?? model.maxOutputTokens;
  const maxOutputTokens = ensureMaxTokens(requestedMax);
  const modelIdentifier = resolveModelIdentifier(model);
  const temperature = typeof options.temperature === "number" ? options.temperature : undefined;
  const signal = options.signal;

  if (isOpenAiEndpoint(apiEndpoint)) {
    logger.debug("invokeChatCompletion routing to OpenAI", logger.sanitizeProvider(provider));
    return await callOpenAi(apiEndpoint, apiKey, modelIdentifier, messages, maxOutputTokens, temperature, options.topP, options.presencePenalty, options.frequencyPenalty, signal);
  }

  if (isAnthropicEndpoint(apiEndpoint)) {
    logger.debug("invokeChatCompletion routing to Anthropic", logger.sanitizeProvider(provider));
    return await callAnthropic(apiEndpoint, apiKey, modelIdentifier, messages, maxOutputTokens, temperature, options.topP, signal);
  }

  if (isGoogleEndpoint(apiEndpoint)) {
    logger.debug("invokeChatCompletion routing to Google", logger.sanitizeProvider(provider));
    return await callGoogle(apiEndpoint, apiKey, modelIdentifier, messages, maxOutputTokens, temperature, options.topP, signal);
  }

  logger.debug("invokeChatCompletion routing to generic", logger.sanitizeProvider(provider));
  return await callGenericCompatible(
    apiEndpoint,
    apiKey,
    modelIdentifier,
    messages,
    maxOutputTokens,
    temperature,
    options.topP,
    options.presencePenalty,
    options.frequencyPenalty,
    signal
  );
}

function buildConversation(history: ChatMessage[], prompt: string): ChatMessage[] {
  const sanitizedHistory = history.filter((msg) => msg && typeof msg.content === "string");
  return [...sanitizedHistory, { role: "user", content: prompt }];
}

function ensureMaxTokens(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return 128;
  }
  return Math.min(Math.max(Math.floor(value), 1), 8192);
}

function resolveModelIdentifier(model: Model): string {
  const trimmedId = model.id?.trim();
  if (trimmedId && !/^[0-9]+$/.test(trimmedId)) {
    return trimmedId;
  }
  const trimmedFamily = model.family?.trim();
  if (trimmedFamily) {
    return trimmedFamily;
  }
  return trimmedId || model.family;
}

function isOpenAiEndpoint(endpoint: string): boolean {
  return endpoint.includes("openai.com");
}

function isAnthropicEndpoint(endpoint: string): boolean {
  return endpoint.includes("anthropic.com");
}

function isGoogleEndpoint(endpoint: string): boolean {
  return endpoint.includes("googleapis.com");
}

function normalizeBaseUrl(endpoint: string, fallback: string): string {
  const base = endpoint.trim() || fallback;
  return base.replace(/\/+$/, "");
}

function buildUrl(base: string, path: string): string {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function resolveChatCompletionsUrl(endpoint: string, fallback: string): string {
  const base = normalizeBaseUrl(endpoint, fallback);
  const lower = base.toLowerCase();
  if (lower.endsWith("/chat/completions")) {
    return base;
  }
  return buildUrl(base, "/chat/completions");
}

async function readResponseError(response: Response): Promise<string> {
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

function toOpenAiMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function splitAnthropicMessages(messages: ChatMessage[]): { system: string | undefined; messages: Array<{ role: string; content: string }> } {
  const systemMessages = messages.filter((message) => message.role === "system");
  const system = systemMessages.length > 0 ? systemMessages.map((msg) => msg.content).join("\n\n") : undefined;
  const rest = messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }));
  return { system, messages: rest };
}

function toGoogleContents(messages: ChatMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  let currentRole = "";
  let currentParts: Array<{ text: string }> = [];

  messages.forEach((message) => {
    const role = message.role === "assistant" ? "model" : message.role;
    const content = message.content;

    if (role !== currentRole && currentParts.length > 0) {
      contents.push({ role: currentRole, parts: currentParts });
      currentParts = [];
    }

    currentRole = role;
    currentParts.push({ text: content });
  });

  if (currentParts.length > 0) {
    contents.push({ role: currentRole, parts: currentParts });
  }

  return contents;
}

async function callOpenAi(
  apiEndpoint: string,
  apiKey: string,
  modelIdentifier: string,
  messages: ChatMessage[],
  maxOutputTokens: number,
  temperature: number | undefined,
  topP: number | undefined,
  presencePenalty: number | undefined,
  frequencyPenalty: number | undefined,
  signal: AbortSignal | undefined
): Promise<ChatResponse> {
  const url = resolveChatCompletionsUrl(apiEndpoint, "https://api.openai.com/v1");
  const requestPayload: Record<string, unknown> = {
    model: modelIdentifier,
    messages: toOpenAiMessages(messages),
    max_tokens: maxOutputTokens,
    stream: false,
  };
  if (typeof temperature === "number") {
    requestPayload["temperature"] = temperature;
  }
  if (typeof topP === "number") {
    // clamp 0..1 just in case
    const v = Math.min(Math.max(topP, 0), 1);
    requestPayload["top_p"] = v;
  }
  if (typeof presencePenalty === "number") {
    requestPayload["presence_penalty"] = Math.min(Math.max(presencePenalty, -2), 2);
  }
  if (typeof frequencyPenalty === "number") {
    requestPayload["frequency_penalty"] = Math.min(Math.max(frequencyPenalty, -2), 2);
  }

  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
    signal: signal ?? null,
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  const responsePayload: unknown = await response.json();
  let responseText = "";
  if (typeof responsePayload === "object" && responsePayload) {
    const p = responsePayload as { choices?: Array<{ message?: { content?: string } }> };
    responseText = p.choices?.[0]?.message?.content ?? "";
  }
  return {
    providerType: "openai",
    endpoint: url,
    requestPayload,
    responsePayload,
    responseText,
    latencyMs: Date.now() - startedAt,
  };
}

async function callGenericCompatible(
  apiEndpoint: string,
  apiKey: string,
  modelIdentifier: string,
  messages: ChatMessage[],
  maxOutputTokens: number,
  temperature: number | undefined,
  topP: number | undefined,
  presencePenalty: number | undefined,
  frequencyPenalty: number | undefined,
  signal: AbortSignal | undefined
): Promise<ChatResponse> {
  const url = resolveChatCompletionsUrl(apiEndpoint, "https://api.openai.com/v1");
  const requestPayload: Record<string, unknown> = {
    model: modelIdentifier,
    messages: toOpenAiMessages(messages),
    max_tokens: maxOutputTokens,
    stream: false,
  };
  if (typeof temperature === "number") {
    requestPayload["temperature"] = temperature;
  }
  if (typeof topP === "number") {
    const v = Math.min(Math.max(topP, 0), 1);
    requestPayload["top_p"] = v;
  }
  if (typeof presencePenalty === "number") {
    requestPayload["presence_penalty"] = Math.min(Math.max(presencePenalty, -2), 2);
  }
  if (typeof frequencyPenalty === "number") {
    requestPayload["frequency_penalty"] = Math.min(Math.max(frequencyPenalty, -2), 2);
  }

  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
    signal: signal ?? null,
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  const responsePayload: unknown = await response.json();
  let responseText = "";
  if (typeof responsePayload === "object" && responsePayload) {
    const p = responsePayload as { choices?: Array<{ message?: { content?: string } }> };
    responseText = p.choices?.[0]?.message?.content ?? "";
  }
  return {
    providerType: "generic",
    endpoint: url,
    requestPayload,
    responsePayload,
    responseText,
    latencyMs: Date.now() - startedAt,
  };
}

async function callAnthropic(
  apiEndpoint: string,
  apiKey: string,
  modelIdentifier: string,
  messages: ChatMessage[],
  maxOutputTokens: number,
  temperature: number | undefined,
  topP: number | undefined,
  signal: AbortSignal | undefined
): Promise<ChatResponse> {
  const baseUrl = normalizeBaseUrl(apiEndpoint, "https://api.anthropic.com");
  const url = buildUrl(baseUrl, "/v1/messages");
  const { system, messages: anthropicMessages } = splitAnthropicMessages(messages);
  const requestPayload: Record<string, unknown> = {
    model: modelIdentifier,
    max_tokens: maxOutputTokens,
    messages: anthropicMessages,
    stream: false,
  };
  if (system) {
    requestPayload["system"] = system;
  }
  if (typeof temperature === "number") {
    requestPayload["temperature"] = temperature;
  }
  if (typeof topP === "number") {
    const v = Math.min(Math.max(topP, 0), 1);
    requestPayload["top_p"] = v;
  }

  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(requestPayload),
    signal: signal ?? null,
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  const responsePayload: unknown = await response.json();
  let responseText = "";
  if (typeof responsePayload === "object" && responsePayload !== null) {
    const rp = responsePayload as Record<string, unknown>;
    const content = rp["content"];
    if (Array.isArray(content)) {
      type AnthropicContentItem = { text?: string };
      const arr = content as Array<AnthropicContentItem>;
      responseText = arr.map((item) => (typeof item?.text === "string" ? item.text : "")).join("");
    }
  }

  return {
    providerType: "anthropic",
    endpoint: url,
    requestPayload,
    responsePayload,
    responseText,
    latencyMs: Date.now() - startedAt,
  };
}

async function callGoogle(
  apiEndpoint: string,
  apiKey: string,
  modelIdentifier: string,
  messages: ChatMessage[],
  maxOutputTokens: number,
  temperature: number | undefined,
  topP: number | undefined,
  signal: AbortSignal | undefined
): Promise<ChatResponse> {
  const baseUrl = normalizeBaseUrl(apiEndpoint, "https://generativelanguage.googleapis.com/v1beta");
  const url = `${baseUrl}/models/${encodeURIComponent(modelIdentifier)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens,
  };
  if (typeof temperature === "number") {
    generationConfig["temperature"] = temperature;
  }
  if (typeof topP === "number") {
    const v = Math.min(Math.max(topP, 0), 1);
    generationConfig["topP"] = v; // Google uses camelCase topP
  }

  const requestPayload: Record<string, unknown> = {
    contents: toGoogleContents(messages),
    generationConfig,
  };

  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestPayload),
    signal: signal ?? null,
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  const responsePayload: unknown = await response.json();
  let responseText = "";
  if (typeof responsePayload === "object" && responsePayload !== null) {
    const rp = responsePayload as Record<string, unknown>;
    const candidates = rp["candidates"];
    if (Array.isArray(candidates)) {
      type GooglePart = { text?: string };
      type GoogleCandidate = { content?: { parts?: GooglePart[] } };
      const cands = candidates as GoogleCandidate[];
      const parts = cands.flatMap((candidate) => candidate?.content?.parts ?? ([] as GooglePart[]));
      responseText = parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
    }
  }

  return {
    providerType: "google",
    endpoint: url,
    requestPayload,
    responsePayload,
    responseText,
    latencyMs: Date.now() - startedAt,
  };
}
