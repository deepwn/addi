import * as assert from 'assert';
import * as vscode from 'vscode';
import { MessageConverter } from '../../core/llm/messageConverter';

suite('MessageConverter Test Suite', () => {
  test('Drops orphan tool result', async () => {
    // Prepare a User message with a ToolResultPart, but NO preceding Assistant message defining the tool call
    const toolResultPart = new vscode.LanguageModelToolResultPart('call_orphan', [
      new vscode.LanguageModelTextPart('Result of orphaned tool'),
    ]);

    const message: vscode.LanguageModelChatRequestMessage = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [toolResultPart],
      name: 'user',
    };

    const coreMessages = await MessageConverter.toAiCoreMessages([message]);

    // Expectation: The orphan result is dropped, so coreMessages should be empty
    assert.strictEqual(
      coreMessages.length,
      0,
      'Should drop orphan tool result and result in empty messages if no other content'
    );
  });

  test('Keeps valid tool result', async () => {
    // 1. Assistant Message with Tool Call
    const assistantMsg: vscode.LanguageModelChatRequestMessage = {
      role: vscode.LanguageModelChatMessageRole.Assistant,
      content: [new vscode.LanguageModelToolCallPart('call_123', 'testTool', { arg: 1 })],
      name: 'assistant',
    };

    // 2. User Message with Tool Result
    const toolResultPart = new vscode.LanguageModelToolResultPart('call_123', [
      new vscode.LanguageModelTextPart('{"success": true}'),
    ]);
    const userMsg: vscode.LanguageModelChatRequestMessage = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [toolResultPart],
      name: 'user',
    };

    const coreMessages = await MessageConverter.toAiCoreMessages([assistantMsg, userMsg]);

    assert.strictEqual(coreMessages.length, 2);

    const msg0 = coreMessages[0];
    if (!msg0) {
      throw new Error('msg0 missing');
    }
    assert.strictEqual(msg0.role, 'assistant');

    const msg1 = coreMessages[1]; // tool message
    if (!msg1) {
      throw new Error('msg1 missing');
    }
    assert.strictEqual(msg1.role, 'tool');
    const toolContent = msg1.content as any[];
    assert.strictEqual(toolContent.length, 1);
    assert.strictEqual(toolContent[0].toolCallId, 'call_123');
    assert.strictEqual(toolContent[0].toolName, 'testTool');
  });

  test('Keeps mixed content (orphan tool dropped, text kept)', async () => {
    // Orphan tool result + Text
    const toolResultPart = new vscode.LanguageModelToolResultPart('call_orphan', [
      new vscode.LanguageModelTextPart('Orphan'),
    ]);
    const textPart = new vscode.LanguageModelTextPart('Hello');

    const message: vscode.LanguageModelChatRequestMessage = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [toolResultPart, textPart],
      name: 'user',
    };

    const coreMessages = await MessageConverter.toAiCoreMessages([message]);

    // Should contain 1 user message with text "Hello", but NO tool message
    assert.strictEqual(coreMessages.length, 1);
    const msg = coreMessages[0];
    if (!msg) {
      throw new Error('msg missing');
    }
    assert.strictEqual(msg.role, 'user');
    const content = msg.content as any[];
    assert.strictEqual(content[0].text, 'Hello');
  });
});
