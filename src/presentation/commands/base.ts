import type * as vscode from 'vscode';
import type { ProviderModelManager } from '../../core/providers/ProviderModelManager';
import type { AddiTreeDataProvider } from '../views/providerView';
import type { EditorViewManager } from '../views/editorView';
import { logger, LogScope } from '../../common/logger';

/**
 * Base command handler with common dependencies
 */
export abstract class BaseCommandHandler {
  protected manager: ProviderModelManager;
  protected treeDataProvider: AddiTreeDataProvider;
  protected context: vscode.ExtensionContext;
  protected editorViewManager?: EditorViewManager;

  constructor(
    manager: ProviderModelManager,
    treeDataProvider: AddiTreeDataProvider,
    context: vscode.ExtensionContext,
  ) {
    this.manager = manager;
    this.treeDataProvider = treeDataProvider;
    this.context = context;
  }

  public setEditorViewManager(m: EditorViewManager) {
    this.editorViewManager = m;
  }

  protected refreshTreeView(): void {
    this.treeDataProvider.refresh();
  }

  protected logError(source: string, error: unknown, context?: Record<string, unknown>): void {
    logger.error(
      source,
      {
        error: error instanceof Error ? error.message : String(error),
        ...context,
      },
      LogScope.COMMAND,
    );
  }
}
