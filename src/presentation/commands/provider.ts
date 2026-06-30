import * as vscode from "vscode";
import { BaseCommandHandler, resolveApiKey } from "./base";
import type { ProviderTreeItem } from "../views/providerView";
import { getProviderDefaults } from "../../services/byokTypes";
import { fetchProviderModels } from "../../services/remoteModelFetcher";
import type { ByokModel, ByokProvider } from "../../services/byokTypes";
import { logger, LogScope } from "../../common/logger";

/**
 * Provider-related command handler (BYOK Edition)
 */
export class ProviderCommandHandler extends BaseCommandHandler {
  async addProvider(): Promise<void> {
    this.editorViewManager?.openEditor(undefined, "create");
  }

  async editProvider(item: ProviderTreeItem): Promise<void> {
    this.editorViewManager?.openEditor(item, "edit");
  }

  async deleteProvider(item: ProviderTreeItem): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'Are you sure you want to delete provider "{0}"? This will also delete all of its models.',
        item.provider.name,
      ),
      { modal: false },
      vscode.l10n.t("Delete"),
    );
    if (!confirmed) return;

    try {
      await this.manager.deleteProvider(item.provider.name);
      this.refreshTreeView();
      vscode.window.showInformationMessage(
        vscode.l10n.t('Provider "{0}" deleted', item.provider.name),
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        vscode.l10n.t(
          "Failed to delete provider: {0}",
          error instanceof Error ? error.message : "Unknown error",
        ),
      );
    }
  }

  async copyProvider(item: ProviderTreeItem): Promise<void> {
    const { models: _models, ...providerData } = item.provider;
    this.editorViewManager?.openEditor(undefined, "create", undefined, {
      ...providerData,
      name: `${item.provider.name} ${vscode.l10n.t("Copy")}`,
    } as Partial<ByokProvider>);
  }

  /**
   * Sync models from remote listApi endpoint.
   * Fetches the model list, auto-adds new models, and prompts for stale ones.
   */
  async syncProviderModels(item: ProviderTreeItem): Promise<void> {
    const provider = item.provider;
    const defaults = getProviderDefaults(provider);

    if (!defaults.listApi) {
      vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Provider "{0}" has no listApi configured. Set it in the provider _addi settings.',
          provider.name,
        ),
      );
      return;
    }

    if (!provider.apiKey) {
      vscode.window.showWarningMessage(
        vscode.l10n.t('Provider "{0}" has no API key. Please configure one first.', provider.name),
      );
      return;
    }

    // Resolve API key (handles ${input:...} secret references)
    const apiKey = await resolveApiKey(provider.apiKey, provider.name, this.context);

    if (!apiKey) {
      vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Cannot resolve API key for provider "{0}". Please enter the key when prompted.',
          provider.name,
        ),
      );
      return;
    }

    try {
      const remoteModels = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t("Fetching models for {0}...", provider.name),
          cancellable: false,
        },
        async () => {
          return await fetchProviderModels(provider, apiKey);
        },
      );

      if (remoteModels.length === 0) {
        vscode.window.showWarningMessage(
          vscode.l10n.t("No models returned from {0}. Check the listApi endpoint.", provider.name),
        );
        return;
      }

      const existingIds = new Set((provider.models || []).map((m) => m.id));
      const remoteIds = new Set(remoteModels.map((m) => m.id));

      // Auto-add new models (in remote but not in local)
      let addedCount = 0;
      for (const remote of remoteModels) {
        if (!existingIds.has(remote.id)) {
          const newModel: ByokModel = {
            id: remote.id,
            name: remote.name || remote.id,
            toolCalling: defaults.toolCalling ?? true,
            vision: defaults.vision ?? false,
            thinking: defaults.thinking ?? false,
            streaming: defaults.streaming ?? true,
            maxInputTokens: remote.maxInputTokens || defaults.maxInputTokens || 128000,
            maxOutputTokens: remote.maxOutputTokens || defaults.maxOutputTokens || 64000,
          };
          await this.manager.addModel(provider.name, newModel);
          addedCount++;
        }
      }

      // Find stale models (in local but not in remote)
      const staleIds: string[] = [];
      for (const mid of existingIds) {
        if (!remoteIds.has(mid)) {
          staleIds.push(mid);
        }
      }

      if (addedCount > 0) {
        vscode.window.showInformationMessage(
          vscode.l10n.t('{0} new model(s) added to "{1}".', addedCount, provider.name),
        );
      }

      if (staleIds.length > 0) {
        const staleList = staleIds.map((id) => `  • ${id}`).join("\n");
        const remove = await vscode.window.showWarningMessage(
          vscode.l10n.t(
            '{0} model(s) in "{1}" were not found in the remote list:\n\n{2}\n\nRemove them?',
            staleIds.length,
            provider.name,
            staleList,
          ),
          { modal: true },
          vscode.l10n.t("Remove"),
          vscode.l10n.t("Keep"),
        );

        if (remove === vscode.l10n.t("Remove")) {
          const deleted = await this.manager.deleteModels(provider.name, staleIds);
          vscode.window.showInformationMessage(
            vscode.l10n.t('{0} stale model(s) removed from "{1}".', deleted, provider.name),
          );
        }
      }

      this.refreshTreeView();

      if (addedCount === 0 && staleIds.length === 0) {
        vscode.window.showInformationMessage(
          vscode.l10n.t(
            'All {0} models for "{1}" are up to date.',
            remoteModels.length,
            provider.name,
          ),
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        vscode.l10n.t(
          "Failed to sync models: {0}",
          error instanceof Error ? error.message : "Unknown error",
        ),
      );
      logger.error("syncProviderModels failed", error, LogScope.COMMAND);
    }
  }
}
