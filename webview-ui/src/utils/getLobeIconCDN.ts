/**
 * Lightweight CDN icon URL generator.
 * Replicates @lobehub/icons getLobeIconCDN() behavior without pulling in antd / @lobehub/ui.
 */

type IconCdn = "github" | "unpkg" | "aliyun";
type IconFormat = "png" | "svg" | "webp" | "avatar";
type IconType = "color" | "mono";

interface IconConfig {
  format?: IconFormat;
  type?: IconType;
  cdn?: IconCdn;
  isDarkMode?: boolean;
}

const CDN_BASE: Record<IconCdn, (format: string) => string> = {
  github: (f) =>
    `https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-${f}`,
  unpkg: (f) => `https://unpkg.com/@lobehub/icons-static-${f}@latest`,
  aliyun: (f) => `https://registry.npmmirror.com/@lobehub/icons-static-${f}/latest/files`,
};

export function getLobeIconCDN(id: string, config?: IconConfig): string {
  const { format = "png", type = "color", cdn = "unpkg", isDarkMode = false } = config ?? {};
  const baseUrl = CDN_BASE[cdn](format);

  if (format === "avatar") {
    return `${baseUrl}/avatars/${id.toLowerCase()}.webp`;
  }

  const addon = type === "mono" ? "" : `-${type}`;
  switch (format) {
    case "svg":
      return `${baseUrl}/icons/${id.toLowerCase()}${addon}.svg`;
    case "webp":
      return `${baseUrl}/${isDarkMode ? "dark" : "light"}/${id.toLowerCase()}${addon}.webp`;
    default:
      return `${baseUrl}/${isDarkMode ? "dark" : "light"}/${id.toLowerCase()}${addon}.png`;
  }
}
