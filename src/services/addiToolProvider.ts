import * as vscode from 'vscode';
import { CustomToolManager } from '../services/customToolManager';
import { logger } from '../logger';
import { McpServerService } from './mcpServerService';

export class AddiToolProvider {
    constructor(private toolManager: CustomToolManager, private context: vscode.ExtensionContext) {}

    register(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.lm.registerTool('addi_run_tool', new AddiRunTool(this.context)),
            vscode.lm.registerTool('addi_list_tools', new AddiListTools(this.toolManager))
        );
    }
}

class AddiRunTool implements vscode.LanguageModelTool<any> {
    constructor(private context: vscode.ExtensionContext) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<any>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { tool_name, parameters } = options.input;
        
        logger.info(`AddiRunTool invoked for: ${tool_name}`);

        try {
            const mcpService = McpServerService.getInstance(this.context);
            const result = await mcpService.callTool(tool_name, parameters || {});
            
            // MCP result structure: { content: [{ type: 'text', text: '...' }], isError: boolean }
            // We need to convert it to vscode.LanguageModelToolResult
            
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
            logger.error(`Error executing ${tool_name} via MCP`, e);
            return {
                content: [new vscode.LanguageModelTextPart(`Error executing tool '${tool_name}': ${e.message}`)]
            };
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<any>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { tool_name } = options.input;
        return {
            confirmationMessages: {
                title: `Run Addi Tool: ${tool_name}?`,
                message: `This will execute the custom tool '${tool_name}' defined in Addi.`
            }
        };
    }
}

class AddiListTools implements vscode.LanguageModelTool<any> {
    constructor(private toolManager: CustomToolManager) {}

    async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<any>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const tools = this.toolManager.getTools();
        const lastUpdated = new Date(this.toolManager.lastUpdated).toLocaleString();
        
        const toolDescriptions = tools.map(t => {
            return `Tool: ${t.name}
Description: ${t.description}
Parameters: ${JSON.stringify(t.parameters, null, 2)}
---`;
        }).join('\n');

        const content = `Available Addi Custom Tools (Last Updated: ${lastUpdated}):\n\n${toolDescriptions || "No custom tools found."}`;

        return {
            content: [new vscode.LanguageModelTextPart(content)]
        };
    }
}
