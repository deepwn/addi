import * as assert from 'assert';
import * as vscode from 'vscode';
import { AddiChatParticipant } from '../chatParticipant';

// helpers for async iterables
async function* asyncIterableFromArray<T>(arr: T[]) {
  for (const item of arr) {
    yield item;
  }
}

suite('ChatParticipant tool-calling', () => {
  test('handleRequest should invoke tool from response.parts using request.toolInvocationToken', async () => {
    // Obtain language model part classes from vscode if available, otherwise provide fallbacks
    const LMToolCallPart = (vscode as any).LanguageModelToolCallPart
      ? (vscode as any).LanguageModelToolCallPart
      : class {
          constructor(public id: string, public name: string, public input: any) {}
        };
    const LMTextPart = (vscode as any).LanguageModelTextPart
      ? (vscode as any).LanguageModelTextPart
      : class {
          constructor(public value: string) {}
        };

    // Mock chat participant registration to avoid real VS Code interactions
    if (!(vscode as any).chat) {
      (vscode as any).chat = {
        createChatParticipant: (_id: string, _handler: any) => ({ dispose: () => {} }),
      };
    }

    // Capture invokeTool calls
    const invoked: Array<any> = [];
    if (!(vscode as any).lm) {
      (vscode as any).lm = {};
    }
    (vscode as any).lm.invokeTool = async (name: string, options: any, token: any) => {
      invoked.push({ name, options, token });
      // return a tool result shaped like LanguageModelToolResultPart content
      return { content: [ new LMTextPart('ok-from-tool') ] };
    };

    // Minimal extension context required by AddiChatParticipant (icon path attempt is caught)
    const mockContext: any = { extensionUri: vscode.Uri.file('.') };

    const participant = new AddiChatParticipant(mockContext as vscode.ExtensionContext);

    // Build a fake chat model that yields text and a tool call part
    const fakeModel = {
      id: 'fake',
      sendRequest: async (_messages: any, _opts: any, _token: any) => {
          return {
            text: asyncIterableFromArray(['hello']),
            parts: asyncIterableFromArray([
              new LMToolCallPart('call-1', 'addi.createFile', { path: 'file.txt', content: 'hi' }),
            ]),
          } as any;
      },
    } as unknown as vscode.LanguageModelChat;

    // Build a fake request with toolInvocationToken
    const request: any = {
      prompt: 'create a file',
      model: fakeModel,
      toolInvocationToken: 'token-xyz',
    } as vscode.ChatRequest;

    const outputs: string[] = [];
    const stream = {
      progress: (_msg: string) => {},
      markdown: (md: string) => { outputs.push(md); },
    } as unknown as vscode.ChatResponseStream;

    const token = { isCancellationRequested: false } as vscode.CancellationToken;

    // Call the private handler via casting since method is private
    await (participant as any).handleRequest(request, {}, stream, token);

    // assert invokeTool was called and token passed through
    assert.strictEqual(invoked.length, 1, 'invokeTool should have been called once');
    assert.strictEqual(invoked[0].name, 'addi.createFile');
    assert.strictEqual(invoked[0].options.input.path, 'file.txt');
    assert.strictEqual(invoked[0].options.toolInvocationToken, 'token-xyz');

    // assert the stream received the tool result summary
    assert.ok(outputs.some(o => String(o).includes('ok-from-tool')),
      `expected outputs to contain tool result, got: ${JSON.stringify(outputs)}`);
  });
});
