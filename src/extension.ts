import * as vscode from "vscode";
import { AddiChatProvider } from "./model";
import { ProviderModelManager, AddiTreeDataProvider, ProviderTreeItem } from "./provider";
import { CommandHandler } from "./commands";
import { ModelTreeItem } from "./model";
import { AddiChatParticipant } from "./chatParticipant";

export function activate(context: vscode.ExtensionContext) {
  const manager = new ProviderModelManager(context);
  const applySettingsSyncPreference = () => {
    const config = vscode.workspace.getConfiguration("addi");
    const enableSync = config.get<boolean>("saveConfigToSettingsSync", true);
    manager.setSettingsSync(Boolean(enableSync));
  };

  applySettingsSyncPreference();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("addi.saveConfigToSettingsSync")) {
        applySettingsSyncPreference();
      }
    })
  );

  vscode.lm.registerLanguageModelChatProvider("addi-provider", new AddiChatProvider(manager));

  const treeDataProvider = new AddiTreeDataProvider(manager);
  vscode.window.registerTreeDataProvider("addiProviders", treeDataProvider);

  const treeView = vscode.window.createTreeView("addiProviders", {
    treeDataProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  const commandHandler = new CommandHandler(manager, treeDataProvider, context);
  const chatParticipant = new AddiChatParticipant(context);
  context.subscriptions.push(chatParticipant);

  // Register a simple language model tool that can create a file in the workspace.
  // This allows LanguageModelToolCallPart emitted by the provider to be handled by the extension.
  try {
    const createFileTool: vscode.LanguageModelTool<Record<string, unknown>> = {
      async invoke(options, _token) {
        const input = options.input ?? {};
        // Expect input to have { path: string, content: string }
        const path = typeof input["path"] === "string" ? (input["path"] as string) : undefined;
        const content = typeof input["content"] === "string" ? (input["content"] as string) : String(input["content"] ?? "");

        if (!path || path.trim().length === 0) {
          return { success: false, message: "Missing 'path' in tool input." } as unknown as vscode.LanguageModelToolResult;
        }

        try {
          // If workspace folder exists, create file relative to first workspace root; otherwise use extension storagePath
          const folders = vscode.workspace.workspaceFolders;
          let baseUri: vscode.Uri | undefined;
          const firstFolder = folders && folders.length > 0 ? folders[0] : undefined;
          if (firstFolder && firstFolder.uri) {
            baseUri = firstFolder.uri;
          } else {
            baseUri = context.globalStorageUri;
          }

          const fileUri = vscode.Uri.joinPath(baseUri, path);
          const encoder = new TextEncoder();
          const bytes = encoder.encode(content);
          await vscode.workspace.fs.writeFile(fileUri, bytes);

          return { success: true, message: `File created: ${fileUri.toString()}`, uri: fileUri.toString() } as unknown as vscode.LanguageModelToolResult;
        } catch (err) {
          return { success: false, message: String(err) } as unknown as vscode.LanguageModelToolResult;
        }
      },
    };

  const disposableTool = vscode.lm.registerTool<Record<string, unknown>>("addi.createFile", createFileTool as unknown as vscode.LanguageModelTool<Record<string, unknown>>);
    context.subscriptions.push(disposableTool);
  } catch (err) {
    console.warn("Failed to register createFile tool:", err);
  }

  // 调试命令：输出当前 Settings Sync 状态和存储内容（仅用于开发/验证）
  context.subscriptions.push(
    vscode.commands.registerCommand("addi.debug.printSettingsSyncState", async () => {
      const channel = vscode.window.createOutputChannel("Addi Debug");
      channel.appendLine(`saveConfigToSettingsSync: ${manager.isSettingsSyncEnabled()}`);
      const providers = manager.getProviders();
      channel.appendLine(`providers (count=${providers.length}):`);
      channel.appendLine(JSON.stringify(providers, null, 2));
      channel.show(true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("addi.manage", async () => {
      await vscode.commands.executeCommand("addiProviders.focus");
    })
  );

  context.subscriptions.push(vscode.commands.registerCommand("addi.addProvider", () => commandHandler.addProvider()));
  context.subscriptions.push(vscode.commands.registerCommand("addi.editProvider", (item: ProviderTreeItem) => commandHandler.editProvider(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.deleteProvider", (item: ProviderTreeItem) => commandHandler.deleteProvider(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.addModel", (item: ProviderTreeItem) => commandHandler.addModel(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.editApiKey", (item: ProviderTreeItem) => commandHandler.editApiKey(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.editModel", (item: ModelTreeItem) => commandHandler.editModel(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.deleteModel", (item: ModelTreeItem) => commandHandler.deleteModel(item)));
  context.subscriptions.push(
    vscode.commands.registerCommand("addi.useModel", (item: ModelTreeItem) => {
      const result = manager.findModel(item.model.id);
      if (!result) {
        void vscode.window.showErrorMessage("Model not found");
        return;
      }
      // 直接打开 playground
      void commandHandler.openPlayground(result.provider, result.model);
    })
  );
  context.subscriptions.push(vscode.commands.registerCommand("addi.exportConfig", () => commandHandler.exportConfig()));
  context.subscriptions.push(vscode.commands.registerCommand("addi.importConfig", () => commandHandler.importConfig()));
}

export function deactivate() {}
