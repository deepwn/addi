import * as vscode from "vscode";

export type LogLevel = "off" | "error" | "warn" | "info" | "debug";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function now(): string {
  const date = new Date();
  return `${date.toISOString()}`;
}

function formatMetadata(metadata: unknown): string {
  if (metadata === undefined || metadata === null) {
    return "";
  }
  try {
    return typeof metadata === "string" ? metadata : JSON.stringify(metadata, null, 2);
  } catch {
    return String(metadata);
  }
}

function maskSecret(value: string | undefined | null): string | undefined {
  if (!value) {
    return value ?? undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return "***";
  }
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-2);
  return `${prefix}***${suffix}`;
}

export class AddiLogger {
  private channel: vscode.OutputChannel | undefined;
  private level: LogLevel = "warn";

  initialize(context: vscode.ExtensionContext, level: LogLevel): void {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel("Addi", { log: true });
      context.subscriptions.push(this.channel);
    }
    this.setLevel(level);
    this.appendRaw(`[${now()}] [INFO] Logger initialized at level ${level}`);
  }

  setLevel(level: LogLevel): void {
    const previous = this.level;
    this.level = level;
    this.appendRaw(`[${now()}] [INFO] Log level set to ${level} (previous: ${previous})`);
  }

  getLevel(): LogLevel {
    return this.level;
  }

  show(): void {
    this.channel?.show(true);
  }

  error(message: string, metadata?: unknown): void {
    this.log("error", message, metadata);
  }

  warn(message: string, metadata?: unknown): void {
    this.log("warn", message, metadata);
  }

  info(message: string, metadata?: unknown): void {
    this.log("info", message, metadata);
  }

  debug(message: string, metadata?: unknown): void {
    this.log("debug", message, metadata);
  }

  log(level: LogLevel, message: string, metadata?: unknown): void {
    if (LEVEL_WEIGHT[level] === undefined || LEVEL_WEIGHT[this.level] === undefined) {
      return;
    }
    if (LEVEL_WEIGHT[level] > LEVEL_WEIGHT[this.level]) {
      return;
    }

    const formatted = `[${now()}] [${level.toUpperCase()}] ${message}`;
    if (metadata !== undefined) {
      const meta = formatMetadata(metadata);
      if (meta) {
        this.ensureChannel().appendLine(`${formatted} :: ${meta}`);
        return;
      }
    }
    this.ensureChannel().appendLine(formatted);
  }

  sanitizeProvider(provider?: { id?: string; name?: string; apiEndpoint?: string | null; apiKey?: string | null; providerType?: string | null }): Record<string, unknown> | undefined {
    if (!provider) {
      return undefined;
    }
    return {
      id: provider.id,
      name: provider.name,
      providerType: provider.providerType,
      apiEndpoint: provider.apiEndpoint,
      apiKey: maskSecret(provider.apiKey ?? undefined),
    };
  }

  sanitizeModel(model?: { id?: string; name?: string; family?: string; version?: string }): Record<string, unknown> | undefined {
    if (!model) {
      return undefined;
    }
    return {
      id: model.id,
      name: model.name,
      family: model.family,
      version: model.version,
    };
  }

  private ensureChannel(): vscode.OutputChannel {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel("Addi", { log: true });
    }
    return this.channel;
  }

  private appendRaw(message: string): void {
    this.ensureChannel().appendLine(message);
  }
}

export const logger = new AddiLogger();
