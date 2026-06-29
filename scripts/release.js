#!/usr/bin/env bun
/**
 * Release script — builds VSIX and publishes to GitHub.
 *
 * Prerequisites:
 *   - GitHub CLI (`gh`) installed and authenticated (`gh auth login`)
 *   - Git configured with upstream remote
 *
 * Usage:
 *   bun run release:github        # dry-run (shows what will happen)
 *   bun run release:github --go   # actually publish
 */

const { readFileSync, existsSync } = require("fs");
const { resolve, join } = require("path");
const { execSync } = require("child_process");

const root = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const version = pkg.version;
const vsixFile = join(root, `addi-${version}.vsix`);
const isDryRun = !process.argv.includes("--go");

function run(cmd, opts = {}) {
	const label = isDryRun ? "  🔄 Would run:" : "  ⚡ Running:";
	console.log(`${label} ${cmd}`);
	if (!isDryRun) {
		execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
	}
}

function check(cmd) {
	try {
		execSync(cmd, { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

async function main() {
	console.log(`\n  📦 Addi v${version} Release\n`);

	// ── Checks ──────────────────────────────────────────
	if (!check("git --version")) {
		console.error("  ❌ Git not found.");
		process.exit(1);
	}
	if (!check("gh --version")) {
		console.error("  ❌ GitHub CLI (gh) not found. Install from https://cli.github.com/");
		process.exit(1);
	}
	if (!check("gh auth status")) {
		console.error("  ❌ Not authenticated with GitHub CLI. Run: gh auth login");
		process.exit(1);
	}

	// Check git status
	const status = execSync("git status --porcelain", { cwd: root, encoding: "utf-8" }).trim();
	if (status) {
		console.warn("  ⚠️  Uncommitted changes detected:");
		console.warn(status.split("\n").map(l => `     ${l}`).join("\n"));
		if (!isDryRun) {
			console.error("  ❌ Please commit all changes before releasing.");
			process.exit(1);
		}
	}

	// Check tag doesn't already exist
	const tag = `v${version}`;
	if (check(`git rev-parse --verify --quiet refs/tags/${tag}`)) {
		console.warn(`  ⚠️  Tag ${tag} already exists.`);
		if (!isDryRun) {
			console.error("  ❌ Delete the tag first or bump version.");
			process.exit(1);
		}
	}

	console.log(`  📄 Version: ${version}`);
	console.log(`  🏷️  Tag:     ${tag}`);
	console.log(`  📦 VSIX:    addi-${version}.vsix`);
	console.log(`  🌐 Remote:  ${pkg.repository.url}`);
	console.log(`\n  ── Dry run ──\n`);

	// ── Steps ───────────────────────────────────────────
	// 1. Build webview + extension
	run(`cd webview-ui && bun run build`, { shell: true });
	run(`bun build ./src/extension.ts --outdir ./dist --target node --format cjs --external vscode`, { shell: true });

	// 2. Package VSIX
	run(`bunx vsce package`, { shell: true });

	if (!existsSync(vsixFile)) {
		console.error(`  ❌ VSIX not found at ${vsixFile}`);
		process.exit(1);
	}

	// 3. Git tag & push
	run(`git tag -a ${tag} -m "Release ${tag}"`);
	run(`git push origin ${tag}`);

	// 4. Create GitHub release
	run(`gh release create ${tag} "${vsixFile}" --title "Addi v${version}" --notes "See [CHANGELOG](./CHANGELOG.md) for details."`);

	// ── Done ────────────────────────────────────────────
	if (isDryRun) {
		console.log(`\n  ✅ Dry-run complete. Run with --go to publish.`);
	} else {
		console.log(`\n  ✅ Released Addi v${version} to GitHub!`);
	}
}

main().catch((err) => {
	console.error(`\n  ❌ Release failed: ${err.message}`);
	process.exit(1);
});
