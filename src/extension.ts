import * as vscode from "vscode";
import { AddiChatProvider } from "./model";
import { ProviderModelManager, AddiTreeDataProvider, ProviderTreeItem } from "./provider";
import { CommandHandler } from "./commands";
import { ModelTreeItem } from "./model";
import { logger, LogLevel } from "./logger";
import { EditorViewManager } from "./editorView";
import { CustomToolManager } from "./services/customToolManager";
import { ToolTreeDataProvider, ToolTreeItem } from "./views/toolView";

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
  const extension = vscode.extensions.getExtension("deepwn.addi");
  const version = extension?.packageJSON?.version ?? "unknown";
  logger.info(`Extension activation start (v${version})`);

  const manager = new ProviderModelManager(context);
  context.subscriptions.push(new vscode.Disposable(() => manager.dispose()));
  
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
      if (event.affectsConfiguration("addi.sortRule") || event.affectsConfiguration("addi.sortTarget")) {
        treeDataProvider.refresh();
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

  // Custom Tools
  const toolManager = new CustomToolManager(context);
  const toolTreeDataProvider = new ToolTreeDataProvider(toolManager);
  vscode.window.registerTreeDataProvider("addiTools", toolTreeDataProvider);

  vscode.lm.registerLanguageModelChatProvider("addi-provider", new AddiChatProvider(manager, toolManager));

  const treeDataProvider = new AddiTreeDataProvider(manager);
  context.subscriptions.push(manager.onDidUpdate(() => treeDataProvider.refresh()));
  vscode.window.registerTreeDataProvider("addiProviders", treeDataProvider);

  const treeView = vscode.window.createTreeView("addiProviders", {
    treeDataProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Refresh the tree view when the window gains focus to reflect any changes from settings sync
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) {
        treeDataProvider.refresh();
      }
    })
  );

  const commandHandler = new CommandHandler(manager, treeDataProvider, context);

  context.subscriptions.push(
    vscode.commands.registerCommand("addi.manage", async () => {
      await vscode.commands.executeCommand("addiProviders.focus");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("addi.refresh", () => {
      treeDataProvider.refresh();
      logger.info("Manual refresh triggered");
    })
  );

  context.subscriptions.push(vscode.commands.registerCommand("addi.addProvider", () => commandHandler.addProvider()));
  context.subscriptions.push(vscode.commands.registerCommand("addi.editProvider", (item: ProviderTreeItem) => commandHandler.editProvider(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.copyProvider", (item: ProviderTreeItem) => commandHandler.copyProvider(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.deleteProvider", (item: ProviderTreeItem) => commandHandler.deleteProvider(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.pullProviderModels", (item: ProviderTreeItem) => commandHandler.pullProviderModels(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.addModel", (item: ProviderTreeItem) => commandHandler.addModel(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.editApiKey", (item: ProviderTreeItem) => commandHandler.editApiKey(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.editModel", (item: ModelTreeItem) => commandHandler.editModel(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.copyModel", (item: ModelTreeItem) => commandHandler.copyModel(item)));
  context.subscriptions.push(vscode.commands.registerCommand("addi.deleteModel", (item: ModelTreeItem) => commandHandler.deleteModel(item)));
  context.subscriptions.push(
    vscode.commands.registerCommand("addi.useModel", (item: ModelTreeItem) => {
      const result = manager.findModel(item.model.sid);
      if (!result) {
        void vscode.window.showErrorMessage("Model not found");
        return;
      }
      // open playground
      void commandHandler.openPlayground(result.provider, result.model);
    })
  );
  context.subscriptions.push(vscode.commands.registerCommand("addi.exportConfig", () => commandHandler.exportConfig()));
  context.subscriptions.push(vscode.commands.registerCommand("addi.importConfig", () => commandHandler.importConfig()));
  context.subscriptions.push(vscode.commands.registerCommand("addi.openSettings", () => {
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:deepwn.addi');
  }));

  const editorManager = new EditorViewManager(context.extensionUri, manager, () => treeDataProvider.refresh());
  commandHandler.setEditorViewManager(editorManager);

  context.subscriptions.push(
    vscode.commands.registerCommand("addi.addTool", async () => {
        // Create a template file
        const type = await vscode.window.showQuickPick(["command", "http"], { placeHolder: "Tool Type" });
        if (!type) { return; }

        const name = await vscode.window.showInputBox({ prompt: "Tool Name (filename)", placeHolder: "my-tool" });
        if (!name) { return; }

        const scope = await vscode.window.showQuickPick(["Workspace (.vscode/addi/)", "Global (~/.addi/)"], { placeHolder: "Where to create?" });
        if (!scope) { return; }

        let dirPath = "";
        if (scope.startsWith("Workspace")) {
            if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                vscode.window.showErrorMessage("No workspace open.");
                return;
            }
            const wf = vscode.workspace.workspaceFolders[0];
            if (wf) {
                dirPath = vscode.Uri.joinPath(wf.uri, ".vscode", "addi").fsPath;
            } else {
                return;
            }
        } else {
            const os = require('os');
            const path = require('path');
            dirPath = path.join(os.homedir(), ".addi");
        }

        const fs = require('fs');
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        const filePath = `${dirPath}/${name}.yaml`;
        
        let content = "";
        if (type === "command") {
            content = `name: ${name}
description: Description of what this tool does
# Simplified inputs definition
inputs:
  arg1:
    description: Argument description
    default: "value"
# Steps to execute
steps:
  - name: print
    run: echo \${arg1}
`;
        } else {
            content = `name: ${name}
description: Description of what this tool does
# Simplified inputs definition
inputs:
  query:
    description: Search query
# Steps to execute
steps:
  - name: fetch
    http:
      url: https://api.example.com/search?q=\${query}
      method: GET
      headers:
        Content-Type: application/json
`;
        }

        fs.writeFileSync(filePath, content);
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("addi.deleteTool", async (item: ToolTreeItem) => {
        if (item && item.tool && item.tool.fileName) {
            const confirm = await vscode.window.showWarningMessage(`Delete tool file "${item.tool.fileName}"?`, "Yes", "No");
            if (confirm === "Yes") {
                const fs = require('fs');
                const path = require('path');
                const os = require('os');
                
                let filePath = "";
                if (item.tool.source === 'global') {
                    filePath = path.join(os.homedir(), '.addi', item.tool.fileName);
                } else if (item.tool.source === 'workspace') {
                     if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                         const wf = vscode.workspace.workspaceFolders[0];
                         if (wf) {
                            filePath = path.join(wf.uri.fsPath, '.vscode', 'addi', item.tool.fileName);
                         }
                     }
                }

                if (filePath && fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    vscode.window.showInformationMessage(`Deleted ${item.tool.fileName}`);
                    // Refresh will happen automatically via watcher
                } else {
                    vscode.window.showErrorMessage(`Could not find file for tool: ${item.tool.fileName}`);
                }
            }
        }
    })
  );
  
  context.subscriptions.push(
      vscode.commands.registerCommand("addi.refreshTools", () => {
          toolTreeDataProvider.refresh();
      })
  );

  // TODO: Implement editTool
  context.subscriptions.push(
      vscode.commands.registerCommand("addi.editTool", async (item: ToolTreeItem) => {
          if (!item || !item.tool || !item.tool.fileName) {
              return;
          }

          const path = require('path');
          const os = require('os');
          const fs = require('fs');

          let filePath = "";
          if (item.tool.source === 'global') {
              filePath = path.join(os.homedir(), '.addi', item.tool.fileName);
          } else if (item.tool.source === 'workspace') {
                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                    const wf = vscode.workspace.workspaceFolders[0];
                    if (wf) {
                        filePath = path.join(wf.uri.fsPath, '.vscode', 'addi', item.tool.fileName);
                    }
                }
          }

          if (filePath && fs.existsSync(filePath)) {
              const doc = await vscode.workspace.openTextDocument(filePath);
              await vscode.window.showTextDocument(doc);
          } else {
              vscode.window.showErrorMessage(`Could not find file for tool: ${item.tool.fileName}`);
          }
      })
  );

}

export function deactivate() {}
