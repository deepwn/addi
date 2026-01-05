import * as vscode from 'vscode';
import { CustomToolManager } from '../services/customToolManager';
import { logger } from '../logger';
import { McpServerService } from './mcpServerService';
import { CustomTool } from '../types';

export class AddiToolProvider {
    private registeredTools: vscode.Disposable[] = [];

    constructor(private toolManager: CustomToolManager, private context: vscode.ExtensionContext) {
        this.toolManager.onDidUpdate(() => this.refreshTools());
    }

    register(_context: vscode.ExtensionContext) {
        this.refreshTools();
    }

    private refreshTools() {
        // Dispose existing tools
        this.registeredTools.forEach(t => t.dispose());
        this.registeredTools = [];

        const tools = this.toolManager.getTools();
        for (const tool of tools) {
            try {
                const registration = vscode.lm.registerTool(tool.name, new AddiGenericTool(this.context, tool));
                this.registeredTools.push(registration);
                logger.info(`Registered tool: ${tool.name}`);
            } catch (e) {
                logger.error(`Failed to register tool ${tool.name}`, e);
            }
        }
    }
}

class AddiGenericTool implements vscode.LanguageModelTool<any> {
    constructor(private context: vscode.ExtensionContext, private toolDef: CustomTool) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<any>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const parameters = options.input;
        
        logger.info(`AddiGenericTool invoked for: ${this.toolDef.name}`);

        try {
            const mcpService = McpServerService.getInstance(this.context);
            const result = await mcpService.callTool(this.toolDef.name, parameters || {});
            
            const contentParts: vscode.LanguageModelTextPart[] = [];
            if (result.content && Array.isArray(result.content)) {
                for (const part of result.content) {
                    if (part.type === 'text') {
                        contentParts.push(new vscode.LanguageModelTextPart(part.text));
                    }
                }
            }

            return {
                content: contentParts
            };

        } catch (e: any) {
            logger.error(`Error executing ${this.toolDef.name} via MCP`, e);
            return {
                content: [new vscode.LanguageModelTextPart(`Error executing tool '${this.toolDef.name}': ${e.message}`)]
            };
        }
    }

    async prepareInvocation(
        _options: vscode.LanguageModelToolInvocationPrepareOptions<any>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            confirmationMessages: {
                title: `Run Addi Tool: ${this.toolDef.name}?`,
                message: `This will execute the custom tool '${this.toolDef.name}' defined in Addi.`
            }
        };
    }
}
