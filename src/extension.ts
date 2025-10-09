import * as vscode from "vscode";
import { AddiChatProvider } from "./model";
import { ProviderModelManager, AddiTreeDataProvider, ProviderTreeItem } from "./provider";
import { CommandHandler } from "./commands";
import { ModelTreeItem } from "./model";
import { logger, LogLevel } from "./logger";

function readLogLevel(): LogLevel {
  const config = vscode.workspace.getConfiguration("addi");
  const raw = (config.get<string>("logLevel") ?? "warn").toLowerCase();
  if (raw === "off" || raw === "error" || raw === "warn" || raw === "info" || raw === "debug") {
    return raw;
  }
  return "warn";
}

export function activate(context: vscode.ExtensionContext) {
  const initialLogLevel = readLogLevel();
  logger.initialize(context, initialLogLevel);
  logger.info("Extension activation start");

  const manager = new ProviderModelManager(context);
  const applySettingsSyncPreference = () => {
    const config = vscode.workspace.getConfiguration("addi");
    const enableSync = config.get<boolean>("saveConfigToSettingsSync", true);
    manager.setSettingsSync(Boolean(enableSync));
    logger.debug("Updated settings sync preference", { enableSync });
  };

  applySettingsSyncPreference();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("addi.saveConfigToSettingsSync")) {
        applySettingsSyncPreference();
      }
      if (event.affectsConfiguration("addi.logLevel")) {
        const nextLevel = readLogLevel();
        logger.setLevel(nextLevel);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("addi.showLogs", () => {
      logger.info("Show logs command executed");
      logger.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("addi.setLogLevel", async () => {
      const currentLevel = logger.getLevel();
      const selection = await vscode.window.showQuickPick(
        [
          { label: "Off", value: "off" },
          { label: "Error", value: "error" },
          { label: "Warn", value: "warn" },
          { label: "Info", value: "info" },
          { label: "Debug", value: "debug" },
        ],
        {
          placeHolder: "Select Addi log level",
          canPickMany: false,
          title: "Addi Log Level",
          ignoreFocusOut: true,
        }
      );
      if (!selection) {
        return;
      }
      const config = vscode.workspace.getConfiguration("addi");
      await config.update("logLevel", selection.value, vscode.ConfigurationTarget.Global);
      logger.setLevel(selection.value as LogLevel);
      logger.info("Log level changed via command", { previous: currentLevel, next: selection.value });
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
      logger.show();
      logger.info("Settings sync state requested", {
        saveConfigToSettingsSync: manager.isSettingsSyncEnabled(),
        providerCount: manager.getProviders().length,
      });
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
