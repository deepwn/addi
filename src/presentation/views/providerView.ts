import * as vscode from 'vscode';
import type { ByokProvider } from '../../services/byokTypes';
import { getProviderDefaults } from '../../services/byokTypes';
import type { ProviderModelManager } from '../../core/providers/ProviderModelManager';
import { ModelTreeItem } from './treeItems';

export class ProviderTreeItem extends vscode.TreeItem {
  constructor(
    public provider: ByokProvider,
    public hasApiKey = false,
  ) {
    super(provider.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = provider.name;

    if (hasApiKey) {
      this.contextValue = 'provider';
    } else {
      this.contextValue = 'provider-no-key';
    }

    // Show sync icon if listApi is configured
    const defaults = getProviderDefaults(provider);
    if (defaults.listApi) {
      this.iconPath = new vscode.ThemeIcon('sync');
    }

    const modelCount = provider.models?.length ?? 0;
    let tooltip = vscode.l10n.t('{0} models', modelCount);

    tooltip += `\n${vscode.l10n.t('vendor: {0}', provider.vendor)}`;
    if (provider.apiType) {
      tooltip += `\n${vscode.l10n.t('API: {0}', provider.apiType)}`;
    }

    if (!hasApiKey) {
      tooltip += `\n${vscode.l10n.t('⚠ API key not configured yet.')}`;
    }

    if (defaults.listApi) {
      tooltip += `\n${vscode.l10n.t('📡 listApi: {0}', defaults.listApi)}`;
    }

    this.tooltip = tooltip;
    this.description = `${provider.vendor} · ${modelCount} models`;
  }
}

export class AddiTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private manager: ProviderModelManager) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    return this._getChildren(element);
  }

  private async _getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      const providers = this.manager.getProviders();
      return providers.map((p) => {
        const hasApiKey = !!p.apiKey?.trim();
        return new ProviderTreeItem(p, hasApiKey);
      });
    }

    if (element instanceof ProviderTreeItem) {
      const models = element.provider.models ?? [];
      const hasApiKey = !!(element.provider.apiKey?.trim());
      return models.map((m) => new ModelTreeItem(m, element.provider.name, hasApiKey));
    }

    return [];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}
