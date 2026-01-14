import * as vscode from 'vscode';
import { IStorageService, IToolManager, IMcpService } from '../../common/interfaces';
import { Provider } from '../../common/types';

/**
 * In-Memory Storage Service Mock
 */
export class MockStorageService implements IStorageService {
  private providers: Provider[] = [];
  private secrets = new Map<string, string>();
  private readonly _onDidUpdate = new vscode.EventEmitter<void>();
  public readonly onDidUpdate = this._onDidUpdate.event;

  getProviders(): Provider[] {
    return this.providers;
  }

  async saveProviders(providers: Provider[]): Promise<void> {
    this.providers = providers;
    this._onDidUpdate.fire();
  }

  async loadProviders(): Promise<Provider[]> {
    return this.providers;
  }

  async getSecret(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async storeSecret(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async deleteSecret(key: string): Promise<void> {
    this.secrets.delete(key);
  }

  isSettingsSyncEnabled(): boolean {
    return false;
  }

  setSettingsSync(_enabled: boolean): void {
    // noop
  }

  initialize(_transform?: (providers: unknown[]) => { mutated: boolean }): void {
    // noop
  }
}

/**
 * Mock Tool Manager
 */
export class MockToolManager implements IToolManager {
  private tools: any[] = [];
  private readonly _onDidUpdate = new vscode.EventEmitter<void>();
  public readonly onDidUpdate = this._onDidUpdate.event;

  constructor(initialTools: any[] = []) {
    this.tools = initialTools;
  }

  getTools(): any[] {
    return this.tools;
  }
}

/**
 * Mock MCP Service
 */
export class MockMcpService implements IMcpService {
  async callTool(_name: string, _args: Record<string, unknown>): Promise<any> {
    return {};
  }

  isBinaryAvailable(): boolean {
    return true;
  }
}

/**
 * Helper to create a fully mocked context
 */
export class MockExtensionContext {
  subscriptions: { dispose(): any }[] = [];
  workspaceState = {
    get: (_key: string) => undefined,
    update: (_key: string, _value: any) => Promise.resolve(),
  };
  globalState = {
    get: (_key: string) => undefined,
    update: (_key: string, _value: any) => Promise.resolve(),
    setKeysForSync: () => {},
  };
  secrets = {
    get: (_key: string) => Promise.resolve(undefined),
    store: (_key: string, _value: string) => Promise.resolve(),
    delete: (_key: string) => Promise.resolve(),
    onDidChange: new vscode.EventEmitter<any>().event,
  };
  extensionUri = vscode.Uri.file('test');
  environmentVariableCollection = {} as any;
  extensionMode = vscode.ExtensionMode.Test;

  asExtensionContext(): vscode.ExtensionContext {
    return this as unknown as vscode.ExtensionContext;
  }
}
