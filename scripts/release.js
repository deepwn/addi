#!/usr/bin/env bun
/**
 * Release script — builds VSIX and publishes to GitHub.
 *
 * Prerequisites:
 *   - GitHub CLI (`gh`) installed and authenticated (`gh auth login`)
 *   - Git configured with upstream remote
 *
 * Usage:
 *   bun run release:github          # shows plan and prompts [y/N]
 *   bun run release:github --yes    # skip prompt, publish directly
 *   bun run release:github -y       # same as --yes
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const version = pkg.version;
const vsixFile = join(root, `addi-${version}.vsix`);
const autoConfirm = process.argv.includes("--yes") || process.argv.includes("-y");

function run(cmd, opts = {}) {
  console.log(`  ⚡ Running: ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
}

function check(cmd) {
  try {
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function confirm(prompt) {
  if (autoConfirm) {
    console.log(`  ✅ ${prompt} --yes, proceeding.`);
    return true;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  ? ${prompt} [y/N] `, (answer) => {
      rl.close();
      resolve(["y", "Y", "yes", "YES"].includes(answer.trim()));
    });
  });
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

  // Check git status — warn always, error only if proceeding
  const status = execSync("git status --porcelain", { cwd: root, encoding: "utf-8" }).trim();
  if (status) {
    console.warn("  ⚠️  Uncommitted changes detected:");
    console.warn(
      status
        .split("\n")
        .map((l) => `     ${l}`)
        .join("\n"),
    );
  }

  // Check tag doesn't already exist
  const tag = `v${version}`;
  if (check(`git rev-parse --verify --quiet refs/tags/${tag}`)) {
    console.error(`  ❌ Tag ${tag} already exists. Delete it or bump version first.`);
    process.exit(1);
  }

  console.log(`  📄 Version: ${version}`);
  console.log(`  🏷️  Tag:     ${tag}`);
  console.log(`  📦 VSIX:    addi-${version}.vsix`);
  console.log(`  🌐 Remote:  ${pkg.repository.url}`);

  // ── Confirm ─────────────────────────────────────────
  const ok = await confirm("Publish this release to GitHub?");
  if (!ok) {
    console.log("\n  ✋ Release cancelled.\n");
    process.exit(0);
  }

  // ── Steps ───────────────────────────────────────────
  // 1. Build webview + extension
  run(`cd webview-ui && bun run build`, { shell: true });
  run(
    `bun build ./src/presentation/extension.ts --outdir ./dist --target node --format cjs --external vscode`,
    { shell: true },
  );

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
  run(
    `gh release create ${tag} "${vsixFile}" --title "Addi v${version}" --notes "See [CHANGELOG](./CHANGELOG.md) for details."`,
  );

  // ── Done ────────────────────────────────────────────
  console.log(`\n  ✅ Released Addi v${version} to GitHub!\n`);
}

main().catch((err) => {
  console.error(`\n  ❌ Release failed: ${err.message}`);
  process.exit(1);
});
