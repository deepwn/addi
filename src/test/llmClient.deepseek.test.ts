import * as assert from "assert";
import * as vscode from "vscode";
import { LLMClient } from "../services/llmClient";

class MockReadableStream {
  private chunks: Uint8Array[];
  constructor(chunks: string[]) {
    this.chunks = chunks.map((c) => new TextEncoder().encode(c));
  }
  getReader() {
    const chunks = [...this.chunks];
    return {
      read: async () => {
        if (chunks.length === 0) {
          return { done: true, value: undefined } as const;
        }
        return { done: false, value: chunks.shift() } as const;
      },
      cancel: async () => {
        return;
      },
    };
  }
}

const originalFetch = globalThis.fetch;

suite("LLMClient DeepSeek tool_calls", () => {
  teardown(() => {
    globalThis.fetch = originalFetch;
  });

  test("callGenericOpenAiCompatibleApi adds reasoning_content for assistant tool_calls when DeepSeek reasoner", async () => {
    let capturedBody: unknown;

    globalThis.fetch = (async (_input: any, init?: any) => {
      capturedBody = init?.body;
      return {
        ok: true,
        body: new MockReadableStream(["data: [DONE]\n"]) as unknown as ReadableStream<Uint8Array>,
        headers: new Headers(),
        status: 200,
        statusText: "OK",
        type: "basic",
        url: "https://api.deepseek.com/v1/chat/completions",
        redirected: false,
        clone() {
          return this as unknown as Response;
        },
        arrayBuffer: async () => new ArrayBuffer(0),
        blob: async () => new Blob([]),
        formData: async () => new FormData(),
        json: async () => ({}),
        text: async () => "",
      };
    }) as unknown as typeof fetch;

    const provider: any = {
      id: "p-deepseek",
      name: "deepseek",
      apiEndpoint: "https://api.deepseek.com/v1",
      apiKey: "sk-test",
      providerType: "generic",
      models: [],
    };

    const model: any = {
      id: "deepseek-reasoner",
      name: "deepseek-reasoner",
      family: "deepseek",
      maxOutputTokens: 128,
    };

    const toolPart = { name: "addi.createFile", arguments: JSON.stringify({ path: "a.txt", content: "x" }), callId: "cid-1" };
    const msg: any = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [toolPart],
      name: undefined,
    } as vscode.LanguageModelChatRequestMessage;

    const llmClient = new LLMClient();
    await llmClient.callGenericOpenAiCompatibleApi(
      provider,
      model,
      [msg],
      undefined,
      undefined,
      { report: () => {} } as any,
      { isCancellationRequested: false } as any
    );

    assert.strictEqual(typeof capturedBody, "string");
    const parsed = JSON.parse(capturedBody as string) as any;
    const messages = parsed.messages as any[];
    const toolCallMsg = messages.find((m) => m?.role === "assistant" && Array.isArray(m?.tool_calls));
    assert.ok(toolCallMsg, "expected an assistant tool_calls message");
    assert.strictEqual(toolCallMsg.reasoning_content, "");
  });
});
