import * as vscode from 'vscode';
import { CustomToolManager } from '../services/customToolManager';
import { CustomToolExecutor } from '../services/customToolExecutor';
import { logger } from '../logger';

export class AddiToolProvider {
    constructor(private toolManager: CustomToolManager) {}

    register(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.lm.registerTool('addi_run_tool', new AddiRunTool(this.toolManager)),
            vscode.lm.registerTool('addi_list_tools', new AddiListTools(this.toolManager))
        );
    }
}

class AddiRunTool implements vscode.LanguageModelTool<any> {
    constructor(private toolManager: CustomToolManager) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<any>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { tool_name, parameters } = options.input;
        
        logger.info(`AddiRunTool invoked for: ${tool_name}`);

        const tools = this.toolManager.getTools();
        const tool = tools.find(t => t.name === tool_name);

        if (!tool) {
            return {
                content: [new vscode.LanguageModelTextPart(`Error: Tool '${tool_name}' not found. Use addi_list_tools to see available tools.`)]
            };
        }

        try {
            const executor = new CustomToolExecutor(tool);
            // Wrap parameters in 'input' as expected by CustomToolExecutor if needed, 
            // but CustomToolExecutor expects the raw input object that matches the tool's schema.
            // Here 'parameters' IS that object.
            const result = await executor.invoke({
                input: parameters || {},
                toolInvocationToken: options.toolInvocationToken
            }, token);
            
            return result;
        } catch (e: any) {
            logger.error(`Error executing ${tool_name}`, e);
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
        
        const toolDescriptions = tools.map(t => {
            return `Tool: ${t.name}
Description: ${t.description}
Parameters: ${JSON.stringify(t.parameters, null, 2)}
---`;
        }).join('\n');

        const content = `Available Addi Custom Tools:\n\n${toolDescriptions || "No custom tools found."}`;

        return {
            content: [new vscode.LanguageModelTextPart(content)]
        };
    }
}
