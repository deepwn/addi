/**
 * Local provider icon resolver using @lobehub/icons-static-svg.
 * Replaces the CDN-based getLobeIconCDN() with direct Vite-bundled imports.
 * 
 * All icon imports are statically resolved at build time via Vite.
 * For icons without a "-color" variant, the base mono SVG is used.
 */

import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg?url';
import anthropicSvg from '@lobehub/icons-static-svg/icons/anthropic.svg?url';
import googleSvg from '@lobehub/icons-static-svg/icons/google-color.svg?url';
import mistralSvg from '@lobehub/icons-static-svg/icons/mistral-color.svg?url';
import deepseekSvg from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url';
import xaiSvg from '@lobehub/icons-static-svg/icons/xai.svg?url';
import groqSvg from '@lobehub/icons-static-svg/icons/groq.svg?url';
import togetheraiSvg from '@lobehub/icons-static-svg/icons/together-color.svg?url';
import perplexitySvg from '@lobehub/icons-static-svg/icons/perplexity-color.svg?url';
import cohereSvg from '@lobehub/icons-static-svg/icons/cohere-color.svg?url';
import azureaiSvg from '@lobehub/icons-static-svg/icons/azureai-color.svg?url';
import zhipuSvg from '@lobehub/icons-static-svg/icons/zhipu-color.svg?url';
import moonshotSvg from '@lobehub/icons-static-svg/icons/moonshot.svg?url';
import minimaxSvg from '@lobehub/icons-static-svg/icons/minimax-color.svg?url';
import qwenSvg from '@lobehub/icons-static-svg/icons/qwen-color.svg?url';
import sparkSvg from '@lobehub/icons-static-svg/icons/spark-color.svg?url';
import bytedanceSvg from '@lobehub/icons-static-svg/icons/bytedance-color.svg?url';
import baiduSvg from '@lobehub/icons-static-svg/icons/baidu-color.svg?url';
import hunyuanSvg from '@lobehub/icons-static-svg/icons/hunyuan-color.svg?url';
import stepfunSvg from '@lobehub/icons-static-svg/icons/stepfun-color.svg?url';
import siliconcloudSvg from '@lobehub/icons-static-svg/icons/siliconcloud-color.svg?url';
import openrouterSvg from '@lobehub/icons-static-svg/icons/openrouter.svg?url';
import baichuanSvg from '@lobehub/icons-static-svg/icons/baichuan-color.svg?url';
import cerebrasSvg from '@lobehub/icons-static-svg/icons/cerebras-color.svg?url';
import fireworksSvg from '@lobehub/icons-static-svg/icons/fireworks-color.svg?url';
import ollamaSvg from '@lobehub/icons-static-svg/icons/ollama.svg?url';

/** Mapping from iconKey (lowercase) → resolved SVG URL */
const iconMap: Record<string, string> = {
  openai: openaiSvg,
  anthropic: anthropicSvg,
  google: googleSvg,
  mistral: mistralSvg,
  deepseek: deepseekSvg,
  xai: xaiSvg,
  groq: groqSvg,
  togetherai: togetheraiSvg,
  perplexity: perplexitySvg,
  cohere: cohereSvg,
  azureai: azureaiSvg,
  zhipu: zhipuSvg,
  moonshot: moonshotSvg,
  minimax: minimaxSvg,
  qwen: qwenSvg,
  spark: sparkSvg,
  bytedance: bytedanceSvg,
  baidu: baiduSvg,
  hunyuan: hunyuanSvg,
  stepfun: stepfunSvg,
  siliconcloud: siliconcloudSvg,
  openrouter: openrouterSvg,
  baichuan: baichuanSvg,
  cerebras: cerebrasSvg,
  fireworks: fireworksSvg,
  ollama: ollamaSvg,
};

/**
 * Get the local SVG URL for a provider icon.
 * @param iconKey - The icon key from presets.json (e.g., "openai", "google")
 * @returns The resolved SVG URL string, or empty string if not found.
 */
export function getProviderIcon(iconKey: string): string {
  return iconMap[iconKey.toLowerCase()] ?? '';
}
