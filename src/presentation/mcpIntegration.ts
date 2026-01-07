import * as vscode from "vscode";
import { McpServerService } from "../infrastructure/mcp/mcpServerService";
import { logger } from "../common/logger";
import { CustomToolManager } from "../infrastructure/mcp/customToolManager";

export class McpExtensionIntegration {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly mcpService: McpServerService,
    private readonly toolManager: CustomToolManager
  ) {}

  public register(): void {
    // 1. Register Definition Provider
    this.registerDefinitionProvider();

    // 2. Register Commands
    this.registerCommands();
  }

  private registerDefinitionProvider(): void {
    const didChangeMcpEmitter = new vscode.EventEmitter<void>();
    this.mcpService.onDidStatusChange(() => didChangeMcpEmitter.fire());
    this.toolManager.onDidUpdate(() => {
      logger.info("Tool manager updated, internal MCP definitions refreshing...");
      didChangeMcpEmitter.fire();
    });

    try {
      // @ts-ignore
      this.context.subscriptions.push(
        vscode.lm.registerMcpServerDefinitionProvider("addi-mcp-provider", {
          onDidChangeMcpServerDefinitions: didChangeMcpEmitter.event,
          provideMcpServerDefinitions: async () => {
            logger.info("provideMcpServerDefinitions called");
            const binaryPath = this.mcpService.getBinaryPath();
            logger.info(`MCP Binary path: ${binaryPath}`);

            if (!binaryPath) {
              return [];
            }

            const dirs: string[] = [];
            const os = require("os");
            const path = require("path");

            // Global tools
            dirs.push(path.join(os.homedir(), ".addi"));

            // Workspace tools
            if (vscode.workspace.workspaceFolders) {
              for (const folder of vscode.workspace.workspaceFolders) {
                dirs.push(path.join(folder.uri.fsPath, ".addi", "public"));
                dirs.push(path.join(folder.uri.fsPath, ".addi", "private"));
              }
            }

            const dirsArg = dirs.join(",");
            logger.info(`MCP Tools directories: ${dirsArg}`);

            // Use a stable environment to avoid unnecessary server restarts.
            // Only update the nonce if we explicitly want to force a process restart.
            const mcpEnv = { ...process.env } as Record<string, string>;

            return [
              new vscode.McpStdioServerDefinition(
                "Addi MCP Server",
                binaryPath,
                ["--mode", "local", "--dirs", dirsArg, "--watch"],
                mcpEnv
              ),
            ];
          },
        })
      );
      logger.info("Registered MCP Server Provider via vscode.lm");
    } catch (e) {
      logger.error("Failed to register MCP Server Provider", e);
    }
  }

  private registerCommands(): void {
    const { context, mcpService, toolManager } = this;

    context.subscriptions.push(
      vscode.commands.registerCommand("addi.restartMcpServer", async () => {
        await mcpService.restart();
        toolManager.refresh();
        vscode.window.showInformationMessage("MCP Server definitions refreshed.");
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("addi.downloadMcpServer", async () => {
        const extension = vscode.extensions.getExtension("deepwn.addi");
        const defaultVersion = extension?.packageJSON?.version || "latest";
        
        const version = await vscode.window.showInputBox({
          title: "Download Addi MCP Server",
          prompt: "Enter version to download",
          value: defaultVersion,
          placeHolder: "e.g. 0.0.15",
        });

        if (version === undefined) {
          return;
        } // User cancelled

        mcpService
          .downloadMcpServer(version)
          .then(async () => {
            await mcpService.initialize();
            toolManager.refresh();
            vscode.window.showInformationMessage(`MCP Server (${version}) downloaded and started successfully.`);
          })
          .catch((err) => {
            vscode.window.showErrorMessage(`Failed to download MCP Server: ${err}`);
          });
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("addi.debug.mcpStatus", async () => {
        const binaryPath = mcpService.getBinaryPath();
        // @ts-ignore
        const apiAvailable = vscode.lm && typeof vscode.lm.registerMcpServerDefinitionProvider === "function";

        const extension = vscode.extensions.getExtension("deepwn.addi");
        const version = extension?.packageJSON?.version ?? "unknown";

        const info = [
          `MCP API Available: ${apiAvailable}`,
          `Binary Path: ${binaryPath}`,
          `Binary Exists: ${binaryPath ? require("fs").existsSync(binaryPath) : false}`,
          `Extension Version: ${version}`,
        ].join("\n");

        vscode.window.showInformationMessage(info, { modal: true });
        logger.info("MCP Debug Status", { apiAvailable, binaryPath });
      })
    );
  }
}
