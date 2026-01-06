import * as assert from "assert";
import * as vscode from "vscode";
import { ConfigManager, InputValidator, TokenFormatter } from "../../common/utils";

// 模拟vscode.workspace
const mockWorkspace = {
  getConfiguration: (section?: string) => {
    return {
      get: (key: string, defaultValue?: unknown) => {
        const config: Record<string, unknown> = {
          "addi.defaultMaxInputTokens": 4096,
          "addi.defaultMaxOutputTokens": 1024,
          "addi.defaultModelVersion": "1.0.0",
          "addi.confirmDelete": true,
        };
        const fullKey = section ? `${section}.${key}` : key;
        return (config as Record<string, unknown>)[fullKey] ?? defaultValue;
      },
    };
  },
};

// 设置模拟：仅在属性可配置或尚未定义时重写，避免 VS Code 运行时抛出 Cannot redefine property
try {
  const desc = Object.getOwnPropertyDescriptor(vscode, "workspace");
  if (!desc || desc.configurable) {
    Object.defineProperty(vscode, "workspace", { value: mockWorkspace, configurable: true });
  }
} catch {
  /* ignore override issues in real host */
}

suite("Utils Test Suite", () => {
  suite("InputValidator", () => {
    test("should validate name", () => {
      assert.strictEqual(InputValidator.validateName("Valid Name"), null);
      assert.strictEqual(InputValidator.validateName(""), "Name cannot be empty");
      assert.strictEqual(InputValidator.validateName("   "), "Name cannot be empty");
    });

    test("should validate version", () => {
      assert.strictEqual(InputValidator.validateVersion("1.0.0"), null);
      assert.strictEqual(InputValidator.validateVersion("2.1"), null);
      assert.strictEqual(InputValidator.validateVersion("3"), null);
      assert.strictEqual(InputValidator.validateVersion("invalid"), "Version format is invalid, it should consist of numbers and dots");
      assert.strictEqual(InputValidator.validateVersion("1.0."), "Version format is invalid, it should consist of numbers and dots");
    });

    test("should validate tokens", () => {
      assert.strictEqual(InputValidator.validateTokens("4096"), null);
      assert.strictEqual(InputValidator.validateTokens("1024"), null);
      assert.strictEqual(InputValidator.validateTokens("0"), "Token count must be a positive integer");
      assert.strictEqual(InputValidator.validateTokens("-1"), "Token count must be a positive integer");
      assert.strictEqual(InputValidator.validateTokens("invalid"), "Token count must be a positive integer");
    });
  });

  suite("TokenFormatter", () => {
    test("should parse valid inputs", () => {
      assert.strictEqual(TokenFormatter.parse(100), 100);
      assert.strictEqual(TokenFormatter.parse("100"), 100);
      assert.strictEqual(TokenFormatter.parse("1k"), 1024);
      assert.strictEqual(TokenFormatter.parse("1.5k"), 1536);
      assert.strictEqual(TokenFormatter.parse(" 2 k "), 2048);
    });

    test("should return undefined for invalid inputs", () => {
      assert.strictEqual(TokenFormatter.parse(undefined), undefined);
      assert.strictEqual(TokenFormatter.parse(null), undefined);
      assert.strictEqual(TokenFormatter.parse(0), undefined);
      assert.strictEqual(TokenFormatter.parse(-1), undefined);
      assert.strictEqual(TokenFormatter.parse("abc"), undefined);
      assert.strictEqual(TokenFormatter.parse("1m"), undefined); // 'm' not supported yet
    });

    test("should format values", () => {
      assert.strictEqual(TokenFormatter.format(100), "100");
      assert.strictEqual(TokenFormatter.format(1024), "1k");
      assert.strictEqual(TokenFormatter.format(1536), "1.5k");
      assert.strictEqual(TokenFormatter.format(2048), "2k");
      assert.strictEqual(TokenFormatter.format(0), "");
      assert.strictEqual(TokenFormatter.format(undefined), "");
    });

    test("should format detailed values", () => {
      assert.strictEqual(TokenFormatter.formatDetailed(100), "100");
      assert.strictEqual(TokenFormatter.formatDetailed(1024), "1024 (1k)");
      assert.strictEqual(TokenFormatter.formatDetailed(1536), "1536 (1.5k)");
    });
  });

  suite("ConfigManager", () => {
    test("should get default max input tokens", () => {
      const tokens = ConfigManager.getDefaultMaxInputTokens();
      assert.strictEqual(tokens, 4096);
    });

    test("should get default max output tokens", () => {
      const tokens = ConfigManager.getDefaultMaxOutputTokens();
      assert.strictEqual(tokens, 1024);
    });

    test("should get default model version", () => {
      const version = ConfigManager.getDefaultModelVersion();
      assert.strictEqual(version, "1.0.0");
    });

    test("should get confirm delete setting", () => {
      const confirm = ConfigManager.getConfirmDelete();
      assert.strictEqual(confirm, true);
    });
  });
});
