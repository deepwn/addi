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
      for await (const fragment of response.text) {
        if (!fragment) {
          continue;
        }
        aggregated += fragment;
      }

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
