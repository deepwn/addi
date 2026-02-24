import * as vscode from 'vscode';
import { AddiChatProvider, ModelTreeItem } from '../core/providers/AddiChatProvider';
import { ProviderModelManager } from '../core/providers/ProviderModelManager';
import { LLMService } from '../core/llm/llmService';
import { AddiTreeDataProvider, ProviderTreeItem } from './views/providerView';
import { CommandHandler } from './commands';
import { logger } from '../common/logger';
import { EditorViewManager } from './views/editorView';
import { CustomToolManager } from '../infrastructure/mcp/customToolManager';
import { ToolTreeDataProvider, ToolTreeItem } from './views/toolView';
import { McpServerService } from '../infrastructure/mcp/mcpServerService';
import { McpExtensionIntegration } from './mcpIntegration';
import { StorageService } from '../infrastructure/storage/storageService';

/**
 * Composition Root & Entry Point.
 *
 * Responsibilities:
 * 1. Initialize Infrastructure Services (Storage, MCP, Logger).
 * 2. Instantiate Core Business Logic (ProviderModelManager).
 * 3. Wire Dependencies (Dependency Injection).
 * 4. Register VS Code UI Components (Commands, Views, MCP Integration).
 */
export function activate(context: vscode.ExtensionContext) {
  logger.initialize(context);
  const extension = vscode.extensions.getExtension('deepwn.addi');
  const version = extension?.packageJSON?.version ?? 'unknown';
  logger.info(`Extension activated (v${version})`, undefined, 'Extension');

  // Initialize Services (Infrastructure)
  const storageService = new StorageService(context);
  const mcpService = McpServerService.getInstance(context);
  const toolManager = new CustomToolManager();

  const applySettingsSyncPreference = () => {
    const config = vscode.workspace.getConfiguration('addi');
    const enableSync = config.get<boolean>('saveConfigToSettingsSync', true);
    storageService.setSettingsSync(Boolean(enableSync));
    logger.debug('Updated settings sync preference', { enableSync });
  };

  applySettingsSyncPreference();

  context.subscriptions.push(new vscode.Disposable(() => mcpService.dispose()));
  mcpService
    .initialize()
    .catch((err) => logger.error('Failed to initialize MCP Server', err, 'MCP'));

  // Initialize Core Managers with Dependencies
  const manager = new ProviderModelManager(storageService);
  // context.subscriptions.push(new vscode.Disposable(() => manager.dispose())); // Manager no longer needs dispose if it strictly manages logic

  const treeDataProvider = new AddiTreeDataProvider(manager);
  context.subscriptions.push(manager.onDidUpdate(() => treeDataProvider.refresh()));
  vscode.window.registerTreeDataProvider('addiProviders', treeDataProvider);

  // Register MCP Integration
  const mcpIntegration = new McpExtensionIntegration(context, mcpService, toolManager);
  mcpIntegration.register();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('addi')) {
        applySettingsSyncPreference();
        treeDataProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('addi.showLogs', () => {
      logger.show();
    })
  );

  // Custom Tools
  // const toolManager = new CustomToolManager(); // Moved to top
  const toolTreeDataProvider = new ToolTreeDataProvider(toolManager);
  vscode.window.registerTreeDataProvider('addiTools', toolTreeDataProvider);

  // Register Addi Tool Provider (Bridge for global tools)
  // const addiToolProvider = new AddiToolProvider(toolManager, context);
  // addiToolProvider.register(context);

  // Debug command to list registered tools
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.debug.listTools', () => {
      const tools = vscode.lm.tools;
      const names = tools.map((t) => t.name).join(', ');
      vscode.window.showInformationMessage(`Registered LM Tools: ${names}`);
      logger.info('Registered LM Tools', {
        tools: tools.map((t) => ({ name: t.name, tags: t.tags })),
      });
    })
  );

  const llmService = new LLMService(toolManager, mcpService);
  vscode.lm.registerLanguageModelChatProvider(
    'addi-provider',
    new AddiChatProvider(manager, llmService)
  );

  const treeView = vscode.window.createTreeView('addiProviders', {
    treeDataProvider,
    showCollapseAll: true,
    canSelectMany: true,
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

  const commandHandler = new CommandHandler(manager, treeDataProvider, context, llmService);

  context.subscriptions.push(
    vscode.commands.registerCommand('addi.manage', async () => {
      await vscode.commands.executeCommand('addiProviders.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('addi.refresh', () => {
      treeDataProvider.refresh();
      logger.info('Manual refresh triggered');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('addi.addProvider', () => commandHandler.addProvider())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.editProvider', (item: ProviderTreeItem) =>
      commandHandler.editProvider(item)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.copyProvider', (item: ProviderTreeItem) =>
      commandHandler.copyProvider(item)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.deleteProvider', (item: ProviderTreeItem) =>
      commandHandler.deleteProvider(item)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.pullProviderModels', (item: ProviderTreeItem) =>
      commandHandler.pullProviderModels(item)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.addModel', (item: ProviderTreeItem) =>
      commandHandler.addModel(item)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.editApiKey', (item: ProviderTreeItem) =>
      commandHandler.editApiKey(item)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.editModel', (item: ModelTreeItem) =>
      commandHandler.editModel(item)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.copyModel', (item: ModelTreeItem) =>
      commandHandler.copyModel(item)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.deleteModel', (item: ModelTreeItem) =>
      commandHandler.deleteModel(item)
    )
  );
  // Batch operations for multiple selection
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.deleteModels', (items: ModelTreeItem[]) =>
      commandHandler.deleteModels(items)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.batchEditModels', (items: ModelTreeItem[]) =>
      commandHandler.batchEditModels(items)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.exportConfig', () => commandHandler.exportConfig())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.importConfig', () => commandHandler.importConfig())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:deepwn.addi');
    })
  );

  const editorManager = new EditorViewManager(context.extensionUri, manager, () =>
    treeDataProvider.refresh()
  );
  commandHandler.setEditorViewManager(editorManager);

  context.subscriptions.push(
    vscode.commands.registerCommand('addi.addTool', async () => {
      // Create a template file
      const name = await vscode.window.showInputBox({
        prompt: 'Tool Name (filename)',
        placeHolder: 'my-tool',
      });
      if (!name) {
        return;
      }

      const scope = await vscode.window.showQuickPick(
        [
          'Workspace Public (.addi/public)',
          'Workspace Private (.addi/private)',
          'Global (~/.addi/)',
        ],
        {
          placeHolder: 'Where to create?',
        }
      );
      if (!scope) {
        return;
      }

      let dirPath = '';
      if (scope.startsWith('Workspace Public')) {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
          vscode.window.showErrorMessage('No workspace open.');
          return;
        }
        const wf = vscode.workspace.workspaceFolders[0];
        if (wf) {
          dirPath = vscode.Uri.joinPath(wf.uri, '.addi', 'public').fsPath;
        } else {
          return;
        }
      } else if (scope.startsWith('Workspace Private')) {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
          vscode.window.showErrorMessage('No workspace open.');
          return;
        }
        const wf = vscode.workspace.workspaceFolders[0];
        if (wf) {
          dirPath = vscode.Uri.joinPath(wf.uri, '.addi', 'private').fsPath;
        } else {
          return;
        }
      } else {
        const os = require('os');
        const path = require('path');
        dirPath = path.join(os.homedir(), '.addi');
      }

      const fs = require('fs');
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const filePath = `${dirPath}/${name}.yaml`;

      const content = `name: ${name}
description: Description of what this tool does
inputs:
  arg1:
    description: Argument description
    default: "value"
runs:
  using: "composite"
  steps:
    - name: print
      run: echo \${{ inputs.arg1 }}
      shell: bash
`;

      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      fs.writeFileSync(filePath, content);
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);
    })
  );

  // Info button: show tip and open .gitignore when requested
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.gitIgnoreInfo', async () => {
      if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showInformationMessage(
          'Open a workspace to manage .gitignore for Addi tools.'
        );
        return;
      }
      const wf = vscode.workspace.workspaceFolders![0]!;
      const path = require('path');
      const fs = require('fs');
      const gitignorePath = path.join(wf.uri.fsPath, '.gitignore');
      const open = await vscode.window.showInformationMessage(
        'Private tools are best kept out of the repo. Click Open to edit .gitignore.',
        'Open',
        'Cancel'
      );
      if (open === 'Open') {
        if (!fs.existsSync(gitignorePath)) {
          try {
            fs.writeFileSync(gitignorePath, '.addi/*.ignore.yaml\n', 'utf8');
          } catch (e) {
            vscode.window.showErrorMessage('Failed to create .gitignore');
            return;
          }
        }
        const doc = await vscode.workspace.openTextDocument(gitignorePath);
        await vscode.window.showTextDocument(doc);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('addi.deleteTool', async (item: ToolTreeItem) => {
      if (item && item.tool && item.tool.fileName) {
        const confirm = await vscode.window.showWarningMessage(
          `Delete tool file "${item.tool.fileName}"?`,
          'Yes',
          'No'
        );
        if (confirm === 'Yes') {
          const fs = require('fs');
          const path = require('path');
          const os = require('os');

          let filePath = '';
          if (item.tool.source === 'global') {
            filePath = path.join(os.homedir(), '.addi', item.tool.fileName);
          } else if (item.tool.source === 'workspace') {
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
              const wf = vscode.workspace.workspaceFolders[0];
              if (wf) {
                // Check visibility to determine subfolder
                const subfolder = item.tool.visibility === 'private' ? 'private' : 'public';
                filePath = path.join(wf.uri.fsPath, '.addi', subfolder, item.tool.fileName);

                // Fallback check for legacy .vscode/addi location if not found
                if (!fs.existsSync(filePath)) {
                  const legacyPath = path.join(
                    wf.uri.fsPath,
                    '.vscode',
                    'addi',
                    item.tool.fileName
                  );
                  if (fs.existsSync(legacyPath)) {
                    filePath = legacyPath;
                  }
                }
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
    vscode.commands.registerCommand('addi.editTool', async (item: ToolTreeItem) => {
      if (!item || !item.tool || !item.tool.fileName) {
        return;
      }

      const path = require('path');
      const os = require('os');
      const fs = require('fs');

      let filePath = '';
      if (item.tool.source === 'global') {
        filePath = path.join(os.homedir(), '.addi', item.tool.fileName);
      } else if (item.tool.source === 'workspace') {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
          const wf = vscode.workspace.workspaceFolders[0];
          if (wf) {
            // Check visibility to determine subfolder
            const subfolder = item.tool.visibility === 'private' ? 'private' : 'public';
            filePath = path.join(wf.uri.fsPath, '.addi', subfolder, item.tool.fileName);

            // Fallback check for legacy .vscode/addi location if not found
            if (!fs.existsSync(filePath)) {
              const legacyPath = path.join(wf.uri.fsPath, '.vscode', 'addi', item.tool.fileName);
              if (fs.existsSync(legacyPath)) {
                filePath = legacyPath;
              }
            }
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

  // Copy tool command
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.copyTool', async (item: ToolTreeItem) => {
      if (!item || !item.tool || !item.tool.fileName) {
        return;
      }
      const fs = require('fs');
      const path = require('path');
      const os = require('os');

      let src = '';
      if (item.tool.source === 'global') {
        src = path.join(os.homedir(), '.addi', item.tool.fileName);
      } else {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
          return;
        }
        const wf = vscode.workspace.workspaceFolders[0];
        if (!wf) {
          return;
        }
        const vis = (item.tool as any).visibility || 'public';
        src = path.join(
          wf.uri.fsPath,
          '.addi',
          vis === 'private' ? 'private' : 'public',
          item.tool.fileName
        );
      }

      if (!fs.existsSync(src)) {
        vscode.window.showErrorMessage('Tool file not found: ' + src);
        return;
      }
      const parsed = path.parse(item.tool.fileName);
      const destName = parsed.name + '-copy' + parsed.ext;
      let dest = '';
      if (item.tool.source === 'global') {
        dest = path.join(os.homedir(), '.addi', destName);
      } else {
        const wf = vscode.workspace.workspaceFolders![0];
        if (!wf) {
          return;
        }
        const vis = (item.tool as any).visibility || 'public';
        dest = path.join(
          wf.uri.fsPath,
          '.addi',
          vis === 'private' ? 'private' : 'public',
          destName
        );
      }
      fs.copyFileSync(src, dest);
      const doc = await vscode.workspace.openTextDocument(dest);
      await vscode.window.showTextDocument(doc);
    })
  );

  // Run tool command
  context.subscriptions.push(
    vscode.commands.registerCommand('addi.runTool', async (item: ToolTreeItem) => {
      if (!item || !item.tool) {
        return;
      }

      const tool = item.tool;

      // Build input form based on tool.parameters (use property keys directly)
      const inputsList: Array<{ key: string; options: vscode.InputBoxOptions }> = [];

      if (tool.parameters && typeof tool.parameters === 'object') {
        const params = tool.parameters as any;
        if (params.properties) {
          for (const [key, prop] of Object.entries(params.properties)) {
            const propDef = prop as any;
            const placeholder = propDef.description || `Enter ${key}`;
            const defaultValue = propDef.default !== undefined ? String(propDef.default) : '';

            inputsList.push({
              key,
              options: {
                prompt: propDef.description || `Enter value for ${key}`,
                placeHolder: placeholder,
                value: defaultValue,
                ignoreFocusOut: true,
              },
            });
          }
        }
      }

      // Collect input values by iterating known keys (keeps mapping correct)
      let inputValues: Record<string, string> = {};
      if (inputsList.length > 0) {
        for (const item of inputsList) {
          const result = await vscode.window.showInputBox(item.options);
          if (result === undefined) {
            // User cancelled
            return;
          }
          inputValues[item.key] = result;
        }
      }

      // Show running status
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Running tool: ${tool.name}`,
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: 'Executing tool...' });

            // Execute the tool via MCP server
            const result = await mcpService.callTool(tool.name, inputValues);

            if (result && result.content && Array.isArray(result.content)) {
              // Format the result for display
              const resultText = result.content
                .map((item: any) => {
                  if (item.type === 'text') {
                    return item.text;
                  } else if (item.type === 'image') {
                    return `[Image: ${item.data}]`;
                  }
                  return JSON.stringify(item);
                })
                .join('\n');

              // Show result in a new document
              const resultDoc = await vscode.workspace.openTextDocument({
                content: `# Tool Result: ${tool.name}\n\nInput:\n${JSON.stringify(inputValues, null, 2)}\n\nOutput:\n${resultText}`,
                language: 'markdown',
              });
              await vscode.window.showTextDocument(resultDoc);
            } else {
              vscode.window.showInformationMessage(`Tool executed successfully: ${tool.name}`);
            }
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to run tool: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      );
    })
  );
}

export function deactivate() {}
