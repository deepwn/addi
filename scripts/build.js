import { build } from "bun";
import { rm } from "node:fs/promises";

const isProduction = process.argv.includes("--production");

console.log(`[Build] Starting build for ${isProduction ? "production" : "development"}...`);

// 清理 dist 目录
console.log("[Build] Cleaning dist directory...");
await rm("./dist", { recursive: true, force: true });

// 执行构建
const result = await build({
  entrypoints: ["./src/extension.ts"],
  outdir: "./dist",
  target: "node",
  format: "cjs",
  external: ["vscode"],
  sourcemap: isProduction ? "none" : "external",
  minify: isProduction,
});

if (!result.success) {
  console.error("[Build] Build failed!");
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}

console.log("[Build] Build completed successfully!");
