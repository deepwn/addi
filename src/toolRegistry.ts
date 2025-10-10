import * as vscode from "vscode";
import { logger } from "./logger";

export type BuiltinToolSource = "host" | "fallback";

export interface ToolMetadata {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly parameters: Record<string, unknown>;
  readonly tags?: readonly string[];
  readonly source: BuiltinToolSource;
}

export class ToolRegistry {
  private static hostTools = new Map<string, ToolMetadata>();
  private static fallbackTools: Map<string, ToolMetadata> | null = null;

  static captureHostTools(tools: ReadonlyArray<Record<string, unknown>> | undefined): void {
    this.hostTools.clear();
    if (!tools || tools.length === 0) {
      return;
    }
    for (const raw of tools) {
      const metadata = this.normalizeTool(raw, "host");
      if (metadata) {
        this.hostTools.set(metadata.id, metadata);
      }
    }
  }

  static getFallbackToolDefinitions(): Array<Record<string, unknown>> {
    const map = this.ensureFallbackTools();
    const definitions: Array<Record<string, unknown>> = [];
    for (const tool of map.values()) {
      definitions.push(this.toDefinition(tool));
    }
    return definitions;
  }

  static findTool(identifier: string): ToolMetadata | undefined {
    const trimmed = typeof identifier === "string" ? identifier.trim() : "";
    if (!trimmed) {
      return undefined;
    }
    const directHost = this.hostTools.get(trimmed) ?? this.lookupByName(this.hostTools, trimmed);
    if (directHost) {
      return directHost;
    }
    const fallback = this.ensureFallbackTools();
    return fallback.get(trimmed) ?? this.lookupByName(fallback, trimmed);
  }

  static resetForTests(): void {
    this.hostTools.clear();
    this.fallbackTools = null;
  }

  static setFallbackToolsForTests(tools: ReadonlyArray<Record<string, unknown>>): void {
    const map = new Map<string, ToolMetadata>();
    for (const raw of tools) {
      const metadata = this.normalizeTool(raw, "fallback");
      if (metadata) {
        map.set(metadata.id, metadata);
      }
    }
    this.fallbackTools = map;
  }

  private static ensureFallbackTools(): Map<string, ToolMetadata> {
    if (this.fallbackTools) {
      return this.fallbackTools;
    }
    const map = new Map<string, ToolMetadata>();
    try {
      const lm = (vscode as any)?.lm;
      const rawTools = lm?.tools;
      if (Array.isArray(rawTools)) {
        for (const raw of rawTools as readonly unknown[]) {
          const metadata = this.normalizeTool(raw as Record<string, unknown>, "fallback");
          if (metadata) {
            map.set(metadata.id, metadata);
          }
        }
      }
    } catch (error) {
      logger.warn("Failed to access vscode.lm.tools", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.fallbackTools = map;
    return map;
  }

  private static lookupByName(map: Map<string, ToolMetadata>, name: string): ToolMetadata | undefined {
    for (const tool of map.values()) {
      if (tool.name === name) {
        return tool;
      }
    }
    return undefined;
  }

  private static normalizeTool(raw: Record<string, unknown> | undefined, source: BuiltinToolSource): ToolMetadata | undefined {
    if (!raw || typeof raw !== "object") {
      return undefined;
    }
    const id = this.extractIdentifier(raw);
    if (!id) {
      return undefined;
    }
    const rawName = raw["name"];
    const name = typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim() : id;
    const descValue = raw["description"] ?? raw["detail"] ?? raw["summary"];
    const description = typeof descValue === "string" ? descValue : undefined;
    const parameters = this.normalizeParameters(raw["parameters"] ?? raw["inputSchema"] ?? raw["schema"]);
    const rawTags = raw["tags"];
    const tags = Array.isArray(rawTags) ? rawTags.filter((tag): tag is string => typeof tag === "string") : undefined;
    const metadata: ToolMetadata = {
      id,
      name,
      parameters,
      source,
      ...(description ? { description } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
    };
    return metadata;
  }

  private static extractIdentifier(raw: Record<string, unknown>): string | undefined {
    const keys = ["id", "identifier", "name"];
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  }

  private static normalizeParameters(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object") {
      return { type: "object", properties: {} };
    }
    const record = value as Record<string, unknown>;
    const typeValue = record["type"];
    if (typeof typeValue === "string" && typeValue.trim().length > 0) {
      return record;
    }
    return {
      type: "object",
      properties: record,
    };
  }

  private static toDefinition(tool: ToolMetadata): Record<string, unknown> {
    const definition: Record<string, unknown> = {
      id: tool.id,
      name: tool.name,
      parameters: tool.parameters,
    };
    if (tool.description) {
      definition["description"] = tool.description;
    }
    if (tool.tags && tool.tags.length > 0) {
      definition["tags"] = tool.tags;
    }
    return definition;
  }
}
