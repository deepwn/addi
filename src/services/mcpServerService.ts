import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as cp from 'child_process';
import { logger } from '../logger';

export class McpServerService {
    private static instance: McpServerService;
    private serverProcess: cp.ChildProcess | null = null;
    private readonly outputChannel: vscode.OutputChannel;

    private buffer: string = '';

    private constructor(_context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel('Addi MCP Server');
    }

    public static getInstance(context: vscode.ExtensionContext): McpServerService {
        if (!McpServerService.instance) {
            McpServerService.instance = new McpServerService(context);
        }
        return McpServerService.instance;
    }

    public async initialize() {
        const binaryPath = await this.getOrDownloadBinary();
        if (binaryPath) {
            this.startServer(binaryPath);
        }
    }

    public async restart() {
        logger.info("Restarting MCP Server...");
        if (this.serverProcess) {
            this.serverProcess.kill();
            this.serverProcess = null;
        }
        await this.initialize();
    }

    public async callTool(name: string, args: any): Promise<any> {
        if (!this.serverProcess) {
            throw new Error("MCP Server is not running");
        }

        return new Promise((resolve, reject) => {
            const id = Math.floor(Math.random() * 1000000);
            const request = {
                jsonrpc: "2.0",
                id: id,
                method: "tools/call",
                params: {
                    name: name,
                    arguments: args
                }
            };

            const json = JSON.stringify(request) + "\n";
            
            // One-time listener for this specific ID
            const responseHandler = (response: any) => {
                if (response.id === id) {
                    this.removeResponseListener(responseHandler);
                    if (response.error) {
                        reject(new Error(response.error.message));
                    } else {
                        resolve(response.result);
                    }
                }
            };

            this.addResponseListener(responseHandler);
            this.serverProcess?.stdin?.write(json);

            // Timeout
            setTimeout(() => {
                this.removeResponseListener(responseHandler);
                reject(new Error("Timeout waiting for MCP Server response"));
            }, 30000); // 30s timeout
        });
    }

    private responseListeners: ((response: any) => void)[] = [];

    private addResponseListener(listener: (response: any) => void) {
        this.responseListeners.push(listener);
    }

    private removeResponseListener(listener: (response: any) => void) {
        const index = this.responseListeners.indexOf(listener);
        if (index > -1) {
            this.responseListeners.splice(index, 1);
        }
    }

    private handleData(data: Buffer) {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        // Keep the last partial line in the buffer
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) { continue; }
            try {
                // Log raw output to channel for debugging
                // this.outputChannel.appendLine(`[MCP RAW] ${line}`);
                
                const response = JSON.parse(line);
                // Notify all listeners
                // Copy array to avoid issues if listeners remove themselves during iteration
                [...this.responseListeners].forEach(listener => listener(response));
            } catch (e) {
                // Not JSON, maybe log output?
                this.outputChannel.appendLine(line);
            }
        }
    }

    public isBinaryAvailable(): boolean {
        const config = vscode.workspace.getConfiguration('addi');
        let binaryPath = config.get<string>('mcpServer.path');

        if (!binaryPath) {
            const homeDir = os.homedir();
            const binDir = path.join(homeDir, '.addi', 'bin');
            const binaryName = process.platform === 'win32' ? 'mcp-server.exe' : 'mcp-server';
            binaryPath = path.join(binDir, binaryName);
        }

        return fs.existsSync(binaryPath);
    }

    public async downloadMcpServer() {
        const config = vscode.workspace.getConfiguration('addi');
        let binaryPath = config.get<string>('mcpServer.path');

        if (!binaryPath) {
            const homeDir = os.homedir();
            const binDir = path.join(homeDir, '.addi', 'bin');
            const binaryName = process.platform === 'win32' ? 'mcp-server.exe' : 'mcp-server';
            binaryPath = path.join(binDir, binaryName);
        }
        
        await this.downloadBinary(binaryPath);
    }

    private async getOrDownloadBinary(): Promise<string | null> {
        const config = vscode.workspace.getConfiguration('addi');
        let binaryPath = config.get<string>('mcpServer.path');

        if (!binaryPath) {
            const homeDir = os.homedir();
            const binDir = path.join(homeDir, '.addi', 'bin');
            const binaryName = process.platform === 'win32' ? 'mcp-server.exe' : 'mcp-server';
            binaryPath = path.join(binDir, binaryName);
        }

        if (fs.existsSync(binaryPath)) {
            return binaryPath;
        }

        // Binary not found, prompt user
        const selection = await vscode.window.showInformationMessage(
            `Addi MCP Server binary not found at ${binaryPath}. Would you like to download it?`,
            'Download',
            'Cancel'
        );

        if (selection === 'Download') {
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
            const binaryName = process.platform === 'win32' ? 'mcp-server.exe' : 'mcp-server';
            const folder = workspaceFolders[0];
            if (!folder) { return null; }
            const devBuildPath = path.join(folder.uri.fsPath, 'mcp-server', binaryName);
            
            if (fs.existsSync(devBuildPath)) {
                try {
                    fs.copyFileSync(devBuildPath, targetPath);
                    fs.chmodSync(targetPath, 0o755); // Make executable
                    vscode.window.showInformationMessage('MCP Server installed successfully (from dev build).');
                    return targetPath;
                } catch (e) {
                    logger.error('Failed to copy dev build', e);
                }
            }
        }

        vscode.window.showErrorMessage('Automatic download not yet implemented. Please build the mcp-server manually and place it at ' + targetPath);
        return null;
    }

    private startServer(binaryPath: string) {
        if (this.serverProcess) {
            this.serverProcess.kill();
        }

        const config = vscode.workspace.getConfiguration('addi');
        const mode = config.get<string>('mcpServer.executionMode', 'local');

        logger.info(`Starting MCP Server: ${binaryPath} --mode=${mode}`);
        
        try {
            this.serverProcess = cp.spawn(binaryPath, ['--mode', mode], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.serverProcess.stdout?.on('data', (data) => {
                this.handleData(data);
            });

            this.serverProcess.stderr?.on('data', (data) => {
                this.outputChannel.append(`[Error] ${data.toString()}`);
            });

            this.serverProcess.on('close', (code) => {
                this.outputChannel.appendLine(`MCP Server exited with code ${code}`);
                this.serverProcess = null;
            });
            
            this.outputChannel.show();

        } catch (e) {
            logger.error('Failed to start MCP Server', e);
            vscode.window.showErrorMessage(`Failed to start Addi MCP Server: ${e}`);
        }
    }

    public dispose() {
        if (this.serverProcess) {
            this.serverProcess.kill();
        }
    }
}
