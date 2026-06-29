import type * as vscode from 'vscode';
import type { ProviderModelManager } from '../../core/providers/ProviderModelManager';
import type { AddiTreeDataProvider } from '../views/providerView';
import type { EditorViewManager } from '../views/editorView';
import { logger, LogScope } from '../../common/logger';

/**
 * Addi secret key prefix for providers stored in context.secrets.
 * When a saved apiKey starts with `${input:addi.apikey.xxx}`, the
 * actual value is stored under this prefix in the extension secret store.
 */
const ADDIC_SECRET_PREFIX = 'addi.apikey.';

/**
 * Resolve an API key that may be a `${input:...}` secret reference.
 * 
 * 1. If the key is plaintext, return it directly.
 * 2. If it's `${input:addi.apikey.<name>}`, resolve from context.secrets.
 * 3. If it's another `${input:...}` (e.g. VS Code's own `chat.lm.secret.*`),
 *    try to fall back to `addi.apikey.<providerName>` in our store, then
 *    prompt the user for the key.
 * 
 * @returns The resolved plaintext key, or undefined if unresolvable.
 */
export async function resolveApiKey(
  apiKey: string | undefined,
  providerName: string,
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  if (!apiKey) return undefined;

  // Plaintext key — return directly
  if (!apiKey.startsWith('${input:')) {
    return apiKey.trim() || undefined;
  }

  // Extract the secret key from ${input:<key>}
  const innerKey = apiKey.slice('${input:'.length, -1); // removes "${input:" prefix and "}" suffix

  // If it's our own addi key, resolve from context.secrets
  if (innerKey.startsWith(ADDIC_SECRET_PREFIX)) {
    const stored = await context.secrets.get(innerKey);
    if (stored) return stored;
  }

  // If it's a VS Code-owned secret (chat.lm.secret.*), try our fallback key
  const ourKey = ADDIC_SECRET_PREFIX + providerName;
  const ourStored = await context.secrets.get(ourKey);
  if (ourStored) return ourStored;

  // Last resort: prompt the user
  const inputKey = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Enter API key for "{0}"', providerName),
    password: true,
    placeHolder: 'sk-...',
    ignoreFocusOut: true,
  });

  if (inputKey) {
    // Cache for future use
    await context.secrets.store(ourKey, inputKey);
    return inputKey;
  }

  return undefined;
}

/**
 * Store a plaintext API key for a provider.
 * 
 * Writes the key to BOTH:
 * 1. Our extension's secret storage (`addi.apikey.<name>`) — for Addi's sync/readback
 * 2. Returns the key as-is (plaintext) — so it gets written to chatLanguageModels.json
 *    as plaintext, which Copilot's _resolveConfiguration can use (via the `stored ?? value`
 *    fallback when decodeSecretKey fails on plaintext).
 * 
 * If the user later uses VS Code's built-in "Update API Key" UI, VS Code will convert
 * the plaintext to `${input:chat.lm.secret.<uuid>}` and store the real key in its own
 * secret storage — at which point our `resolveApiKey` will find it via our backup copy.
 * 
 * @returns The plaintext API key (to write as-is to chatLanguageModels.json)
 */
export async function storeApiKey(
  apiKey: string,
  providerName: string,
  context: vscode.ExtensionContext,
): Promise<string> {
  // Keep a backup in our own secrets for sync/readback
  const secretKey = ADDIC_SECRET_PREFIX + providerName;
  await context.secrets.store(secretKey, apiKey);
  // Return plaintext — let Copilot read it directly from the file
  return apiKey;
}

/**
 * Base command handler with common dependencies
 */
export abstract class BaseCommandHandler {
  protected manager: ProviderModelManager;
  protected treeDataProvider: AddiTreeDataProvider;
  protected context: vscode.ExtensionContext;
  protected editorViewManager?: EditorViewManager;

  constructor(
    manager: ProviderModelManager,
    treeDataProvider: AddiTreeDataProvider,
    context: vscode.ExtensionContext,
  ) {
    this.manager = manager;
    this.treeDataProvider = treeDataProvider;
    this.context = context;
  }

  public setEditorViewManager(m: EditorViewManager) {
    this.editorViewManager = m;
  }

  protected refreshTreeView(): void {
    this.treeDataProvider.refresh();
  }

  protected logError(source: string, error: unknown, context?: Record<string, unknown>): void {
    logger.error(
      source,
      {
        error: error instanceof Error ? error.message : String(error),
        ...context,
      },
      LogScope.COMMAND,
    );
  }
}
