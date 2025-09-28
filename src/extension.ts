import * as vscode from "vscode";
import { AddiChatProvider } from "./model";
import { ProviderModelManager, AddiTreeDataProvider, ProviderTreeItem } from "./provider";
import { CommandHandler } from "./commands";
import { ModelTreeItem } from "./model";

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
