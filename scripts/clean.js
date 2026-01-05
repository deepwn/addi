#!/usr/bin/env bun
import { rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

console.log("🧹 清理项目缓存和构建文件...\n");

const dirsToClean = [
  { name: "dist (Bun 构建输出)", path: "dist" },
  { name: "out (TypeScript 编译输出)", path: "out" },
  // { name: '.vscode-test (VS Code 测试缓存)', path: '.vscode-test' }
];

const filesToClean = [{ name: "*.vsix (VS Code 扩展包)", pattern: /\.vsix$/ }];

let totalSize = 0;

// 递归获取目录大小
async function getDirSize(dirPath) {
  if (!existsSync(dirPath)) {
    return 0;
  }

  let size = 0;
  const files = await readdir(dirPath);

  for (const file of files) {
    const filePath = join(dirPath, file);
    const stats = await stat(filePath);

    if (stats.isDirectory()) {
      size += await getDirSize(filePath);
    } else {
      size += stats.size;
    }
  }

  return size;
}

async function clean() {
  // 清理目录
  for (const dir of dirsToClean) {
    if (existsSync(dir.path)) {
      const size = await getDirSize(dir.path);
      totalSize += size;
      console.log(`📁 ${dir.name}: ${(size / 1024 / 1024).toFixed(2)} MB`);

      try {
        await rm(dir.path, { recursive: true, force: true });
        console.log(`   ✅ 已删除`);
      } catch (e) {
        console.error(`   ❌ 删除失败: ${e.message}`);
      }
    } else {
      console.log(`⚪ ${dir.name}: 未找到 (无需清理)`);
    }
  }

  // 清理文件 (简单实现，只在根目录查找)
  const rootFiles = await readdir(".");
  for (const fileRule of filesToClean) {
    let found = false;
    for (const file of rootFiles) {
      if (fileRule.pattern.test(file)) {
        found = true;
        const stats = await stat(file);
        totalSize += stats.size;
        console.log(`📄 ${file}: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

        try {
          await rm(file);
          console.log(`   ✅ 已删除`);
        } catch (e) {
          console.error(`   ❌ 删除失败: ${e.message}`);
        }
      }
    }
    if (!found) {
      console.log(`⚪ ${fileRule.name}: 未找到`);
    }
  }

  console.log(`\n🎉 清理完成! 释放空间: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
}

clean();
