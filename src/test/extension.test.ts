import * as assert from "assert";
import * as vscode from "vscode";
import { ProviderModelManager } from "../provider";
import { ConfigManager, InputValidator } from "../utils";

// 模拟vscode模块
class MockExtensionContext {
  private _globalState = new Map<string, any>();

  get globalState() {
    return {
      get: (key: string, defaultValue?: any) => {
        return this._globalState.get(key) ?? defaultValue;
      },
      update: (key: string, value: any) => {
        this._globalState.set(key, value);
        return Promise.resolve();
      },
    };
  }
}

// 模拟vscode.workspace
const mockWorkspace = {
  getConfiguration: (section?: string) => {
    return {
      get: (key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          "addi.defaultMaxInputTokens": 4096,
          "addi.defaultMaxOutputTokens": 1024,
          "addi.defaultModelVersion": "1.0.0",
        };
        const fullKey = section ? `${section}.${key}` : key;
        return config[fullKey] ?? defaultValue;
      },
    };
  },
};

// 设置模拟
Object.defineProperty(vscode, "workspace", {
  value: mockWorkspace,
  configurable: true,
});

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  suite("ProviderModelManager", () => {
    let context: MockExtensionContext;
    let manager: ProviderModelManager;

    setup(() => {
      context = new MockExtensionContext();
      manager = new ProviderModelManager(context as any);
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
      assert.strictEqual(InputValidator.validateName(""), "名称不能为空");
      assert.strictEqual(InputValidator.validateName("   "), "名称不能为空");
    });

    test("should validate version", () => {
      assert.strictEqual(InputValidator.validateVersion("1.0.0"), null);
      assert.strictEqual(InputValidator.validateVersion("2.1"), null);
      assert.strictEqual(InputValidator.validateVersion("3"), null);
      assert.strictEqual(InputValidator.validateVersion("invalid"), "版本号格式不正确，应为数字和点号组成");
      assert.strictEqual(InputValidator.validateVersion("1.0."), "版本号格式不正确，应为数字和点号组成");
    });

    test("should validate tokens", () => {
      assert.strictEqual(InputValidator.validateTokens("4096"), null);
      assert.strictEqual(InputValidator.validateTokens("1024"), null);
      assert.strictEqual(InputValidator.validateTokens("0"), "Token数必须是正整数");
      assert.strictEqual(InputValidator.validateTokens("-1"), "Token数必须是正整数");
      assert.strictEqual(InputValidator.validateTokens("invalid"), "Token数必须是正整数");
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
      manager = new ProviderModelManager(context as any);
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
      });
      await manager.addModel(provider.id, {
        name: "Test Model 2",
        family: "Test Family",
        version: "2.0.0",
        maxInputTokens: 8192,
        maxOutputTokens: 2048,
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
  });
});
