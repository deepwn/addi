import * as vscode from 'vscode';
import { BaseCommandHandler } from './base';
import type { ProviderTreeItem } from '../views/providerView';
import type { ModelTreeItem } from '../views/treeItems';
import { logger, LogScope } from '../../common/logger';

/**
 * Model-related command handler (BYOK Edition)
 */
export class ModelCommandHandler extends BaseCommandHandler {
  async addModel(item: ProviderTreeItem): Promise<void> {
    this.editorViewManager?.openEditor(undefined, 'create', item.provider.name);
  }

  async editModels(items: ModelTreeItem[]): Promise<void> {
    if (!items?.length) return;
    this.editorViewManager?.openEditor(items, 'edit');
  }

  async deleteModels(items: ModelTreeItem[]): Promise<void> {
    if (!items?.length) return;

    const providerName = items[0]!.providerName;
    const count = items.length;
    const message =
      count === 1 && items[0]
        ? vscode.l10n.t('Are you sure you want to delete the model "{0}"?', items[0].model.id)
        : vscode.l10n.t('Are you sure you want to delete {0} model(s)?', count);

    const confirmed = await vscode.window.showWarningMessage(message, { modal: false }, vscode.l10n.t('Delete'));
    if (!confirmed) return;

    try {
      await this.manager.deleteModels(providerName, items.map((i) => i.model.id));
      this.refreshTreeView();
      vscode.window.showInformationMessage(vscode.l10n.t('{0} model(s) deleted', count));
    } catch (error) {
      vscode.window.showErrorMessage(
        vscode.l10n.t('Failed to delete models: {0}', error instanceof Error ? error.message : 'Unknown error'),
      );
    }
  }

  async copyModel(item: ModelTreeItem): Promise<void> {
    const result = this.manager.findModel(item.model.id);
    if (!result) {
      vscode.window.showErrorMessage(vscode.l10n.t('Parent provider not found'));
      return;
    }

    const { id: _id, ...modelWithoutId } = item.model;
    const prefill = {
      ...modelWithoutId,
      name: `${item.model.name || item.model.id} ${vscode.l10n.t('Copy')}`,
    };
    this.editorViewManager?.openEditor(undefined, 'create', result.provider.name, prefill);
  }

  /**
   * Select a model in VS Code Copilot chat.
   * Only works for models with toolCalling support.
   */
  async selectModel(item: ModelTreeItem): Promise<void> {
    if (!item.model.toolCalling) {
      vscode.window.showWarningMessage(
        vscode.l10n.t('Model "{0}" does not support tool calling and cannot be used in Copilot.', item.model.name || item.model.id),
      );
      return;
    }

    try {
      await vscode.lm.selectChatModels({
        vendor: 'copilot',
        family: item.model.id,
      });

      // Open and focus chat
      try {
        await vscode.commands.executeCommand('workbench.action.chat.open');
      } catch {
        // Ignore if already open
      }

      logger.info('Chat model selected', { modelId: item.model.id, provider: item.providerName }, LogScope.COMMAND);
    } catch (error) {
      logger.warn('Failed to select chat model', {
        error: error instanceof Error ? error.message : String(error),
        modelId: item.model.id,
      });
      vscode.window.showErrorMessage(
        vscode.l10n.t('Failed to select model in Chat. Please try selecting it manually.'),
      );
    }
  }
}
