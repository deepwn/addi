import * as vscode from "vscode";

export class MessageConverter {
  static mapChatRole(role: unknown): string {
    if (role === vscode.LanguageModelChatMessageRole.Assistant) {
      return "assistant";
    }
    if (role === vscode.LanguageModelChatMessageRole.User) {
      return "user";
    }
    const value = typeof role === "string" ? role.toLowerCase() : undefined;
    switch (value) {
      case "assistant":
        return "assistant";
      case "tool":
        return "tool";
      case "system":
        return "system";
      default:
        return "user";
    }
  }

  static extractTextFromMessageParts(parts: readonly unknown[]): string {
    const textParts: string[] = [];
    for (const part of parts) {
      if (typeof part === "string") {
        textParts.push(part);
        continue;
      }
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part.value ?? "");
        continue;
      }
      if (part && typeof part === "object") {
        const value = (part as Record<string, unknown>)["value"];
        if (typeof value === "string") {
          textParts.push(value);
        }
      }
    }
    return textParts.join("");
  }

  static extractToolCallFromParts(parts: readonly unknown[]): { name: string; arguments: string; id?: string } | undefined {
    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const candidate = part as Record<string, unknown>;
      const name = typeof candidate["name"] === "string" ? candidate["name"] : undefined;
      const argsRaw = candidate["arguments"] ?? candidate["input"];
      if (!name) {
        continue;
      }
      if (argsRaw === undefined) {
        continue;
      }
      const id = typeof candidate["callId"] === "string" ? candidate["callId"] : typeof candidate["id"] === "string" ? candidate["id"] : undefined;
      const args = typeof argsRaw === "string" ? argsRaw : JSON.stringify(argsRaw ?? {});
      const result: { name: string; arguments: string; id?: string } = { name, arguments: args };
      if (id) {
        result.id = id;
      }
      return result;
    }
    return undefined;
  }

  static extractToolResultFromParts(parts: readonly unknown[]): { id?: string; content: string } | undefined {
    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const candidate = part as Record<string, unknown>;
      const id =
        typeof candidate["callId"] === "string"
          ? candidate["callId"]
          : typeof candidate["toolCallId"] === "string"
          ? candidate["toolCallId"]
          : typeof candidate["id"] === "string"
          ? candidate["id"]
          : undefined;
      if (!id) {
        continue;
      }
      const payload = candidate["result"] ?? candidate["output"] ?? candidate["content"];
      const content = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
      return { id, content };
    }
    return undefined;
  }

  static toOpenAiMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): Array<Record<string, unknown>> {
    return messages.map((msg) => {
      let role = this.mapChatRole(msg.role);
      const parts = Array.isArray(msg.content) ? (msg.content as readonly unknown[]) : [msg.content];
      const toolCall = this.extractToolCallFromParts(parts);
      const toolResult = this.extractToolResultFromParts(parts);
      const contentText = this.extractTextFromMessageParts(parts);

      if (toolCall) {
        role = "assistant";
      } else if (toolResult) {
        role = "tool";
      }

      const entry: Record<string, unknown> = {
        role,
      };

      if (toolCall) {
        const callId = toolCall.id ?? `tool_call_${Math.random().toString(36).slice(2)}`;
        entry["tool_calls"] = [
          {
            type: "function",
            id: callId,
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          },
        ];
        entry["content"] = contentText;
      } else if (toolResult) {
        entry["content"] = toolResult.content;
        if (toolResult.id) {
          entry["tool_call_id"] = toolResult.id;
        }
      } else {
        entry["content"] = contentText;
      }

      return entry;
    });
  }

  static extractSystemMessage(messages: readonly vscode.LanguageModelChatRequestMessage[]): string {
    for (const msg of messages) {
      if (msg.name === "system") {
        if (typeof msg.content === "string") {
          return msg.content;
        }
        if (Array.isArray(msg.content)) {
          return (msg.content as Array<unknown>)
            .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
            .map((p) => p.value)
            .join("");
        }
        return String(msg.content);
      }
    }
    return "";
  }

  static toAnthropicMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];
    for (const msg of messages) {
      if (msg.name === "system") {
        continue;
      }
      const role = msg.role === vscode.LanguageModelChatMessageRole.User ? "user" : "assistant";
      const content =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
          ? msg.content
              .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
              .map((p: vscode.LanguageModelTextPart) => p.value)
              .join("")
          : String(msg.content);
      result.push({ role, content });
    }
    return result;
  }

  static toGoogleMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    let currentRole = "";
    let currentParts: Array<{ text: string }> = [];

    messages.forEach((msg) => {
      const role = msg.role === vscode.LanguageModelChatMessageRole.User ? "user" : "model";
      const content =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
          ? (msg.content as Array<unknown>)
              .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
              .map((p) => p.value)
              .join("")
          : String(msg.content);

      if (role !== currentRole && currentParts.length > 0) {
        contents.push({
          role: currentRole,
          parts: currentParts,
        });
        currentParts = [];
      }

      currentRole = role;
      currentParts.push({ text: content });
    });

    if (currentParts.length > 0) {
      contents.push({
        role: currentRole,
        parts: currentParts,
      });
    }

    return contents;
  }

  static summarizeMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): {
    total: number;
    byRole: Record<string, number>;
    toolCallMessages: number;
    toolResultMessages: number;
    textCharacters: number;
    attachmentParts: number;
  } {
    const summary = {
      total: messages.length,
      byRole: {} as Record<string, number>,
      toolCallMessages: 0,
      toolResultMessages: 0,
      textCharacters: 0,
      attachmentParts: 0,
    };

    for (const message of messages) {
      const role = this.mapChatRole(message.role);
      summary.byRole[role] = (summary.byRole[role] ?? 0) + 1;
      const parts = Array.isArray(message.content) ? (message.content as readonly unknown[]) : [message.content];

      if (this.extractToolCallFromParts(parts)) {
        summary.toolCallMessages += 1;
      }
      if (this.extractToolResultFromParts(parts)) {
        summary.toolResultMessages += 1;
      }

      for (const part of parts) {
        if (typeof part === "string") {
          summary.textCharacters += part.length;
          continue;
        }
        if (part instanceof vscode.LanguageModelTextPart) {
          summary.textCharacters += part.value?.length ?? 0;
          continue;
        }
        if (part && typeof part === "object") {
          const candidate = part as Record<string, unknown>;
          const text = candidate["text"] ?? candidate["value"] ?? candidate["content"];
          if (typeof text === "string") {
            summary.textCharacters += text.length;
          }
          if (typeof candidate["mimeType"] === "string" || typeof candidate["type"] === "string") {
            summary.attachmentParts += 1;
          }
        }
      }
    }

    return summary;
  }
}
