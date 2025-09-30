import * as assert from 'assert';
import * as vscode from 'vscode';
import { AddiChatProvider } from '../model';

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
});
