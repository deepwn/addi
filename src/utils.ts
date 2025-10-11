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

  static getDefaultModelFamily(): string {
    return this.getConfiguration().get<string>("defaultModelFamily", "Addi");
  }

  static getDefaultModelVersion(): string {
    return this.getConfiguration().get<string>("defaultModelVersion", "1.0.0");
  }
}

export class TokenFormatter {
  private static readonly LIMIT = 1024 * 1024 * 4;
  private static readonly MULTIPLIERS: Record<string, number> = {
    k: 1024,
  };

  static parse(input: string | number | undefined | null): number | undefined {
    if (input === undefined || input === null) {
      return undefined;
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input) || input <= 0) {
        return undefined;
      }
      return Math.floor(input);
    }
    const trimmed = input
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, "");
    if (!trimmed) {
      return undefined;
    }
    const match = /^([0-9]+(?:\.[0-9]+)?)([kmg]?)$/.exec(trimmed);
    if (!match) {
      return undefined;
    }
    const base = Number(match[1]);
    if (!Number.isFinite(base) || base <= 0) {
      return undefined;
    }
    const suffix = match[2];
    if (suffix && !(suffix in this.MULTIPLIERS)) {
      return undefined;
    }
    const multiplier = suffix ? this.MULTIPLIERS[suffix]! : 1;
    const value = Math.round(base * multiplier);
    if (!Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    return Math.min(value, this.LIMIT);
  }

  static format(value: number | undefined): string {
    if (!Number.isFinite(value) || value === undefined || value <= 0) {
      return "";
    }
    if (value >= 1024) {
      const scaled = value / 1024;
      const formatted = Number.isInteger(scaled)
        ? scaled.toString()
        : scaled
            .toFixed(scaled >= 10 ? 1 : 2)
            .replace(/\.0+$/, "")
            .replace(/\.([0-9]*[1-9])0+$/, ".$1");
      return `${formatted}k`;
    }
    return Math.floor(value).toString();
  }

  static formatDetailed(value: number | undefined): string {
    if (!Number.isFinite(value) || value === undefined || value <= 0) {
      return "";
    }
    const raw = Math.floor(value).toString();
    const friendly = this.format(value);
    if (!friendly || friendly === raw) {
      return raw;
    }
    return `${raw} (${friendly})`;
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
    return TokenFormatter.parse(value) ? null : "Token count must be a positive integer";
  }
}

export class UserFeedback {
  private static async showMessage(type: "info" | "warning" | "error", message: string, actions: string[] = []): Promise<string | undefined> {
    const options: vscode.MessageOptions = { modal: false }; // ensure toast-style notification
    switch (type) {
      case "warning":
        return await vscode.window.showWarningMessage(message, options, ...actions);
      case "error":
        return await vscode.window.showErrorMessage(message, options, ...actions);
      default:
        return await vscode.window.showInformationMessage(message, options, ...actions);
    }
  }

  static showInfo(message: string): void {
    void this.showMessage("info", message);
  }

  static showError(message: string): void {
    void this.showMessage("error", message);
  }

  static showWarning(message: string): void {
    void this.showMessage("warning", message);
  }

  static async showWarningWithActions(message: string, actions: string[]): Promise<string | undefined> {
    return await this.showMessage("warning", message, actions);
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

  static async showConfirmDialog(message: string, severity: "info" | "warning" | "error" = "warning"): Promise<boolean> {
    const choice = await this.showMessage(severity, message, ["Confirm", "Cancel"]);
    return choice === "Confirm";
  }
}
