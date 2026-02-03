import * as assert from 'assert';
import * as vscode from 'vscode';
import { StorageService } from '../../infrastructure/storage/storageService';
import { Provider } from '../../common/types';

// --- Mocks ---

class InMemorySecretStorage {
  private map = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
  public onDidChange = this._onDidChange.event;

  get(key: string): Thenable<string | undefined> {
    return Promise.resolve(this.map.get(key));
  }
  store(key: string, value: string): Thenable<void> {
    this.map.set(key, value);
    this._onDidChange.fire({ key });
    return Promise.resolve();
  }
  delete(key: string): Thenable<void> {
    this.map.delete(key);
    this._onDidChange.fire({ key });
    return Promise.resolve();
  }
}

class InMemoryGlobalState {
  private map = new Map<string, any>();
  private syncKeys = new Set<string>();

  get<T>(key: string, defaultValue?: T): T {
    return (this.map.has(key) ? this.map.get(key) : defaultValue) as T;
  }
  update(key: string, value: any): Thenable<void> {
    if (value === undefined) {
      this.map.delete(key);
    } else {
      this.map.set(key, value);
    }
    return Promise.resolve();
  }
  setKeysForSync(keys: readonly string[]): void {
    this.syncKeys = new Set(keys);
  }
  // Helper for test verification
  getSyncKeys(): string[] {
    return Array.from(this.syncKeys);
  }
}

// Mock ExtensionContext
const createMockContext = () => {
  const secrets = new InMemorySecretStorage();
  const globalState = new InMemoryGlobalState();
  return {
    secrets,
    globalState,
    subscriptions: [],
    // Cast to any to satisfy the complex ExtensionContext interface
  } as unknown as vscode.ExtensionContext & { 
    secrets: InMemorySecretStorage; 
    globalState: InMemoryGlobalState 
  };
};

suite('StorageService Test Suite', () => {
  let context: ReturnType<typeof createMockContext>;
  let storage: StorageService;

  setup(() => {
    context = createMockContext();
    storage = new StorageService(context);
  });

  test('should save config, stats and secrets separately', async () => {
    const provider: Provider = {
      id: 'p1',
      name: 'Test',
      providerType: 'openai',
      apiKey: 'secret-key-123',
      models: [
        {
          sid: 'm1',
          id: 'gpt-4', 
          name: 'GPT-4',
          family: 'openai',
          version: '1',
          maxInputTokens: 1000,
          maxOutputTokens: 1000,
          capabilities: {},
          speedHistory: [100, 200], // Stats
          averageSpeed: 150 // Stats
        }
      ]
    };

    await storage.saveProviders([provider]);

    // 1. Verify Config (clean of secrets and stats)
    const storedConfig = context.globalState.get<any[]>('addi.providers');
    assert.strictEqual(storedConfig?.length, 1);
    assert.strictEqual(storedConfig[0].apiKey, undefined, 'API Key should not be in config');
    assert.strictEqual(storedConfig[0].models[0].speedHistory, undefined, 'Stats should not be in config');

    // 2. Verify Secrets
    const storedSecret = await context.secrets.get('addi.provider.apikey.p1');
    assert.strictEqual(storedSecret, 'secret-key-123');

    // 3. Verify Stats
    const storedStats = context.globalState.get<any>('addi.providers.extend');
    assert.deepStrictEqual(storedStats['p1']['m1'].speedHistory, [100, 200]);
  });

  test('should reconstitute provider on get', async () => {
    // Setup state manually
    await context.globalState.update('addi.providers', [{
      id: 'p1',
      name: 'Test',
      providerType: 'openai',
      models: [{ sid: 'm1', id: 'gpt-4', name: 'GPT-4' }]
    }]);
    await context.secrets.store('addi.provider.apikey.p1', 'restored-key');
    await context.globalState.update('addi.providers.extend', {
      p1: { m1: { averageSpeed: 999 } }
    });

    await storage.initialize();

    const result = storage.getProviders();

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.apiKey, 'restored-key');
    assert.strictEqual(result[0]!.models[0]!.averageSpeed, 999);
  });

  test('update should preserve secret if not provided', async () => {
    // Initial save
    await storage.saveProviders([{
      id: 'p1', 
      name: 'Init', 
      providerType: 'generic', 
      apiKey: 'initial-key', 
      models: []
    }]);

    // Update (simulating UI that didn't send back the obscured key)
    // apiKey is undefined here
    await storage.saveProviders([{
      id: 'p1', 
      name: 'Updated', 
      providerType: 'generic', 
      models: []
    }]);

    const secret = await context.secrets.get('addi.provider.apikey.p1');
    assert.strictEqual(secret, 'initial-key');
  });
  
  test('update should update secret if provided', async () => {
     // Initial save
     await storage.saveProviders([{
      id: 'p1', 
      name: 'Init', 
      providerType: 'generic', 
      apiKey: 'initial-key', 
      models: []
    }]);

    // Update with new Key
    await storage.saveProviders([{
      id: 'p1', 
      name: 'Updated', 
      providerType: 'generic', 
      apiKey: 'new-key',
      models: []
    }]);

    const secret = await context.secrets.get('addi.provider.apikey.p1');
    assert.strictEqual(secret, 'new-key');
  });

  test('migration: should move insecure keys to secrets', async () => {
    // Setup legacy state: apiKey in globalState
    await context.globalState.update('addi.providers', [{
      id: 'old1',
      name: 'Legacy',
      apiKey: 'insecure-key',
      models: []
    }]);

    await storage.initialize();

    // Verify moved to secret
    const secret = await context.secrets.get('addi.provider.apikey.old1');
    assert.strictEqual(secret, 'insecure-key');

    // Verify removed from config (need to check if saveProviders was called)
    const newConfig = context.globalState.get<any[]>('addi.providers');
    assert.strictEqual(newConfig![0].apiKey, undefined);
  });
});
