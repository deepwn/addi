import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { CustomTool } from '../types';
import { logger } from '../logger';

export class CustomToolManager {
    private readonly _onDidUpdate = new vscode.EventEmitter<void>();
    public readonly onDidUpdate = this._onDidUpdate.event;
    private tools: CustomTool[] = [];
    private watchers: vscode.FileSystemWatcher[] = [];

    constructor(_context: vscode.ExtensionContext) {
        this.refresh();
        this.setupWatchers();
    }

    dispose() {
        this.watchers.forEach(w => w.dispose());
    }

    private setupWatchers() {
        // Watch workspace .vscode/addi/*.yaml
        const workspaceWatcher = vscode.workspace.createFileSystemWatcher('**/.vscode/addi/*.yaml');
        workspaceWatcher.onDidChange(() => this.refresh());
        workspaceWatcher.onDidCreate(() => this.refresh());
        workspaceWatcher.onDidDelete(() => this.refresh());
        this.watchers.push(workspaceWatcher);

        // Watch global ~/.addi/*.yaml
        const globalDir = path.join(os.homedir(), '.addi');
        if (fs.existsSync(globalDir)) {
            try {
                fs.watch(globalDir, (_eventType, filename) => {
                    if (filename && (filename.endsWith('.yaml') || filename.endsWith('.yml'))) {
                        this.refresh();
                    }
                });
            } catch (e) {
                logger.warn('Failed to watch global addi directory', e);
            }
        }
    }

    getTools(): CustomTool[] {
        return this.tools;
    }

    async refresh() {
        const newTools: CustomTool[] = [];

        // 1. Load Global Tools (~/.addi/*.yaml)
        const globalDir = path.join(os.homedir(), '.addi');
        newTools.push(...this.loadToolsFromDir(globalDir, 'global'));

        // 2. Load Workspace Tools (.vscode/addi/*.yaml)
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const localDir = path.join(folder.uri.fsPath, '.vscode', 'addi');
                newTools.push(...this.loadToolsFromDir(localDir, 'workspace'));
            }
        }

        this.tools = newTools;
        this._onDidUpdate.fire();
        logger.info(`Loaded ${this.tools.length} custom tools`);
    }

    private loadToolsFromDir(dirPath: string, source: 'global' | 'workspace'): CustomTool[] {
        const tools: CustomTool[] = [];
        if (!fs.existsSync(dirPath)) {
            return tools;
        }

        try {
            const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
            for (const file of files) {
                try {
                    const content = fs.readFileSync(path.join(dirPath, file), 'utf8');
                    const parsed = yaml.load(content) as any;
                    
                    if (parsed && parsed.name) {
                        const tool = this.parseTool(parsed, file, source);
                        if (tool) {
                            tools.push(tool);
                        }
                    }
                } catch (e) {
                    logger.error(`Failed to load tool from ${file}`, e);
                }
            }
        } catch (e) {
            logger.error(`Error reading directory ${dirPath}`, e);
        }
        return tools;
    }

    private parseTool(data: any, fileName: string, source: 'global' | 'workspace'): CustomTool | null {
        try {
            // Basic validation
            if (!data.name || !data.description) {
                return null;
            }

            // Parse Steps
            const steps: any[] = [];
            if (data.steps && Array.isArray(data.steps)) {
                steps.push(...data.steps);
            } else if (data.command) {
                // Legacy/Simple format support
                steps.push({
                    name: 'default',
                    run: data.command
                });
            } else if (data.http) {
                // Legacy/Simple format support
                steps.push({
                    name: 'default',
                    http: data.http
                });
            }

            if (steps.length === 0) {
                return null;
            }

            // Convert simplified inputs to JSON Schema using Zod
            let parameters = data.parameters;
            if (data.inputs && !data.parameters) {
                const shape: Record<string, z.ZodTypeAny> = {};
                
                for (const [key, value] of Object.entries(data.inputs) as [string, any][]) {
                    // Default to string as per previous implementation
                    let field: z.ZodTypeAny = z.string();
                    
                    if (value.description) {
                        field = field.describe(value.description);
                    }
                    
                    if (value.default !== undefined) {
                        field = field.default(value.default);
                    }
                    
                    // Default to required unless explicitly false
                    if (value.required === false) {
                        field = field.optional();
                    }
                    
                    shape[key] = field;
                }

                const zodSchema = z.object(shape);
                // Use Zod's toJSONSchema to generate the JSON Schema
                parameters = z.toJSONSchema(zodSchema);
            }

            return {
                id: `${source}:${fileName}:${data.name}`,
                name: data.name,
                description: data.description,
                parameters: parameters || { type: 'object', properties: {} },
                steps,
                source,
                fileName
            };
        } catch (e) {
            logger.error(`Error parsing tool data for ${fileName}`, e);
            return null;
        }
    }

    // Legacy methods stubbed or removed
    async addTool(_tool: CustomTool): Promise<void> {
        // Not supported in file-based mode directly via object
        // We could implement writing to file here
        vscode.window.showInformationMessage("Please create a YAML file in .vscode/addi/ or ~/.addi/ to add tools.");
    }

    async deleteTool(_id: string): Promise<void> {
         // Find the tool and delete the file?
         // For now, read-only from UI
         vscode.window.showInformationMessage("Please delete the YAML file to remove the tool.");
    }
}
