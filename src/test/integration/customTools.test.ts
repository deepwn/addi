import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { CustomToolExecutor } from '../../services/customToolExecutor';
import { CustomTool } from '../../types';

suite('Custom Tools Integration Tests', () => {
    let tempDir: string;

    setup(() => {
        // Create a temp dir for tools
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'addi-test-'));
        // We can't easily point CustomToolManager to this temp dir without mocking workspace folders or homedir.
        // So we will test CustomToolExecutor directly for execution, 
        // and maybe mock fs for Manager if needed, or just skip Manager file watching test for now 
        // as it depends on VS Code workspace events which are hard to trigger deterministically in tests.
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('CustomToolExecutor should execute shell command', async () => {
        const tool: CustomTool = {
            id: 'test-echo',
            name: 'test-echo',
            description: 'Echo test',
            parameters: { type: 'object', properties: {} },
            steps: [
                {
                    run: {
                        command: 'echo',
                        args: ['{{msg}}']
                    }
                }
            ],
            source: 'global'
        };

        const executor = new CustomToolExecutor(tool);
        const tokenSource = new vscode.CancellationTokenSource();
        
        const result = await executor.invoke({
            input: { msg: 'hello world' },
            toolInvocationToken: {} as any
        }, tokenSource.token);

        assert.strictEqual(result.content.length, 1);
        if (result.content[0] instanceof vscode.LanguageModelTextPart) {
             assert.ok(result.content[0].value.trim().includes('hello world'));
        } else {
            assert.fail('Expected text part');
        }
    });

    test('CustomToolExecutor should handle multiple steps', async () => {
        const tool: CustomTool = {
            id: 'test-multi',
            name: 'test-multi',
            description: 'Multi step',
            parameters: { type: 'object', properties: {} },
            steps: [
                { run: { command: 'echo', args: ['step1'] } },
                { run: { command: 'echo', args: ['step2'] } }
            ],
            source: 'global'
        };

        const executor = new CustomToolExecutor(tool);
        const tokenSource = new vscode.CancellationTokenSource();
        
        const result = await executor.invoke({
            input: {},
            toolInvocationToken: {} as any
        }, tokenSource.token);

        // It returns the result of the last step
        if (result.content[0] instanceof vscode.LanguageModelTextPart) {
             assert.ok(result.content[0].value.trim().includes('step2'));
        }
    });
});
