import { Model, Provider } from "./types";

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

export async function invokeChatCompletion(provider: Provider, model: Model, options: ChatRequestOptions): Promise<ChatResponse> {
  const apiEndpoint = provider.apiEndpoint?.trim();
  const apiKey = provider.apiKey?.trim();

  if (!apiEndpoint) {
    throw new Error("unconfigured API endpoint for the provider");
  }

  if (!apiKey) {
    throw new Error("unconfigured API key for the provider");
  }

  const messages = buildConversation(options.conversation ?? [], options.prompt);
  const maxOutputTokens = ensureMaxTokens(options.maxOutputTokens ?? model.maxOutputTokens);
  const modelIdentifier = resolveModelIdentifier(model);
  const temperature = typeof options.temperature === "number" ? options.temperature : undefined;
  const signal = options.signal;

  if (isOpenAiEndpoint(apiEndpoint)) {
    return await callOpenAi(apiEndpoint, apiKey, modelIdentifier, messages, maxOutputTokens, temperature, signal);
  }

  if (isAnthropicEndpoint(apiEndpoint)) {
    return await callAnthropic(apiEndpoint, apiKey, modelIdentifier, messages, maxOutputTokens, temperature, signal);
  }

  if (isGoogleEndpoint(apiEndpoint)) {
    return await callGoogle(apiEndpoint, apiKey, modelIdentifier, messages, maxOutputTokens, temperature, signal);
  }

  return await callGenericCompatible(apiEndpoint, apiKey, modelIdentifier, messages, maxOutputTokens, temperature, signal);
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

function toGoogleContents(messages: ChatMessage[]): any[] {
  const contents: any[] = [];
  let currentRole = "";
  let currentParts: any[] = [];

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

  const responsePayload: any = await response.json();
  const responseText = responsePayload?.choices?.[0]?.message?.content ?? "";
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

  const responsePayload: any = await response.json();
  const responseText = responsePayload?.choices?.[0]?.message?.content ?? "";
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

  const responsePayload: any = await response.json();
  const responseText = Array.isArray(responsePayload?.content) ? responsePayload.content.map((item: any) => (typeof item?.text === "string" ? item.text : "")).join("") : "";

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

  const responsePayload: any = await response.json();
  const responseText = Array.isArray(responsePayload?.candidates)
    ? responsePayload.candidates
        .flatMap((candidate: any) => candidate?.content?.parts ?? [])
        .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
    : "";

  return {
    providerType: "google",
    endpoint: url,
    requestPayload,
    responsePayload,
    responseText,
    latencyMs: Date.now() - startedAt,
  };
}
