import * as assert from "assert";
import * as vscode from "vscode";
import { AddiChatProvider } from "../model";
import { ToolRegistry } from "../toolRegistry";
import { MessageConverter } from "../services/messageConverter";

suite("Model provider conversions", () => {
  test("toAiCoreMessages should handle text parts", async () => {
    const textPart = new (vscode as any).LanguageModelTextPart("please create");

    const msg: any = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [textPart],
      name: undefined,
    } as vscode.LanguageModelChatRequestMessage;

    // invoke MessageConverter.toAiCoreMessages
    const out = await MessageConverter.toAiCoreMessages([msg]);
    assert.ok(Array.isArray(out), "expected array");
    assert.strictEqual(out.length, 1);
    const entry = out[0] as any;
    
    assert.strictEqual(entry.role, 'user');
    assert.strictEqual(entry.content[0].text, "please create");
  });

  test("resolveToolDefinitions falls back to vscode.lm.tools", () => {
    const fakeRepo: any = { getProviders: () => [], findModel: () => null };
    const provider = new AddiChatProvider(fakeRepo as any);
    try {
      ToolRegistry.resetForTests();
      ToolRegistry.setFallbackToolsForTests([
        {
          name: "vscode.echo",
          description: "Echo text back",
          inputSchema: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
            required: ["message"],
          },
        },
      ]);
      const definitions = (provider as any).resolveToolDefinitions(undefined) as ReadonlyArray<vscode.LanguageModelChatTool> | undefined;
      assert.ok(definitions, "expected fallback definitions");
      assert.strictEqual(definitions!.length, 1);
      
      const entry = definitions![0];
      assert.ok(entry);
      assert.strictEqual(entry.name, "vscode.echo");
      assert.strictEqual(entry.description, "Echo text back");
    } finally {
      ToolRegistry.resetForTests();
    }
  });
});
