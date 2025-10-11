import * as assert from "assert";

// 抽象出一个纯函数用于参数持久化测试（模拟 commands.ts 的逻辑）
interface Params {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  systemPrompt?: string | undefined;
}

function sanitizeParams(input: Params, prev: Params): Params {
  const out: Params = { ...prev };
  if (typeof input.temperature === "number") {
    out.temperature = input.temperature;
  }
  if (typeof input.topP === "number") {
    out.topP = Math.min(Math.max(input.topP, 0), 1);
  }
  if (typeof input.maxOutputTokens === "number") {
    const v = Math.floor(input.maxOutputTokens);
    if (isFinite(v) && v > 0) {
      out.maxOutputTokens = Math.min(Math.max(v, 1), 8192);
    }
  }
  if (typeof input.presencePenalty === "number") {
    out.presencePenalty = Math.min(Math.max(input.presencePenalty, -2), 2);
  }
  if (typeof input.frequencyPenalty === "number") {
    out.frequencyPenalty = Math.min(Math.max(input.frequencyPenalty, -2), 2);
  }
  if (typeof input.systemPrompt === "string") {
    const sp = input.systemPrompt.trim();
    out.systemPrompt = sp.length ? sp : undefined;
  }
  return out;
}

suite("Playground 参数持久化逻辑", () => {
  test("sanitizeParams clamps and keeps previous", () => {
    const prev: Params = { temperature: 0.7, topP: 1, maxOutputTokens: 1024, presencePenalty: 0, frequencyPenalty: 0 };
    const next = sanitizeParams({ temperature: 1.2, topP: 1.5, maxOutputTokens: 9000, presencePenalty: 3, frequencyPenalty: -3, systemPrompt: "  " }, prev);
    assert.strictEqual(next.temperature, 1.2);
    assert.strictEqual(next.topP, 1); // clamp
    assert.strictEqual(next.maxOutputTokens, 8192); // clamp upper
    assert.strictEqual(next.presencePenalty, 2);
    assert.strictEqual(next.frequencyPenalty, -2);
    assert.strictEqual(next.systemPrompt, undefined); // trimmed empty
  });

  test("sanitizeParams updates subset only", () => {
    const prev: Params = { temperature: 0.5, topP: 0.9, maxOutputTokens: 500 };
    const next = sanitizeParams({ topP: 0.1 }, prev);
    assert.strictEqual(next.temperature, 0.5);
    assert.strictEqual(next.topP, 0.1);
    assert.strictEqual(next.maxOutputTokens, 500);
  });
});
