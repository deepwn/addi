import * as vscode from 'vscode';
import type { ByokModel } from '../../services/byokTypes';

/**
 * Tree item representing a single AI model in the provider tree view.
 * Adapted for BYOK native types — uses LMModel.id as tree item id.
 */
export class ModelTreeItem extends vscode.TreeItem {
  constructor(
    public model: ByokModel,
    public providerName: string,
    public hasApiKey = false,
  ) {
    super(model.name || model.id, vscode.TreeItemCollapsibleState.None);
    this.id = `${providerName}::${model.id}`;

    this.contextValue = hasApiKey ? 'model' : 'model-no-key';

    const capabilityHints: string[] = [];
    if (model.toolCalling) capabilityHints.push('tool');
    if (model.thinking) capabilityHints.push('think');
    if (model.vision) capabilityHints.push('vision');

    const formatTokens = (val?: number): string => {
      if (!val) return '?';
      if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M';
      if (val >= 1_000) return (val / 1_000).toFixed(0) + 'K';
      return String(val);
    };

    const label = this.label;
    const displayName: string = (label !== undefined && typeof label !== 'string') ? label.label : (typeof label === 'string' ? label : this.model.id);
    let tooltip = `${vscode.l10n.t('name: {0}', displayName)}\n`;
    tooltip += `${vscode.l10n.t('provider: {0}', providerName)}\n`;
    tooltip += `${vscode.l10n.t('id: {0}', model.id)}\n`;
    if (model.url) tooltip += `${vscode.l10n.t('url: {0}', model.url)}\n`;
    tooltip += `${vscode.l10n.t('input: {0}', formatTokens(model.maxInputTokens))}\n`;
    tooltip += `${vscode.l10n.t('output: {0}', formatTokens(model.maxOutputTokens))}`;
    if (capabilityHints.length > 0) {
      tooltip += `\n${vscode.l10n.t('capabilities: {0}', capabilityHints.join(', '))}`;
    }
    if (!model.toolCalling) {
      tooltip += `\n\n${vscode.l10n.t('⚠ Model does not support tool calling and cannot be used in Copilot.')}`;
    }

    this.tooltip = tooltip;
    const inputSummary = formatTokens(model.maxInputTokens);
    const outputSummary = formatTokens(model.maxOutputTokens);
    this.description = ` · ${inputSummary}↑/${outputSummary}↓`;
  }
}

/**
 * Normalize tree items argument to an array.
 */
export function normalizeTreeItems<T>(arg: T | T[]): T[] {
  return Array.isArray(arg) ? arg : [arg];
}
