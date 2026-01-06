import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as cp from "child_process";
import { logger } from "../../common/logger";
import { IMcpService } from "../../common/interfaces";
import { McpDownloader } from "../../common/utils/mcpDownloader";

/**
 * Manages the local MCP (Model Context Protocol) Server process.
 * 
 * - Encapsulates the child_process lifecycle (spawn, restart, kill).
 * - Implements the transport layer (stdio) for communicating with the Go binary.
 */
export class McpServerService implements IMcpService {
  private static instance: McpServerService;
  // Define the required MCP server version. Update this only when a new binary is released.
  // REMOVED: public static readonly REQUIRED_MCP_VERSION = "0.0.16";
  
  private _onDidStatusChange = new vscode.EventEmitter<void>();
  public readonly onDidStatusChange = this._onDidStatusChange.event;

  // Private instance state
  private child: cp.ChildProcess | null = null;
  private isReady: boolean = false;
  private pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private messageBuffer: string = "";

  private constructor(private readonly context: vscode.ExtensionContext) {}

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
        // Start the private instance for internal use
        await this.ensureServerRunning();
    }
  }

  private async checkForUpdate(binaryPath: string) {
      // Logic: 
      // 1. Get current installed binary version.
      // 2. Get target version (ideally extension version, or latest released MCP version).
      const extensionVersion = this.context.extension.packageJSON.version;
      
      // Get binary version
      const currentVersion = await this.getBinaryVersion(binaryPath);
      if (!currentVersion) { return; }
      
      // If current version is "dev", never update automatically
      if (currentVersion === "dev") { return; }

      // We simply assume we want to match latest available if current is different?
      // Or we can check if a better version exists. 
      // For now, let's just trigger download logic if we suspect an update is needed (handled inside getOrDownloadBinary usually?)
      // But here we are in 'initialize', binary exists. 
      // Let's rely on McpDownloader to find the best version.
      try {
        const targetVersion = await McpDownloader.resolveBestMcpVersion(extensionVersion);
        if (targetVersion && currentVersion !== targetVersion) {
             const selection = await vscode.window.showInformationMessage(
              `New version of Addi MCP Server is available (Current: ${currentVersion}, Latest: ${targetVersion}). Update now?`,
              "Update",
              "Ignore"
          );
          if (selection === "Update") {
              await this.downloadBinary(binaryPath, targetVersion);
          }
        }
      } catch (e) {
          logger.warn("Failed to check for MCP updates", e);
      }
  }

  private async getBinaryVersion(binaryPath: string): Promise<string | null> {
      return new Promise((resolve) => {
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
    logger.info("Restarting MCP Server...");
    // 1. Restart private instance
    this.stop();
    await this.ensureServerRunning().catch(e => logger.error("Failed to restart private MCP server", e));
    
    // 2. Notify VS Code to restart public instance
    this._onDidStatusChange.fire();
  }

  public stop() {
    if (this.child) {
      logger.info("Stopping Private MCP Server process...");
      this.child.kill();
      this.child = null;
    }
    this.isReady = false;
    this.pendingRequests.forEach((p) => p.reject(new Error("Server stopped")));
    this.pendingRequests.clear();
    this.messageBuffer = "";
  }

  public isBinaryAvailable(): boolean {
    const binaryPath = this.getBinaryPath();
    return !!binaryPath && fs.existsSync(binaryPath);
  }

  public async downloadMcpServer(version?: string) {
    const binaryPath = this.getBinaryPath() || this.getDefaultBinaryPath();
    await this.downloadBinary(binaryPath, version);
  }

  public getBinaryPath(): string | null {
    const config = vscode.workspace.getConfiguration("addi");
    let binaryPath = config.get<string>("mcpServer.path");

    if (!binaryPath) {
      binaryPath = this.getDefaultBinaryPath();
    }

    return fs.existsSync(binaryPath) ? binaryPath : null;
  }

  private getDefaultBinaryPath(): string {
    const homeDir = os.homedir();
    const binDir = path.join(homeDir, ".addi", "bin");
    const binaryName = process.platform === "win32" ? "mcp-server.exe" : "mcp-server";
    return path.join(binDir, binaryName);
  }

  private async getOrDownloadBinary(): Promise<string | null> {
    const existing = this.getBinaryPath();
    if (existing) {
      return existing;
    }

    const binaryPath = this.getDefaultBinaryPath();

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

    // 1. Try to copy from local dev build
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const folder = workspaceFolders[0];
      if (folder) {
        const platform = process.platform;
        const arch = process.arch;
        const binaryName = platform === "win32" ? "mcp-server.exe" : "mcp-server";
        
        const releaseName = `mcp-server-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
        const releaseBuildPath = path.join(folder.uri.fsPath, "release", "bin", releaseName);
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
    let targetVersion = version;
    if (!targetVersion) {
         try {
             // Resolve best version if not specified
             const extensionVersion = this.context.extension.packageJSON.version;
             const best = await McpDownloader.resolveBestMcpVersion(extensionVersion);
             if (best) {
                 targetVersion = best;
             } else {
                 throw new Error("Could not find a compatible MCP Server version.");
             }
         } catch (e) {
             vscode.window.showErrorMessage(`Failed to resolve MCP version: ${e instanceof Error ? e.message : String(e)}`);
             return null;
         }
    }

    try {
        const result = await McpDownloader.downloadServer(targetPath, targetVersion);
        if (result) {
            vscode.window.showInformationMessage(`MCP Server (${targetVersion}) downloaded and installed successfully.`);
            this._onDidStatusChange.fire(); // Notify VS Code
            return result;
        }
        return null;
    } catch (e) {
         vscode.window.showErrorMessage(`Failed to download MCP server: ${e instanceof Error ? e.message : String(e)}`);
         return null;
    }
  }

  // --- Private Instance Management (For LLMService internal use) ---

  public async callTool(toolName: string, args: any): Promise<any> {
    await this.ensureServerRunning();

    return new Promise((resolve, reject) => {
      const id = Date.now().toString() + Math.random().toString().slice(2, 5);
      this.pendingRequests.set(id, { resolve, reject });

      this.send({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      });
    });
  }

  private async ensureServerRunning(): Promise<void> {
    if (this.child && !this.child.killed && this.isReady) {
      return;
    }
    
    // If child exists but not ready, we are probably initializing.
    // If child is dead/null, start it.
    if (!this.child || this.child.killed) {
        const binaryPath = this.getBinaryPath();
        if (!binaryPath) {
          throw new Error("MCP Server binary not found");
        }

        logger.info(`Spawning Private MCP Server at ${binaryPath}`);

        const dirs: string[] = [];
        dirs.push(path.join(os.homedir(), ".addi"));
        if (vscode.workspace.workspaceFolders) {
          for (const folder of vscode.workspace.workspaceFolders) {
            dirs.push(path.join(folder.uri.fsPath, ".addi", "public"));
            dirs.push(path.join(folder.uri.fsPath, ".addi", "private"));
          }
        }
        const dirsArg = dirs.join(",");

        this.child = cp.spawn(binaryPath, ["--mode", "local", "--dirs", dirsArg, "--watch"], {
          env: process.env,
        });

        this.child.stdout?.on("data", (data: Buffer) => {
          this.messageBuffer += data.toString();
          const lines = this.messageBuffer.split("\n");
          if (this.messageBuffer.endsWith("\n")) {
            this.messageBuffer = "";
          } else {
            this.messageBuffer = lines.pop() || "";
          }

          for (const line of lines) {
            if (!line.trim()) {
              continue;
            }
            try {
              const msg = JSON.parse(line);
              this.handleMessage(msg);
            } catch (e) {
              // logger.debug("Non-JSON output from MCP server", { line });
            }
          }
        });

        this.child.stderr?.on("data", (_data) => {
           // logger.debug(`MCP Private Stderr: ${_data}`);
        });

        this.child.on("error", (err) => {
          logger.error("Private MCP Server process error", err);
          this.stop();
        });

        this.child.on("exit", (code, signal) => {
          logger.info(`Private MCP Server exited with code ${code} signal ${signal}`);
          this.stop();
        });
    }

    // Check readiness or wait for init
    if (this.isReady) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
       const initId = "init-" + Date.now();
       
       // Timeout to prevent hanging forever
       const timeout = setTimeout(() => {
           this.pendingRequests.delete(initId);
           reject(new Error("Timeout waiting for MCP server initialization"));
       }, 5000);

       this.pendingRequests.set(initId, {
           resolve: () => {
               clearTimeout(timeout);
               this.isReady = true;
               this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
               resolve();
           },
           reject: (err) => {
               clearTimeout(timeout);
               reject(err);
           }
       });

       this.send({
        jsonrpc: "2.0",
        id: initId,
        method: "initialize",
        params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "addi-extension-private", version: "0.1.0" }
        }
      });
    });
  }

  private send(msg: any) {
    if (this.child && !this.child.killed && this.child.stdin) {
      const str = JSON.stringify(msg) + "\n";
      this.child.stdin.write(str);
    } else {
      logger.warn("Attempted to send message to dead Private MCP server");
    }
  }

  private handleMessage(msg: any) {
    if (msg.id) {
       const pending = this.pendingRequests.get(msg.id);
       if (pending) {
           this.pendingRequests.delete(msg.id);
           if (msg.error) {
               pending.reject(new Error(msg.error.message));
           } else {
               pending.resolve(msg.result);
           }
       }
    }
  }

  public dispose() {
    this.stop();
  }
}
