import { CustomTool, Provider } from './types';
import { Disposable } from 'vscode';

/**
 * Interface for Tool Management (Core -> Infra)
 */
export interface IToolManager {
  getTools(): CustomTool[];
  onDidUpdate(listener: () => void): Disposable;
}

/**
 * Interface for MCP Service (Core -> Infra)
 */
export interface IMcpService {
  callTool(name: string, args: Record<string, unknown>): Promise<any>;
  isBinaryAvailable(): boolean;
}

/**
 * Interface for Storage Service (Core -> Infra)
 */
export interface IStorageService {
  getProviders(): Provider[];
  saveProviders(providers: Provider[]): Promise<void>;
  onDidUpdate(listener: () => void): Disposable;
  isSettingsSyncEnabled(): boolean;
  setSettingsSync(enabled: boolean): void;
  initialize(transform?: (providers: unknown[]) => { mutated: boolean }): void;
}
