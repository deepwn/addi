import * as assert from 'assert';
import { parseSseLine, ChatStreamChunk, streamChatCompletion } from '../apiClient';

// Mock fetch & ReadableStream for streamChatCompletion test

class MockReadableStream {
  private chunks: Uint8Array[];
  constructor(chunks: string[]) { this.chunks = chunks.map(c => new TextEncoder().encode(c)); }
  getReader() { const chunks = [...this.chunks]; return {
    read: async () => {
      if(chunks.length===0) { return { done: true, value: undefined }; }
      return { done: false, value: chunks.shift() };
    }
  }; }
}

// Save original fetch
const originalFetch = globalThis.fetch as any;

suite('Streaming / SSE Parsing', () => {
  teardown(()=>{ globalThis.fetch = originalFetch; });

  test('parseSseLine basic cases', () => {
    assert.strictEqual(parseSseLine(''), undefined);
    assert.strictEqual(parseSseLine(':comment'), undefined);
    assert.deepStrictEqual(parseSseLine('data: {"a":1}'), { a:1 });
    assert.deepStrictEqual(parseSseLine('data: [DONE]'), { done:true });
    assert.strictEqual(parseSseLine('other: x'), undefined);
  });

  test('streamChatCompletion yields deltas and done', async () => {
    // Simulated OpenAI SSE lines (2 deltas then done)
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"content":" World"}}]}\n',
      '\n',
      'data: [DONE]\n'
    ];

    // Mock fetch to return our stream
    globalThis.fetch = (async () => ({
      ok: true,
      body: new MockReadableStream(ssePayload) as any,
      headers: new Headers(),
      status: 200,
      statusText: 'OK',
      type: 'basic',
      url: 'https://api.openai.com/v1/chat/completions',
      redirected: false,
      clone() { return this as any; },
      arrayBuffer: async () => new ArrayBuffer(0),
  blob: async () => new Blob([]),
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => '',
    })) as any;

    const provider: any = { apiEndpoint: 'https://api.openai.com/v1', apiKey: 'sk-test', providerType: 'openai' };
    const model: any = { id: 'gpt-4o-mini', family: 'gpt-4o-mini', maxOutputTokens: 128 };
    const chunks: ChatStreamChunk[] = [];
    for await (const c of streamChatCompletion(provider, model, { prompt: 'Hi' })) {
      chunks.push(c);
    }

    // Expect 2 deltas + done
    const deltaTexts = chunks.filter(c=>c.type==='delta').map(c=>c.deltaText).join('');
    assert.strictEqual(deltaTexts, 'Hello World');
    const done = chunks.find(c=>c.type==='done');
    assert.ok(done, 'should have done');
    assert.strictEqual(done?.fullText, 'Hello World');
  });

  test('streamChatCompletion handles non-stream provider (anthropic) as error', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      body: null,
      headers: new Headers(),
      status: 200,
      statusText: 'OK',
      type: 'basic',
      url: 'https://api.anthropic.com/v1/messages',
      redirected: false,
      clone() { return this as any; },
      arrayBuffer: async () => new ArrayBuffer(0),
  blob: async () => new Blob([]),
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => '',
    })) as any;
    const provider: any = { apiEndpoint: 'https://api.anthropic.com', apiKey: 'key', providerType: 'anthropic' };
    const model: any = { id: 'claude-3', family: 'claude', maxOutputTokens: 128 };
    const chunks: ChatStreamChunk[] = [];
    for await (const c of streamChatCompletion(provider, model, { prompt: 'Hi' })) { chunks.push(c); }
    assert.ok(chunks.some(c=>c.type==='error'));
  });
});
