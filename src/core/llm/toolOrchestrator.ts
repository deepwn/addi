import * as vscode from 'vscode';
import { Tool } from 'ai';
import { z } from 'zod';
import { IToolManager, IMcpService } from '../../common/interfaces';
import { logger } from '../../common/logger';
import { safeConvertToZod } from './schemaConverter';

export class ToolOrchestrator {
  constructor(
    private toolManager?: IToolManager,
    private mcpService?: IMcpService
  ) {}

  /**
   * Prepares a union of custom MCP tools and VS Code host tools in AI SDK format.
   */
  async prepareTools(
    options: vscode.ProvideLanguageModelChatResponseOptions | undefined
  ): Promise<Record<string, Tool>> {
    const tools: Record<string, Tool> = {};

    // 1. MCP Custom Tools (with execution logic)
    if (this.toolManager) {
      for (const ct of this.toolManager.getTools()) {
        try {
          tools[ct.name] = {
            description: ct.description,
            inputSchema: safeConvertToZod(ct.parameters, z.object({})),
            execute: async (args: any) => {
              if (!this.mcpService) {
                return 'Error: MCP Service not available.';
              }

              const startTime = Date.now();
              try {
                const result = await this.mcpService.callTool(ct.name, args);
                const duration = Date.now() - startTime;

                logger.info(`Tool executed: ${ct.name}`, {
                  duration: `${duration}ms`,
                  success: true,
                });

                if (result.content && Array.isArray(result.content)) {
                  return result.content
                    .map((p: any) => (p.type === 'text' ? p.text : ''))
                    .join('\n');
                }
                return 'Tool executed successfully.';
              } catch (error) {
                const duration = Date.now() - startTime;
                logger.error(`Tool failed: ${ct.name}`, {
                  duration: `${duration}ms`,
                  error: error instanceof Error ? error.message : String(error),
                });
                throw error;
              }
            },
          };
        } catch (e) {
          logger.error(`Failed to register custom tool ${ct.name}`, e);
        }
      }
    }

    // 2. VS Code Host Tools (definition only, as VS Code handles execution)
    // @ts-ignore
    const providedTools = (options as any)?.tools as vscode.LanguageModelChatTool[] | undefined;
    if (providedTools) {
      for (const tool of providedTools) {
        try {
          const schema = tool.inputSchema
            ? JSON.parse(JSON.stringify(tool.inputSchema))
            : { type: 'object', properties: {} };
          tools[tool.name] = {
            description: tool.description,
            inputSchema: safeConvertToZod(schema, z.object({})),
          } as any;
        } catch (e) {
          logger.error(`Failed to register host tool ${tool.name}`, e);
        }
      }
    }

    return tools;
  }
}
