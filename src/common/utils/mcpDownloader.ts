import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../logger';

export interface ReleaseInfo {
  version: string;
  assetName: string;
  downloadUrl: string;
  digest?: string; // Standardized hash if available in API
}

export class McpDownloader {
  /**
   * Resolves the best available release information from GitHub.
   *
   * Fallback Strategy:
   * 1. If `baseVersion` is provided, try to find that specific release first.
   * 2. If it lacks binary assets OR `baseVersion` is not found:
   * 3. Iterate backwards through all recent releases to find the most recent one
   *    that actually contains the platform-specific binary (mcp-server-*).
   */
  public static async resolveBestRelease(baseVersion?: string): Promise<ReleaseInfo | null> {
    const platform = process.platform === 'win32' ? 'windows' : process.platform;
    const arch = process.arch === 'x64' ? 'amd64' : process.arch;
    const releaseName = `mcp-server-${platform}-${arch}${platform === 'windows' ? '.exe' : ''}`;

    // 1. Try to get specific version if provided
    if (baseVersion) {
      const releaseTag = `v${baseVersion}`;
      const apiUrl = `https://api.github.com/repos/deepwn/addi/releases/tags/${releaseTag}`;
      try {
        const apiRes = await fetch(apiUrl, {
          headers: { 'User-Agent': 'VSCode-Addi-Extension' },
        });
        if (apiRes.ok) {
          const releaseData = (await apiRes.json()) as any;
          const asset = releaseData.assets?.find((a: any) => a.name === releaseName);
          if (asset) {
            return {
              version: baseVersion,
              assetName: releaseName,
              downloadUrl: asset.browser_download_url,
              digest: asset.digest,
            };
          }
        }
      } catch (e) {
        logger.debug(`Failed to fetch specific release ${releaseTag}`, e);
      }
    }

    // 2. List recent releases and find the latest one with assets
    try {
      logger.info('Searching for the latest release with binary assets...');
      const apiUrl = `https://api.github.com/repos/deepwn/addi/releases`;
      const apiRes = await fetch(apiUrl, {
        headers: { 'User-Agent': 'VSCode-Addi-Extension' },
      });
      if (!apiRes.ok) {
        return null;
      }
      const releases = (await apiRes.json()) as any[];

      for (const release of releases) {
        const asset = release.assets?.find((a: any) => a.name === releaseName);
        if (asset) {
          const tag = release.tag_name;
          const version = tag.startsWith('v') ? tag.substring(1) : tag;
          return {
            version,
            assetName: releaseName,
            downloadUrl: asset.browser_download_url,
            digest: asset.digest,
          };
        }
      }
    } catch (e) {
      logger.error('Failed to resolve best release', e);
    }
    return null;
  }

  /**
   * Legacy helper to match previous API usage.
   */
  public static async resolveBestMcpVersion(baseVersion: string): Promise<string | null> {
    const info = await this.resolveBestRelease(baseVersion);
    return info ? info.version : null;
  }

  /**
   * Downloads the MCP server binary for the specified version to the target path.
   */
  public static async downloadServer(targetPath: string, version: string): Promise<string | null> {
    const info = await this.resolveBestRelease(version);
    if (!info) {
      throw new Error(`Could not find a valid release for version ${version}`);
    }

    // Ensure directory exists
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Downloading Addi MCP Server (${info.version})...`,
        cancellable: false,
      },
      async (_progress) => {
        try {
          logger.info(`Downloading target asset ${info.assetName} from ${info.downloadUrl}`);
          const response = await fetch(info.downloadUrl);
          if (!response.ok) {
            throw new Error(`Failed to download binary: ${response.statusText}`);
          }

          const buffer = await response.arrayBuffer();
          fs.writeFileSync(targetPath, Buffer.from(buffer));

          // Verify Integrity
          await this.verifyIntegrity(targetPath, info);

          fs.chmodSync(targetPath, 0o755);
          return targetPath;
        } catch (e) {
          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }
          logger.error('Failed to download MCP server', e);
          throw e;
        }
      }
    );
  }

  /**
   * Verifies the downloaded file integrity using 'digest' from API or fallback to checksums.txt.
   */
  private static async verifyIntegrity(targetPath: string, info: ReleaseInfo): Promise<void> {
    const actualHash = await this.calculateFileHash(targetPath);

    // 1. Try API digest first
    if (info.digest) {
      const parts = info.digest.split(':');
      const algo = parts.length > 1 ? parts[0] : 'sha256';
      const expectedHash = parts.length > 1 ? parts[1] : parts[0];

      if (algo === 'sha256') {
        if (actualHash !== expectedHash) {
          throw new Error(
            `Integrity check failed (API digest). Expected: ${expectedHash}, Actual: ${actualHash}`
          );
        }
        logger.info('Integrity verification passed (via API digest).');
        return;
      }
    }

    // 2. Fallback to checksums.txt
    try {
      const releaseTag = `v${info.version}`;
      const apiUrl = `https://api.github.com/repos/deepwn/addi/releases/tags/${releaseTag}`;
      const apiRes = await fetch(apiUrl, { headers: { 'User-Agent': 'VSCode-Addi-Extension' } });
      if (apiRes.ok) {
        const releaseData = (await apiRes.json()) as any;
        const checksumAsset = releaseData.assets?.find((a: any) => a.name === 'checksums.txt');
        if (checksumAsset) {
          const checksumRes = await fetch(checksumAsset.browser_download_url);
          if (checksumRes.ok) {
            const checksumText = await checksumRes.text();
            const expectedHash = this.parseChecksum(checksumText, info.assetName);
            if (expectedHash) {
              if (actualHash !== expectedHash) {
                throw new Error(
                  `Integrity check failed (checksums.txt). Expected: ${expectedHash}, Actual: ${actualHash}`
                );
              }
              logger.info('Integrity verification passed (via checksums.txt).');
              return;
            }
          }
        }
      }
    } catch (e) {
      logger.warn('Fallback checksum verification failed', e);
    }

    logger.warn('No source found to verify binary integrity. Proceeding with caution.');
  }

  public static async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(filePath)) {
        reject(new Error(`File not found for hashing: ${filePath}`));
        return;
      }
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk: any) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  private static parseChecksum(checksumText: string, filename: string): string | null {
    const lines = checksumText.split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const hash = parts[0];
        const file = parts[1];
        if (
          hash &&
          file &&
          (file === filename ||
            file === `*${filename}` ||
            file.endsWith(`/${filename}`) ||
            file.endsWith(`\\${filename}`))
        ) {
          return hash;
        }
      }
    }
    return null;
  }
}
