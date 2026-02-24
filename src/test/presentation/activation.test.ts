import * as assert from 'assert';
import * as vscode from 'vscode';
import { ProviderModelManager } from '../../core/providers/ProviderModelManager';
import { MockStorageService } from '../mocks';

suite('Extension Integration Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  suite('Integration Tests', () => {
    let manager: ProviderModelManager;

    setup(() => {
      // Use standard mock
      const storage = new MockStorageService();
      manager = new ProviderModelManager(storage);
    });

    test('should create provider with models and export/import', async () => {
      // 创建供应商和模型
      const provider = await manager.addProvider({
        name: 'Test Provider',
        providerType: 'openai-completions',
        description: 'Test Description',
        website: 'https://example.com',
        apiEndpoint: 'https://api.example.com',
        apiKey: 'test-api-key',
      });
      await manager.addModel(provider.id, {
        id: 'test-model-1',
        name: 'Test Model 1',
        family: 'Test Family',
        version: '1.0.0',
        maxInputTokens: 4096,
        maxOutputTokens: 1024,
        capabilities: {
          imageInput: false,
          toolCalling: false,
        },
      });
      await manager.addModel(provider.id, {
        id: 'test-model-2',
        name: 'Test Model 2',
        family: 'Test Family',
        version: '2.0.0',
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
      assert.notStrictEqual(exportedData, '');

      // 模拟导入
      const importedProviders = JSON.parse(exportedData);
      await manager.saveProviders(importedProviders);

      // 验证导入的数据
      providers = manager.getProviders();
      assert.strictEqual(providers.length, 1);
      assert.strictEqual(providers[0]?.name, 'Test Provider');
      assert.strictEqual(providers[0]?.description, 'Test Description');
      assert.strictEqual(providers[0]?.models.length, 2);
      assert.strictEqual(providers[0]?.models[0]?.name, 'Test Model 1');
      assert.strictEqual(providers[0]?.models[1]?.name, 'Test Model 2');
    });
  });
});
