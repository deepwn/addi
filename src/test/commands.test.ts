import * as assert from "assert";
import * as vscode from "vscode";
import { CommandHandler } from "../commands";
import { ProviderModelManager } from "../provider";
import { AddiTreeDataProvider, ProviderTreeItem } from "../views/providerView";
import { Provider } from "../types";

// Mock ProviderModelManager
class MockProviderModelManager {
  public deleteProviderCalledWith: string | undefined;
  public deleteModelCalledWith: string | undefined;
  public savedProviders: Provider[] | undefined;
  private providers: Provider[] = [];

  setProviders(providers: Provider[]) {
    this.providers = providers;
  }

  getProviders(): Provider[] {
    return this.providers;
  }

  async saveProviders(providers: Provider[]): Promise<void> {
    this.savedProviders = providers;
    this.providers = providers;
  }

  async deleteProvider(id: string): Promise<boolean> {
    this.deleteProviderCalledWith = id;
    return true;
  }

  async deleteModel(sid: string): Promise<boolean> {
    this.deleteModelCalledWith = sid;
    return true;
  }
}

// Mock AddiTreeDataProvider
class MockTreeDataProvider {
  refresh() {}
}

suite("CommandHandler Test Suite", () => {
  let manager: MockProviderModelManager;
  let treeDataProvider: MockTreeDataProvider;
  let commandHandler: CommandHandler;
  let originalGetConfiguration: any;
  let originalShowWarningMessage: any;
  let originalShowInputBox: any;
  let originalShowSaveDialog: any;
  let originalShowOpenDialog: any;
  let originalFs: any;
  let showWarningMessageCalled = false;
  let writeFileCalledWith: { uri: vscode.Uri; content: Uint8Array } | undefined;

  setup(() => {
    manager = new MockProviderModelManager();
    treeDataProvider = new MockTreeDataProvider();
    commandHandler = new CommandHandler(
      manager as unknown as ProviderModelManager,
      treeDataProvider as unknown as AddiTreeDataProvider
    );

    // Mock ConfigManager.getConfiguration via vscode.workspace.getConfiguration
    originalGetConfiguration = vscode.workspace.getConfiguration;
    originalShowWarningMessage = vscode.window.showWarningMessage;
    originalShowInputBox = vscode.window.showInputBox;
    originalShowSaveDialog = vscode.window.showSaveDialog;
    originalShowOpenDialog = vscode.window.showOpenDialog;
    
    // Mock fs by replacing the property on vscode.workspace
    originalFs = vscode.workspace.fs;
    const mockFs = {
      writeFile: async (uri: vscode.Uri, content: Uint8Array) => {
        writeFileCalledWith = { uri, content };
      },
      readFile: async (_uri: vscode.Uri) => new Uint8Array(),
      // Add other methods if needed, or cast to any
    };
    
    Object.defineProperty(vscode.workspace, "fs", {
      value: mockFs,
      configurable: true,
      writable: true
    });
  });

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.showWarningMessage = originalShowWarningMessage;
    vscode.window.showInputBox = originalShowInputBox;
    vscode.window.showSaveDialog = originalShowSaveDialog;
    vscode.window.showOpenDialog = originalShowOpenDialog;
    
    if (originalFs) {
      Object.defineProperty(vscode.workspace, "fs", {
        value: originalFs,
        configurable: true,
        writable: true
      });
    }
  });

  const mockConfig = (confirmDelete: boolean) => {
    vscode.workspace.getConfiguration = (_section?: string) => {
      return {
        get: (key: string, defaultValue?: unknown) => {
          if (key === "confirmDelete") {
            return confirmDelete;
          }
          return defaultValue;
        },
      } as unknown as vscode.WorkspaceConfiguration;
    };
  };

  const mockShowWarningMessage = (choiceTitle: string | undefined) => {
    showWarningMessageCalled = false;
    vscode.window.showWarningMessage = async (...args: any[]) => {
      showWarningMessageCalled = true;
      if (!choiceTitle) {
        return undefined;
      }

      // Signature in usage: (message, { modal: true }, ...items)
      const items = args.slice(2) as Array<vscode.MessageItem>;
      return items.find((item) => item?.title === choiceTitle);
    };
  };

  test("deleteProvider should ask for confirmation when confirmDelete is true and user confirms", async () => {
    mockConfig(true);
    mockShowWarningMessage("Delete");

    const provider: Provider = {
      id: "p1",
      name: "Test Provider",
      models: [],
      providerType: "generic",
    };
    const item = new ProviderTreeItem(provider);

    await commandHandler.deleteProvider(item);

    assert.strictEqual(showWarningMessageCalled, true, "Confirmation dialog should be shown");
    assert.strictEqual(manager.deleteProviderCalledWith, "p1", "Provider should be deleted");
  });

  test("deleteProvider should ask for confirmation when confirmDelete is true and user cancels", async () => {
    mockConfig(true);
    mockShowWarningMessage("Cancel");

    const provider: Provider = {
      id: "p1",
      name: "Test Provider",
      models: [],
      providerType: "generic",
    };
    const item = new ProviderTreeItem(provider);

    await commandHandler.deleteProvider(item);

    assert.strictEqual(showWarningMessageCalled, true, "Confirmation dialog should be shown");
    assert.strictEqual(manager.deleteProviderCalledWith, undefined, "Provider should not be deleted");
  });

  test("deleteProvider should NOT ask for confirmation when confirmDelete is false", async () => {
    mockConfig(false);
    mockShowWarningMessage("Delete"); // Should not be called, but set just in case

    const provider: Provider = {
      id: "p1",
      name: "Test Provider",
      models: [],
      providerType: "generic",
    };
    const item = new ProviderTreeItem(provider);

    await commandHandler.deleteProvider(item);

    assert.strictEqual(showWarningMessageCalled, false, "Confirmation dialog should NOT be shown");
    assert.strictEqual(manager.deleteProviderCalledWith, "p1", "Provider should be deleted");
  });

  test("exportConfig should export unencrypted JSON", async () => {
    const providers: Provider[] = [
      { id: "p1", name: "P1", models: [], providerType: "generic", apiKey: "secret-key" },
    ];
    manager.setProviders(providers);

    // Mock showInputBox to return empty string (no password)
    vscode.window.showInputBox = async () => "";

    // Mock showSaveDialog
    const saveUri = vscode.Uri.file("/tmp/config.json");
    vscode.window.showSaveDialog = async () => saveUri;

    // Mock writeFile
    writeFileCalledWith = undefined;
    (vscode.workspace.fs as any).writeFile = async (uri: vscode.Uri, content: Uint8Array) => {
      writeFileCalledWith = { uri, content };
    };

    await commandHandler.exportConfig();

    assert.ok(writeFileCalledWith, "writeFile should be called");
    const call = writeFileCalledWith as { uri: vscode.Uri; content: Uint8Array };
    assert.strictEqual(call.uri.fsPath, saveUri.fsPath);
    const content = new TextDecoder().decode(call.content);
    const exported = JSON.parse(content);
    assert.strictEqual(exported.length, 1);
    assert.strictEqual(exported[0].id, "p1");
    assert.strictEqual(exported[0].apiKey, undefined, "API Key should be stripped from unencrypted export");
  });

  test("exportConfig should export encrypted content when password provided", async () => {
    const providers: Provider[] = [
      { id: "p1", name: "P1", models: [], providerType: "generic" },
    ];
    manager.setProviders(providers);

    // Mock showInputBox to return password
    vscode.window.showInputBox = async () => "password123";

    // Mock showSaveDialog
    const saveUri = vscode.Uri.file("/tmp/config.encrypt.txt");
    vscode.window.showSaveDialog = async () => saveUri;

    // Mock writeFile
    writeFileCalledWith = undefined;
    (vscode.workspace.fs as any).writeFile = async (uri: vscode.Uri, content: Uint8Array) => {
      writeFileCalledWith = { uri, content };
    };

    await commandHandler.exportConfig();

    assert.ok(writeFileCalledWith, "writeFile should be called");
    const call = writeFileCalledWith as { uri: vscode.Uri; content: Uint8Array };
    assert.strictEqual(call.uri.fsPath, saveUri.fsPath);
    const content = new TextDecoder().decode(call.content);
    assert.ok(content.startsWith("aes:"), "Content should be encrypted with aes:");
  });

  test("importConfig should import unencrypted JSON", async () => {
    const providers: Provider[] = [
      { id: "p1", name: "Imported", models: [], providerType: "generic" },
    ];
    const jsonContent = JSON.stringify(providers);

    // Mock showOpenDialog
    const openUri = vscode.Uri.file("/tmp/config.json");
    vscode.window.showOpenDialog = async () => [openUri];

    // Mock readFile
    (vscode.workspace.fs as any).readFile = async () => new TextEncoder().encode(jsonContent);

    // Mock showConfirmDialog (if needed, though mock manager starts empty so maybe not)
    // But if current providers exist, it asks. Let's ensure manager is empty first.
    manager.setProviders([]);

    await commandHandler.importConfig();

    assert.ok(manager.savedProviders, "Providers should be saved");
    const saved = manager.savedProviders as Provider[];
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0]!.name, "Imported");
  });

  test("importConfig should import encrypted content", async () => {
    // First export to get valid encrypted string
    const providers: Provider[] = [
      { id: "p1", name: "Encrypted", models: [], providerType: "generic", apiKey: "secret-key" },
    ];
    manager.setProviders(providers);

    // Mock showInputBox for export
    vscode.window.showInputBox = async () => "password123";
    const saveUri = vscode.Uri.file("/tmp/config.encrypt.txt");
    vscode.window.showSaveDialog = async () => saveUri;
    
    let exportedContent: Uint8Array | undefined;
    (vscode.workspace.fs as any).writeFile = async (_uri: vscode.Uri, content: Uint8Array) => {
      exportedContent = content;
    };

    await commandHandler.exportConfig();
    assert.ok(exportedContent, "Export failed");

    // Now import
    manager.setProviders([]); // Clear
    manager.savedProviders = undefined;

    // Mock showOpenDialog
    vscode.window.showOpenDialog = async () => [saveUri];

    // Mock readFile
    (vscode.workspace.fs as any).readFile = async () => exportedContent!;

    // Mock showInputBox for import (password)
    vscode.window.showInputBox = async () => "password123";

    await commandHandler.importConfig();

    assert.ok(manager.savedProviders, "Providers should be saved after import");
    const saved = manager.savedProviders as Provider[];
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0]!.name, "Encrypted");
    assert.strictEqual(saved[0]!.apiKey, "secret-key", "API Key should be preserved in encrypted import");
  });
});
