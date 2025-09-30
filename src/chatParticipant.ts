import * as vscode from "vscode";

export class AddiChatParticipant implements vscode.Disposable {
  private readonly participant: vscode.ChatParticipant;

  constructor(private readonly context: vscode.ExtensionContext) {
    const handler: vscode.ChatRequestHandler = this.handleRequest.bind(this);
    this.participant = vscode.chat.createChatParticipant("addi.chat", handler);
    try {
      this.participant.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "icon.min.svg");
    } catch (error) {
      console.warn("Failed to set Addi chat participant icon", error);
    }
  }

  dispose(): void {
    this.participant.dispose();
  }

  private async handleRequest(request: vscode.ChatRequest, _context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
    const chatModel = await this.resolveModel(request.model);
    if (!chatModel) {
      stream.markdown(vscode.l10n.t("No Addi model is available. Configure a provider and try again."));
      return;
    }

    const messages = this.buildMessages(request);
    if (messages.length === 0) {
      stream.markdown(vscode.l10n.t("I need a prompt to send to the Addi model."));
      return;
    }

    stream.progress(vscode.l10n.t("Sending request to {0}…", chatModel.id ?? "Addi"));

    try {
      const response = await chatModel.sendRequest(messages, {}, token);
      let aggregated = "";

      // response.text is an async iterable of textual fragments
      const textReader = (async () => {
        for await (const fragment of response.text) {
          if (!fragment) {
            continue;
          }
          aggregated += fragment;
        }
      })();

      // response.parts may contain structured parts such as tool calls / tool results
      const parts = (response as any).parts;
      const partsReader = (async () => {
        if (!parts || typeof (parts as any)[Symbol.asyncIterator] !== "function") {
          return;
        }

        for await (const part of parts) {
          try {
            // Language model tool call parts should be instances of LanguageModelToolCallPart
            if (part instanceof (vscode as any).LanguageModelToolCallPart) {
              const toolPart: any = part;
              const toolName = toolPart.name ?? "tool";
              // The part may expose an input or arguments field
              const toolInput = toolPart.input ?? toolPart.arguments ?? {};

              // Invoke the registered tool and pass the chat request's toolInvocationToken so the UI binds it to this chat
              const invokeOptions = { input: toolInput, toolInvocationToken: request.toolInvocationToken } as unknown as vscode.LanguageModelToolInvocationOptions<object>;
              try {
                const toolResult = await vscode.lm.invokeTool(toolName, invokeOptions, token);
                // Summarize the tool result for the chat stream
                let summary = "";
                try {
                  if (toolResult && Array.isArray((toolResult as any).content)) {
                    summary = (toolResult as any).content
                      .map((p: any) => (p instanceof (vscode as any).LanguageModelTextPart ? p.value : String(p)))
                      .join("");
                  } else {
                    summary = String(toolResult ?? "");
                  }
                } catch (_err) {
                  summary = String(toolResult ?? "Tool invoked.");
                }

                if (summary && summary.trim().length > 0) {
                  stream.markdown(summary);
                } else {
                  stream.markdown(vscode.l10n.t("Tool {0} invoked.", toolName));
                }
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                stream.markdown(vscode.l10n.t("Tool invocation failed for {0}: {1}", toolName, message));
              }
            }
            // If the part is a text part, forward it to the aggregated text as well
            else if (part instanceof (vscode as any).LanguageModelTextPart) {
              try {
                const v = (part as any).value ?? String(part);
                aggregated += String(v);
              } catch (_e) {
                // ignore
              }
            }
            // Tool result parts can also be surfaced
            else if (part instanceof (vscode as any).LanguageModelToolResultPart) {
              try {
                const v = (part as any).value ?? String(part);
                if (v && String(v).trim().length > 0) {
                  stream.markdown(String(v));
                }
              } catch (_e) {
                // ignore
              }
            }
          } catch (err) {
            console.warn("Error handling response part:", err);
          }
        }
      })();

      // wait for both readers to finish
      await Promise.all([textReader, partsReader]);

      if (!aggregated.trim()) {
        stream.markdown(vscode.l10n.t("The Addi model did not return any content."));
        return;
      }

      stream.markdown(aggregated);
    } catch (error) {
      if (token.isCancellationRequested) {
        stream.markdown(vscode.l10n.t("Request cancelled."));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      stream.markdown(vscode.l10n.t("Addi chat failed: {0}", message));
    }
  }

  private async resolveModel(candidate: vscode.LanguageModelChat | undefined): Promise<vscode.LanguageModelChat | undefined> {
    if (candidate && typeof (candidate as { sendRequest?: unknown }).sendRequest === "function") {
      return candidate;
    }

    try {
      const models = await vscode.lm.selectChatModels({ vendor: "addi-provider" });
      return models[0];
    } catch (error) {
      console.warn("Failed to select Addi chat model", error);
      return undefined;
    }
  }

  private buildMessages(request: vscode.ChatRequest): vscode.LanguageModelChatMessage[] {
    const messageCtor = (vscode as unknown as { LanguageModelChatMessage?: typeof vscode.LanguageModelChatMessage }).LanguageModelChatMessage;
    if (!messageCtor) {
      return [];
    }

    const messages: vscode.LanguageModelChatMessage[] = [];
    const prompt = request.prompt?.trim();
    if (prompt && prompt.length > 0) {
      messages.push(messageCtor.User(prompt));
    }
    return messages;
  }
}
