import * as vscode from 'vscode';
import { Provider } from '../../common/types';
import { ProviderModelManager } from '../../core/providers/ProviderModelManager';
import { ModelTreeItem } from '../../core/providers/AddiChatProvider';

export class ProviderTreeItem extends vscode.TreeItem {
  constructor(public provider: Provider) {
    super(provider.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = provider.id;

    // Set contextValue based on whether API key exists
    const hasApiKey = provider.apiKey && provider.apiKey.trim() !== '';
    this.contextValue = hasApiKey ? 'provider' : 'provider-no-key';

    if (provider.description) {
      this.description = provider.description;
    }

    let tooltip = `${provider.name} (${provider.models.length} models)`;
    if (!hasApiKey) {
      tooltip += `\nAPI key not configured yet. Please set it up to use this provider.`;
    }
    if (provider.description) {
      tooltip += `\nDescription: ${provider.description}`;
    }
    if (provider.website) {
      tooltip += `\nWebsite: ${provider.website}`;
    }
    if (provider.apiEndpoint) {
      tooltip += `\nAPI Endpoint: ${provider.apiEndpoint}`;
    }
    if (provider.providerType) {
      tooltip += `\nType: ${provider.providerType}`;
    }
    this.tooltip = tooltip;
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
    const config = vscode.workspace.getConfiguration('addi');
    const sortRule = config.get<string>('sortRule', 'none');
    const sortTarget = config.get<string>('sortTarget', 'both');

    if (!element) {
      let providers = this.manager.getProviders();
      // Sort providers only if target includes providers
      if (sortRule !== 'none' && (sortTarget === 'providers' || sortTarget === 'both')) {
        if (sortRule === 'alphabet') {
          providers = [...providers].sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
          );
        } else if (sortRule === 'input tokens') {
          providers = [...providers].sort((a, b) => {
            const maxA = Math.max(...a.models.map((m) => m.maxInputTokens || 0), 0);
            const maxB = Math.max(...b.models.map((m) => m.maxInputTokens || 0), 0);
            return maxB - maxA;
          });
        } else if (sortRule === 'output tokens') {
          providers = [...providers].sort((a, b) => {
            const maxA = Math.max(...a.models.map((m) => m.maxOutputTokens || 0), 0);
            const maxB = Math.max(...b.models.map((m) => m.maxOutputTokens || 0), 0);
            return maxB - maxA;
          });
        }
      }
      return providers.map((p) => new ProviderTreeItem(p));
    }
    if (element instanceof ProviderTreeItem) {
      let models = [...element.provider.models];
      // Sort models only if target includes models
      if (sortRule !== 'none' && (sortTarget === 'models' || sortTarget === 'both')) {
        models.sort((a, b) => {
          if (sortRule === 'alphabet') {
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          }
          // Numeric sort for tokens (more to less)
          if (sortRule === 'input tokens') {
            return (b.maxInputTokens || 0) - (a.maxInputTokens || 0);
          }
          if (sortRule === 'output tokens') {
            return (b.maxOutputTokens || 0) - (a.maxOutputTokens || 0);
          }
          return 0;
        });
      }
      return models.map((m) => new ModelTreeItem(m));
    }
    return [];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}
