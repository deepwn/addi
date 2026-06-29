import * as vscode from 'vscode';
import type { ByokProvider } from '../../services/byokTypes';
import { getProviderDefaults } from '../../services/byokTypes';

/**
 * Provider icon resolver for the tree view.
 *
 * Matches providers to their brand logo (monochrome SVG) using one of:
 *   1. Known vendor name (e.g. "openai", "anthropic", "google")
 *   2. URL pattern recognition (for vendors stored as "custom"/"customendpoint")
 *
 * Icons are loaded from resources/provider-icons/*.svg at runtime.
 * No package.json registration required — uses TreeItem.iconPath { light, dark }.
 */

/** Icon file name (without extension) → iconKey identifier */
const knownIcons = new Set([
  'openai', 'anthropic', 'google', 'mistral', 'deepseek', 'xai', 'groq',
  'together', 'perplexity', 'cohere', 'azureai', 'zhipu', 'moonshot',
  'minimax', 'qwen', 'spark', 'bytedance', 'baidu', 'hunyuan', 'stepfun',
  'siliconcloud', 'openrouter', 'baichuan', 'cerebras', 'fireworks', 'ollama',
]);

/**
 * URL pattern → iconKey mapping for providers whose vendor is "custom"/"customendpoint".
 * Matched by checking if the provider's `_addi_defaults.url` contains the pattern.
 * Order matters: more specific patterns should come first.
 */
const urlPatternMap: Array<{ pattern: string; icon: string }> = [
  { pattern: 'api.openai.com', icon: 'openai' },
  { pattern: 'api.anthropic.com', icon: 'anthropic' },
  { pattern: 'generativelanguage.googleapis.com', icon: 'google' },
  { pattern: 'api.mistral.ai', icon: 'mistral' },
  { pattern: 'api.deepseek.com', icon: 'deepseek' },
  { pattern: 'api.x.ai', icon: 'xai' },
  { pattern: 'api.groq.com', icon: 'groq' },
  { pattern: 'api.together.xyz', icon: 'together' },
  { pattern: 'api.perplexity', icon: 'perplexity' },
  { pattern: 'api.cohere.ai', icon: 'cohere' },
  // Azure AI uses azureai icon (different from azure)
  { pattern: 'open.bigmodel.cn', icon: 'zhipu' },
  { pattern: 'api.moonshot.cn', icon: 'moonshot' },
  { pattern: 'api.minimax.chat', icon: 'minimax' },
  { pattern: 'dashscope.aliyuncs.com', icon: 'qwen' },
  { pattern: 'spark-api-open.xf-yun.com', icon: 'spark' },
  { pattern: 'ark.cn-beijing.volces.com', icon: 'bytedance' },
  { pattern: 'qianfan.baidubce.com', icon: 'baidu' },
  { pattern: 'api.hunyuan.cloud.tencent.com', icon: 'hunyuan' },
  { pattern: 'api.stepfun.com', icon: 'stepfun' },
  { pattern: 'api.siliconflow.cn', icon: 'siliconcloud' },
  { pattern: 'openrouter.ai', icon: 'openrouter' },
  { pattern: 'api.baichuan-ai.com', icon: 'baichuan' },
  { pattern: 'api.cerebras.ai', icon: 'cerebras' },
  { pattern: 'api.fireworks.ai', icon: 'fireworks' },
  // Ollama — usually localhost
  { pattern: 'ollama', icon: 'ollama' },
  { pattern: 'localhost:11434', icon: 'ollama' },
];

/**
 * Resolve the icon path for a provider tree item.
 * Returns { light, dark } Uri pair, or a ThemeIcon if no logo matches.
 */
export function resolveProviderTreeIcon(
  provider: ByokProvider,
  extensionUri: vscode.Uri,
): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } | undefined {
  const iconKey = resolveIconKey(provider);
  if (!iconKey) return undefined;

  const iconPath = vscode.Uri.joinPath(
    extensionUri,
    'resources',
    'provider-icons',
    `${iconKey}.svg`,
  );

  return { light: iconPath, dark: iconPath };
}

/**
 * Determine the icon key for a provider.
 * 1. If the vendor is a known icon name directly → use it
 * 2. If the vendor is "custom"/"customendpoint" → match URL against known patterns
 */
function resolveIconKey(provider: ByokProvider): string | undefined {
  const vendor = provider.vendor?.toLowerCase();

  // Direct vendor match (openai, anthropic, google, azure, azureai)
  if (vendor && vendor !== 'custom' && vendor !== 'customendpoint' && vendor !== 'copilot' && vendor !== 'github') {
    // For "azure", prefer "azureai" icon if the provider URL looks like Azure AI Studio
    if (vendor === 'azure') {
      return 'azureai';
    }
    if (knownIcons.has(vendor)) {
      return vendor;
    }
  }

  // URL pattern matching for custom providers
  const defaults = getProviderDefaults(provider);
  const url = defaults.url?.toLowerCase();
  if (!url) return undefined;

  for (const entry of urlPatternMap) {
    if (url.includes(entry.pattern)) {
      return entry.icon;
    }
  }

  return undefined;
}
