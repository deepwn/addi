import * as vscode from 'vscode';
import { CustomToolManager } from '../services/customToolManager';
import { CustomTool } from '../types';

export class ToolTreeDataProvider implements vscode.TreeDataProvider<ToolTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ToolTreeItem | undefined | null | void> = new vscode.EventEmitter<ToolTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ToolTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private manager: CustomToolManager) {
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
        return Promise.resolve(tools.map(t => new ToolTreeItem(t)));
    }
}

export class ToolTreeItem extends vscode.TreeItem {
    constructor(public readonly tool: CustomTool) {
        super(tool.name, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${tool.description}\nSource: ${tool.source}\nFile: ${tool.fileName}`;
        this.description = `${tool.steps.length} steps (${tool.source})`;
        this.contextValue = 'tool';
        this.iconPath = new vscode.ThemeIcon(tool.source === 'global' ? 'globe' : 'file-code');
    }
}
