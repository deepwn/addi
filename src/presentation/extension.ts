import * as vscode from 'vscode';
import { ProviderModelManager } from '../core/providers/ProviderModelManager';
import { ByokFileManager } from '../services/byokFileManager';
import { AddiTreeDataProvider, type ProviderTreeItem } from './views/providerView';
import { type ModelTreeItem, normalizeTreeItems } from './views/treeItems';
import { CommandHandler } from './commands';
import { EditorViewManager } from './views/editorView';
import { logger, LogScope } from '../common/logger';

/**
 * Activation Entry Point (BYOK Edition)
 *
 * Addi is a visual editor for the user-level chatLanguageModels.json
 * (%APPDATA%/Code/User/chatLanguageModels.json).
 * VS Code Copilot handles all agent/chat interactions natively.
 */
export function activate(context: vscode.ExtensionContext) {
  logger.initialize(context);
  logger.info('Addi BYOK extension activated', undefined, LogScope.EXTENSION);

  // BYOK file manager (reads/writes user-level chatLanguageModels.json)
  const fileManager = new ByokFileManager();
  context.subscriptions.push(fileManager);
  fileManager.initialize(); // ensure config is loaded before tree renders

  // Core manager (wraps ByokFileManager)
  const manager = new ProviderModelManager(fileManager);
  const treeDataProvider = new AddiTreeDataProvider(manager);
  context.subscriptions.push(manager.onDidUpdate(() => treeDataProvider.refresh()));
  vscode.window.registerTreeDataProvider('addiProviders', treeDataProvider);

  // Auto-refresh when BYOK config file changes externally
  context.subscriptions.push(
    manager.onDidUpdate(() => treeDataProvider.refresh()),
  );

  // Refresh when VS Code's chat model list changes
  context.subscriptions.push(
    vscode.lm.onDidChangeChatModels(() => treeDataProvider.refresh()),
  );

  // Tree view (multi-select support)
  const treeView = vscode.window.createTreeView('addiProviders', {
    treeDataProvider,
    showCollapseAll: true,
    canSelectMany: true,
  });
  context.subscriptions.push(treeView);

  // Command handler
  const commandHandler = new CommandHandler(manager, treeDataProvider, context);

  // Editor webview manager
  const editorViewManager = new EditorViewManager(context.extensionUri, manager, () =>
    treeDataProvider.refresh(),
  );
  commandHandler.setEditorViewManager(editorViewManager);

  // ----- Helper: register command with error handling -----
  function registerCmd(id: string, handler: (...args: never[]) => unknown): void {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          await (handler as (...a: unknown[]) => unknown)(...args);
        } catch (error) {
          vscode.window.showErrorMessage(
            vscode.l10n.t('Command {0} failed: {1}', id, error instanceof Error ? error.message : String(error)),
          );
          logger.error(`Command ${id} failed`, error, LogScope.COMMAND);
        }
      }),
    );
  }

  // Helper: resolve multi-select items
  function resolveModelItems(item: ModelTreeItem | ModelTreeItem[]): ModelTreeItem[] {
    let items = normalizeTreeItems(item);
    if (items.length <= 1) {
      const sel = treeView.selection as ModelTreeItem[];
      if (sel && sel.length > 1) items = sel;
    }
    return items;
  }

  // ==================== Commands ====================
  registerCmd('addi.manage', async () => {
    await vscode.commands.executeCommand('addiProviders.focus');
  });

  // Provider commands
  registerCmd('addi.addProvider', () => commandHandler.addProvider());
  registerCmd('addi.editProvider', (item: ProviderTreeItem) => commandHandler.editProvider(item));
  registerCmd('addi.copyProvider', (item: ProviderTreeItem) => commandHandler.copyProvider(item));
  registerCmd('addi.deleteProvider', (item: ProviderTreeItem) => commandHandler.deleteProvider(item));
  registerCmd('addi.syncProviderModels', (item: ProviderTreeItem) => commandHandler.syncProviderModels(item));

  // Model commands
  registerCmd('addi.addModel', (item: ProviderTreeItem) => commandHandler.addModel(item));
  registerCmd('addi.editModels', (item: ModelTreeItem | ModelTreeItem[]) =>
    commandHandler.editModels(resolveModelItems(item)),
  );
  registerCmd('addi.deleteModels', (item: ModelTreeItem | ModelTreeItem[]) =>
    commandHandler.deleteModels(resolveModelItems(item)),
  );
  registerCmd('addi.copyModel', (item: ModelTreeItem) => commandHandler.copyModel(item));
  registerCmd('addi.selectModel', (item: ModelTreeItem) => commandHandler.selectModel(item));

  // Config commands
  registerCmd('addi.openConfig', () => commandHandler.openConfig());
}

export function deactivate() {}
