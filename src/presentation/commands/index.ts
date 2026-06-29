import type * as vscode from 'vscode';
import type { ProviderModelManager } from '../../core/providers/ProviderModelManager';
import type { AddiTreeDataProvider } from '../views/providerView';
import type { ProviderTreeItem } from '../views/providerView';
import type { ModelTreeItem } from '../views/treeItems';
import type { EditorViewManager } from '../views/editorView';
import { ProviderCommandHandler } from './provider';
import { ModelCommandHandler } from './model';
import { ConfigCommandHandler } from './config';

/**
 * Command Handler - Facade that delegates to specialized handlers (BYOK Edition)
 */
export class CommandHandler {
  private providerHandler: ProviderCommandHandler;
  private modelHandler: ModelCommandHandler;
  private configHandler: ConfigCommandHandler;

  constructor(
    manager: ProviderModelManager,
    treeDataProvider: AddiTreeDataProvider,
    context: vscode.ExtensionContext,
  ) {
    this.providerHandler = new ProviderCommandHandler(manager, treeDataProvider, context);
    this.modelHandler = new ModelCommandHandler(manager, treeDataProvider, context);
    this.configHandler = new ConfigCommandHandler(manager, treeDataProvider, context);
  }

  public setEditorViewManager(manager: EditorViewManager): void {
    this.providerHandler.setEditorViewManager(manager);
    this.modelHandler.setEditorViewManager(manager);
    this.configHandler.setEditorViewManager(manager);
  }

  // ==================== Provider Commands ====================

  async addProvider(): Promise<void> {
    return this.providerHandler.addProvider();
  }

  async editProvider(item: ProviderTreeItem): Promise<void> {
    return this.providerHandler.editProvider(item);
  }

  async deleteProvider(item: ProviderTreeItem): Promise<void> {
    return this.providerHandler.deleteProvider(item);
  }

  async copyProvider(item: ProviderTreeItem): Promise<void> {
    return this.providerHandler.copyProvider(item);
  }

  async syncProviderModels(item: ProviderTreeItem): Promise<void> {
    return this.providerHandler.syncProviderModels(item);
  }

  // ==================== Model Commands ====================

  async addModel(item: ProviderTreeItem): Promise<void> {
    return this.modelHandler.addModel(item);
  }

  async editModels(items: ModelTreeItem[]): Promise<void> {
    return this.modelHandler.editModels(items);
  }

  async deleteModels(items: ModelTreeItem[]): Promise<void> {
    return this.modelHandler.deleteModels(items);
  }

  async copyModel(item: ModelTreeItem): Promise<void> {
    return this.modelHandler.copyModel(item);
  }

  async selectModel(item: ModelTreeItem): Promise<void> {
    return this.modelHandler.selectModel(item);
  }

  // ==================== Config Commands ====================

  async openConfig(): Promise<void> {
    return this.configHandler.openConfig();
  }
}
