import * as vscode from "vscode";

export class ConfigManager {
  static getConfiguration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("addi");
  }

  static getDefaultMaxInputTokens(): number {
    return this.getConfiguration().get<number>("defaultMaxInputTokens", 4096);
  }

  static getDefaultMaxOutputTokens(): number {
    return this.getConfiguration().get<number>("defaultMaxOutputTokens", 1024);
  }

  static getDefaultModelVersion(): string {
    return this.getConfiguration().get<string>("defaultModelVersion", "1.0.0");
  }
}

export class InputValidator {
  static validateName(name: string): string | null {
    return name.trim().length > 0 ? null : "Name cannot be empty";
  }

  static validateVersion(version: string): string | null {
    return /^\d+(\.\d+)*$/.test(version) ? null : "Version format is invalid, it should consist of numbers and dots";
  }

  static validateTokens(value: string): string | null {
    const num = Number(value);
    return !isNaN(num) && num > 0 && Number.isInteger(num) ? null : "Token count must be a positive integer";
  }
}

export class UserFeedback {
  static showInfo(message: string): void {
    void vscode.window.showInformationMessage(message, { modal: false });
  }

  static showError(message: string): void {
    void vscode.window.showErrorMessage(message, { modal: false });
  }

  static showWarning(message: string): void {
    void vscode.window.showWarningMessage(message, { modal: false });
  }

  static async showInputBox(options: vscode.InputBoxOptions): Promise<string | undefined> {
    const finalOptions: vscode.InputBoxOptions = {
      ignoreFocusOut: true,
      ...options,
    };
    return await vscode.window.showInputBox(finalOptions);
  }

  static async showProgress<T>(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => Promise<T>
  ): Promise<T> {
    return await vscode.window.withProgress<T>(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false,
      },
      task
    );
  }

  static async showConfirmDialog(message: string, _modal: boolean = true): Promise<boolean> {
    const items: Array<vscode.QuickPickItem & { value: boolean }> = [
      { label: "Confirm", value: true },
      { label: "Cancel", value: false },
    ];

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: message,
      ignoreFocusOut: true,
    });

    return selection?.value ?? false;
  }
}
