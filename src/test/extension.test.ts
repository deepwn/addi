import * as assert from "assert";
import * as vscode from "vscode";
import { ProviderModelManager } from "../provider";
import { ConfigManager, InputValidator } from "../utils";

// 模拟vscode模块
class MockExtensionContext {
  private _globalState = new Map<string, unknown>();

  get globalState() {
    return {
      get: (key: string, defaultValue?: unknown) => {
        return this._globalState.get(key) ?? defaultValue;
      },
      update: (key: string, value: unknown) => {
        this._globalState.set(key, value);
        return Promise.resolve();
      },
    } as unknown as vscode.Memento;
  }
}

// 模拟vscode.workspace
const mockWorkspace = {
  getConfiguration: (section?: string) => {
    return {
      get: (key: string, defaultValue?: unknown) => {
        const config: Record<string, unknown> = {
          "addi.defaultMaxInputTokens": 4096,
          "addi.defaultMaxOutputTokens": 1024,
          "addi.defaultModelVersion": "1.0.0",
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

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  suite("ProviderModelManager", () => {
    let context: MockExtensionContext;
    let manager: ProviderModelManager;

    setup(() => {
      context = new MockExtensionContext();
      manager = new ProviderModelManager(context as unknown as vscode.ExtensionContext);
    });

    test("should add provider", async () => {
      const provider = await manager.addProvider({
        name: "Test Provider",
        providerType: "generic",
        description: "Test Description",
        website: "https://example.com",
        apiEndpoint: "https://api.example.com",
        apiKey: "test-api-key",
      });
      assert.strictEqual(provider.name, "Test Provider");
      assert.strictEqual(provider.description, "Test Description");
      assert.strictEqual(provider.website, "https://example.com");
      assert.strictEqual(provider.apiEndpoint, "https://api.example.com");
      assert.strictEqual(provider.apiKey, "test-api-key");
      assert.strictEqual(provider.models.length, 0);

      const providers = manager.getProviders();
      assert.strictEqual(providers.length, 1);
      assert.strictEqual(providers[0]?.name, "Test Provider");
    });

    test("should update provider", async () => {
      const provider = await manager.addProvider({
        name: "Test Provider",
        providerType: "generic",
        description: "Test Description",
        website: "https://example.com",
        apiEndpoint: "https://api.example.com",
        apiKey: "test-api-key",
      });
      const success = await manager.updateProvider(provider.id, {
        name: "Updated Provider",
        description: "Updated Description",
      });
      assert.strictEqual(success, true);

      const providers = manager.getProviders();
      assert.strictEqual(providers[0]?.name, "Updated Provider");
      assert.strictEqual(providers[0]?.description, "Updated Description");
      assert.strictEqual(providers[0]?.website, "https://example.com");
    });

    test("should delete provider", async () => {
      const provider = await manager.addProvider({
        name: "Test Provider",
        providerType: "generic",
        description: "Test Description",
        website: "https://example.com",
        apiEndpoint: "https://api.example.com",
        apiKey: "test-api-key",
      });
      const success = await manager.deleteProvider(provider.id);
      assert.strictEqual(success, true);

      const providers = manager.getProviders();
      assert.strictEqual(providers.length, 0);
    });

    test("should add model to provider", async () => {
      const provider = await manager.addProvider({
        name: "Test Provider",
        providerType: "generic",
        description: "Test Description",
        website: "https://example.com",
        apiEndpoint: "https://api.example.com",
        apiKey: "test-api-key",
      });
      const model = await manager.addModel(provider.id, {
        name: "Test Model",
        family: "Test Family",
        version: "1.0.0",
        maxInputTokens: 4096,
        maxOutputTokens: 1024,
        capabilities: {
          imageInput: false,
          toolCalling: false,
        },
      });

      assert.notStrictEqual(model, null);
      if (model) {
        assert.strictEqual(model.name, "Test Model");
        assert.strictEqual(model.family, "Test Family");
      }

      const providers = manager.getProviders();
      assert.strictEqual(providers[0]?.models.length, 1);
    });

    test("should update model", async () => {
      const provider = await manager.addProvider({
        name: "Test Provider",
        providerType: "generic",
        description: "Test Description",
        website: "https://example.com",
        apiEndpoint: "https://api.example.com",
        apiKey: "test-api-key",
      });
      const model = await manager.addModel(provider.id, {
        name: "Test Model",
        family: "Test Family",
        version: "1.0.0",
        maxInputTokens: 4096,
        maxOutputTokens: 1024,
        capabilities: {
          imageInput: false,
          toolCalling: false,
        },
      });

      assert.notStrictEqual(model, null);
      if (model) {
        const success = await manager.updateModel(provider.id, model.id, {
          name: "Updated Model",
        });
        assert.strictEqual(success, true);

        const providers = manager.getProviders();
        assert.strictEqual(providers[0]?.models[0]?.name, "Updated Model");
      }
    });

    test("should delete model", async () => {
      const provider = await manager.addProvider({
        name: "Test Provider",
        providerType: "generic",
        description: "Test Description",
        website: "https://example.com",
        apiEndpoint: "https://api.example.com",
        apiKey: "test-api-key",
      });
      const model = await manager.addModel(provider.id, {
        name: "Test Model",
        family: "Test Family",
        version: "1.0.0",
        maxInputTokens: 4096,
        maxOutputTokens: 1024,
        capabilities: {
          imageInput: false,
          toolCalling: false,
        },
      });

      assert.notStrictEqual(model, null);
      if (model) {
        const success = await manager.deleteModel(model.id);
        assert.strictEqual(success, true);

        const providers = manager.getProviders();
        assert.strictEqual(providers[0]?.models.length, 0);
      }
    });

    test("should find model", async () => {
      const provider = await manager.addProvider({
        name: "Test Provider",
        providerType: "generic",
        description: "Test Description",
        website: "https://example.com",
        apiEndpoint: "https://api.example.com",
        apiKey: "test-api-key",
      });
      const model = await manager.addModel(provider.id, {
        name: "Test Model",
        family: "Test Family",
        version: "1.0.0",
        maxInputTokens: 4096,
        maxOutputTokens: 1024,
        capabilities: {
          imageInput: false,
          toolCalling: false,
        },
      });

      assert.notStrictEqual(model, null);
      if (model) {
        const result = manager.findModel(model.id);
        assert.notStrictEqual(result, null);
        if (result) {
          assert.strictEqual(result.model.name, "Test Model");
          assert.strictEqual(result.provider.name, "Test Provider");
        }
      }
    });
  });

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
  });

  suite("Integration Tests", () => {
    let context: MockExtensionContext;
    let manager: ProviderModelManager;

    setup(() => {
      context = new MockExtensionContext();
      manager = new ProviderModelManager(context as unknown as vscode.ExtensionContext);
    });

    test("should create provider with models and export/import", async () => {
      // 创建供应商和模型
      const provider = await manager.addProvider({
        name: "Test Provider",
        providerType: "generic",
        description: "Test Description",
        website: "https://example.com",
        apiEndpoint: "https://api.example.com",
        apiKey: "test-api-key",
      });
      await manager.addModel(provider.id, {
        name: "Test Model 1",
        family: "Test Family",
        version: "1.0.0",
        maxInputTokens: 4096,
        maxOutputTokens: 1024,
        capabilities: {
          imageInput: false,
          toolCalling: false,
        },
      });
      await manager.addModel(provider.id, {
        name: "Test Model 2",
        family: "Test Family",
        version: "2.0.0",
        maxInputTokens: 8192,
        maxOutputTokens: 2048,
        capabilities: {
          imageInput: false,
          toolCalling: false,
        },
      });

      // 验证数据
      let providers = manager.getProviders();
      assert.strictEqual(providers.length, 1);
      assert.strictEqual(providers[0]?.models.length, 2);

      // 模拟导出
      const exportedData = JSON.stringify(providers, null, 2);
      assert.notStrictEqual(exportedData, "");

      // 模拟导入
      const importedProviders = JSON.parse(exportedData);
      await manager.saveProviders(importedProviders);

      // 验证导入的数据
      providers = manager.getProviders();
      assert.strictEqual(providers.length, 1);
      assert.strictEqual(providers[0]?.name, "Test Provider");
      assert.strictEqual(providers[0]?.description, "Test Description");
      assert.strictEqual(providers[0]?.models.length, 2);
      assert.strictEqual(providers[0]?.models[0]?.name, "Test Model 1");
      assert.strictEqual(providers[0]?.models[1]?.name, "Test Model 2");
    });

    test("should normalize legacy model fields on import (imageInput/toolCalling)", async () => {
      const legacyProvider = {
        id: "legacy-1",
        name: "Legacy Provider",
        providerType: "generic",
        apiEndpoint: "https://api.legacy",
        apiKey: "key",
        models: [
          {
            id: "m-legacy",
            name: "LegacyModel",
            family: "legacy",
            version: "1.0",
            // legacy placement of capabilities
            imageInput: true,
            toolCalling: 1,
          },
        ],
      };

      // simulate JSON import roundtrip to produce a plain object
      const imported = JSON.parse(JSON.stringify([legacyProvider]));
      await manager.saveProviders(imported as any);

      const providers = manager.getProviders();
      assert.strictEqual(providers.length, 1);
      assert.ok(providers[0]);
      assert.ok(Array.isArray(providers[0].models) && providers[0].models.length > 0);
      const normalizedModel = providers[0].models[0]!;
      assert.ok(normalizedModel.capabilities !== undefined);
      assert.strictEqual(normalizedModel.capabilities?.imageInput, true);
      // legacy numeric flag should be preserved as number by normalizeCapabilities
      assert.strictEqual(normalizedModel.capabilities?.toolCalling, 1);
    });
  });
});
