import * as assert from 'assert';
import * as vscode from 'vscode';
import { AddiChatProvider } from '../model';
import { ToolRegistry } from '../toolRegistry';

suite('Model provider conversions', () => {
  test('toOpenAiMessages should handle tool call parts and text parts', () => {
    const fakeRepo: any = { getProviders: () => [], findModel: () => null };
    const provider = new AddiChatProvider(fakeRepo as any);

    // Build a fake LanguageModelChatRequestMessage with a tool call encoded as object
    const toolPart = { name: 'addi.createFile', arguments: JSON.stringify({ path: 'a.txt', content: 'x' }), callId: 'cid-1' };
    const textPart = new (vscode as any).LanguageModelTextPart ? new (vscode as any).LanguageModelTextPart('please create') : 'please create';

    const msg: any = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [ textPart, toolPart ],
      name: undefined,
    } as vscode.LanguageModelChatRequestMessage;

    // invoke the private toOpenAiMessages via any cast
    const out = (provider as any).toOpenAiMessages([msg]);
    assert.ok(Array.isArray(out), 'expected array');
    assert.strictEqual(out.length, 1);
    const entry = out[0] as any;
    // should include tool_calls array and content text
    assert.ok(Array.isArray(entry.tool_calls), 'expected tool_calls');
    assert.strictEqual(entry.tool_calls[0].function.name, 'addi.createFile');
    assert.strictEqual(entry.content.includes('please create'), true);
  });

  test('resolveToolDefinitions falls back to vscode.lm.tools', () => {
    const fakeRepo: any = { getProviders: () => [], findModel: () => null };
    const provider = new AddiChatProvider(fakeRepo as any);
    try {
      ToolRegistry.resetForTests();
      ToolRegistry.setFallbackToolsForTests([
        {
          id: 'vscode.echo',
          description: 'Echo text back',
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string' }
            },
            required: ['message']
          }
        }
      ]);
      const definitions = (provider as any).resolveToolDefinitions(undefined) as ReadonlyArray<Record<string, unknown>> | undefined;
      assert.ok(definitions, 'expected fallback definitions');
      assert.strictEqual(definitions!.length, 1);
      const functions = (provider as any).convertToFunctionTools(definitions) as Array<{ type: string; function: { name: string; parameters: Record<string, unknown> } }> | undefined;
      assert.ok(functions && functions.length === 1, 'expected converted functions');
      if (!functions) {
        assert.fail('missing converted functions');
      }
      const entry = functions[0];
      assert.ok(entry, 'expected single function entry');
      assert.strictEqual(entry.function.name, 'vscode.echo');
      const params = entry.function.parameters as Record<string, unknown>;
      assert.strictEqual(params["type"], 'object');
    } finally {
      ToolRegistry.resetForTests();
    }
  });
});
