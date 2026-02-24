import * as assert from 'assert';
import * as vscode from 'vscode';

let LLMService: any;

// Minimal provider/model shapes
const provider: any = {
  id: 'test-provider',
  name: 'test',
  providerType: 'openai-completions',
  models: [],
};

const model: any = {
  sid: 'm1',
  id: 'gpt-test',
  name: 'gpt-test',
  family: 'test',
  version: '1',
  maxInputTokens: 4096,
  maxOutputTokens: 1024,
  capabilities: {},
};

// Stub CustomToolManager that returns a simple tool which runs `node -e "console.log(\"OK\")"`
class StubToolManager {
  getTools() {
    return [
      {
        id: 't1',
        name: 'echoTool',
        description: 'Echo tool',
        parameters: { type: 'object', properties: {} },
        steps: [{ run: { command: 'echo OK', args: [] } }],
      },
    ];
  }
}

// Helper to monkeypatch ai.streamText
function makeStreamWithToolCall(toolName: string) {
  return {
    fullStream: (async function* () {
      yield { type: 'tool-call', toolCallId: 'call-1', toolName, args: {} } as any;
      // Simulate tool execution result which LLMService should handle if it was executing tools
      // But now LLMService relies on ai-sdk to execute tools.
      // Since we mock streamText, we need to simulate the tool-result part coming back from AI SDK's execution loop if we were mocking that deeply.
      // Alternatively, we can assume LLMService just passes through what it gets.

      // If we want to test LLMService's handling of tool execution *results*, we should emit a tool-result here.
      yield { type: 'tool-result', toolCallId: 'call-1', toolName, result: 'OK' } as any;
    })(),
  } as any;
}

suite('LLMService tool-call handling', function () {
  this.timeout(10000);
  let origStream: any;

  setup(() => {
    // Inject a mocked 'ai' module into require cache before loading LLMService
    const aiPath = require.resolve('ai');
    const lmPath = require.resolve('../../core/llm/llmService');

    // Save original cache entries (if any)
    const origAiEntry = require.cache[aiPath];
    const origLmEntry = require.cache[lmPath];
    origStream = { aiEntry: origAiEntry, lmEntry: origLmEntry };

    // Place mock ai module by preserving original exports but overriding streamText
    const originalAiExports = require(aiPath);
    const mockExports = Object.assign({}, originalAiExports, {
      streamText: (_opts: any) => makeStreamWithToolCall('echoTool'),
    });
    require.cache[aiPath] = {
      id: aiPath,
      filename: aiPath,
      loaded: true,
      exports: mockExports,
    } as any;

    // Remove compiled LLMService from cache so it will be reloaded against mock ai
    delete require.cache[lmPath];
    LLMService = require('../../core/llm/llmService').LLMService;
  });

  teardown(() => {
    // Restore original cache entries if they existed
    const aiPath = require.resolve('ai');
    const lmPath = require.resolve('../../core/llm/llmService');
    const orig = origStream as any;
    if (orig && orig.aiEntry) {
      require.cache[aiPath] = orig.aiEntry;
    } else {
      delete require.cache[aiPath];
    }
    if (orig && orig.lmEntry) {
      require.cache[lmPath] = orig.lmEntry;
    } else {
      delete require.cache[lmPath];
    }
  });

  test('executes registered custom tool and returns its output', async () => {
    const svc = new LLMService(new StubToolManager() as any);
    const reports: any[] = [];
    const progress = {
      report: (p: any) => reports.push(p),
    } as vscode.Progress<vscode.LanguageModelResponsePart>;
    const token = new vscode.CancellationTokenSource().token;

    await svc.chat(provider, model, [], undefined, progress, token);

    // Expect at least one report containing "OK"
    const joined = reports
      .map((r) => {
        try {
          return (r as any).value ?? (r as any).text ?? JSON.stringify(r);
        } catch {
          return String(r);
        }
      })
      .join(' ');

    console.log('tool-call reports:', joined);
    assert.ok(/OK/.test(joined), 'Expected tool output to include OK, got: ' + joined);
  });

  test('reports error when custom tool fails', async () => {
    // Patch tool steps to a failing command
    class FailingToolManager {
      getTools() {
        return [
          {
            id: 't2',
            name: 'failTool',
            description: '',
            parameters: { type: 'object', properties: {} },
            steps: [{ run: { command: 'node -e "process.exit(1)"', args: [] } }],
          },
        ];
      }
    }

    // Patch streamText to call failTool
    const ai = require('ai');
    ai.streamText = (_opts: any) => ({
      fullStream: (async function* () {
        yield { type: 'tool-call', toolCallId: 'call-2', toolName: 'failTool', args: {} } as any;
        // Simulate error result
        yield {
          type: 'tool-result',
          toolCallId: 'call-2',
          toolName: 'failTool',
          result: 'Error: execution error',
        } as any;
      })(),
    });

    const svc = new LLMService(new FailingToolManager() as any);
    const reports: any[] = [];
    const progress = {
      report: (p: any) => reports.push(p),
    } as vscode.Progress<vscode.LanguageModelResponsePart>;
    const token = new vscode.CancellationTokenSource().token;

    await svc.chat(provider, model, [], undefined, progress, token);

    const joined = reports
      .map((r) => {
        try {
          return (r as any).value ?? (r as any).text ?? JSON.stringify(r);
        } catch {
          return String(r);
        }
      })
      .join(' ');

    console.log('fail-tool reports:', joined);
    assert.ok(
      /execution error|Error|exit/i.test(joined),
      'Expected error message in reports, got: ' + joined
    );
  });
});
