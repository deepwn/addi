import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";
// zod removed for direct JSON Schema generation
import { CustomTool } from "../types";
import { logger } from "../logger";
import { CustomToolExecutor } from "./customToolExecutor";
import { ToolParser } from "../utils/toolParser";

export class CustomToolManager {
  private readonly _onDidUpdate = new vscode.EventEmitter<void>();
  public readonly onDidUpdate = this._onDidUpdate.event;
  private tools: CustomTool[] = [];
  private watchers: vscode.FileSystemWatcher[] = [];
  private registeredTools: vscode.Disposable[] = [];

  constructor(_context: vscode.ExtensionContext) {
    this.refresh();
    this.setupWatchers();
  }

  dispose() {
    this.watchers.forEach((w) => w.dispose());
    this.registeredTools.forEach((t) => t.dispose());
  }

  private setupWatchers() {
    // Watch workspace .addi/public and .addi/private
    const publicWatcher = vscode.workspace.createFileSystemWatcher("**/.addi/public/*.{yml,yaml}");
    publicWatcher.onDidChange(() => this.refresh());
    publicWatcher.onDidCreate(() => this.refresh());
    publicWatcher.onDidDelete(() => this.refresh());
    this.watchers.push(publicWatcher);

    const privateWatcher = vscode.workspace.createFileSystemWatcher("**/.addi/private/*.{yml,yaml}");
    privateWatcher.onDidChange(() => this.refresh());
    privateWatcher.onDidCreate(() => this.refresh());
    privateWatcher.onDidDelete(() => this.refresh());
    this.watchers.push(privateWatcher);

    // Watch global ~/.addi/*.yaml
    const globalDir = path.join(os.homedir(), ".addi");
    if (fs.existsSync(globalDir)) {
      try {
        fs.watch(globalDir, (_eventType, filename) => {
          if (filename && (filename.endsWith(".yaml") || filename.endsWith(".yml"))) {
            this.refresh();
          }
        });
      } catch (e) {
        logger.warn("Failed to watch global addi directory", e);
      }
    }
  }

  getTools(): CustomTool[] {
    return this.tools;
  }

  async refresh() {
    // Dispose existing tools
    this.registeredTools.forEach((t) => t.dispose());
    this.registeredTools = [];

    const newTools: CustomTool[] = [];

    // 1. Load Global Tools (~/.addi/*.yaml)
    const globalDir = path.join(os.homedir(), ".addi");
    newTools.push(...this.loadToolsFromDir(globalDir, "global"));

    // 2. Load Workspace Tools (.addi/public/*.yaml and .addi/private/*.yaml)
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const publicDir = path.join(folder.uri.fsPath, ".addi", "public");
        const privateDir = path.join(folder.uri.fsPath, ".addi", "private");
        newTools.push(...this.loadToolsFromDir(publicDir, "workspace:public"));
        newTools.push(...this.loadToolsFromDir(privateDir, "workspace:private"));

        // If privateDir exists and this is a git repo, suggest adding to .gitignore
        try {
          const gitDir = path.join(folder.uri.fsPath, '.git');
          if (fs.existsSync(privateDir) && fs.existsSync(gitDir)) {
            const gitignorePath = path.join(folder.uri.fsPath, '.gitignore');
            let gitignore = '';
            if (fs.existsSync(gitignorePath)) {
              gitignore = fs.readFileSync(gitignorePath, 'utf8');
            }
            const ignoreEntry = '.addi/private';
            if (!gitignore.split(/\r?\n/).some(l => l.trim() === ignoreEntry)) {
              // Non-blocking prompt to user
              vscode.window.showInformationMessage(
                `Detected ${privateDir}. Add ${ignoreEntry} to .gitignore to avoid committing secrets?`,
                'Add to .gitignore'
              ).then(selection => {
                if (selection === 'Add to .gitignore') {
                  try {
                    fs.appendFileSync(gitignorePath, (gitignore.endsWith('\n') || gitignore.length === 0 ? '' : '\n') + ignoreEntry + '\n');
                    vscode.window.showInformationMessage(`${ignoreEntry} added to .gitignore`);
                  } catch (e) {
                    logger.error('Failed to write .gitignore', e);
                    vscode.window.showErrorMessage('Failed to update .gitignore to ignore .addi/private');
                  }
                }
              }, (e: any) => logger.debug('Gitignore prompt failed', e));
            }
          }
        } catch (e) {
          logger.debug('Error checking gitignore for private tools', e);
        }
      }
    }

    this.tools = newTools;

    // Register tools
    for (const tool of this.tools) {
      try {
        const disposable = vscode.lm.registerTool(tool.name, new CustomToolExecutor(tool));
        this.registeredTools.push(disposable);
        logger.info(`Registered tool: ${tool.name}`);
      } catch (e) {
        logger.error(`Failed to register tool ${tool.name}`, e);
      }
    }

    this._onDidUpdate.fire();
    logger.info(`Loaded ${this.tools.length} custom tools`);
  }

  private loadToolsFromDir(dirPath: string, source: string): CustomTool[] {
    const tools: CustomTool[] = [];
    if (!fs.existsSync(dirPath)) {
      return tools;
    }

    try {
      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dirPath, file), "utf8");
          const parsed = yaml.load(content) as any;

          if (parsed && parsed.name) {
            const tool = ToolParser.parse(parsed, file, source);
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

  // Legacy methods stubbed or removed
  async addTool(_tool: CustomTool): Promise<void> {
    // Not supported in file-based mode directly via object
    // We could implement writing to file here
    vscode.window.showInformationMessage("Please create a YAML file in .addi/ or ~/.addi/ to add tools.");
  }

  async deleteTool(_id: string): Promise<void> {
    // Find the tool and delete the file?
    // For now, read-only from UI
    vscode.window.showInformationMessage("Please delete the YAML file to remove the tool.");
  }
}
