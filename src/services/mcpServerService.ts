import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { logger } from "../logger";
import { McpDownloader } from "../utils/mcpDownloader";

export class McpServerService {
  private static instance: McpServerService;
  // Define the required MCP server version. Update this only when a new binary is released.
  public static readonly REQUIRED_MCP_VERSION = "0.0.15";
  
  private _onDidStatusChange = new vscode.EventEmitter<void>();
  public readonly onDidStatusChange = this._onDidStatusChange.event;

  private constructor(_context: vscode.ExtensionContext) {}

  public static getInstance(context: vscode.ExtensionContext): McpServerService {
    if (!McpServerService.instance) {
      McpServerService.instance = new McpServerService(context);
    }
    return McpServerService.instance;
  }

  public async initialize() {
    const binaryPath = await this.getOrDownloadBinary();
    if (binaryPath) {
        await this.checkForUpdate(binaryPath);
    }
  }

  private async checkForUpdate(binaryPath: string) {
      // Use the hardcoded required version instead of the extension version
      const requiredVersion = McpServerService.REQUIRED_MCP_VERSION;

      // Get binary version
      const currentVersion = await this.getBinaryVersion(binaryPath);
      if (!currentVersion) { return; }

      // Simple version comparison (string equality for now, assuming exact match required)
      // In future, could use semver comparison
      if (currentVersion !== requiredVersion && currentVersion !== "dev") {
          // Prompt update
          const selection = await vscode.window.showInformationMessage(
              `New version of Addi MCP Server is available (Current: ${currentVersion}, Required: ${requiredVersion}). Update now?`,
              "Update",
              "Ignore"
          );
          if (selection === "Update") {
              await this.downloadBinary(binaryPath);
          }
      }
  }

  private async getBinaryVersion(binaryPath: string): Promise<string | null> {
      return new Promise((resolve) => {
          const cp = require("child_process");
          // Run binary with --version flag
          cp.exec(`"${binaryPath}" --version`, (err: any, stdout: string) => {
              if (err) {
                  logger.warn(`Failed to get version from binary: ${err}`);
                  resolve(null);
                  return;
              }
              resolve(stdout.trim());
          });
      });
  }

  public async restart() {
    // No-op for now as we don't manage the process
    logger.info("Restarting MCP Server (Managed by VS Code)...");
    this._onDidStatusChange.fire();
  }

  public isBinaryAvailable(): boolean {
    const config = vscode.workspace.getConfiguration("addi");
    let binaryPath = config.get<string>("mcpServer.path");

    if (!binaryPath) {
      const homeDir = os.homedir();
      const binDir = path.join(homeDir, ".addi", "bin");
      const binaryName = process.platform === "win32" ? "mcp-server.exe" : "mcp-server";
      binaryPath = path.join(binDir, binaryName);
    }

    return fs.existsSync(binaryPath);
  }

  public async downloadMcpServer(version?: string) {
    const config = vscode.workspace.getConfiguration("addi");
    let binaryPath = config.get<string>("mcpServer.path");

    if (!binaryPath) {
      const homeDir = os.homedir();
      const binDir = path.join(homeDir, ".addi", "bin");
      const binaryName = process.platform === "win32" ? "mcp-server.exe" : "mcp-server";
      binaryPath = path.join(binDir, binaryName);
    }

    await this.downloadBinary(binaryPath, version);
  }

  public getBinaryPath(): string | null {
    const config = vscode.workspace.getConfiguration("addi");
    let binaryPath = config.get<string>("mcpServer.path");

    if (!binaryPath) {
      const homeDir = os.homedir();
      const binDir = path.join(homeDir, ".addi", "bin");
      const binaryName = process.platform === "win32" ? "mcp-server.exe" : "mcp-server";
      binaryPath = path.join(binDir, binaryName);
    }

    return fs.existsSync(binaryPath) ? binaryPath : null;
  }

  private async getOrDownloadBinary(): Promise<string | null> {
    const existing = this.getBinaryPath();
    if (existing) {
      return existing;
    }

    const config = vscode.workspace.getConfiguration("addi");
    let binaryPath = config.get<string>("mcpServer.path");

    if (!binaryPath) {
      const homeDir = os.homedir();
      const binDir = path.join(homeDir, ".addi", "bin");
      const binaryName = process.platform === "win32" ? "mcp-server.exe" : "mcp-server";
      binaryPath = path.join(binDir, binaryName);
    }

    // Binary not found, prompt user
    const selection = await vscode.window.showInformationMessage(`Addi MCP Server binary not found at ${binaryPath}. Would you like to download it?`, "Download", "Cancel");

    if (selection === "Download") {
      return await this.downloadBinary(binaryPath);
    }

    return null;
  }

  private async downloadBinary(targetPath: string, version?: string): Promise<string | null> {
    // Ensure directory exists
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 1. Try to copy from local dev build (release/bin or mcp-server)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const folder = workspaceFolders[0];
      if (folder) {
        const platform = process.platform;
        const arch = process.arch;
        const binaryName = platform === "win32" ? "mcp-server.exe" : "mcp-server";
        
        // Check release/bin first (cross-compiled names)
        // e.g. mcp-server-darwin-arm64
        const releaseName = `mcp-server-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
        const releaseBuildPath = path.join(folder.uri.fsPath, "release", "bin", releaseName);
        
        // Check mcp-server/ (direct go build)
        const devBuildPath = path.join(folder.uri.fsPath, "mcp-server", binaryName);

        let sourcePath: string | null = null;
        if (fs.existsSync(releaseBuildPath)) {
            sourcePath = releaseBuildPath;
            logger.info(`Found local release build at ${releaseBuildPath}`);
        } else if (fs.existsSync(devBuildPath)) {
            sourcePath = devBuildPath;
            logger.info(`Found local dev build at ${devBuildPath}`);
        }

        if (sourcePath) {
          try {
            fs.copyFileSync(sourcePath, targetPath);
            fs.chmodSync(targetPath, 0o755); // Make executable
            vscode.window.showInformationMessage("MCP Server installed successfully (from local build).");
            this._onDidStatusChange.fire();
            return targetPath;
          } catch (e) {
            logger.error("Failed to copy local build", e);
          }
        }
      }
    }

    // 2. Download from GitHub Releases
    const targetVersion = version || McpServerService.REQUIRED_MCP_VERSION;

    try {
        const result = await McpDownloader.downloadServer(targetPath, targetVersion);
        if (result) {
            vscode.window.showInformationMessage(`MCP Server (${targetVersion}) downloaded and installed successfully.`);
            this._onDidStatusChange.fire();
            return result;
        }
        return null;
    } catch (e) {
         vscode.window.showErrorMessage(`Failed to download MCP server: ${e instanceof Error ? e.message : String(e)}. Please check your internet connection or manually download from GitHub Releases.`);
         return null;
    }
  }

  // Helper methods calculateFileHash and parseChecksum removed as they are moved to McpDownloader


  public async callTool(toolName: string, args: any): Promise<any> {
    const binaryPath = this.getBinaryPath();
    if (!binaryPath) {
      throw new Error("MCP Server binary not found");
    }

    return new Promise((resolve, reject) => {
      const cp = require("child_process");
      const os = require("os");
      const path = require("path");

      const dirs: string[] = [];
      dirs.push(path.join(os.homedir(), ".addi"));
      if (vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
          dirs.push(path.join(folder.uri.fsPath, ".addi", "public"));
          dirs.push(path.join(folder.uri.fsPath, ".addi", "private"));
        }
      }
      const dirsArg = dirs.join(",");

      const child = cp.spawn(binaryPath, ["--mode", "local", "--dirs", dirsArg], {
        env: process.env
      });

      let buffer = "";

      const send = (msg: any) => {
        const str = JSON.stringify(msg) + "\n";
        child.stdin.write(str);
      };

      child.stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        // Keep the last part if it's not a complete line
        if (buffer.endsWith("\n")) {
            buffer = "";
        } else {
            buffer = lines.pop() || "";
        }

        for (const line of lines) {
          if (!line.trim()) { continue; }
          try {
            const msg = JSON.parse(line);
            
            if (msg.id === "init") {
                // Initialize response
                send({
                    jsonrpc: "2.0",
                    method: "notifications/initialized"
                });
                
                // Now call the tool
                send({
                    jsonrpc: "2.0",
                    id: "call-1",
                    method: "tools/call",
                    params: {
                        name: toolName,
                        arguments: args
                    }
                });
            } else if (msg.id === "call-1") {
                if (msg.error) {
                    reject(new Error(msg.error.message));
                } else {
                    resolve(msg.result);
                }
                child.kill();
            }
          } catch (e) {
            // Ignore non-JSON lines (logs)
          }
        }
      });
      
      child.stderr.on("data", (_data: Buffer) => {
          // logger.debug(`MCP Stderr: ${data}`);
      });

      child.on("error", (err: Error) => {
        reject(err);
      });

      // Start handshake
      send({
        jsonrpc: "2.0",
        id: "init",
        method: "initialize",
        params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: {
                name: "addi-extension",
                version: "0.1.0"
            }
        }
      });
    });
  }

  public dispose() {
    // No cleanup needed
  }
}
