import * as assert from "assert";
import * as vscode from "vscode";
import { ProviderModelManager } from "../provider";

// 模拟vscode模块
class MockExtensionContext {
  private _globalState = new Map<string, unknown>();
  private _secrets = new Map<string, string>();

  get globalState() {
    return {
      get: (key: string, defaultValue?: unknown) => {
        return this._globalState.get(key) ?? defaultValue;
      },
      update: (key: string, value: unknown) => {
        this._globalState.set(key, value);
        return Promise.resolve();
      },
      setKeysForSync: (_keys: string[]) => {
        // noop
      },
    } as unknown as vscode.Memento;
  }

  get secrets() {
    return {
      get: (key: string) => Promise.resolve(this._secrets.get(key)),
      store: (key: string, value: string) => {
        this._secrets.set(key, value);
        return Promise.resolve();
      },
      delete: (key: string) => {
        this._secrets.delete(key);
        return Promise.resolve();
      },
      onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    } as unknown as vscode.SecretStorage;
  }
}

// 模拟vscode.workspace
const mockWorkspace = {
  getConfiguration: (_section?: string) => {
    return {
      get: (_key: string, defaultValue?: unknown) => {
        return defaultValue;
      },
      update: (_key: string, _value: unknown, _target: vscode.ConfigurationTarget) => {
        return Promise.resolve();
      },
    };
  },
};

// 设置模拟：仅在属性可配置或尚未定义时重写
try {
  const desc = Object.getOwnPropertyDescriptor(vscode, "workspace");
  if (!desc || desc.configurable) {
    Object.defineProperty(vscode, "workspace", { value: mockWorkspace, configurable: true });
  }
} catch {
  /* ignore override issues in real host */
}

suite("ProviderModelManager Test Suite", () => {
  let context: MockExtensionContext;
  let manager: ProviderModelManager;

  setup(() => {
    context = new MockExtensionContext();
    manager = new ProviderModelManager(context as unknown as vscode.ExtensionContext);
  });

  teardown(() => {
    manager.dispose();
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
      id: "test-model",
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
      id: "test-model",
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
      const success = await manager.updateModel(provider.id, model.sid, {
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
      id: "test-model",
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
      const success = await manager.deleteModel(model.sid);
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
      id: "test-model",
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
      const result = manager.findModel(model.sid);
      assert.notStrictEqual(result, null);
      if (result) {
        assert.strictEqual(result.model.name, "Test Model");
        assert.strictEqual(result.provider.name, "Test Provider");
      }
    }
  });

  test("should normalize legacy model fields on import (imageInput/toolCalling)", async () => {
    // Manually inject legacy data
    const legacyProvider = {
      id: "legacy-p",
      name: "Legacy Provider",
      providerType: "generic",
      models: [
        {
          sid: "m1",
          id: "m1",
          name: "Legacy Model",
          family: "Legacy",
          version: "1.0",
          maxInputTokens: 1000,
          maxOutputTokens: 1000,
          imageInput: true, // Legacy field
          toolCalling: 1, // Legacy field
        },
      ],
    };

    await manager.saveProviders([legacyProvider as any]);

    const providers = manager.getProviders();
    const model = providers[0]?.models[0];
    assert.ok(model);
    assert.strictEqual(model.capabilities?.imageInput, true);
    assert.strictEqual(model.capabilities?.toolCalling, 1); // Legacy value preserved
    assert.strictEqual((model as any).imageInput, undefined);
    assert.strictEqual((model as any).toolCalling, undefined);
  });

  test("should fire onDidUpdate when refresh is called", (done) => {
    const disposable = manager.onDidUpdate(() => {
      disposable.dispose();
      done();
    });
    manager.refresh();
  });

  test("should validate provider name", async () => {
    await assert.rejects(async () => {
      await manager.addProvider({
        name: "",
        providerType: "generic",
        apiEndpoint: "https://example.com",
      });
    }, /Provider name is required/);
  });

  test("should validate generic provider endpoint", async () => {
    await assert.rejects(async () => {
      await manager.addProvider({
        name: "Test",
        providerType: "generic",
        apiEndpoint: "",
      });
    }, /API Endpoint is required/);
  });

  test("should validate model name", async () => {
    const provider = await manager.addProvider({
      name: "Test Provider",
      providerType: "generic",
      apiEndpoint: "https://example.com",
    });

    await assert.rejects(async () => {
      await manager.addModel(provider.id, {
        name: "",
        id: "test-model",
        family: "test",
        version: "1.0",
        maxInputTokens: 100,
        maxOutputTokens: 100,
        capabilities: {},
      });
    }, /Model name is required/);
  });

  test("should validate model id", async () => {
    const provider = await manager.addProvider({
      name: "Test Provider",
      providerType: "generic",
      apiEndpoint: "https://example.com",
    });

    await assert.rejects(async () => {
      await manager.addModel(provider.id, {
        name: "Test Model",
        id: "",
        family: "test",
        version: "1.0",
        maxInputTokens: 100,
        maxOutputTokens: 100,
        capabilities: {},
      });
    }, /Model ID is required/);
  });
});
