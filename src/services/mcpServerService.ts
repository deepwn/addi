import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as cp from "child_process";
import { logger } from "../logger";
import { McpDownloader } from "../utils/mcpDownloader";

export class McpServerService {
  private static instance: McpServerService;
  // Define the required MCP server version. Update this only when a new binary is released.
  public static readonly REQUIRED_MCP_VERSION = "0.0.16";
  
  private _onDidStatusChange = new vscode.EventEmitter<void>();
  public readonly onDidStatusChange = this._onDidStatusChange.event;

  private child: cp.ChildProcess | null = null;
  private isReady: boolean = false;
  private pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private messageBuffer: string = "";

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
    logger.info("Restarting MCP Server...");
    this.stop();
    this._onDidStatusChange.fire();
  }

  public stop() {
    if (this.child) {
      logger.info("Stopping MCP Server process...");
      this.child.kill();
      this.child = null;
    }
    this.isReady = false;
    this.pendingRequests.forEach((p) => p.reject(new Error("Server stopped")));
    this.pendingRequests.clear();
    this.messageBuffer = "";
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
    if (this.child && !this.child.killed) {
      if (this.isReady) {
        return;
      }
      // If child exists but not ready (handshaking), we might want to wait or just proceed if logic handles it.
      // For simplicity, we assume if child exists, we are either ready or becoming ready.
      // But we should probably implement a wait for ready state if we want to be robust.
      // For now, let's just return and let request queue if we were advanced, but here we just rely on happy path or re-init.
      return;
    }

    const binaryPath = this.getBinaryPath();
    if (!binaryPath) {
      throw new Error("MCP Server binary not found");
    }

    logger.info(`Spawning MCP Server at ${binaryPath}`);

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

    this.child.stderr?.on("data", (data) => {
       logger.debug(`MCP Stderr: ${data}`);
    });

    this.child.on("error", (err) => {
      logger.error("MCP Server process error", err);
      this.stop();
    });

    this.child.on("exit", (code, signal) => {
      logger.info(`MCP Server exited with code ${code} signal ${signal}`);
      this.stop();
    });

    // Queue initialization
    return new Promise<void>((resolve, reject) => {
       // We create a temporary listener or request for init
       const initId = "init-" + Date.now();
       
       // Register one-off handler for init response
       this.pendingRequests.set(initId, {
           resolve: () => {
               this.isReady = true;
               // Send initialized notification
               this.send({
                   jsonrpc: "2.0",
                   method: "notifications/initialized"
               });
               resolve();
           },
           reject
       });

       this.send({
        jsonrpc: "2.0",
        id: initId,
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

  private send(msg: any) {
    if (this.child && !this.child.killed && this.child.stdin) {
      const str = JSON.stringify(msg) + "\n";
      this.child.stdin.write(str);
    } else {
      logger.warn("Attempted to send message to dead MCP server");
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
