import * as vscode from "vscode";
import { AddiChatProvider } from "./model";
import { ProviderModelManager, AddiTreeDataProvider, ProviderTreeItem } from "./provider";
import { CommandHandler } from "./commands";
import { ModelTreeItem } from "./model";

export function activate(context: vscode.ExtensionContext) {
  const manager = new ProviderModelManager(context);

  vscode.lm.registerLanguageModelChatProvider("addi-provider", new AddiChatProvider(manager));

  const treeDataProvider = new AddiTreeDataProvider(manager);
  vscode.window.registerTreeDataProvider("addiProviders", treeDataProvider);

  const treeView = vscode.window.createTreeView("addiProviders", {
    treeDataProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  const commandHandler = new CommandHandler(context, manager, treeDataProvider);

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
  context.subscriptions.push(vscode.commands.registerCommand("addi.useModel", (item: ModelTreeItem) => commandHandler.useModel(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.exportConfig", () => commandHandler.exportConfig()));
  context.subscriptions.push(vscode.commands.registerCommand("addi.importConfig", () => commandHandler.importConfig()));
}

export function deactivate() {}
