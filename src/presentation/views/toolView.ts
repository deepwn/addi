import * as vscode from 'vscode';
import { CustomToolManager } from '../../infrastructure/mcp/customToolManager';
import { CustomTool } from '../../common/types';
import { McpServerService } from '../../infrastructure/mcp/mcpServerService';

export class ToolTreeDataProvider implements vscode.TreeDataProvider<ToolTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ToolTreeItem | undefined | null | void> =
    new vscode.EventEmitter<ToolTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ToolTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  constructor(
    private manager: CustomToolManager,
    private context: vscode.ExtensionContext
  ) {
    this.manager.onDidUpdate(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ToolTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ToolTreeItem): Thenable<ToolTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }
    const tools = this.manager.getTools();

    if (tools.length === 0) {
      const mcpService = McpServerService.getInstance(this.context);
      if (!mcpService.isBinaryAvailable()) {
        return Promise.resolve([
          new ToolTreeItem(
            null,
            'Download MCP Server',
            'Click to download the required MCP server binary'
          ),
        ]);
      }
      return Promise.resolve([
        new ToolTreeItem(
          null,
          'No tools found',
          'Create a .addi/public/*.yaml file to add tools',
          false
        ),
      ]);
    }
    return Promise.resolve(tools.map((t) => new ToolTreeItem(t)));
  }
}

export class ToolTreeItem extends vscode.TreeItem {
  constructor(
    public readonly tool: CustomTool | null,
    label?: string,
    description?: string,
    isDownloadAction: boolean = true
  ) {
    super(label || tool!.name, vscode.TreeItemCollapsibleState.None);

    if (!tool) {
      this.description = description || '';
      this.contextValue = 'empty';
      this.iconPath = new vscode.ThemeIcon('info');

      if (isDownloadAction && label === 'Download MCP Server') {
        this.command = {
          command: 'addi.downloadMcpServer',
          title: 'Download MCP Server',
          arguments: [],
        };
        this.iconPath = new vscode.ThemeIcon('cloud-download');
      }
      return;
    }

    this.tooltip = `${tool.description}\nSource: ${tool.source}\nFile: ${tool.fileName}`;
    this.description = `${tool.steps.length} steps (${tool.source})`;
    this.contextValue = 'tool';
    // Choose icon by visibility when available (public/private/global)
    const vis = (tool as any).visibility || (tool.source === 'global' ? 'global' : 'public');
    if (vis === 'global') {
      this.iconPath = new vscode.ThemeIcon('globe');
    } else if (vis === 'private') {
      this.iconPath = new vscode.ThemeIcon('lock');
    } else {
      this.iconPath = new vscode.ThemeIcon('file-code');
    }
  }
}
