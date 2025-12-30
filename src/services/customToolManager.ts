import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";
// zod removed for direct JSON Schema generation
import { CustomTool } from "../types";
import { logger } from "../logger";

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
    this.watchers.forEach((w) => w.dispose());
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

  private parseTool(data: any, fileName: string, source: string): CustomTool | null {
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
          name: "default",
          run: data.command,
        });
      } else if (data.http) {
        // Legacy/Simple format support
        steps.push({
          name: "default",
          http: data.http,
        });
      }

      if (steps.length === 0) {
        return null;
      }

      // Normalize steps: convert legacy `run` string or `command` into structured { command, args }
      const splitArgsRespectingQuotes = (s: string) => {
        const parts: string[] = [];
        let current = '';
        let inSingle = false;
        let inDouble = false;
        for (let i = 0; i < s.length; i++) {
          const ch = s[i];
          if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
          }
          if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
          }
          if (ch === ' ' && !inSingle && !inDouble) {
            if (current.length > 0) {
              parts.push(current);
              current = '';
            }
            continue;
          }
          current += ch;
        }
        if (current.length > 0) { parts.push(current); }
        return parts;
      };

      const normalizedSteps: any[] = [];
      for (const s of steps) {
        const ns: any = { ...s };
        // If step has `run` as string, split into command + args
        if (s.run && typeof s.run === 'string') {
          const tokens = splitArgsRespectingQuotes(s.run);
          if (tokens.length > 0) {
            ns.run = { command: tokens[0], args: tokens.slice(1) };
          }
        } else if (Array.isArray(s.run)) {
          // run: ["cmd","arg1"]
          if (s.run.length > 0) {
            ns.run = { command: String(s.run[0]), args: s.run.slice(1).map(String) };
          }
        } else if (s.command) {
          // legacy `command` field
          const cmd = String(s.command);
          if (s.args && Array.isArray(s.args)) {
            ns.run = { command: cmd, args: s.args.map(String) };
          } else {
            const tokens = splitArgsRespectingQuotes(cmd);
            ns.run = tokens.length > 0 ? { command: tokens[0], args: tokens.slice(1) } : undefined;
          }
        }

        normalizedSteps.push(ns);
      }

      // replace steps with normalized version
      const finalSteps = normalizedSteps;

      // Convert simplified `inputs` to a JSON Schema `parameters` object
      // If `parameters` already provided in YAML, keep it. Otherwise build from `inputs`.
      let parameters = data.parameters;
      if (data.inputs && !data.parameters) {
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(data.inputs) as [string, any][]) {
          const prop: any = {};
          // Allow explicit type in YAML, otherwise default to string
          if (value && value.type) {
            prop.type = value.type;
          } else {
            prop.type = 'string';
          }

          if (value && value.description) {
            prop.description = value.description;
          }
          if (value && value.default !== undefined) {
            prop.default = value.default;
          }

          // Required by default unless explicitly false
          if (!(value && value.required === false)) {
            required.push(key);
          }

          properties[key] = prop;
        }

        parameters = {
          type: 'object',
          properties,
        } as any;

        if (required.length > 0) {
          parameters.required = required;
        }

        // Be explicit about additionalProperties to avoid surprises when validating
        parameters.additionalProperties = false;
      }

      const visibility = source === 'global' ? 'global' : (source.indexOf('public') >= 0 ? 'public' : (source.indexOf('private') >= 0 ? 'private' : 'public'));
      return {
        id: `${source}:${fileName}:${data.name}`,
        name: data.name,
        description: data.description,
        parameters: parameters || { type: "object", properties: {} },
        steps: finalSteps,
        source: source === 'global' ? 'global' : 'workspace',
        visibility,
        fileName,
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
    vscode.window.showInformationMessage("Please create a YAML file in .addi/ or ~/.addi/ to add tools.");
  }

  async deleteTool(_id: string): Promise<void> {
    // Find the tool and delete the file?
    // For now, read-only from UI
    vscode.window.showInformationMessage("Please delete the YAML file to remove the tool.");
  }
}
