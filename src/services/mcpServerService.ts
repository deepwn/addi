import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { logger } from "../logger";

export class McpServerService {
  private static instance: McpServerService;
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
    await this.getOrDownloadBinary();
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

  public async downloadMcpServer() {
    const config = vscode.workspace.getConfiguration("addi");
    let binaryPath = config.get<string>("mcpServer.path");

    if (!binaryPath) {
      const homeDir = os.homedir();
      const binDir = path.join(homeDir, ".addi", "bin");
      const binaryName = process.platform === "win32" ? "mcp-server.exe" : "mcp-server";
      binaryPath = path.join(binDir, binaryName);
    }

    await this.downloadBinary(binaryPath);
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

  private async downloadBinary(targetPath: string): Promise<string | null> {
    // Ensure directory exists
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // TODO: Replace with actual download logic from GitHub Releases or similar
    // For now, we will try to copy from the workspace if available (Dev mode)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      // Check for both 'mcp-server.exe' (default go build) and 'addi-mcp-server.exe' (if renamed)
      const binaryName = process.platform === "win32" ? "mcp-server.exe" : "mcp-server";
      const folder = workspaceFolders[0];
      if (!folder) {
        return null;
      }
      const devBuildPath = path.join(folder.uri.fsPath, "mcp-server", binaryName);

      if (fs.existsSync(devBuildPath)) {
        try {
          fs.copyFileSync(devBuildPath, targetPath);
          fs.chmodSync(targetPath, 0o755); // Make executable
          vscode.window.showInformationMessage("MCP Server installed successfully (from dev build).");
          this._onDidStatusChange.fire();
          return targetPath;
        } catch (e) {
          logger.error("Failed to copy dev build", e);
        }
      }
    }

    vscode.window.showErrorMessage("Automatic download not yet implemented. Please build the mcp-server manually and place it at " + targetPath);
    return null;
  }

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
