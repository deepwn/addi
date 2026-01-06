import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { logger } from "../logger";

export class McpDownloader {
    
    /**
     * Downloads the MCP server binary for the specified version to the target path.
     * @param targetPath The full path where the binary should be saved.
     * @param version The version to download (e.g., "0.0.15").
     * @returns The path to the downloaded binary if successful, null otherwise.
     */
    public static async downloadServer(targetPath: string, version: string): Promise<string | null> {
        // Ensure directory exists
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const platformRaw = process.platform;
        const archRaw = process.arch;
        
        // Map platform: win32 -> windows, darwin -> darwin, linux -> linux
        const platform = platformRaw === 'win32' ? 'windows' : platformRaw;
        
        // Map arch: x64 -> amd64, arm64 -> arm64
        const arch = archRaw === 'x64' ? 'amd64' : archRaw;
        
        const releaseTag = `v${version}`;

        // GitHub API URL
        const apiUrl = `https://api.github.com/repos/deepwn/addi/releases/tags/${releaseTag}`;

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Downloading Addi MCP Server (${version})...`,
            cancellable: false
        }, async (_progress) => {
            try {
                logger.info(`Fetching release info from ${apiUrl}`);
                const apiRes = await fetch(apiUrl, {
                    headers: { 'User-Agent': 'VSCode-Addi-Extension' }
                });
                if (!apiRes.ok) {
                    throw new Error(`Failed to fetch release info: ${apiRes.statusText}`);
                }
                
                const releaseData = await apiRes.json() as any;
                
                // Construct expected asset name matching GitHub release naming
                const releaseName = `mcp-server-${platform}-${arch}${platform === "windows" ? ".exe" : ""}`;
                
                const asset = releaseData.assets.find((a: any) => a.name === releaseName);
                if (!asset) {
                     throw new Error(`Asset ${releaseName} not found in release ${releaseTag}. Available: ${releaseData.assets.map((a:any) => a.name).join(', ')}`);
                }
                
                const downloadUrl = asset.browser_download_url;
                logger.info(`Found asset ${releaseName}: ${downloadUrl}`);
                
                const response = await fetch(downloadUrl);
                if (!response.ok) {
                    throw new Error(`Failed to download binary: ${response.statusText}`);
                }
                
                const buffer = await response.arrayBuffer();
                fs.writeFileSync(targetPath, Buffer.from(buffer));

                // Verify Checksum
                try {
                    const checksumAsset = releaseData.assets.find((a: any) => a.name === 'checksums.txt');
                    if (checksumAsset) {
                        const checksumUrl = checksumAsset.browser_download_url;
                        logger.info(`Fetching checksums from ${checksumUrl}`);
                        const checksumResponse = await fetch(checksumUrl);
                        if (checksumResponse.ok) {
                            const checksumText = await checksumResponse.text();
                            const expectedHash = McpDownloader.parseChecksum(checksumText, releaseName);
                            
                            if (expectedHash) {
                                const actualHash = await McpDownloader.calculateFileHash(targetPath);
                                if (actualHash !== expectedHash) {
                                    throw new Error(`Checksum verification failed. Expected ${expectedHash}, got ${actualHash}`);
                                }
                                logger.info("Checksum verification passed.");
                            } else {
                                logger.warn(`No checksum found for ${releaseName} in checksums.txt`);
                            }
                        }
                    } else {
                         logger.warn("checksums.txt not found in release assets.");
                    }
                } catch (checksumErr) {
                    if (checksumErr instanceof Error && checksumErr.message.includes("Checksum verification failed")) {
                         throw checksumErr;
                    }
                    logger.warn(`Checksum verification error: ${checksumErr}`);
                }

                fs.chmodSync(targetPath, 0o755);
                
                return targetPath;
            } catch (e) {
                // Cleanup partial file
                if (fs.existsSync(targetPath)) {
                    fs.unlinkSync(targetPath);
                }
                logger.error("Failed to download MCP server", e);
                throw e; // Let caller handle the UI error message if needed, or rethrow
            }
        });
    }

    private static parseChecksum(checksumText: string, filename: string): string | null {
        const lines = checksumText.split('\n');
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
                const hash = parts[0];
                const file = parts[1];
                if (!hash || !file) { continue; }
                // shasum output might have *filename or just filename, and might include path
                if (file === filename || file === `*${filename}` || file.endsWith(`/${filename}`) || file.endsWith(`\\${filename}`)) {
                    return hash;
                }
            }
        }
        return null;
    }

    private static async calculateFileHash(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash("sha256");
            const stream = fs.createReadStream(filePath);
            stream.on("error", reject);
            stream.on("data", (chunk: any) => hash.update(chunk));
            stream.on("end", () => resolve(hash.digest("hex")));
        });
    }
}
