import * as vscode from 'vscode';
import { CustomTool } from '../types';
import { logger } from '../logger';
import * as cp from 'child_process';
import { ToolUtils } from '../utils/toolUtils';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export class CustomToolExecutor implements vscode.LanguageModelTool<any> {
    constructor(private readonly tool: CustomTool) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<any>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        logger.info(`Invoking tool ${this.tool.name}`, options);
        
        // Apply defaults from schema
        const input = { ...options.input };
        const props = this.tool.parameters?.properties;
        if (props) {
            for (const key of Object.keys(props)) {
                const prop = props[key];
                if (typeof prop === 'object' && prop !== null && 'default' in prop && input[key] === undefined) {
                    input[key] = prop.default;
                }
            }
        }
        
        const results: any[] = [];
        
        for (const step of this.tool.steps) {
            if (token.isCancellationRequested) {
                break;
            }
            
            try {
                if (step.run) {
                    const result = await this.executeRunStep(step, input, token);
                    results.push(result);
                } else if (step.http) {
                    const result = await this.executeHttpStep(step.http, input, token);
                    results.push(result);
                }
            } catch (err) {
                logger.error(`Step execution failed for tool ${this.tool.name}`, err);
                throw err;
            }
        }

        const content = results.map(r => typeof r === 'string' ? r : JSON.stringify(r, null, 2)).join('\n\n');
        
        return {
            content: [new vscode.LanguageModelTextPart(content)]
        };
    }

    async prepareInvocation(
        _options: vscode.LanguageModelToolInvocationPrepareOptions<any>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            confirmationMessages: {
                title: `Run tool ${this.tool.name}?`,
                message: `This tool will execute: ${this.tool.description}`
            }
        };
    }

    private async executeRunStep(step: any, rawInput: any, token?: vscode.CancellationToken): Promise<string> {
        const run = step.run;
        let command: string;
        let args: string[] = [];
        let shell = step.shell;
        let env = { ...process.env, ...(step.env || {}) };

        // Prepare context for substitution: inputs, env
        const context = { 
            inputs: rawInput,
            env: env
        };

        logger.debug(`Executing run step. Shell: ${shell}, Run type: ${typeof run}`);

        // Replace placeholders in env vars
        for (const key in env) {
            if (env[key]) {
                env[key] = ToolUtils.replacePlaceholders(env[key], context);
            }
        }

        if (typeof run === 'string') {
            // Script mode
            const scriptContent = ToolUtils.replacePlaceholders(run, context);
            
            const tmpDir = os.tmpdir();
            
            // Determine shell if not provided
            if (!shell) {
                shell = os.platform() === 'win32' ? 'powershell' : 'bash';
            }

            // Determine extension based on shell
            let ext = os.platform() === 'win32' ? '.ps1' : '.sh';
            if (shell) {
                const s = shell.toLowerCase();
                if (s.includes('node') || s.includes('bun')) {
                    ext = '.js';
                } else if (s.includes('python')) {
                    ext = '.py';
                } else if (s.includes('powershell') || s.includes('pwsh')) {
                    ext = '.ps1';
                } else if (s.includes('bash') || s.includes('sh')) {
                    ext = '.sh';
                } else if (s.includes('cmd')) {
                    ext = '.bat';
                }
            }

            const scriptPath = path.join(tmpDir, `addi-script-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
            
            fs.writeFileSync(scriptPath, scriptContent);
            
            command = shell;
            args = [scriptPath];
            
            // For PowerShell, we might need execution policy bypass if not set globally
            if (shell === 'powershell' || shell === 'pwsh') {
                args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
            }

            logger.debug(`Executing script via ${shell}: ${scriptPath}`);
            
            // Clean up file after execution (in finally block)
            try {
                return await this.spawnProcess(command, args, env, token, false, shell, ext);
            } finally {
                try { fs.unlinkSync(scriptPath); } catch {}
            }

        } else {
            // Structured command mode
            args = run.args?.map((arg: string) => ToolUtils.replacePlaceholders(arg, context)) ?? [];
            command = ToolUtils.replacePlaceholders(run.command, context);
            logger.debug(`Executing command: ${command} ${args.join(' ')}`);
            return await this.spawnProcess(command, args, env, token, true);
        }
    }

    private spawnProcess(command: string, args: string[], env: any, token?: vscode.CancellationToken, useShell = false, debugShell?: string, debugExt?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const process = cp.spawn(command, args, { shell: useShell, env });
            
            if (token) {
                token.onCancellationRequested(() => {
                    process.kill();
                    reject(new Error('Operation cancelled'));
                });
            }

            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    const debugInfo = debugShell ? ` (shell: ${debugShell}, ext: ${debugExt})` : '';
                    reject(new Error(`Command failed with code ${code}${debugInfo}: ${stderr}`));
                }
            });
            
            process.on('error', (err) => {
                reject(err);
            });
        });
    }

    private async executeHttpStep(http: { url: string; method?: string; headers?: Record<string, string>; body?: any }, rawInput: any, token?: vscode.CancellationToken): Promise<any> {
        // Prepare context for substitution: inputs
        const context = { 
            inputs: rawInput,
            // env is not typically available in HTTP step unless we explicitly pass it, 
            // but for consistency we could pass process.env if needed. 
            // For now, let's stick to inputs as HTTP steps are usually self-contained.
        };
        logger.debug(`Executing HTTP step with input: ${JSON.stringify(context)}`);

        const url = ToolUtils.replacePlaceholders(http.url, context);
        const method = http.method ?? 'GET';
        const headers: Record<string, string> = http.headers ? { ...http.headers } : {};
        
        for (const key in headers) {
            const val = headers[key];
            if (val) {
                headers[key] = ToolUtils.replacePlaceholders(val, context);
            }
        }

        let body = http.body;
        if (body && typeof body === 'object') {
             body = JSON.stringify(body);
             // Also replace in stringified body
             body = ToolUtils.replacePlaceholders(body, context);
        } else if (typeof body === 'string') {
            body = ToolUtils.replacePlaceholders(body, context);
        }

        logger.debug(`Executing HTTP ${method} ${url}`);

        const controller = new AbortController();
        if (token) {
            token.onCancellationRequested(() => {
                controller.abort();
            });
        }

        const init: RequestInit = {
            method,
            headers,
            signal: controller.signal
        };
        if (body) {
            init.body = String(body);
        }

        const response = await fetch(url, init);

        if (!response.ok) {
            throw new Error(`HTTP request failed: ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        } else {
            return await response.text();
        }
    }
}
