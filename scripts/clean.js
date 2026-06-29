#!/usr/bin/env bun
/**
 * Clean script — removes all build artifacts.
 * Usage: bun run clean
 */

const { rmSync, existsSync, readdirSync } = require("fs");
const { join, resolve } = require("path");

const root = resolve(__dirname, "..");

const targets = [
	join(root, "dist"),
	join(root, "resources", "webview", "assets"),
];

// Remove directories
for (const dir of targets) {
	if (existsSync(dir)) {
		rmSync(dir, { recursive: true, force: true });
		console.log(`  🗑  Removed: ${dir.replace(root, ".")}`);
	}
}

// Remove any .vsix files in root
const rootFiles = readdirSync(root);
for (const file of rootFiles) {
	if (file.endsWith(".vsix")) {
		const full = join(root, file);
		rmSync(full, { force: true });
		console.log(`  🗑  Removed: ${file}`);
	}
}

console.log("  ✅ Clean finished.");
