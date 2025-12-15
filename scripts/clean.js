#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🧹 清理项目缓存和构建文件...\n');

const dirsToClean = [
  { name: 'dist (webpack 构建输出)', path: 'dist' },
  { name: 'out (TypeScript 编译输出)', path: 'out' },
  { name: '.vscode-test (VS Code 测试缓存)', path: '.vscode-test' }
];

const filesToClean = [
  { name: '*.vsix (VS Code 扩展包)', pattern: '*.vsix' }
];

let totalSize = 0;

// 检查目录大小
function getDirSize(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }
  
  let size = 0;
  const files = fs.readdirSync(dirPath);
  
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      size += getDirSize(filePath);
    } else {
      size += stats.size;
    }
  }
  
  return size;
}

// 清理目录
for (const dir of dirsToClean) {
  if (fs.existsSync(dir.path)) {
    const size = getDirSize(dir.path);
    totalSize += size;
    console.log(`📁 ${dir.name}: ${(size / 1024 / 1024).toFixed(2)} MB`);
    
    try {
      execSync(`rimraf "${dir.path}"`, { stdio: 'inherit' });
      console.log(`✅ 已删除: ${dir.name}\n`);
    } catch (error) {
      console.error(`❌ 删除失败: ${dir.name}`, error.message);
    }
  } else {
    console.log(`⏭️  跳过: ${dir.name} (不存在)\n`);
  }
}

// 清理文件
for (const file of filesToClean) {
  try {
    // 使用 PowerShell 命令来获取文件信息（Windows 兼容）
    const result = execSync(`powershell -Command "Get-ChildItem -Path '${file.pattern}' -ErrorAction SilentlyContinue | Select-Object Name, Length | ConvertTo-Json"`, { encoding: 'utf8' });
    
    if (result.trim() && result.trim() !== '[]') {
      console.log(`📄 ${file.name}:`);
      
      try {
        const files = JSON.parse(result.trim());
        let fileSize = 0;
        
        if (Array.isArray(files)) {
          for (const fileObj of files) {
            if (fileObj.Length) {
              fileSize += fileObj.Length;
            }
          }
        }
        
        totalSize += fileSize;
        console.log(`   大小: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
        
        execSync(`powershell -Command "Remove-Item '${file.pattern}' -Force -ErrorAction SilentlyContinue"`, { stdio: 'inherit' });
        console.log(`✅ 已删除: ${file.name}\n`);
      } catch (parseError) {
        // 如果 JSON 解析失败，直接删除
        execSync(`powershell -Command "Remove-Item '${file.pattern}' -Force -ErrorAction SilentlyContinue"`, { stdio: 'inherit' });
        console.log(`✅ 已删除: ${file.name}\n`);
      }
    } else {
      console.log(`⏭️  跳过: ${file.name} (不存在)\n`);
    }
  } catch (error) {
    console.log(`⏭️  跳过: ${file.name} (不存在)\n`);
  }
}

console.log(`🎉 清理完成！总计释放空间: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);