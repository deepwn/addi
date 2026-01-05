import * as vscode from 'vscode';
import { CustomTool } from '../types';
import { logger } from '../logger';
import * as cp from 'child_process';
import { ToolUtils } from '../utils/toolUtils';

export class CustomToolExecutor implements vscode.LanguageModelTool<any> {
    constructor(private readonly tool: CustomTool) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<any>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        logger.info(`Invoking tool ${this.tool.name}`, options);
        
        const results: any[] = [];
        
        for (const step of this.tool.steps) {
            if (token.isCancellationRequested) {
                break;
            }
            
            try {
                if (step.run) {
                    const result = await this.executeRunStep(step.run, options.input, token);
                    results.push(result);
                } else if (step.http) {
                    const result = await this.executeHttpStep(step.http, options.input, token);
                    results.push(result);
                }
            } catch (err) {
                logger.error(`Step execution failed for tool ${this.tool.name}`, err);
                throw err;
            }
        }

        const lastResult = results.length > 0 ? results[results.length - 1] : "No steps executed";
        const content = typeof lastResult === 'string' ? lastResult : JSON.stringify(lastResult, null, 2);
        
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

    private async executeRunStep(run: { command: string; args?: string[] }, input: any, token?: vscode.CancellationToken): Promise<string> {
        const args = run.args?.map(arg => ToolUtils.replacePlaceholders(arg, input)) ?? [];
        const command = ToolUtils.replacePlaceholders(run.command, input);

        logger.debug(`Executing command: ${command} ${args.join(' ')}`);

        return new Promise((resolve, reject) => {
            const process = cp.spawn(command, args, { shell: true });
            
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
                    reject(new Error(`Command failed with code ${code}: ${stderr}`));
                }
            });
            
            process.on('error', (err) => {
                reject(err);
            });
        });
    }

    private async executeHttpStep(http: { url: string; method?: string; headers?: Record<string, string>; body?: any }, input: any, token?: vscode.CancellationToken): Promise<any> {
        const url = ToolUtils.replacePlaceholders(http.url, input);
        const method = http.method ?? 'GET';
        const headers: Record<string, string> = http.headers ? { ...http.headers } : {};
        
        for (const key in headers) {
            const val = headers[key];
            if (val) {
                headers[key] = ToolUtils.replacePlaceholders(val, input);
            }
        }

        let body = http.body;
        if (body && typeof body === 'object') {
             body = JSON.stringify(body);
             // Also replace in stringified body
             body = ToolUtils.replacePlaceholders(body, input);
        } else if (typeof body === 'string') {
            body = ToolUtils.replacePlaceholders(body, input);
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
