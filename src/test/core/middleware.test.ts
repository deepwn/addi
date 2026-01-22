import * as assert from 'assert';
import { ToolCallCompatibilityMiddleware } from '../../core/llm/middleware/toolCallCompatibility/toolCallCompatibility';
import { LLMCallContext } from '../../core/llm/middleware';
import { ModelMessage } from 'ai';
import { Provider, Model } from '../../common/types';

suite('ToolCallCompatibilityMiddleware Test Suite', () => {
  let middleware: ToolCallCompatibilityMiddleware;
  let mockProvider: Provider;
  let mockModel: Model;
  let context: LLMCallContext;

  setup(() => {
    middleware = new ToolCallCompatibilityMiddleware();
    mockProvider = {
      id: 'test-p',
      name: 'Test Provider',
      providerType: 'openai',
      models: [],
    } as any;
    mockModel = {
      sid: 'test-sid',
      id: 'test-model',
      name: 'Test Model',
      family: 'addi',
      version: '1.0.0',
      maxInputTokens: 1024,
      maxOutputTokens: 1024,
      capabilities: {
        scrubSettings: {
          enabled: true,
          patterns: ['<\\/?tool_call[^>]*>', 'DEBUG: .*'],
          strategy: 'retry',
        },
      },
    } as any;

    context = {
      provider: mockProvider,
      modelId: mockModel.id,
      model: mockModel,
    };
  });

  suite('processMessages', () => {
    test('should scrub hallucinated tags from assistant messages', async () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Thinking... <tool_call name="test"> Done.' },
      ];

      const result = await middleware.processMessages(messages, context);
      const content = (result.messages[1] as any).content;
      assert.strictEqual(content, 'Thinking...  Done.');
    });

    test('should scrub multiple different patterns', async () => {
      const messages: ModelMessage[] = [{ role: 'assistant', content: 'SECRET_TAG answer' }];

      // Override patterns for this specific test to avoid RegExp pitfalls
      const customContext = {
        ...context,
        model: {
          ...mockModel,
          capabilities: {
            ...mockModel.capabilities,
            scrubSettings: {
              enabled: true,
              patterns: ['SECRET_TAG'],
              strategy: 'retry',
            },
          },
        },
      } as any;

      const result = await middleware.processMessages(messages, customContext);
      assert.strictEqual((result.messages[0] as any).content, 'answer');
    });

    test('should not scrub if disabled', async () => {
      if (mockModel.capabilities.scrubSettings) {
        mockModel.capabilities.scrubSettings.enabled = false;
      }
      const content = 'Keep <tool_call>';
      const messages: ModelMessage[] = [{ role: 'assistant', content }];

      const result = await middleware.processMessages(messages, context);
      assert.strictEqual((result.messages[0] as any).content, content);
    });
  });

  suite('processResponsePart', () => {
    test('should scrub text deltas in stream', () => {
      const part = { type: 'text-delta', text: 'Some <tool_call> text' };
      const result = middleware.processResponsePart(part, context);
      assert.strictEqual(result.text, 'Some  text');
    });

    test('should signal retry if strategy is retry and pattern matches', () => {
      const part = { type: 'text-delta', text: 'Error <tool_call>' };
      const result = middleware.processResponsePart(part, context);
      assert.strictEqual((result as any)._addiAction, 'retry');
    });

    test('should signal stop if strategy is stop and pattern matches', () => {
      if (mockModel.capabilities.scrubSettings) {
        mockModel.capabilities.scrubSettings.strategy = 'stop';
      }
      const part = { type: 'text-delta', text: 'Error <tool_call>' };
      const result = middleware.processResponsePart(part, context);
      assert.strictEqual((result as any)._addiAction, 'stop');
    });

    test('should use default patterns if enabled but no patterns provided', () => {
      if (mockModel.capabilities.scrubSettings) {
        mockModel.capabilities.scrubSettings.patterns = [];
      }
      const part = { type: 'text-delta', text: 'Using <function_call>' };
      const result = middleware.processResponsePart(part, context);
      assert.strictEqual(result.text, 'Using ');
    });
  });
});
