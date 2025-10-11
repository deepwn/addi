import * as assert from "assert";
import { CommandHandler } from "../commands";

suite("Provider sync diagnostics", () => {
  test("logs zhipu models fetch", async function () {
    this.timeout(15000);

  const apiKey = process.env["ZHIPU_API_KEY"];
    if (!apiKey) {
      console.warn("ZHIPU_API_KEY env var missing; skipping diagnostics");
      this.skip();
      return;
    }

    const handler = new CommandHandler({} as any, {} as any);
    const apiEndpoint = "https://open.bigmodel.cn/api/coding/paas/v4";

    const resolvedUrl = (handler as any).resolveModelsUrl(apiEndpoint, "https://api.openai.com/v1") as string;
    console.log("[diagnostic] resolved models URL:", resolvedUrl);

    const response = await fetch(resolvedUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    console.log("[diagnostic] response status:", response.status, response.statusText);
    console.log("[diagnostic] response headers:", Array.from(response.headers.entries()));

    const body = await response.text();
    console.log("[diagnostic] response body preview:", body.slice(0, 800));

    assert.ok(resolvedUrl.length > 0, "expected a resolved URL");
    assert.ok(response.status > 0, "expected a response status code");
  });
});
