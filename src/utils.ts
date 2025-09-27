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
    vscode.window.showInformationMessage(message);
  }

  static showError(message: string): void {
    vscode.window.showErrorMessage(message);
  }

  static showWarning(message: string): void {
    vscode.window.showWarningMessage(message);
  }

  static async showInputBox(options: vscode.InputBoxOptions): Promise<string | undefined> {
    return await vscode.window.showInputBox(options);
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

  static async showConfirmDialog(message: string, modal: boolean = true): Promise<boolean> {
    const result = await vscode.window.showWarningMessage(message, { modal }, "Confirm", "Cancel");
    return result === "Confirm";
  }
}
