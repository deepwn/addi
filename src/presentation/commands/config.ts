import * as vscode from 'vscode';
import { BaseCommandHandler } from './base';

/**
 * Configuration-related command handler (BYOK Edition)
 *
 * With BYOK, configuration is stored in the user-level chatLanguageModels.json
 * (%APPDATA%/Code/User/chatLanguageModels.json), matching VS Code's built-in
 * "Chat: Open Language Model (JSON)" command.
 */
export class ConfigCommandHandler extends BaseCommandHandler {
  /**
   * Open the BYOK user-level config file for manual editing.
   * This is the same file used by VS Code's built-in BYOK system.
   */
  async openConfig(): Promise<void> {
    const configUri = this._getUserConfigUri();
    try {
      await vscode.workspace.fs.stat(configUri);
    } catch {
      // File doesn't exist — create empty config
      await vscode.workspace.fs.writeFile(
        configUri,
        new TextEncoder().encode(JSON.stringify([], null, 2))
      );
    }

    const doc = await vscode.workspace.openTextDocument(configUri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  /**
   * Returns the URI for the user-level chatLanguageModels.json.
   * Matches the path used by ByokFileManager.
   */
  private _getUserConfigUri(): vscode.Uri {
    const userDir = vscode.Uri.joinPath(
      vscode.Uri.file(process.env['APPDATA'] || ''),
      'Code',
      'User'
    );
    return vscode.Uri.joinPath(userDir, 'chatLanguageModels.json');
  }
}
